# Sentinel: Technical specification

Companion to [PRD.md](PRD.md) and [architecture.md](architecture.md). Feature numbers (F1–F10) refer to the PRD.

## 1. System overview
One Cloudflare Worker serves the React app as static assets and handles `/api/*`, `/mcp`, and the OAuth endpoints.
Domain logic lives in `packages/engine` and has no I/O; the Worker loads state from D1, calls the engine, and writes the
resulting state, audit events, and notifications in one transaction. See [architecture.md](architecture.md) for the diagram.

## 2. Data model (D1)
| Table | Purpose | Notes |
|---|---|---|
| `users` | People who can sign in | `unit_id` places a person in the organization tree; `is_admin` marks system administrators |
| `sessions` | Browser sessions | 12-hour expiry |
| `org_units` | Organization tree | `level`, `parent_id`, `head_user_id`, `acting_head_user_id`, `acting_until` |
| `reporting_exceptions` | Recorded exceptions to the tree | Always has a reason, start, and end |
| `authorities`, `authority_holders` | Authority matrix | A holder may be scoped to one branch of the tree |
| `org_owners`, `org_changes` | Review of organization changes | A change is proposed, reviewed, then applied on its effective date |
| `flow_versions` | Versioned flow definitions (JSON) | Status `draft` or `active`; active rows are frozen by triggers |
| `flow_owners` | Process owners per flow | |
| `requests` | Request state (JSON) with optimistic `rev` | Pinned to the `flow_version_id` it started under |
| `tasks` | Projection of open approval tasks | Rebuilt from request state on each write |
| `delegations` | Time-boxed delegations | |
| `audit_events` | Append-only audit trail | Update and delete are blocked by triggers |
| `notifications`, `attachments`, `chat_messages`, `sop_documents` | Supporting data | Attachment bytes are in R2 |
| `api_clients`, `request_sources` | Other systems allowed to file requests, and which request came from which system | Only the hash of an API key is stored; `external_ref` is unique per client, which makes retries safe |
| `webhooks`, `webhook_deliveries` | Where outcomes are sent, and the delivery queue | One delivery per request, event, and URL; retried with backoff by cron |

A flow definition has three parts: `fields` (the request form), `tables` (first-match rule tables), and `steps`
(approval, condition, parallel, notify). An approver is one of: superior N levels up, head of the requester's unit at a
level, holders of an authority, a named user, or a rule table. Examples are in `packages/engine/examples/`.

## 3. Interfaces
**HTTP API** (JSON, cookie session; all under `/api`):

| Area | Endpoints |
|---|---|
| Session | `POST /login`, `POST /logout`, `GET /me` |
| Requests | `GET /flows`, `POST /requests`, `GET /requests`, `GET /requests/:id`, `POST /requests/:id/decision`, `POST /requests/:id/resubmit`, `POST /requests/:id/attachments`, `GET /inbox` |
| Delegations, notifications | `GET/POST /delegations`, `DELETE /delegations/:id`, `GET /reports`, `GET /notifications`, `POST /notifications/read` |
| Flow management | `GET /admin/flows`, `PUT /admin/flows/:key/owners`, `POST /admin/drafts`, `GET /admin/versions/:id`, `PUT /admin/drafts/:id`, `POST /admin/simulate`, `POST /admin/drafts/:id/sop`, `POST /admin/drafts/:id/chat`, `POST /admin/drafts/:id/submit`, `POST /admin/drafts/:id/activate`, `GET /admin/audit`, `POST /admin/directory` |
| Integrations, for other systems (API key) | `GET /integrations/flows`, `POST /integrations/requests`, `GET /integrations/requests/:id` |
| Integrations, administration | `GET /admin/integrations`, `POST /admin/integrations/clients`, `DELETE /admin/integrations/clients/:id`, `POST /admin/integrations/webhooks`, `DELETE /admin/integrations/webhooks/:id`, `GET /admin/integrations/deliveries`, `POST /admin/integrations/deliveries/:id/retry` |
| Organization | `GET /org`, `GET /org/chain/:id`, `GET/POST /org/changes`, `POST /org/changes/:id/review`, `GET /org/coverage`, `PUT /org/owners`, `POST /org/import/units` |

Errors are `{ "error": string, "code"?: string }`. Engine error codes map to HTTP status: `INVALID_DATA` 400,
`SOD_VIOLATION`/`NOT_ASSIGNEE`/`FORBIDDEN` 403, `INVALID_STATE` 409, `INVALID_DEFINITION`/`ROUTING` 422.

**Inbound API.** Another system sends `Authorization: Bearer <key>` and
`{ flowKey, requesterEmail, data, externalRef?, callbackUrl? }` to `POST /api/integrations/requests`. The request is
started for that employee and follows the flow in effect exactly like one filed in the web app, including separation
of duties. Sending the same `externalRef` again returns the first request instead of creating another. `callbackUrl`
must be https and its host must be on the client's allowed list. A system can read only the requests it filed.

**Outbound webhooks.** When a request becomes `approved`, `rejected`, or `cancelled`, Sentinel POSTs
`{ id, event, occurredAt, request: { id, flowKey, flowVersionId, status, externalRef, requesterEmail } }` to every
webhook registered for that flow (or for all flows) and to the request's own `callbackUrl`. `event` is
`request.approved`, `request.rejected`, or `request.cancelled`. Each call carries
`X-Sentinel-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 of `<t>.<body>` with the signing secret;
receivers should recompute it and reject old timestamps. A delivery that does not get a 2xx answer within 5 seconds
is retried after 1, 5, 30, 120, and 720 minutes, then marked failed; an administrator can send it again. The first
attempt runs after the response to the decision is sent (`ctx.waitUntil`), so nobody waits on other systems; retries
run on the 15-minute cron, so each wait is rounded up to the next cron run. Form data is not included in the payload.
A delivery failure never changes the decision.

**MCP** (`/mcp`, Streamable HTTP, stateless): 42 tools defined in `apps/api/src/mcp.ts`. Each tool validates its input
with a schema and calls one API endpoint in-process as the authorized user. OAuth 2.1 with PKCE and dynamic client
registration: `/authorize`, `/oauth/token`, `/oauth/register`, metadata under `/.well-known/`.

**AI drafter**: `POST /admin/drafts/:id/chat` sends the SOP text, the current draft, and authority names to Claude
through AI Gateway. The model must call a single tool, `propose_draft`, with a complete definition and citations; the
result is validated before it is stored, and validation errors are returned to the model to fix.

## 4. Acceptance criteria and where they are tested
| Feature | Criterion | Automated test |
|---|---|---|
| F1 | Valid request opens the first task; invalid data is rejected | `packages/engine/test/engine.test.ts`, `apps/api/test/api.test.ts` (request lifecycle) |
| F2 | Inbox shows only the user's and delegated tasks | `apps/api/test/api.test.ts` (inbox, delegation) |
| F3 | Requester can never decide own request; editor cannot activate own draft | `packages/engine/test/sod.test.ts` |
| F4 | Draft from chat is stored with citations; unverified quotes are flagged; AI receives no employee data; ambiguous SOP leads to a question | `apps/api/test/api.test.ts` (flow drafting) |
| F5 | A path without approval is rejected; simulation matches execution | `packages/engine/test/routing.test.ts`, `rules.test.ts` |
| F6 | Superior from unit head, vacancy escalation, exceptions, stated reason | `packages/engine/test/org.test.ts` |
| F7 | Second-owner review, scheduled application, task rerouting, coverage test | `apps/api/test/api.test.ts` (organization master), `org.test.ts` |
| F8 | One reminder, escalation never adds the requester | `packages/engine/test/sla.test.ts` |
| F9 | Audit rows and active versions are immutable | `packages/engine/test/audit.test.ts`, `apps/api/test/api.test.ts` (audit in database) |
| F10 | MCP round trip with OAuth; forbidden calls return 403 | Manual end-to-end check against the live URL (not yet automated; tracked as a v2 issue) |
| F11 | API key required; request filed by another system follows the same flow; duplicate `externalRef` is not created twice; signed webhook on the final outcome; failed delivery retried; revoked key rejected | `apps/api/test/api.test.ts` (integrations) |

Rule evaluation has a parity test: over 40,000 combinations of operators and values give the same result as the
reference semantics (`rules.test.ts`).

## 5. Test and deployment plan
- `npm run typecheck`, `npm test` (102 tests), and `npm run build` must pass locally and in CI.
- GitHub Actions (`.github/workflows/ci.yml`): every push and pull request runs audit, typecheck, tests, and build.
- Deployment is manual: `npm run deploy:test` builds the web app and deploys the Worker; D1 migrations are applied
  with `wrangler d1 migrations apply`. The Cloudflare account is read from `CLOUDFLARE_ACCOUNT_ID`, and no cloud
  credentials are stored in GitHub. Configuration is in `apps/api/wrangler.jsonc`. The application itself needs no
  secret: AI goes through the Worker AI binding.
- Monitoring: Workers observability is enabled (logs and request traces in the Cloudflare dashboard); AI usage and
  cost are visible per request in AI Gateway.

## 6. Revisions after review
The first version of this design was reviewed against real organization data and by the product owner. Changes made:

| Original design | Finding in review | Revision |
|---|---|---|
| Hand-written condition evaluator | No runtime type checks; a wrong type compared silently | Conditions run on `json-rules-engine` with typed facts and fail-closed errors |
| Each person stores a `manager_id` | Per-person approver data in the source system was inconsistent with the actual structure | Superiors are computed from an organization tree with vacancy escalation and recorded exceptions |
| Free-text roles on users | "Who may approve this" was mixed up with "who is my superior" | A separate authority matrix; flows label each step as by structure or by authority |
| Administrators could not edit flows | First-phase users are the IT team alone | Administrators may act alone; each such action is flagged `adminOverride` in the audit trail |
| AI through a provider key stored as a Worker secret | A stored key is avoidable on Workers | AI binding plus AI Gateway; no key or token is stored |
| Results pushed only to the ERP through a fixed adapter | Validation showed approval logic scattered across applications; other systems need to hand requests in and learn the outcome | Inbound API with per-system keys and signed outbound webhooks; approval rules stay only in Sentinel |
| Indonesian UI | Product owner asked for professional English | All screens and messages translated; data entered by users is left as written |

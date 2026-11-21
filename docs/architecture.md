# Architecture notes

```
Browser (React SPA)          MCP client (Claude, etc.)
        │  /api/*  cookie session        │  /mcp  OAuth bearer token
        ▼                                ▼
┌───────────────────────── Cloudflare Worker ─────────────────────────┐
│ worker.ts   OAuth provider ── /authorize consent page (authorize.ts) │
│             └─ mcp.ts: 42 tools, each calls the API in-process       │
│ index.ts    Hono API: auth, requests, admin (flows), org             │
│ ai.ts       AI drafter ── AI binding ── AI Gateway ── Claude         │
│ cron        every 15 min: apply due org changes, SLA reminders       │
└───────────────┬───────────────┬───────────────┬─────────────────────┘
                ▼               ▼               ▼
        D1 (SQLite)        R2 (attachments)   KV (OAuth grants)
```

## Packages
| Package | Responsibility |
|---|---|
| `packages/engine` | Pure domain logic with no I/O: flow definition schema, validation, rule evaluation, approver resolution from the organization tree, request state machine, SLA, simulation, coverage test |
| `apps/api` | Cloudflare Worker: HTTP API, persistence, AI drafter, MCP server, OAuth consent, cron |
| `apps/web` | React single-page app served as static assets by the same Worker |

## Decisions and why
| Decision | Reason |
|---|---|
| Domain logic in a pure package | The rules that matter (separation of duties, routing, validation) are tested without a database or network, and simulation uses the same code path as production |
| Rule conditions evaluated by `json-rules-engine` | A mature, widely used engine instead of a hand-written evaluator; facts are type-checked and any evaluation error stops routing rather than silently picking another row |
| Flow definitions are versioned JSON, active versions frozen by database triggers | A request is always processed with the version it was created under, so past decisions can be reproduced |
| Approvers computed from an organization tree, not stored per person | Per-person approver fields drift; a tree with one head per unit gives one answer, and vacancies escalate by rule with a recorded reason |
| The AI can only edit drafts | Activation is a human action; the model's output passes the same validation as a human's and each rule needs a quote that is checked as an exact substring of the SOP |
| MCP tools call the HTTP API in-process as the authorized user | One implementation of permissions, validation, and audit for both the browser and AI clients |
| AI through the Worker AI binding and AI Gateway | No provider key or gateway token is stored anywhere; usage is logged and can be capped at the gateway |
| Cloudflare Workers + D1 + R2 + KV | One deployable unit, no servers to run, low idle cost for an internal tool |

## Security notes
- Sessions are HttpOnly, SameSite=Strict cookies; passwords are PBKDF2 hashes.
- Sign-in, in the app and on the OAuth consent page, is limited to 10 attempts per email per minute by the Workers Rate
  Limiting binding (`LOGIN_LIMITER`). It is keyed by email, not IP, because staff share office IPs.
- Secrets (password hashes, the CSRF token) are compared in constant time over their SHA-256 digests.
- Attachments are limited to 10 MB; larger uploads are refused from `Content-Length` before the body is read.
- The OAuth consent page always asks for an explicit decision, uses a CSRF token, and sets a restrictive Content Security Policy.
- A request is visible only to its requester, its approvers, and their active delegates.
- The AI drafter receives the SOP, the draft, and authority names, and never employee data.
- Other systems authenticate with a per-system API key that is shown once and stored only as a SHA-256 hash. A key lets a system file requests and read the ones it filed, nothing else.
- Webhook targets must be https, a request's callback URL must be on its client's allowed host list, redirects are not followed, and every delivery is signed with HMAC-SHA256.
- No secret is committed, and none is stored in GitHub: deploys are manual and the application reaches AI through a binding.

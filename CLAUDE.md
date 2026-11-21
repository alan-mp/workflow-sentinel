# Sentinel

Approval-workflow app: versioned flows owned by process owners, an AI drafter that cites the SOP, and approvers
computed from an organization tree. Product context is in `apps/web/PRODUCT.md`, requirements in `docs/PRD.md`,
design in `docs/spec.md` and `docs/architecture.md`, visual system in `apps/web/DESIGN.md`.

## Commands
- `npm install` then `npm run db:setup` (local D1 with demo data) and `npm run dev` (http://localhost:8787)
- `npm run typecheck`, `npm test`, `npm run build`: all three must pass before a change is done
- `npm run types` after any change to `apps/api/wrangler.jsonc`: `Env` is generated into `worker-configuration.d.ts`, and CI fails when it is stale
- `npx vitest run packages/engine` for engine tests only; API tests start a local workerd and take about 15 seconds
- `npm run deploy:test` deploys to the test environment (needs `CLOUDFLARE_ACCOUNT_ID` and a Cloudflare login)

## Layout
- `packages/engine`: pure domain logic, no I/O. `src/model.ts` is the browser-safe entry (definition and validation);
  the web app must import from `@sentinel/engine/model`, never from the package root
- `apps/api`: Cloudflare Worker (Hono). `src/worker.ts` is the entry; `src/index.ts` builds the API app and is what tests import
- `apps/web`: React + Vite SPA, hash routing, plain CSS in `src/styles.css` with tokens on `:root`

## Rules that must not be broken
- A requester never decides their own request. This is enforced in the engine (`act`), not only in the UI
- No flow path may finish without a human approval; `validateDefinition` rejects such definitions
- The AI only edits drafts. Nothing reachable by the model may activate a flow or decide a task
- `audit_events` is append-only and active flow versions are immutable; never add code that updates or deletes them
- Approvers are computed from the organization tree and the authority matrix. Do not store a superior per person
- Rule evaluation errors stop routing (fail closed). Do not catch them to fall through to another rule row
- Every state change goes through the engine and is persisted with its audit events in one batch (`commit` in `store.ts`)
- No secrets in the repository. AI goes through the `AI` binding; deploys are manual and read the account from the environment

## Conventions
- TypeScript strict mode with `noUncheckedIndexedAccess`; no `any` in the engine
- User-visible text is English, sentence case, and says what happened and what to do. Data values and identifiers
  (`direksi`, `departemen`, step ids) are not translated
- Dates display in `en-GB`, numbers in `en-US`
- New behavior gets a test next to the code it changes: engine rules in `packages/engine/test`, HTTP behavior in `apps/api/test`
- New API endpoints also get an MCP tool in `apps/api/src/mcp.ts`
- UI follows `apps/web/DESIGN.md`: color only for status and actions, one table text size, flat surfaces
- Commit messages: imperative summary line, then why the change was made

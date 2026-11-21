import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from './env';
import { internalUsers } from './index';

// Every MCP tool is a thin wrapper over the same HTTP API the web app uses, called
// in-process as the authorized user. Permissions, validation, separation of duties
// and audit logging therefore behave identically whether an action comes from the
// browser or from an AI client.

interface Call {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}
interface ToolSpec<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** True when the tool only reads data. */
  readOnly?: boolean;
  call: (args: z.infer<S>) => Call;
}
const tool = <S extends z.ZodObject>(spec: ToolSpec<S>) => spec;

const id = (what: string) => z.string().min(1).describe(what);
const requestId = id('Request ID, for example REQ-7F3A9C21');
const draftId = id('Flow version ID of a draft');
const isoDate = (what: string) => z.string().describe(`${what} as an ISO 8601 timestamp`);

const orgChange = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('unit_upsert'), id: z.string().optional(), name: z.string(), level: z.enum(['direksi', 'divisi', 'departemen', 'unit', 'seksi']), parentId: z.string().nullable().optional() }),
    z.object({ kind: z.literal('unit_delete'), id: z.string() }),
    z.object({ kind: z.literal('unit_head'), id: z.string(), headUserId: z.string().nullable().optional(), actingHeadUserId: z.string().nullable().optional(), actingUntil: z.string().nullable().optional() }),
    z.object({ kind: z.literal('user_place'), userId: z.string(), unitId: z.string(), title: z.string().nullable().optional() }),
    z.object({ kind: z.literal('exception_add'), userId: z.string(), toUserId: z.string(), flowKey: z.string().nullable().optional(), reason: z.string(), startsAt: z.string(), endsAt: z.string() }),
    z.object({ kind: z.literal('exception_end'), id: z.string() }),
    z.object({ kind: z.literal('authority_upsert'), id: z.string(), name: z.string(), description: z.string().optional() }),
    z.object({ kind: z.literal('authority_delete'), id: z.string() }),
    z.object({ kind: z.literal('holder_add'), authorityId: z.string(), userId: z.string(), scopeUnitId: z.string().nullable().optional() }),
    z.object({ kind: z.literal('holder_remove'), authorityId: z.string(), userId: z.string(), scopeUnitId: z.string().nullable().optional() }),
  ])
  .describe('One change to the organization master. Units have exactly one head; a definitive head must be a member of the unit; an acting head needs actingUntil.');

const none = z.object({});

export const TOOLS = [
  // ----- Identity -----
  tool({ name: 'whoami', title: 'Current user', description: 'Return the signed-in user, whether they are a system administrator, and which flows and masters they manage.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/me' }) }),

  // ----- Requests -----
  tool({ name: 'list_request_types', title: 'List request types', description: 'List the approval flows currently in effect, with the form fields each one requires. Use this before create_request.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/flows' }) }),
  tool({
    name: 'create_request',
    title: 'Submit a request',
    description: 'Submit a new request on behalf of the signed-in user. Approvers are assigned automatically by the flow; the user can never approve their own request.',
    input: z.object({ flowKey: id('Flow key from list_request_types'), data: z.record(z.string(), z.unknown()).describe('Form values keyed by field key; numbers as numbers, dates as YYYY-MM-DD') }),
    call: (a) => ({ method: 'POST', path: '/requests', body: a }),
  }),
  tool({ name: 'list_my_requests', title: 'My requests', description: 'List requests submitted by the signed-in user, with status and who each open step is waiting on.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/requests' }) }),
  tool({ name: 'get_request', title: 'Request detail', description: 'Get one request: form values, attachments, approval steps with the reason each approver was assigned, the full audit timeline, and insight: an AI briefing and, for approvers only (never the requester), anomaly flags such as a purchase split below an approval limit.', input: z.object({ requestId }), readOnly: true, call: (a) => ({ method: 'GET', path: `/requests/${encodeURIComponent(a.requestId)}` }) }),
  tool({ name: 'list_inbox', title: 'Approval inbox', description: 'List approval tasks waiting for the signed-in user, including tasks delegated to them, ordered by due date. flags is the number of anomaly flags on the request; open it with get_request to read them.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/inbox' }) }),
  tool({
    name: 'decide_task',
    title: 'Decide an approval task',
    description: 'Approve, reject, or request revision on an approval task. This is a real decision recorded in the audit trail under the signed-in user. Confirm with the user before calling. Get taskId from list_inbox or get_request.',
    input: z.object({ requestId, taskId: id('Task ID from list_inbox or get_request'), type: z.enum(['approve', 'reject', 'request_revision']), comment: z.string().optional().describe('Reason; strongly recommended for reject and request_revision') }),
    call: (a) => ({ method: 'POST', path: `/requests/${encodeURIComponent(a.requestId)}/decision`, body: { taskId: a.taskId, type: a.type, comment: a.comment } }),
  }),
  tool({
    name: 'resubmit_request',
    title: 'Resubmit after revision',
    description: 'Resubmit a request that was returned for revision, with corrected form values. Only the requester can do this; approval restarts from the first step.',
    input: z.object({ requestId, data: z.record(z.string(), z.unknown()) }),
    call: (a) => ({ method: 'POST', path: `/requests/${encodeURIComponent(a.requestId)}/resubmit`, body: { data: a.data } }),
  }),
  tool({ name: 'list_notifications', title: 'Notifications', description: 'List the 50 most recent notifications for the signed-in user.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/notifications' }) }),
  tool({ name: 'mark_notifications_read', title: 'Mark notifications read', description: 'Mark all notifications of the signed-in user as read.', input: none, call: () => ({ method: 'POST', path: '/notifications/read' }) }),

  // ----- Delegations -----
  tool({ name: 'list_people', title: 'List people', description: 'List people (ID and name) who can be chosen as a delegate.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/users' }) }),
  tool({ name: 'list_direct_reports', title: 'Direct reports', description: 'List people whose direct superior is the signed-in user. A superior may create a delegation on their behalf.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/reports' }) }),
  tool({ name: 'list_delegations', title: 'Delegations', description: 'List active and scheduled delegations that involve the signed-in user.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/delegations' }) }),
  tool({
    name: 'create_delegation',
    title: 'Create a delegation',
    description: 'Let another person decide approval tasks on behalf of the signed-in user (or of a direct report) for a limited period. Decisions stay recorded as made on behalf of the original approver.',
    input: z.object({ toUserId: id('User ID of the delegate'), startsAt: isoDate('Start'), endsAt: isoDate('End'), fromUserId: z.string().optional().describe('Direct report to delegate for; omit to delegate your own approvals') }),
    call: (a) => ({ method: 'POST', path: '/delegations', body: a }),
  }),
  tool({ name: 'revoke_delegation', title: 'Revoke a delegation', description: 'End a delegation the signed-in user created or owns.', input: z.object({ delegationId: id('Delegation ID from list_delegations') }), call: (a) => ({ method: 'DELETE', path: `/delegations/${encodeURIComponent(a.delegationId)}` }) }),

  // ----- Flow management (process owners and administrators) -----
  tool({ name: 'list_flows', title: 'Managed flows', description: 'List approval flows the signed-in user manages, with owners and every version (draft and active).', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/admin/flows' }) }),
  tool({ name: 'get_flow_version', title: 'Flow version', description: 'Get one flow version: the full definition (fields, rule tables, steps), SOP link, citations, validation issues, available authorities, and whether the signed-in user may edit or activate it.', input: z.object({ versionId: id('Flow version ID, for example purchase-v1') }), readOnly: true, call: (a) => ({ method: 'GET', path: `/admin/versions/${encodeURIComponent(a.versionId)}` }) }),
  tool({
    name: 'create_flow_draft',
    title: 'Create a flow draft',
    description: 'Start a new draft version of a flow, copied from the newest approved version. A flow has at most one open draft: if one exists, its ID is returned (existing: true) instead of a new draft. For a flow with no versions yet, also pass a name.',
    input: z.object({ flowKey: id('Flow key'), name: z.string().optional().describe('Display name; required only for the first draft of a new flow') }),
    call: (a) => ({ method: 'POST', path: '/admin/drafts', body: a }),
  }),
  tool({
    name: 'save_flow_draft',
    title: 'Save a flow draft',
    description: 'Replace the definition of a draft. The definition must be the complete object in the shape returned by get_flow_version (key, name, fields, tables, steps). It is validated before saving: every path must pass through at least one approval that cannot be skipped.',
    input: z.object({ draftId, definition: z.record(z.string(), z.unknown()).describe('Complete flow definition'), sopUrl: z.string().optional().describe('Link to the source SOP; required before activation') }),
    call: (a) => ({ method: 'PUT', path: `/admin/drafts/${encodeURIComponent(a.draftId)}`, body: { definition: a.definition, sopUrl: a.sopUrl } }),
  }),
  tool({
    name: 'simulate_flow',
    title: 'Simulate routing',
    description: 'Show who a request would be routed to, step by step, for a given requester and form values, assuming every approver approves. Works on unsaved definitions; nothing is stored.',
    input: z.object({ definition: z.record(z.string(), z.unknown()).describe('Complete flow definition to simulate'), requesterId: id('User ID of the hypothetical requester'), data: z.record(z.string(), z.unknown()).describe('Form values') }),
    readOnly: true,
    call: (a) => ({ method: 'POST', path: '/admin/simulate', body: a }),
  }),
  tool({ name: 'attach_sop_to_draft', title: 'Attach SOP text', description: 'Store the SOP text a draft is based on, so citations can be checked against it and the AI drafter can read it.', input: z.object({ draftId, name: z.string().describe('Document name'), content: z.string().describe('Full SOP text') }), call: (a) => ({ method: 'POST', path: `/admin/drafts/${encodeURIComponent(a.draftId)}/sop`, body: { name: a.name, content: a.content } }) }),
  tool({ name: 'ask_ai_to_draft_flow', title: 'Ask the AI drafter', description: 'Send a message to Sentinel\'s built-in AI drafter for this draft. It may ask clarifying questions or update the draft with citations to the SOP. It can only change the draft, never activate it.', input: z.object({ draftId, message: z.string() }), call: (a) => ({ method: 'POST', path: `/admin/drafts/${encodeURIComponent(a.draftId)}/chat`, body: { message: a.message } }) }),
  tool({ name: 'submit_flow_draft_for_review', title: 'Submit a draft for review', description: 'Notify the other process owners that a draft is ready to be reviewed and activated.', input: z.object({ draftId }), call: (a) => ({ method: 'POST', path: `/admin/drafts/${encodeURIComponent(a.draftId)}/submit` }) }),
  tool({
    name: 'activate_flow_draft',
    title: 'Activate a flow draft',
    description: 'Make a draft the version in effect from a date. New requests use it from then on; requests already in progress keep their original version. A process owner cannot activate a draft they edited; a system administrator can, and that is flagged in the audit trail. Confirm with the user before calling.',
    input: z.object({ draftId, effectiveFrom: isoDate('When the version takes effect') }),
    call: (a) => ({ method: 'POST', path: `/admin/drafts/${encodeURIComponent(a.draftId)}/activate`, body: { effectiveFrom: a.effectiveFrom } }),
  }),
  tool({ name: 'set_flow_owners', title: 'Set process owners', description: 'Administrators only. Set the process owners of a flow (at least two). Use a new flow key to register a new flow.', input: z.object({ flowKey: id('Flow key: lowercase letters, digits, underscore'), userIds: z.array(z.string()).min(2) }), call: (a) => ({ method: 'PUT', path: `/admin/flows/${encodeURIComponent(a.flowKey)}/owners`, body: { userIds: a.userIds } }) }),
  tool({ name: 'get_audit_log', title: 'Audit log', description: 'Administrators only. Read the append-only audit log of flow and organization changes.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/admin/audit' }) }),

  // ----- Organization master -----
  tool({ name: 'get_organization', title: 'Organization master', description: 'Get the organization master: unit tree with heads, people and their units, authority matrix with holders, reporting exceptions, open-task load per person, and structural findings (vacant heads, authorities without holders, and so on).', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/org' }) }),
  tool({ name: 'get_reporting_line', title: 'Reporting line', description: 'Show the chain of superiors for one person, with the reason for each level (unit head, acting head, escalation over a vacancy, reporting exception).', input: z.object({ userId: id('User ID') }), readOnly: true, call: (a) => ({ method: 'GET', path: `/org/chain/${encodeURIComponent(a.userId)}` }) }),
  tool({
    name: 'propose_org_change',
    title: 'Propose an organization change',
    description: 'Propose one change to units, unit heads, placements, reporting exceptions, or the authority matrix. The response lists the structural findings the change would introduce or resolve. An organization owner\'s proposal waits for a second owner; a system administrator\'s proposal applies immediately and is flagged in the audit trail. Open approval tasks are rerouted when a change takes effect.',
    input: z.object({ change: orgChange, effectiveFrom: z.string().optional().describe('ISO 8601 timestamp; defaults to now'), note: z.string().optional().describe('Note for the reviewer') }),
    call: (a) => ({ method: 'POST', path: '/org/changes', body: a }),
  }),
  tool({ name: 'list_org_changes', title: 'Organization changes', description: 'List proposed, scheduled, applied, and rejected organization changes with their impact and reviewers.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/org/changes' }) }),
  tool({ name: 'review_org_change', title: 'Review an organization change', description: 'Approve or reject a pending organization change. A proposer cannot review their own proposal unless they are a system administrator. Confirm with the user before calling.', input: z.object({ changeId: id('Change ID from list_org_changes'), decision: z.enum(['approve', 'reject']), note: z.string().optional() }), call: (a) => ({ method: 'POST', path: `/org/changes/${encodeURIComponent(a.changeId)}/review`, body: { decision: a.decision, note: a.note } }) }),
  tool({ name: 'run_coverage_test', title: 'Coverage test', description: 'Try every person as the requester of every flow in effect, including every rule-table row, and report whose approval path would dead-end and why.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/org/coverage' }) }),
  tool({ name: 'set_org_owners', title: 'Set organization owners', description: 'Administrators only. Set the owners of the organization master (at least two).', input: z.object({ userIds: z.array(z.string()).min(2) }), call: (a) => ({ method: 'PUT', path: '/org/owners', body: a }) }),
  tool({ name: 'import_units', title: 'Import units', description: 'Administrators only. Create or update organization units from CSV text with the header id,name,level,parent_id. Unit heads are not imported.', input: z.object({ csv: z.string() }), call: (a) => ({ method: 'POST', path: '/org/import/units', body: a.csv }) }),
  tool({ name: 'import_people', title: 'Import people', description: 'Administrators only. Create or update people from CSV text with the header id,email,name,unit_id,title,is_admin. New people get a temporary password, returned once.', input: z.object({ csv: z.string() }), call: (a) => ({ method: 'POST', path: '/admin/directory', body: a.csv }) }),
  // ----- Integrations -----
  tool({ name: 'list_integrations', title: 'Integrations', description: 'Administrators only. List API clients (other systems allowed to file requests) and registered webhooks. Keys and secrets are never returned here.', input: none, readOnly: true, call: () => ({ method: 'GET', path: '/admin/integrations' }) }),
  tool({
    name: 'create_api_client',
    title: 'Create an API client',
    description: 'Administrators only. Register another system that may file approval requests through POST /api/integrations/requests. Returns the API key and the webhook signing secret once; they cannot be read again, so hand them to the user immediately.',
    input: z.object({ name: z.string().min(1).describe('Name of the system, for example "HR application"'), callbackHosts: z.array(z.string()).optional().describe('Host names this system may use as callbackUrl, for example ["hr.example.com"]') }),
    call: (a) => ({ method: 'POST', path: '/admin/integrations/clients', body: a }),
  }),
  tool({ name: 'revoke_api_client', title: 'Revoke an API client', description: 'Administrators only. Revoke an API client so its key stops working. Requests it already filed continue through their flow. Confirm with the user before calling.', input: z.object({ clientId: id('API client ID from list_integrations') }), call: (a) => ({ method: 'DELETE', path: `/admin/integrations/clients/${encodeURIComponent(a.clientId)}` }) }),
  tool({
    name: 'create_webhook',
    title: 'Register a webhook',
    description: 'Administrators only. Register an https URL that is told when a request finishes (approved, rejected, or cancelled), for one flow or for all flows. Returns the signing secret once.',
    input: z.object({ url: z.string().describe('https URL that receives the POST'), flowKey: z.string().nullable().optional().describe('Flow key, or omit for all flows') }),
    call: (a) => ({ method: 'POST', path: '/admin/integrations/webhooks', body: a }),
  }),
  tool({ name: 'delete_webhook', title: 'Delete a webhook', description: 'Administrators only. Stop sending events to a registered webhook. Confirm with the user before calling.', input: z.object({ webhookId: id('Webhook ID from list_integrations') }), call: (a) => ({ method: 'DELETE', path: `/admin/integrations/webhooks/${encodeURIComponent(a.webhookId)}` }) }),
  tool({ name: 'list_webhook_deliveries', title: 'Webhook deliveries', description: 'Administrators only. List the latest webhook deliveries with status (pending, delivered, failed), attempts, and the last error.', input: z.object({ status: z.enum(['pending', 'delivered', 'failed']).optional() }), readOnly: true, call: (a) => ({ method: 'GET', path: `/admin/integrations/deliveries${a.status ? `?status=${a.status}` : ''}` }) }),
  tool({ name: 'retry_webhook_delivery', title: 'Retry a webhook delivery', description: 'Administrators only. Send a pending or failed webhook delivery again now.', input: z.object({ deliveryId: id('Delivery ID from list_webhook_deliveries') }), call: (a) => ({ method: 'POST', path: `/admin/integrations/deliveries/${encodeURIComponent(a.deliveryId)}/retry` }) }),
] as const;

type App = Hono<AppEnv>;

/** Runs one API call in-process as `userId`. The Request object itself carries the identity. */
async function invoke(app: App, env: Env, ctx: ExecutionContext, userId: string, call: Call): Promise<{ ok: boolean; status: number; body: unknown }> {
  const raw = typeof call.body === 'string';
  const request = new Request(`https://sentinel.internal/api${call.path}`, {
    method: call.method,
    headers: call.body === undefined || raw ? undefined : { 'content-type': 'application/json' },
    body: call.body === undefined ? undefined : raw ? (call.body as string) : JSON.stringify(call.body),
  });
  internalUsers.set(request, userId);
  const res = await app.fetch(request, env, ctx);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, body };
}

export function buildMcpServer(app: App, env: Env, ctx: ExecutionContext, userId: string): McpServer {
  const server = new McpServer(
    { name: 'sentinel', version: '1.0.0' },
    {
      instructions:
        'Sentinel is the approval workflow system of PT Mitra Prodin. Every tool acts as the signed-in user with exactly their permissions, and every change is written to an append-only audit trail. Decisions (decide_task, activate_flow_draft, review_org_change) are binding: confirm with the user before calling them. Amounts are in Indonesian Rupiah.',
    },
  );
  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.input, annotations: { readOnlyHint: Boolean(spec.readOnly), destructiveHint: false, openWorldHint: false } },
      async (args: unknown) => {
        const result = await invoke(app, env, ctx, userId, (spec.call as (a: unknown) => Call)(args));
        const message = !result.ok && result.body && typeof result.body === 'object' && 'error' in result.body ? String((result.body as { error: unknown }).error) : undefined;
        return {
          isError: !result.ok,
          content: [{ type: 'text' as const, text: result.ok ? JSON.stringify(result.body) : `Error ${result.status}: ${message ?? JSON.stringify(result.body)}` }],
        };
      },
    );
  }
  return server;
}

/** Handles one MCP request for an already-authorized user. Stateless: a server is built per request. */
export function mcpFetch(app: App, request: Request, env: Env, ctx: ExecutionContext, userId: string): Promise<Response> {
  return createMcpHandler(() => buildMcpServer(app, env, ctx, userId), { route: '/mcp', authContext: { props: { userId } } })(request, env, ctx);
}

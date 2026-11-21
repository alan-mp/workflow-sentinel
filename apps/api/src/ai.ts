import Anthropic from '@anthropic-ai/sdk';
import { validateDefinition, type FlowDefinition } from '@sentinel/engine';
import type { Env } from './env';

export interface DraftCitation {
  target: string;
  quote: string;
  section?: string;
  source: 'sop' | 'admin';
}

export interface DraftTurnInput {
  definition: FlowDefinition;
  sopText?: string;
  /** Nama peran yang ada di direktori. Tidak ada data orang yang dikirim ke AI. */
  roles: string[];
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
}

export interface DraftTurnOutput {
  reply: string;
  draft?: { definition: FlowDefinition; citations: DraftCitation[] };
}

/**
 * AI penyusun draf. Hanya mengembalikan teks dan usulan definisi; tidak punya
 * akses ke database, ERP, atau aksi approval. Penyimpanan dan aktivasi
 * dilakukan oleh kode pemanggil atas nama admin.
 */
export interface AiDrafter {
  run(input: DraftTurnInput): Promise<DraftTurnOutput>;
}

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You help an administrator at a manufacturing company turn SOPs and policies into approval flow definitions for an internal approval system.

Your output is only ever a draft. A human reviews it in a visual editor, the system checks it, and a second person must activate it. You cannot approve requests or activate anything, so your job is to make the draft faithful to the source and easy to verify.

## How to work

The admin gives you an SOP text, a description of rules, or a change request. Each turn you also receive the current draft, which may contain manual edits made in the visual editor. Start from that draft and change only what the request calls for.

If the source is ambiguous, contradicts itself, or leaves a gap that affects who approves what (for example a threshold stated two different ways, an amount range no rule covers, an approver named by a title that could mean two roles, or "the relevant manager" without saying which), ask the admin a specific question and do not call propose_draft in that turn. A wrong guess here silently routes real approvals to the wrong person. Ask all open questions at once, numbered, each quoting the passage that causes it. Cosmetic choices such as step names and ids are yours to make.

When nothing is blocking, call propose_draft with the complete definition. For every approval step, condition, and rule row, add a citation: for rules that come from the SOP, the quote must be copied verbatim from the SOP text (it is machine-checked as an exact substring, so do not paraphrase or stitch passages together) with the section label if there is one; for rules the admin stated in chat, use source "admin" and quote the admin's words. After the tool call succeeds, summarize in a few sentences what you drafted and point out anything the admin should double-check.

Approvers are referenced by role name, by management level above the requester, or through a rule table. Use role names from the provided list. If the SOP names a role that is not in the list, use a sensible snake_case name and tell the admin that this role must exist in the directory before the flow can run.

Reply to the admin in English, briefly and plainly.

## Definition format (JSON)

{
  "key": "snake_case id of the flow",
  "name": "display name",
  "fields": [{ "key": "amount", "label": "Nominal (Rp)", "type": "number"|"string"|"boolean"|"date", "optional"?: true }],
  "tables": [RuleTable],
  "steps": [Step]
}

Step is one of exactly four block types:
- { "type": "approval", "id", "name", "approver": Approver, "slaHours"?: number }
- { "type": "condition", "id", "name", "branches": [{ "when": [Condition], "steps": [Step] }], "otherwise": [Step] }  (first matching branch runs; "otherwise" may be empty)
- { "type": "parallel", "id", "name", "branches": [[Step], [Step], ...] }  (at least two branches; all must finish)
- { "type": "notify", "id", "name", "to": DirectApprover | { "kind": "requester" }, "message" }

Approver: DirectApprover | { "kind": "table", "tableId" }
DirectApprover: { "kind": "manager", "level": 1..5 } (level 1 = requester's direct superior, computed from the org tree) | { "kind": "unit_head", "level": "direksi"|"divisi"|"departemen"|"unit"|"seksi" } (head of the requester's unit at that level, or the nearest level above) | { "kind": "role", "role" } (holders of an authority from the authority matrix; use only ids listed in available_roles) | { "kind": "user", "userId" }
Prefer "unit_head" when the source names an organizational level ("kepala departemen", "kepala divisi"), "manager" when it says "atasan langsung", and "role" when the approver is defined by what is being requested rather than by who asks (finance, IT, HR sign-off).
Condition: { "field", "op": "eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in", "value" }. "field" is a field key or "requester.department". All conditions in a list must hold. "in" takes an array.
RuleTable: { "id", "name", "rows": [{ "id", "when": [Condition], "approver": DirectApprover | { "kind": "none" } }] }. The first matching row wins. The last row must have an empty "when" (the default). "none" means the step is not needed for that row.

Rules the system enforces: ids use lowercase letters, digits and underscores, and step ids are unique across the whole flow; every possible path must pass through at least one approval step that cannot be skipped; if several people hold a role, any one of them can decide, so use a parallel block when all must approve. The requester can never approve their own request, vacant unit heads escalate to the unit above, and a structural approver who already approved an earlier step is replaced by the next level up; the system does all of this automatically, so do not model it.

Citation targets: a step id, or "tableId.rowId" for a rule row.`;

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_draft',
  description:
    'Save a complete flow definition as the current draft so the admin sees it in the visual editor. Call this only when no open question about routing remains. The definition is validated; if validation fails you get the errors back and should fix them and call again.',
  input_schema: {
    type: 'object',
    properties: {
      definition: { type: 'object', description: 'The complete flow definition in the documented JSON format.' },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Step id, or "tableId.rowId".' },
            quote: { type: 'string', description: 'Verbatim passage from the SOP, or the admin\'s words.' },
            section: { type: 'string', description: 'Section label in the SOP, if any.' },
            source: { type: 'string', enum: ['sop', 'admin'] },
          },
          required: ['target', 'quote', 'source'],
        },
      },
    },
    required: ['definition', 'citations'],
  },
};

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

export class ClaudeDrafter implements AiDrafter {
  constructor(private client: Anthropic) {}

  async run(input: DraftTurnInput): Promise<DraftTurnOutput> {
    const context = [
      `<current_draft>\n${JSON.stringify(input.definition, null, 2)}\n</current_draft>`,
      `<available_roles>${input.roles.join(', ')}</available_roles>`,
      input.sopText ? `<sop>\n${input.sopText}\n</sop>` : '<sop>(no SOP uploaded yet)</sop>',
    ].join('\n\n');
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: `${context}\n\n${input.message}` },
    ];
    let draft: DraftTurnOutput['draft'];

    for (let round = 0; round < 4; round++) {
      const response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [PROPOSE_TOOL],
        messages,
      });

      if (response.stop_reason === 'refusal') {
        return { reply: 'The AI declined to process this request. Try rephrasing it, or edit the flow in the visual editor.', draft };
      }
      if (response.stop_reason === 'max_tokens') {
        return { reply: 'The AI response was cut off because it was too long. Try asking for a smaller change.', draft };
      }
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (calls.length === 0) return { reply: textOf(response.content), draft };

      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((call) => {
        const args = call.input as { definition?: unknown; citations?: DraftCitation[] };
        const checked = validateDefinition(args.definition);
        if (!checked.definition) {
          const errors = checked.issues.filter((i) => i.level === 'error').map((i) => `- ${i.message}`);
          return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Validation failed:\n${errors.join('\n')}` };
        }
        draft = { definition: checked.definition, citations: Array.isArray(args.citations) ? args.citations : [] };
        return { type: 'tool_result', tool_use_id: call.id, content: 'Draft saved and shown in the visual editor.' };
      });
      messages.push({ role: 'user', content: results });
    }
    return {
      reply: draft
        ? 'The draft has been updated. Review it in the editor.'
        : 'I could not produce a draft that passes validation. Try describing the rules in more detail.',
      draft,
    };
  }
}

/**
 * Preferred setup: the Worker's AI binding plus AI Gateway Unified Billing. Requests go
 * through the binding, which is already authenticated, and carry no provider key, so the
 * Worker holds no secret at all; Cloudflare bills the usage to the account's credits.
 */
function bindingClient(ai: Ai, gatewayId: string): Anthropic {
  const gateway = ai.gateway(gatewayId);
  return new Anthropic({
    // The SDK insists on a key; it is stripped below and never leaves the Worker.
    apiKey: 'unified-billing',
    baseURL: 'https://ai-gateway.binding',
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        if (key !== 'x-api-key' && key !== 'authorization') headers[key] = value;
      });
      return gateway.run(
        { provider: 'anthropic', endpoint: `${url.pathname.replace(/^\//, '')}${url.search}`, headers, query: typeof init?.body === 'string' ? JSON.parse(init.body) : {} },
        { signal: init?.signal ?? undefined },
      );
    },
  });
}

export function drafterFromEnv(env: Env): AiDrafter | null {
  if (env.AI && env.AI_GATEWAY_ID) return new ClaudeDrafter(bindingClient(env.AI, env.AI_GATEWAY_ID));
  // Alternative: gateway URL with the Anthropic key held as a Worker secret.
  if (!env.AI_GATEWAY_URL || !env.ANTHROPIC_API_KEY) return null;
  return new ClaudeDrafter(
    new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.AI_GATEWAY_URL,
      defaultHeaders: env.AI_GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}` } : undefined,
    }),
  );
}

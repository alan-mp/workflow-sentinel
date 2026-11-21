import type { ErpAdapter, EmailNotifier } from './adapters';
import type { AiDrafter, AiSummarizer } from './ai';

/**
 * Bindings and vars are generated from wrangler.jsonc into worker-configuration.d.ts (`npm run types`).
 * Only what Wrangler cannot see is declared here: secrets and the helpers OAuthProvider injects.
 */
export interface Env extends Cloudflare.Env {
  /** Secret, only for the gateway-URL alternative: authenticates to an authenticated AI Gateway. */
  AI_GATEWAY_TOKEN?: string;
  /** Secret, only for the gateway-URL alternative (AI_GATEWAY_URL). */
  ANTHROPIC_API_KEY?: string;
  /** Disisipkan OAuthProvider di setiap permintaan. */
  OAUTH_PROVIDER?: import('@cloudflare/workers-oauth-provider').OAuthHelpers;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  department: string;
  /** Admin sistem (IT). Pemilik proses dicatat per alur di tabel flow_owners. */
  isAdmin: boolean;
}

export interface Deps {
  erp: ErpAdapter;
  email: EmailNotifier;
  /** Diisi di test; di produksi dibuat dari Env (Claude lewat AI Gateway). */
  drafter?: AiDrafter;
  /** Diisi di test; di produksi dibuat dari Env. */
  summarizer?: AiSummarizer;
  /** Outbound HTTP for webhooks; replaced in tests. */
  http?: typeof fetch;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

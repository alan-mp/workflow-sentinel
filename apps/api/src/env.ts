import type { ErpAdapter, EmailNotifier } from './adapters';
import type { AiDrafter } from './ai';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** AI binding; with AI_GATEWAY_ID it reaches Claude through AI Gateway without any key. */
  AI?: Ai;
  /** Name of the AI Gateway to route through, for example "internal-apps". */
  AI_GATEWAY_ID?: string;
  /** https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic */
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  /** Penyimpanan klien, grant, dan token OAuth untuk server MCP. */
  OAUTH_KV?: KVNamespace;
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
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

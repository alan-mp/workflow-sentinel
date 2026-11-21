import type { ErpAdapter, EmailNotifier } from './adapters';
import type { AiDrafter } from './ai';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic */
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
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

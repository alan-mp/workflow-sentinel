import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { AiDrafter, AiSummarizer } from '../src/ai';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { DEMO_PASSWORD, seedSql } from '../scripts/seed';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Worker lokal dengan D1 dan R2 sungguhan (workerd), database kosong lalu diisi data contoh. */
export async function setup(drafter?: AiDrafter, summarizer?: AiSummarizer) {
  const proxy = await getPlatformProxy<Env>({ configPath: path('../wrangler.jsonc'), persist: false });
  const env = proxy.env;
  const migration = readdirSync(path('../migrations'))
    .sort()
    .map((f) => readFileSync(path(`../migrations/${f}`), 'utf8'))
    .join('\n');
  const statements = [...migration.split(/;\s*$/m), ...(await seedSql()).split(/;\s*$/m)].map((s) => s.trim()).filter(Boolean);
  for (const sql of statements) await env.DB.prepare(sql).run();

  const { app, deps } = createApp({ drafter, summarizer });
  const cookies = new Map<string, string>();

  /**
   * A stand-in for the Workers ExecutionContext: work handed to waitUntil is collected, and settle()
   * waits for it, the way the runtime finishes it after the response.
   */
  function executionContext() {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} };
    return { ctx: ctx as Partial<ExecutionContext> as ExecutionContext, settle: () => Promise.all(pending), pending };
  }

  /** Sends a request without settling background work, so tests can look at the state in between. */
  async function send(path: string, init: RequestInit) {
    const { ctx, settle, pending } = executionContext();
    const res = await app.request(path, init, env, ctx);
    return { res, settle, pending };
  }

  /** Sends a request and finishes its background work before returning. */
  async function request(path: string, init: RequestInit) {
    const { res, settle } = await send(path, init);
    await settle();
    return res;
  }

  async function prepare(user: string | null, method: string, body?: unknown): Promise<RequestInit> {
    const headers: Record<string, string> = {};
    if (user) {
      if (!cookies.has(user)) {
        const res = await request('/api/login', { method: 'POST', body: JSON.stringify({ email: `${user}@contoh.test`, password: DEMO_PASSWORD }) });
        cookies.set(user, res.headers.get('set-cookie')!.split(';')[0]!);
      }
      headers.cookie = cookies.get(user)!;
    }
    let payload: BodyInit | undefined;
    if (body instanceof FormData || typeof body === 'string') payload = body;
    else if (body !== undefined) payload = JSON.stringify(body);
    return { method, headers, body: payload };
  }

  async function call(user: string | null, method: string, url: string, body?: unknown) {
    const res = await request(`/api${url}`, await prepare(user, method, body));
    const text = await res.text();
    let json: any = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json };
  }

  return { env, deps, app, call, send, request, prepare, dispose: () => proxy.dispose() };
}

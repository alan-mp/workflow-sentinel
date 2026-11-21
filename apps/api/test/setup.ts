import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { AiDrafter } from '../src/ai';
import type { Env } from '../src/env';
import { createApp } from '../src/index';
import { DEMO_PASSWORD, seedSql } from '../scripts/seed';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Worker lokal dengan D1 dan R2 sungguhan (workerd), database kosong lalu diisi data contoh. */
export async function setup(drafter?: AiDrafter) {
  const proxy = await getPlatformProxy<Env>({ configPath: path('../wrangler.jsonc'), persist: false });
  const env = proxy.env;
  const migration = readdirSync(path('../migrations'))
    .sort()
    .map((f) => readFileSync(path(`../migrations/${f}`), 'utf8'))
    .join('\n');
  const statements = [...migration.split(/;\s*$/m), ...(await seedSql()).split(/;\s*$/m)].map((s) => s.trim()).filter(Boolean);
  for (const sql of statements) await env.DB.prepare(sql).run();

  const { app, deps } = createApp({ drafter });
  const cookies = new Map<string, string>();

  async function call(user: string | null, method: string, url: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (user) {
      if (!cookies.has(user)) {
        const res = await app.request(
          '/api/login',
          { method: 'POST', body: JSON.stringify({ email: `${user}@contoh.test`, password: DEMO_PASSWORD }) },
          env,
        );
        cookies.set(user, res.headers.get('set-cookie')!.split(';')[0]!);
      }
      headers.cookie = cookies.get(user)!;
    }
    let payload: BodyInit | undefined;
    if (body instanceof FormData || typeof body === 'string') payload = body;
    else if (body !== undefined) payload = JSON.stringify(body);
    const res = await app.request(`/api${url}`, { method, headers, body: payload }, env);
    const text = await res.text();
    let json: any = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json };
  }

  return { env, deps, app, call, dispose: () => proxy.dispose() };
}

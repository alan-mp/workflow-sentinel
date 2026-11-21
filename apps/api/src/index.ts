import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { EngineError } from '@sentinel/engine';
import { LogEmailNotifier, MockErpAdapter } from './adapters';
import { adminRoutes } from './admin';
import type { AppEnv, Deps, Env } from './env';
import { requestRoutes, runSla } from './requests';
import { randomToken, verifyPassword } from './security';
import { ConflictError } from './store';

const SESSION_HOURS = 12;
const STATUS: Record<string, 400 | 403 | 409 | 422> = {
  SOD_VIOLATION: 403,
  NOT_ASSIGNEE: 403,
  FORBIDDEN: 403,
  INVALID_STATE: 409,
  INVALID_DATA: 400,
  INVALID_DEFINITION: 422,
  ROUTING: 422,
};

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = { erp: new MockErpAdapter(), email: new LogEmailNotifier(), ...overrides };
  const app = new Hono<AppEnv>().basePath('/api');

  app.onError((e, c) => {
    if (e instanceof EngineError) return c.json({ error: e.message, code: e.code }, STATUS[e.code] ?? 400);
    if (e instanceof ConflictError) return c.json({ error: e.message }, 409);
    console.error(e);
    return c.json({ error: 'Terjadi kesalahan di server' }, 500);
  });

  app.post('/login', async (c) => {
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    const row = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .bind(String(email ?? '').toLowerCase())
      .first<{ id: string; password_hash: string | null }>();
    // Verifikasi tetap dijalankan walau user tidak ada, supaya waktunya tidak membocorkan email terdaftar.
    const ok = await verifyPassword(String(password ?? ''), row?.password_hash ?? 'pbkdf2$100000$AAAA$AAAA');
    if (!row || !ok) return c.json({ error: 'Email atau password salah' }, 401);
    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000);
    await c.env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, row.id, expires.toISOString())
      .run();
    setCookie(c, 'sid', token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/',
      expires,
    });
    return c.json({ ok: true });
  });

  app.post('/logout', async (c) => {
    const token = getCookie(c, 'sid');
    if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    deleteCookie(c, 'sid', { path: '/' });
    return c.json({ ok: true });
  });

  app.use('*', async (c, next) => {
    const token = getCookie(c, 'sid');
    const row = token
      ? await c.env.DB.prepare(
          `SELECT u.id, u.email, u.name, u.department, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ?`,
        )
          .bind(token, new Date().toISOString())
          .first<Record<string, unknown>>()
      : null;
    if (!row) return c.json({ error: 'Belum login' }, 401);
    c.set('user', {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      department: row.department as string,
      isAdmin: row.is_admin === 1,
    });
    await next();
  });

  app.get('/me', (c) => c.json(c.var.user));
  app.route('/', requestRoutes(deps));
  app.route('/admin', adminRoutes(deps));
  return { app, deps };
}

const { app, deps } = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env) {
    await runSla(env.DB, deps, new Date());
  },
} satisfies ExportedHandler<Env>;

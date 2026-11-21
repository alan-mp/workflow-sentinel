import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { EngineError } from '@sentinel/engine';
import { LogEmailNotifier, MockErpAdapter } from './adapters';
import { adminRoutes, ownedFlows } from './admin';
import { ChangeError, orgRoutes, ownsOrg } from './org';
import type { AppEnv, Deps, SessionUser } from './env';
import { integrationAdminRoutes, integrationApiRoutes } from './integrations';
import { requestRoutes } from './requests';
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

/**
 * Permintaan internal yang sudah diautentikasi (dipakai server MCP setelah OAuth).
 * Kuncinya objek Request, jadi tidak bisa dipalsukan dari luar lewat header apa pun.
 */
export const internalUsers = new WeakMap<Request, string>();

const toSessionUser = (row: Record<string, unknown>): SessionUser => ({
  id: row.id as string,
  email: row.email as string,
  name: row.name as string,
  department: row.department as string,
  isAdmin: row.is_admin === 1,
});

export async function userById(db: D1Database, id: string): Promise<SessionUser | null> {
  const row = await db.prepare('SELECT id, email, name, department, is_admin FROM users WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? toSessionUser(row) : null;
}

export async function sessionUser(db: D1Database, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.department, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .bind(token, new Date().toISOString())
    .first<Record<string, unknown>>();
  return row ? toSessionUser(row) : null;
}

/** Memeriksa email dan password; waktu verifikasi sama walau email tidak terdaftar. */
export async function verifyLogin(db: D1Database, email: string, password: string): Promise<string | null> {
  const row = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email.toLowerCase()).first<{ id: string; password_hash: string | null }>();
  const ok = await verifyPassword(password, row?.password_hash ?? 'pbkdf2$100000$AAAA$AAAA');
  return row && ok ? row.id : null;
}

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = { erp: new MockErpAdapter(), email: new LogEmailNotifier(), ...overrides };
  const app = new Hono<AppEnv>().basePath('/api');

  app.onError((e, c) => {
    if (e instanceof EngineError) return c.json({ error: e.message, code: e.code }, STATUS[e.code] ?? 400);
    if (e instanceof ConflictError) return c.json({ error: e.message }, 409);
    if (e instanceof ChangeError) return c.json({ error: e.message }, 400);
    console.error(e);
    return c.json({ error: 'Something went wrong on the server' }, 500);
  });

  app.post('/login', async (c) => {
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    const userId = await verifyLogin(c.env.DB, String(email ?? ''), String(password ?? ''));
    if (!userId) return c.json({ error: 'Incorrect email or password' }, 401);
    const row = { id: userId };
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

  // Other systems authenticate with an API key, so these routes sit before the session check.
  app.route('/integrations', integrationApiRoutes(deps));

  app.use('*', async (c, next) => {
    // Panggilan dari server MCP membawa identitas pengguna lewat objek Request itu sendiri, bukan header.
    const internalId = internalUsers.get(c.req.raw);
    const user = internalId ? await userById(c.env.DB, internalId) : await sessionUser(c.env.DB, getCookie(c, 'sid'));
    if (!user) return c.json({ error: 'Not signed in' }, 401);
    c.set('user', user);
    await next();
  });

  app.get('/me', async (c) =>
    c.json({ ...c.var.user, ownedFlows: await ownedFlows(c.env.DB, c.var.user), ownsOrg: await ownsOrg(c.env.DB, c.var.user) }),
  );
  app.route('/', requestRoutes(deps));
  app.route('/admin/integrations', integrationAdminRoutes(deps));
  app.route('/admin', adminRoutes(deps));
  app.route('/org', orgRoutes(deps));
  return { app, deps };
}

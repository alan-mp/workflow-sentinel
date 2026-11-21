import { Hono } from 'hono';
import type { AppEnv } from './env';

// A stand-in for another internal system that receives Sentinel's webhooks, used by the
// "HR application (simulation)" page to show an integration end to end. It exists only when
// DEMO_APPS is "on" (the test environment). It stores what it receives and can be switched
// offline to show failed deliveries and retries. Sample data only; nothing here is trusted.

const KEEP = 50;

export function demoRoutes() {
  const app = new Hono<{ Bindings: AppEnv['Bindings'] }>();

  app.use('*', async (c, next) => {
    if (c.env.DEMO_APPS !== 'on') return c.json({ error: 'Not found' }, 404);
    await next();
  });

  const online = async (db: D1Database) =>
    ((await db.prepare(`SELECT value FROM demo_settings WHERE key = 'receiver_online'`).first<{ value: string }>())?.value ?? 'true') === 'true';

  app.post('/hr/webhook', async (c) => {
    if (!(await online(c.env.DB))) return c.text('Receiver is offline', 503);
    const body = (await c.req.text()).slice(0, 20_000);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO demo_webhooks (received_at, event, delivery_id, signature, body) VALUES (?, ?, ?, ?, ?)').bind(
        new Date().toISOString(),
        c.req.header('x-sentinel-event') ?? null,
        c.req.header('x-sentinel-delivery') ?? null,
        c.req.header('x-sentinel-signature') ?? null,
        body,
      ),
      c.env.DB.prepare(`DELETE FROM demo_webhooks WHERE id NOT IN (SELECT id FROM demo_webhooks ORDER BY id DESC LIMIT ${KEEP})`),
    ]);
    return c.json({ received: true });
  });

  app.get('/hr/received', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM demo_webhooks ORDER BY id DESC LIMIT 20').all();
    return c.json({ online: await online(c.env.DB), received: results });
  });

  app.post('/hr/receiver', async (c) => {
    const { online: on } = await c.req.json<{ online: boolean }>();
    await c.env.DB.prepare(`INSERT OR REPLACE INTO demo_settings (key, value) VALUES ('receiver_online', ?)`).bind(String(Boolean(on))).run();
    return c.json({ online: Boolean(on) });
  });

  return app;
}

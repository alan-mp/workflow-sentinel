import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { Env, SessionUser } from './env';
import { sessionUser, userById, verifyLogin } from './index';
import { randomToken } from './security';

// The OAuth consent screen for MCP clients. It is rendered by the Worker itself
// (no JavaScript, no external assets) and always asks for an explicit decision:
// a signed-in browser session alone never grants access to a client.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cookie = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(/;\s*/)
    .map((p) => p.split('='))
    .find(([k]) => k === name)?.[1];

const CSRF_COOKIE = 'sentinel_authz';
const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function page(body: string, status = 200, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize access · Sentinel</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; grid-template-rows: auto 1fr; background: #eef2f5; color: #333f48; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  header { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; background: #00558c; color: #fff; }
  header img { height: 30px; width: auto; display: block; }
  header span { padding-left: 12px; border-left: 1px solid rgb(255 255 255 / 0.35); font-weight: 650; }
  main { align-self: start; justify-self: center; width: min(440px, 100% - 32px); margin-top: 8vh; padding: 24px; background: #fff; border: 1px solid #d4dde4; border-radius: 4px; }
  h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.25; color: #1d252c; }
  p { margin: 0 0 12px; }
  ul { margin: 0 0 16px; padding-left: 18px; }
  .who { padding: 10px 12px; margin-bottom: 16px; background: #f6f8f9; border: 1px solid #e5ebef; border-radius: 4px; color: #1d252c; }
  .who small { display: block; color: #5b6770; }
  label { display: grid; gap: 4px; margin-bottom: 12px; font-size: 11px; font-weight: 650; letter-spacing: 0.05em; text-transform: uppercase; color: #5b6770; }
  input { width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid #d4dde4; border-radius: 4px; font: inherit; color: #1d252c; }
  input:focus-visible, button:focus-visible { outline: 2px solid #00558c; outline-offset: 2px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  button { min-height: 36px; padding: 6px 16px; border: 1px solid #c3ccd3; border-radius: 4px; background: #fff; color: #1d252c; font: inherit; font-weight: 600; cursor: pointer; }
  button.primary { background: #00558c; border-color: #00558c; color: #fff; }
  .error { padding: 8px 12px; margin-bottom: 12px; background: #fbe9eb; border: 1px solid #e8b4ba; border-radius: 4px; color: #8e0011; }
  .muted { color: #5b6770; font-size: 13px; }
</style>
</head>
<body>
<header><img src="/brand/mp-logo-white-768.png" alt="Mitra Prodin"><span>Sentinel</span></header>
<main>${body}</main>
</body>
</html>`;
  return new Response(html, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

const errorPage = (title: string, detail: string, status = 400) => page(`<h1>${esc(title)}</h1><p>${esc(detail)}</p>`, status);

/** Parses and validates the OAuth request from the query string, whatever the HTTP method. */
async function parse(request: Request, env: Env): Promise<AuthRequest> {
  const url = new URL(request.url);
  return env.OAUTH_PROVIDER!.parseAuthRequest(new Request(url.toString(), { headers: request.headers }));
}

function consent(input: { oauth: AuthRequest; clientName: string; redirectHost: string; user: SessionUser | null; search: string; error?: string; secure: boolean }): Response {
  const csrf = randomToken();
  const who = input.user
    ? `<div class="who">${esc(input.user.name)}<small>${esc(input.user.email)}</small></div>`
    : `<label>Work email<input type="email" name="email" autocomplete="username" required></label>
       <label>Password<input type="password" name="password" autocomplete="current-password" required></label>`;
  const body = `<h1>Authorize ${esc(input.clientName)}</h1>
    <p>This application is asking to use Sentinel on your behalf. It will be redirected to <strong>${esc(input.redirectHost)}</strong>.</p>
    <p>If you approve, it will be able to:</p>
    <ul>
      <li>Read your requests, approval inbox, and notifications</li>
      <li>Submit requests and record approval decisions as you</li>
      <li>Use any management rights your account has (flows, organization)</li>
    </ul>
    <p class="muted">Everything it does is recorded in the audit trail under your name. You can sign in to Sentinel at any time to review it.</p>
    ${input.error ? `<div class="error" role="alert">${esc(input.error)}</div>` : ''}
    <form method="post" action="/authorize${esc(input.search)}">
      <input type="hidden" name="csrf" value="${csrf}">
      ${who}
      <div class="actions">
        <button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
        <button type="submit" name="decision" value="approve" class="primary">${input.user ? 'Approve' : 'Sign in and approve'}</button>
      </div>
    </form>`;
  return page(body, input.error ? 400 : 200, {
    'set-cookie': `${CSRF_COOKIE}=${csrf}; Path=/authorize; HttpOnly; SameSite=Strict; Max-Age=600${input.secure ? '; Secure' : ''}`,
  });
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (!env.OAUTH_PROVIDER) return errorPage('MCP access is not configured', 'This environment has no OAuth storage bound.', 503);
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let oauth: AuthRequest;
  try {
    oauth = await parse(request, env);
  } catch (e) {
    return errorPage('This authorization link is not valid', e instanceof Error ? e.message : 'The request could not be validated.');
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(oauth.clientId);
  if (!client) return errorPage('Unknown application', 'The application that sent you here is not registered with Sentinel.');
  const url = new URL(request.url);
  const view = {
    oauth,
    clientName: client.clientName || 'An MCP client',
    redirectHost: new URL(oauth.redirectUri).host,
    search: url.search,
    secure: url.protocol === 'https:',
  };
  const session = await sessionUser(env.DB, cookie(request, 'sid'));
  if (request.method === 'GET') return consent({ ...view, user: session });

  const form = await request.formData();
  const sent = String(form.get('csrf') ?? '');
  if (!sent || sent !== cookie(request, CSRF_COOKIE)) return consent({ ...view, user: session, error: 'This form expired. Please try again.' });

  if (form.get('decision') !== 'approve') {
    const back = new URL(oauth.redirectUri);
    back.searchParams.set('error', 'access_denied');
    if (oauth.state) back.searchParams.set('state', oauth.state);
    return Response.redirect(back.toString(), 302);
  }

  let user = session;
  if (!user) {
    const userId = await verifyLogin(env.DB, String(form.get('email') ?? ''), String(form.get('password') ?? ''));
    user = userId ? await userById(env.DB, userId) : null;
    if (!user) return consent({ ...view, user: null, error: 'The email or password is incorrect.' });
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauth,
    userId: user.id,
    metadata: { client: view.clientName, grantedAt: new Date().toISOString() },
    scope: oauth.scope,
    props: { userId: user.id },
  });
  await env.DB.prepare(
    `INSERT INTO audit_events (at, actor_type, actor_id, action, flow_version_id, detail) VALUES (?, 'user', ?, 'mcp_access_granted', 'mcp', ?)`,
  )
    .bind(new Date().toISOString(), user.id, JSON.stringify({ client: view.clientName, clientId: oauth.clientId, redirectHost: view.redirectHost }))
    .run();
  return Response.redirect(redirectTo, 302);
}

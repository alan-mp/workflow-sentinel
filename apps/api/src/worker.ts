import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleAuthorize } from './authorize';
import { runCron } from './cron';
import type { Env } from './env';
import { createApp } from './index';
import { mcpFetch } from './mcp';

const { app, deps } = createApp();

const SCOPE = 'sentinel';

/**
 * The OAuth provider needs the public URL of the MCP endpoint, which differs per
 * environment. It is taken from the first request and kept for the isolate's life.
 */
const providers = new Map<string, OAuthProvider<Env>>();
function provider(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: {
        fetch(request, env, ctx) {
          const userId = (ctx as ExecutionContext & { props?: { userId?: string } }).props?.userId;
          if (!userId) return new Response('Unauthorized', { status: 401 });
          return mcpFetch(app, request, env, ctx, userId);
        },
      },
      defaultHandler: {
        fetch(request, env, ctx) {
          const { pathname } = new URL(request.url);
          if (pathname === '/authorize') return handleAuthorize(request, env);
          // ctx is passed on so routes can hand work to ctx.waitUntil (webhook delivery).
          return app.fetch(request, env, ctx);
        },
      },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [SCOPE],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'Sentinel' },
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request, env, ctx) {
    // Without OAuth storage the MCP endpoint is off; the app and API keep working.
    if (!env.OAUTH_KV) return app.fetch(request, env, ctx);
    return provider(new URL(request.url).origin).fetch(request, env, ctx);
  },
  async scheduled(_controller, env) {
    await runCron(env.DB, deps, new Date(), env);
  },
} satisfies ExportedHandler<Env>;

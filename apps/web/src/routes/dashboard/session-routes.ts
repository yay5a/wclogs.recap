import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  compareDashboardAdminSecret,
  consumeOAuthState,
  createDiscordSession,
  dashboardAuthContext,
  deleteDiscordSessionFromCookie,
  exchangeDiscordCode,
  fetchDiscordBearerJson,
  parseDiscordUser,
  parseOAuthGuild,
  publicAuthContext,
  requireDashboardAuth,
  requireDashboardMutationSafety,
  setDashboardCookie,
  shouldUseSecureDashboardCookies,
  storeOAuthState,
} from './auth.js';
import { getRequestBody, sendError } from './dto.js';
import {
  DASHBOARD_COOKIE_NAME,
  DASHBOARD_COOKIE_PATH,
  DASHBOARD_OAUTH_STATE_COOKIE_NAME,
  DASHBOARD_OAUTH_STATE_TTL_MS,
  DASHBOARD_SESSION_TTL_MS,
  type DashboardAuthedRequest,
  type DashboardOAuthGuild,
  type DashboardRouteOptions,
} from './types.js';

export const registerDashboardSessionRoutes = (
  app: FastifyInstance,
  options: DashboardRouteOptions,
) => {
  const authPreHandler = requireDashboardAuth(options.env);
  const mutationPreHandlers = [authPreHandler, requireDashboardMutationSafety];

  app.post('/api/dashboard/login', async (request, reply) => {
    if (options.env.DASHBOARD_AUTH_DISABLED) return reply.send({ ok: true });

    const body = getRequestBody(request);
    const submittedSecret = typeof body?.adminSecret === 'string' ? body.adminSecret : undefined;
    const expectedSecret = options.env.DASHBOARD_ADMIN_SECRET;
    if (
      !submittedSecret ||
      !expectedSecret ||
      !compareDashboardAdminSecret(submittedSecret, expectedSecret)
    ) {
      return sendError(reply, 401, 'unauthorized');
    }

    const expiresAtMs = Date.now() + DASHBOARD_SESSION_TTL_MS;
    setDashboardCookie(reply, options.env, `dashboard:v1:${expiresAtMs}`);
    return reply.send({ ok: true });
  });

  app.get('/api/dashboard/discord/login', async (_request, reply) => {
    if (!options.env.DISCORD_CLIENT_SECRET || !options.env.discordOAuthRedirectUri) {
      return sendError(reply, 503, 'discord_login_not_configured');
    }

    const state = crypto.randomBytes(24).toString('base64url');
    storeOAuthState(state);
    reply.setCookie(DASHBOARD_OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: shouldUseSecureDashboardCookies(options.env),
      path: '/api/dashboard/discord/callback',
      maxAge: DASHBOARD_OAUTH_STATE_TTL_MS / 1000,
    });

    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', options.env.DISCORD_APPLICATION_ID);
    authorizeUrl.searchParams.set('scope', 'identify guilds');
    authorizeUrl.searchParams.set('redirect_uri', options.env.discordOAuthRedirectUri);
    authorizeUrl.searchParams.set('state', state);
    return reply.redirect(authorizeUrl.toString());
  });

  app.get('/api/dashboard/discord/callback', async (request, reply) => {
    const query =
      typeof request.query === 'object' && request.query !== null
        ? (request.query as Record<string, unknown>)
        : {};
    const oauthError = typeof query.error === 'string' ? query.error : '';
    const code = typeof query.code === 'string' ? query.code : '';
    const state = typeof query.state === 'string' ? query.state : '';
    const rawStateCookie = request.cookies[DASHBOARD_OAUTH_STATE_COOKIE_NAME];
    const unsignedState = rawStateCookie ? request.unsignCookie(rawStateCookie) : null;
    reply.clearCookie(DASHBOARD_OAUTH_STATE_COOKIE_NAME, {
      path: '/api/dashboard/discord/callback',
    });

    if (oauthError) {
      if (state && unsignedState?.valid && unsignedState.value === state) {
        consumeOAuthState(state);
      }
      return sendError(reply, 400, 'discord_oauth_denied');
    }

    if (!code || !state || !unsignedState?.valid || unsignedState.value !== state) {
      return sendError(reply, 400, 'invalid_oauth_state');
    }

    if (!consumeOAuthState(state)) {
      return sendError(reply, 400, 'invalid_oauth_state');
    }

    const accessToken = await exchangeDiscordCode(options.env, code);
    if (!accessToken) return sendError(reply, 401, 'discord_oauth_failed');

    const [rawUser, rawGuilds] = await Promise.all([
      fetchDiscordBearerJson('/users/@me', accessToken),
      fetchDiscordBearerJson('/users/@me/guilds', accessToken),
    ]);
    const user = parseDiscordUser(rawUser);
    if (!user || !Array.isArray(rawGuilds)) {
      return sendError(reply, 401, 'discord_oauth_failed');
    }

    const oauthGuildsById: Record<string, DashboardOAuthGuild> = {};
    for (const rawGuild of rawGuilds) {
      const guild = parseOAuthGuild(rawGuild);
      if (guild) oauthGuildsById[guild.id] = guild;
    }

    const { sessionId, sessionExpiresAtMs } = createDiscordSession({
      kind: 'discord',
      discordUserId: user.id,
      username: user.username,
      displayName: user.displayName,
      oauthGuildsById,
    });
    setDashboardCookie(reply, options.env, `dashboard:v2:${sessionId}:${sessionExpiresAtMs}`);
    return reply.redirect('/dashboard');
  });

  app.post(
    '/api/dashboard/logout',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      deleteDiscordSessionFromCookie(request);
      reply.clearCookie(DASHBOARD_COOKIE_NAME, { path: DASHBOARD_COOKIE_PATH });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/api/dashboard/session',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) =>
      reply.send({
        authenticated: true,
        auth: publicAuthContext(request.dashboardAuth ?? dashboardAuthContext),
      }),
  );
};

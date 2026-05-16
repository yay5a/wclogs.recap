import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsync } from 'fastify';
import type { UpsertWclUserAuthInput, WclUserAuthStatus } from '@wcl/db';
import type { createLogger } from '@wcl/shared';
import { exchangeWclAuthorizationCode, getWclTokenExpiresAt } from '@wcl/wcl-client';
import type { WebEnv } from '../config.js';
import {
  getDashboardAuthFromRequest,
  requireDashboardMutationSafety,
  shouldUseSecureDashboardCookies,
} from '../routes/dashboard/auth.js';
import type { DashboardAuthContext } from '../routes/dashboard/types.js';

export type WclUserAuthStore = {
  getByDiscordUserId(discordUserId: string): Promise<{
    discordUserId: string;
    provider?: string;
    userAccessToken?: string;
    userRefreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    linkedAt?: Date;
    updatedAt?: Date;
  } | null>;
  getStatusByDiscordUserId(discordUserId: string): Promise<WclUserAuthStatus | null>;
  upsertForDiscordUser(entry: UpsertWclUserAuthInput): Promise<void>;
  deleteForDiscordUser(discordUserId: string): Promise<void>;
};

type WclAuthRouteOptions = {
  env: WebEnv;
  logger: ReturnType<typeof createLogger>;
  wclUserAuthStore: WclUserAuthStore;
};

const WCL_OAUTH_STATE_COOKIE_NAME = 'wcl_oauth_state';
const WCL_OAUTH_STATE_COOKIE_PATH = '/api/auth/wcl/callback';
const WCL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type WclOAuthStateRecord = {
  discordUserId: string;
  expiresAtMs: number;
};

const wclOAuthStates = new Map<string, WclOAuthStateRecord>();

const hashOAuthState = (state: string): string =>
  crypto.createHash('sha256').update(state).digest('base64url');

const pruneExpiredWclOAuthStates = () => {
  const now = Date.now();
  for (const [stateHash, record] of wclOAuthStates.entries()) {
    if (now > record.expiresAtMs) wclOAuthStates.delete(stateHash);
  }
};

const storeWclOAuthState = (state: string, discordUserId: string) => {
  pruneExpiredWclOAuthStates();
  wclOAuthStates.set(hashOAuthState(state), {
    discordUserId,
    expiresAtMs: Date.now() + WCL_OAUTH_STATE_TTL_MS,
  });
};

const consumeWclOAuthState = (state: string): WclOAuthStateRecord | null => {
  const stateHash = hashOAuthState(state);
  const record = wclOAuthStates.get(stateHash);
  wclOAuthStates.delete(stateHash);
  return record && Date.now() <= record.expiresAtMs ? record : null;
};

const sendWclAuthError = (reply: FastifyReply, statusCode: number, message: string) =>
  reply.code(statusCode).send({ ok: false, message });

const getDiscordAuth = (
  request: FastifyRequest,
  reply: FastifyReply,
  env: WebEnv,
): Extract<DashboardAuthContext, { kind: 'discord' }> | undefined => {
  const auth = getDashboardAuthFromRequest(request, env);
  if (!auth) {
    sendWclAuthError(reply, 401, 'Sign in with Discord before linking Warcraft Logs.');
    return undefined;
  }

  if (auth.kind !== 'discord') {
    sendWclAuthError(reply, 403, 'Sign in with Discord before linking Warcraft Logs.');
    return undefined;
  }

  return auth;
};

const serializeWclAuthStatus = (status: WclUserAuthStatus | null) => ({
  ok: true,
  linked: !!status,
  provider: status?.provider ?? null,
  tokenType: status?.tokenType ?? null,
  scope: status?.scope ?? null,
  expiresAt: status?.expiresAt ?? null,
  linkedAt: status?.linkedAt ?? null,
  updatedAt: status?.updatedAt ?? null,
  reauthorizationRequired: status?.expiresAt ? status.expiresAt <= new Date() : false,
});

const getWclAuthorizationCodeClient = (
  env: WebEnv,
): { clientId: string; clientSecret: string; redirectUri: string } | null =>
  env.WCL_CLIENT_ID && env.WCL_CLIENT_SECRET && env.wclRedirectUri
    ? {
        clientId: env.WCL_CLIENT_ID,
        clientSecret: env.WCL_CLIENT_SECRET,
        redirectUri: env.wclRedirectUri,
      }
    : null;

export const registerWclAuthRoutes: FastifyPluginAsync<WclAuthRouteOptions> = async (
  app,
  options,
) => {
  const { env, logger, wclUserAuthStore } = options;

  app.get('/api/auth/wcl/status', async (request, reply) => {
    const auth = getDiscordAuth(request, reply, env);
    if (!auth) return reply;

    const status = await wclUserAuthStore.getStatusByDiscordUserId(auth.discordUserId);
    return reply.send(serializeWclAuthStatus(status));
  });

  app.delete(
    '/api/auth/wcl',
    { preHandler: requireDashboardMutationSafety },
    async (request, reply) => {
      const auth = getDiscordAuth(request, reply, env);
      if (!auth) return reply;

      await wclUserAuthStore.deleteForDiscordUser(auth.discordUserId);
      return reply.send({ ok: true, linked: false });
    },
  );

  app.get('/api/auth/wcl/login', async (request, reply) => {
    const auth = getDiscordAuth(request, reply, env);
    if (!auth) return reply;

    const wclOAuthClient = getWclAuthorizationCodeClient(env);
    if (!wclOAuthClient) {
      return sendWclAuthError(reply, 503, 'Warcraft Logs user authorization is not configured.');
    }

    const state = crypto.randomBytes(32).toString('base64url');
    storeWclOAuthState(state, auth.discordUserId);

    reply.setCookie(WCL_OAUTH_STATE_COOKIE_NAME, state, {
      path: WCL_OAUTH_STATE_COOKIE_PATH,
      httpOnly: true,
      secure: shouldUseSecureDashboardCookies(env),
      sameSite: 'lax',
      signed: true,
      maxAge: WCL_OAUTH_STATE_TTL_MS / 1000,
    });

    const authorizeUrl = new URL('https://www.warcraftlogs.com/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', wclOAuthClient.clientId);
    authorizeUrl.searchParams.set('redirect_uri', wclOAuthClient.redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);

    return reply.redirect(authorizeUrl.toString());
  });

  app.get('/api/auth/wcl/callback', async (request, reply) => {
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    const state = typeof query.state === 'string' ? query.state : '';
    const stateCookie = request.unsignCookie(request.cookies[WCL_OAUTH_STATE_COOKIE_NAME] ?? '');

    reply.clearCookie(WCL_OAUTH_STATE_COOKIE_NAME, {
      path: WCL_OAUTH_STATE_COOKIE_PATH,
    });

    if (query.error) {
      if (state && stateCookie.valid && stateCookie.value === state) {
        consumeWclOAuthState(state);
      }
      return sendWclAuthError(reply, 400, 'WCL authorization failed or was denied.');
    }

    if (!query.code || !state) {
      return sendWclAuthError(reply, 400, 'Missing code or state.');
    }

    if (!stateCookie.valid || stateCookie.value !== state) {
      return sendWclAuthError(reply, 400, 'Invalid OAuth state.');
    }

    const stateRecord = consumeWclOAuthState(state);
    if (!stateRecord) {
      return sendWclAuthError(reply, 400, 'Invalid OAuth state.');
    }

    const wclOAuthClient = getWclAuthorizationCodeClient(env);
    if (!wclOAuthClient) {
      return sendWclAuthError(reply, 503, 'Warcraft Logs user authorization is not configured.');
    }

    const tokenResult = await exchangeWclAuthorizationCode({
      clientId: wclOAuthClient.clientId,
      clientSecret: wclOAuthClient.clientSecret,
      code: query.code,
      redirectUri: wclOAuthClient.redirectUri,
    });

    if (
      !tokenResult.payload.userAccessToken ||
      tokenResult.status < 200 ||
      tokenResult.status >= 300
    ) {
      logger.error(
        {
          provider: 'warcraftlogs',
          flow: 'authorization_code',
          failureCategory: 'token_exchange_failed',
          status: tokenResult.status,
        },
        'WCL token exchange failed',
      );

      return reply.code(500).send({
        ok: false,
        message: 'WCL token exchange failed',
        status: tokenResult.status,
      });
    }

    const updatedAt = new Date();
    const expiresAt = getWclTokenExpiresAt(tokenResult.payload, updatedAt);
    try {
      await wclUserAuthStore.upsertForDiscordUser({
        discordUserId: stateRecord.discordUserId,
        provider: 'warcraftlogs',
        userAccessToken: tokenResult.payload.userAccessToken,
        updatedAt,
        ...(tokenResult.payload.userRefreshToken
          ? { userRefreshToken: tokenResult.payload.userRefreshToken }
          : {}),
        ...(tokenResult.payload.tokenType ? { tokenType: tokenResult.payload.tokenType } : {}),
        ...(tokenResult.payload.scope ? { scope: tokenResult.payload.scope } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
    } catch {
      logger.error(
        {
          provider: 'warcraftlogs',
          flow: 'authorization_code',
          failureCategory: 'token_persistence_failed',
          discordUserId: stateRecord.discordUserId,
        },
        'WCL token persistence failed',
      );
      return reply.code(500).send({
        ok: false,
        message: 'Could not save Warcraft Logs authorization. Try again.',
      });
    }

    return reply.send({
      ok: true,
      linked: true,
      provider: 'warcraftlogs',
      expiresAt: expiresAt ?? null,
      updatedAt,
    });
  });
};

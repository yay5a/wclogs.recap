import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWebEnv, type WebEnv } from '../config.js';
import { createDiscordSession } from '../routes/dashboard/auth.js';
import { DASHBOARD_COOKIE_NAME, type DashboardAuthContext } from '../routes/dashboard/types.js';
import { registerWclAuthRoutes, type WclUserAuthStore } from './routes.js';

const discordUserId = '323456789012345678';
const otherDiscordUserId = '423456789012345678';

const makeEnv = (
  overrides: Partial<Record<string, string | number | boolean | undefined>> = {},
): WebEnv => {
  const rawEnv: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '3000',
    MONGODB_URI: 'mongodb://localhost:27017/wclogs',
    DISCORD_PUBLIC_KEY: 'a'.repeat(64),
    DISCORD_APPLICATION_ID: '1234567890',
    DISCORD_BOT_TOKEN: 'discord-token',
    WCL_CLIENT_ID: 'wcl-client-id',
    WCL_CLIENT_SECRET: 'wcl-client-secret',
    WCL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    WCL_API_BASE_URL: 'https://www.warcraftlogs.com/api/v2/client',
    PUBLIC_APP_BASE_URL: 'https://public.example.test',
    COOKIE_SECRET: 'cookie-secret',
    DASHBOARD_ADMIN_SECRET: 'admin-secret',
    DASHBOARD_AUTH_DISABLED: 'false',
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete rawEnv[key];
    } else {
      rawEnv[key] = String(value);
    }
  }

  return parseWebEnv(rawEnv);
};

type StoredWclAuth = Awaited<ReturnType<WclUserAuthStore['getByDiscordUserId']>>;

const statusFrom = (record: StoredWclAuth) =>
  record
    ? {
        discordUserId: record.discordUserId,
        provider: 'warcraftlogs' as const,
        ...(record.tokenType ? { tokenType: record.tokenType } : {}),
        ...(record.scope ? { scope: record.scope } : {}),
        ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
        ...(record.linkedAt ? { linkedAt: record.linkedAt } : {}),
        ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
      }
    : null;

const makeStore = (initialRecords: StoredWclAuth[] = []): WclUserAuthStore => {
  const records = new Map(
    initialRecords.flatMap((record) => (record ? [[record.discordUserId, record] as const] : [])),
  );

  return {
    getByDiscordUserId: vi.fn(async (userId: string) => records.get(userId) ?? null),
    getStatusByDiscordUserId: vi.fn(async (userId: string) =>
      statusFrom(records.get(userId) ?? null),
    ),
    upsertForDiscordUser: vi.fn(async (entry) => {
      const existing = records.get(entry.discordUserId);
      records.set(entry.discordUserId, {
        ...existing,
        ...entry,
        linkedAt: existing?.linkedAt ?? entry.updatedAt,
      });
    }),
    deleteForDiscordUser: vi.fn(async (userId: string) => {
      records.delete(userId);
    }),
  };
};

const makeLogger = () => ({
  error: vi.fn(),
  info: vi.fn(),
});

type TestLogger = ReturnType<typeof makeLogger>;

const makeApp = async (
  options: {
    env?: WebEnv;
    store?: WclUserAuthStore;
    logger?: TestLogger;
  } = {},
) => {
  const env = options.env ?? makeEnv();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
  await app.register(registerWclAuthRoutes, {
    env,
    logger: (options.logger ?? makeLogger()) as never,
    wclUserAuthStore: options.store ?? makeStore(),
  });
  return app;
};

const firstSetCookie = (response: { headers: Record<string, unknown> }): string => {
  const header = response.headers['set-cookie'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') throw new Error('missing set-cookie');
  return raw.split(';')[0] ?? raw;
};

const makeDiscordSessionCookie = (app: FastifyInstance, userId = discordUserId): string => {
  const auth: DashboardAuthContext = {
    kind: 'discord',
    discordUserId: userId,
    username: `user-${userId}`,
    displayName: `User ${userId}`,
    oauthGuildsById: {},
  };
  const { sessionId, sessionExpiresAtMs } = createDiscordSession(auth);
  const signed = app.signCookie(`dashboard:v2:${sessionId}:${sessionExpiresAtMs}`);
  return `${DASHBOARD_COOKIE_NAME}=${encodeURIComponent(signed)}`;
};

const parseAuthorizeState = (response: { headers: Record<string, unknown> }): string => {
  const state = new URL(String(response.headers.location)).searchParams.get('state');
  if (!state) throw new Error('missing state');
  return state;
};

describe('WCL OAuth routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects unauthenticated WCL authorize and status requests', async () => {
    const app = await makeApp();

    const login = await app.inject('/api/auth/wcl/login');
    const status = await app.inject('/api/auth/wcl/status');

    expect(login.statusCode).toBe(401);
    expect(status.statusCode).toBe(401);
    expect(login.json()).toEqual({
      ok: false,
      message: 'Sign in with Discord before linking Warcraft Logs.',
    });

    await app.close();
  });

  it('uses the configured public callback URI and creates user-bound state', async () => {
    const app = await makeApp();
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: {
        cookie: discordCookie,
        host: 'evil.example.test',
      },
    });

    expect(login.statusCode).toBe(302);
    const redirect = new URL(String(login.headers.location));
    expect(redirect.searchParams.get('redirect_uri')).toBe(
      'https://public.example.test/api/auth/wcl/callback',
    );
    expect(redirect.searchParams.get('response_type')).toBe('code');
    expect(redirect.searchParams.get('state')).toBeTruthy();
    expect(firstSetCookie(login)).toContain('wcl_oauth_state=');

    await app.close();
  });

  it('does not start WCL user authorization with only a public client token', async () => {
    const app = await makeApp({
      env: makeEnv({
        WCL_CLIENT_ID: undefined,
        WCL_CLIENT_SECRET: undefined,
        WCL_OAUTH_CLIENT_TOKEN: 'client-token',
      }),
    });
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });

    expect(login.statusCode).toBe(503);
    expect(login.json()).toEqual({
      ok: false,
      message: 'Warcraft Logs user authorization is not configured.',
    });

    await app.close();
  });

  it('rejects missing, invalid, expired, mismatched, and replayed WCL state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'));
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ access_token: 'wcl-access-token' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await makeApp();
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const state = parseAuthorizeState(login);
    const stateCookie = firstSetCookie(login);

    const missingState = await app.inject({
      url: '/api/auth/wcl/callback?code=abc',
      headers: { cookie: stateCookie },
    });
    const invalidState = await app.inject({
      url: '/api/auth/wcl/callback?code=abc&state=bad',
      headers: { cookie: stateCookie },
    });
    const otherLogin = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const mismatch = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${state}`,
      headers: { cookie: firstSetCookie(otherLogin) },
    });

    const expiredLogin = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const expiredState = parseAuthorizeState(expiredLogin);
    vi.setSystemTime(new Date('2026-04-09T00:11:00.000Z'));
    const expired = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${expiredState}`,
      headers: { cookie: firstSetCookie(expiredLogin) },
    });

    vi.setSystemTime(new Date('2026-04-09T00:12:00.000Z'));
    const replayLogin = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const replayState = parseAuthorizeState(replayLogin);
    const replayCookie = firstSetCookie(replayLogin);
    const success = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${replayState}`,
      headers: { cookie: replayCookie },
    });
    const replay = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${replayState}`,
      headers: { cookie: replayCookie },
    });

    expect(missingState.statusCode).toBe(400);
    expect(invalidState.statusCode).toBe(400);
    expect(mismatch.statusCode).toBe(400);
    expect(expired.statusCode).toBe(400);
    expect(success.statusCode).toBe(200);
    expect(replay.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('handles WCL OAuth denial without exposing provider details', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = await makeApp();
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const state = parseAuthorizeState(login);
    const denied = await app.inject({
      url: `/api/auth/wcl/callback?error=access_denied&state=${state}`,
      headers: { cookie: firstSetCookie(login) },
    });
    const replay = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${state}`,
      headers: { cookie: firstSetCookie(login) },
    });

    expect(denied.statusCode).toBe(400);
    expect(denied.json()).toEqual({
      ok: false,
      message: 'WCL authorization failed or was denied.',
    });
    expect(denied.body).not.toContain('access_denied');
    expect(replay.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('uses the consumed WCL state during callback and stores token data for that user only', async () => {
    const store = makeStore();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: 'wcl-access-token',
        refresh_token: 'wcl-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'view-user-profile',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await makeApp({ store });
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const state = parseAuthorizeState(login);
    const callback = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${state}`,
      headers: {
        cookie: firstSetCookie(login),
        host: 'evil.example.test',
      },
    });

    expect(callback.statusCode).toBe(200);
    const tokenRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(tokenRequest?.body).toBeInstanceOf(URLSearchParams);
    expect((tokenRequest?.body as URLSearchParams).get('redirect_uri')).toBe(
      'https://public.example.test/api/auth/wcl/callback',
    );
    expect(store.upsertForDiscordUser).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId,
        provider: 'warcraftlogs',
        userAccessToken: 'wcl-access-token',
        userRefreshToken: 'wcl-refresh-token',
        tokenType: 'Bearer',
        scope: 'view-user-profile',
        expiresAt: expect.any(Date),
      }),
    );
    expect(callback.body).not.toContain('wcl-access-token');
    expect(callback.body).not.toContain('wcl-refresh-token');

    await app.close();
  });

  it('does not expose token material when WCL token persistence fails', async () => {
    const logger = makeLogger();
    const store = makeStore();
    vi.mocked(store.upsertForDiscordUser).mockRejectedValue(
      new Error('WCL token encryption failed'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({
          access_token: 'wcl-access-token',
          refresh_token: 'wcl-refresh-token',
        }),
      }),
    );
    const app = await makeApp({ logger, store });
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const state = parseAuthorizeState(login);
    const callback = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${state}`,
      headers: { cookie: firstSetCookie(login) },
    });

    expect(callback.statusCode).toBe(500);
    expect(callback.json()).toEqual({
      ok: false,
      message: 'Could not save Warcraft Logs authorization. Try again.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'warcraftlogs',
        failureCategory: 'token_persistence_failed',
        discordUserId,
      }),
      'WCL token persistence failed',
    );
    const serializedLog = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(serializedLog).not.toContain('wcl-access-token');
    expect(serializedLog).not.toContain('wcl-refresh-token');
    expect(callback.body).not.toContain('wcl-access-token');
    expect(callback.body).not.toContain('wcl-refresh-token');

    await app.close();
  });

  it('returns safe per-user status metadata without token material', async () => {
    const linkedAt = new Date('2026-04-08T00:00:00.000Z');
    const updatedAt = new Date('2026-04-09T00:00:00.000Z');
    const expiresAt = new Date('2099-04-09T01:00:00.000Z');
    const store = makeStore([
      {
        discordUserId,
        provider: 'warcraftlogs',
        userAccessToken: 'wcl-access-token',
        userRefreshToken: 'wcl-refresh-token',
        tokenType: 'Bearer',
        scope: 'view-user-profile',
        linkedAt,
        updatedAt,
        expiresAt,
      },
    ]);
    const app = await makeApp({ store });

    const response = await app.inject({
      url: '/api/auth/wcl/status',
      headers: { cookie: makeDiscordSessionCookie(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      linked: true,
      provider: 'warcraftlogs',
      tokenType: 'Bearer',
      scope: 'view-user-profile',
      expiresAt: expiresAt.toISOString(),
      linkedAt: linkedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      reauthorizationRequired: false,
    });
    expect(response.body).not.toContain('wcl-access-token');
    expect(response.body).not.toContain('wcl-refresh-token');
    expect(store.getStatusByDiscordUserId).toHaveBeenCalledWith(discordUserId);

    await app.close();
  });

  it('marks expired linked WCL auth as requiring reauthorization', async () => {
    const store = makeStore([
      {
        discordUserId,
        provider: 'warcraftlogs',
        userAccessToken: 'wcl-access-token',
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
        linkedAt: new Date('1999-12-31T00:00:00.000Z'),
        updatedAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    ]);
    const app = await makeApp({ store });

    const response = await app.inject({
      url: '/api/auth/wcl/status',
      headers: { cookie: makeDiscordSessionCookie(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        linked: true,
        reauthorizationRequired: true,
      }),
    );

    await app.close();
  });

  it("unlinks only the authenticated Discord user's WCL auth", async () => {
    const store = makeStore([
      {
        discordUserId,
        provider: 'warcraftlogs',
        userAccessToken: 'current-user-token',
        linkedAt: new Date('2026-04-08T00:00:00.000Z'),
        updatedAt: new Date('2026-04-09T00:00:00.000Z'),
      },
      {
        discordUserId: otherDiscordUserId,
        provider: 'warcraftlogs',
        userAccessToken: 'other-user-token',
        linkedAt: new Date('2026-04-08T00:00:00.000Z'),
        updatedAt: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);
    const app = await makeApp({ store });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/auth/wcl',
      headers: {
        cookie: makeDiscordSessionCookie(app),
        'x-dashboard-request': '1',
      },
    });
    const currentStatus = await app.inject({
      url: '/api/auth/wcl/status',
      headers: { cookie: makeDiscordSessionCookie(app) },
    });
    const otherStatus = await app.inject({
      url: '/api/auth/wcl/status',
      headers: { cookie: makeDiscordSessionCookie(app, otherDiscordUserId) },
    });

    expect(response.statusCode).toBe(200);
    expect(store.deleteForDiscordUser).toHaveBeenCalledWith(discordUserId);
    expect(currentStatus.json()).toEqual(expect.objectContaining({ linked: false }));
    expect(otherStatus.json()).toEqual(expect.objectContaining({ linked: true }));

    await app.close();
  });

  it('logs safe context only when WCL token exchange fails', async () => {
    const logger = makeLogger();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        access_token: 'leaked-access-token',
        refresh_token: 'leaked-refresh-token',
        client_secret: 'leaked-client-secret',
        code: 'leaked-authorization-code',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await makeApp({ logger });
    const discordCookie = makeDiscordSessionCookie(app);

    const login = await app.inject({
      url: '/api/auth/wcl/login',
      headers: { cookie: discordCookie },
    });
    const state = parseAuthorizeState(login);
    const callback = await app.inject({
      url: `/api/auth/wcl/callback?code=abc&state=${state}`,
      headers: { cookie: firstSetCookie(login) },
    });

    expect(callback.statusCode).toBe(500);
    expect(logger.error).toHaveBeenCalledOnce();
    const [context] = vi.mocked(logger.error).mock.calls[0] ?? [];
    const serializedContext = JSON.stringify(context);
    expect(serializedContext).toContain('warcraftlogs');
    expect(serializedContext).toContain('token_exchange_failed');
    expect(serializedContext).toContain('400');
    for (const secret of [
      'leaked-access-token',
      'leaked-refresh-token',
      'leaked-client-secret',
      'leaked-authorization-code',
      'abc',
    ]) {
      expect(serializedContext).not.toContain(secret);
      expect(callback.body).not.toContain(secret);
    }
    expect(context).not.toHaveProperty('tokenPayload');

    await app.close();
  });
});

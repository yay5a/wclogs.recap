import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGuildConfigFor, type GuildConfig } from "@wcl/domain";
import { parseWebEnv, type WebEnv } from "../config.js";
import {
    compareDashboardAdminSecret,
    DASHBOARD_COOKIE_NAME,
    registerDashboardRoutes,
    type DashboardActivityRecord,
    type DashboardActivityStore,
    type DashboardCharacterClaimStore,
    type DashboardDirectory,
    type DashboardGuildConfigStore,
    type DashboardGuildConfigSummary,
    type DashboardOnboardingStore,
} from "./dashboard.js";
import type { CharacterClaimRecord } from "@wcl/discord";

const guildId = "123456789012345678";
const otherGuildId = "223456789012345678";
const discordUserId = "323456789012345678";
const channelId = "423456789012345678";

const makeEnv = (
    overrides: Partial<Record<string, string | number | boolean | undefined>> = {},
): WebEnv => {
    const rawEnv: Record<string, string> = {
        NODE_ENV: "test",
        PORT: "3000",
        MONGODB_URI: "mongodb://localhost:27017/wclogs",
        DISCORD_PUBLIC_KEY: "a".repeat(64),
        DISCORD_APPLICATION_ID: "1234567890",
        DISCORD_BOT_TOKEN: "discord-token",
        WCL_CLIENT_ID: "wcl-client-id",
        WCL_CLIENT_SECRET: "wcl-client-secret",
        WCL_API_BASE_URL: "https://www.warcraftlogs.com/api/v2/client",
        WCL_REDIRECT_URI: "https://example.com/api/auth/wcl/callback",
        COOKIE_SECRET: "cookie-secret",
        DASHBOARD_ADMIN_SECRET: "admin-secret",
        DASHBOARD_AUTH_DISABLED: "false",
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

const toSummary = (config: GuildConfig): DashboardGuildConfigSummary => ({
    guildId: config.guildId,
    compareModeDefault: config.compareModeDefault,
    compareAccessMode: config.compareAccessMode,
    comparePublicPostingEnabled: config.comparePublicPostingEnabled,
    autoReportMode: config.autoReportMode,
    defaultGameFamily: config.defaultGameFamily,
    dashboardOfficerAccessEnabled: config.dashboardOfficerAccessEnabled,
    compareOfficerUserCount: config.compareOfficerUserIds.length,
    autoReportChannelCount: config.autoReportChannelIds.length,
});

const makeStore = (initialConfigs: GuildConfig[] = []) => {
    const configs = new Map(initialConfigs.map((config) => [config.guildId, config]));
    const store = {
        listGuildConfigSummaries: vi.fn(async () =>
            [...configs.values()].map(toSummary).sort((left, right) => left.guildId.localeCompare(right.guildId)),
        ),
        listGuildConfigSummariesForGuilds: vi.fn(async (guildIds: string[]) => {
            const allowedGuildIds = new Set(guildIds);
            return [...configs.values()]
                .filter((config) => allowedGuildIds.has(config.guildId))
                .map(toSummary)
                .sort((left, right) => left.guildId.localeCompare(right.guildId));
        }),
        getGuildConfig: vi.fn(async (id: string) => configs.get(id) ?? defaultGuildConfigFor(id)),
        saveGuildConfig: vi.fn(async (id: string, update: Partial<Omit<GuildConfig, "guildId">>) => {
            const next = { ...(configs.get(id) ?? defaultGuildConfigFor(id)), ...update };
            configs.set(id, next);
            return next;
        }),
        getExistingGuildConfig: vi.fn(async (id: string) => configs.get(id) ?? null),
        createDefaultGuildConfig: vi.fn(async (id: string) => {
            const next = configs.get(id) ?? defaultGuildConfigFor(id);
            configs.set(id, next);
            return next;
        }),
        saveExistingGuildConfig: vi.fn(
            async (id: string, update: Partial<Omit<GuildConfig, "guildId">>) => {
                const current = configs.get(id);
                if (!current) return null;
                const next = { ...current, ...update };
                configs.set(id, next);
                return next;
            },
        ),
        addOfficerToExistingGuild: vi.fn(async (id: string, userId: string) => {
            const current = configs.get(id);
            if (!current) return null;
            const compareOfficerUserIds = current.compareOfficerUserIds.includes(userId)
                ? current.compareOfficerUserIds
                : [...current.compareOfficerUserIds, userId];
            const next = { ...current, compareOfficerUserIds };
            configs.set(id, next);
            return next;
        }),
        removeOfficerFromExistingGuild: vi.fn(async (id: string, userId: string) => {
            const current = configs.get(id);
            if (!current) return null;
            const next = {
                ...current,
                compareOfficerUserIds: current.compareOfficerUserIds.filter(
                    (existingUserId) => existingUserId !== userId,
                ),
            };
            configs.set(id, next);
            return next;
        }),
        deconfigureExistingGuild: vi.fn(async (id: string) => configs.delete(id)),
    } satisfies DashboardGuildConfigStore;
    return { store, configs };
};

const makeApp = async (
    env: WebEnv,
    store: DashboardGuildConfigStore,
    options: {
        characterClaimStore?: DashboardCharacterClaimStore;
        activityStore?: DashboardActivityStore;
        onboardingStore?: DashboardOnboardingStore;
        directoryResolver?: (input: {
            guildId: string;
            config: GuildConfig;
            claims: CharacterClaimRecord[];
            activity: DashboardActivityRecord[];
        }) => Promise<DashboardDirectory>;
    } = {},
) => {
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
    const routeOptions = {
        env,
        guildConfigStore: store,
        ...(options.characterClaimStore !== undefined
            ? { characterClaimStore: options.characterClaimStore }
            : {}),
        ...(options.activityStore !== undefined ? { activityStore: options.activityStore } : {}),
        ...(options.onboardingStore !== undefined
            ? { onboardingStore: options.onboardingStore }
            : {}),
        ...(options.directoryResolver !== undefined
            ? { directoryResolver: options.directoryResolver }
            : {}),
    };
    await app.register(registerDashboardRoutes, {
        ...routeOptions,
    });
    return app;
};

const firstSetCookie = (response: { headers: Record<string, unknown> }): string => {
    const header = response.headers["set-cookie"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw !== "string") throw new Error("missing set-cookie");
    return raw.split(";")[0] ?? raw;
};

const firstSetCookieHeader = (response: { headers: Record<string, unknown> }): string => {
    const header = response.headers["set-cookie"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw !== "string") throw new Error("missing set-cookie");
    return raw;
};

const setCookieHeaders = (response: { headers: Record<string, unknown> }): string[] => {
    const header = response.headers["set-cookie"];
    return Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
};

const dashboardSetCookie = (response: { headers: Record<string, unknown> }): string => {
    const header = response.headers["set-cookie"];
    const values = Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
    const found = values.find((value) => value.startsWith(`${DASHBOARD_COOKIE_NAME}=`));
    if (!found) throw new Error("missing dashboard set-cookie");
    return found.split(";")[0] ?? found;
};

const signedCookieValueFrom = (cookiePair: string): string => {
    const value = cookiePair.split("=").slice(1).join("=");
    if (!value) throw new Error("missing cookie value");
    return decodeURIComponent(value);
};

const makeDiscordOAuthEnv = () =>
    makeEnv({
        DISCORD_CLIENT_SECRET: "discord-client-secret",
        DISCORD_OAUTH_REDIRECT_URI: "https://example.com/api/dashboard/discord/callback",
    });

const loginAsDiscordUser = async (
    app: Awaited<ReturnType<typeof makeApp>>,
    options: {
        userId?: string;
        username?: string;
        displayName?: string;
        guilds: Array<{
            id: string;
            name?: string;
            owner?: boolean;
            permissions?: string;
        }>;
    },
) => {
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
            ok: true,
            json: vi.fn().mockResolvedValue({ access_token: "access-token" }),
        })
        .mockResolvedValueOnce({
            ok: true,
            json: vi.fn().mockResolvedValue({
                id: options.userId ?? discordUserId,
                username: options.username ?? "yaysa",
                global_name: options.displayName ?? "Yaysa",
            }),
        })
        .mockResolvedValueOnce({
            ok: true,
            json: vi.fn().mockResolvedValue(
                options.guilds.map((guild) => ({
                    id: guild.id,
                    name: guild.name ?? `Guild ${guild.id}`,
                    owner: guild.owner === true,
                    ...(guild.permissions !== undefined ? { permissions: guild.permissions } : {}),
                })),
            ),
        });
    vi.stubGlobal("fetch", fetchMock);

    const login = await app.inject("/api/dashboard/discord/login");
    const location = String(login.headers.location);
    expect(login.statusCode).toBe(302);
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
        url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
        headers: { cookie: firstSetCookie(login) },
    });
    expect(callback.statusCode).toBe(302);
    return { sessionCookie: dashboardSetCookie(callback), fetchMock };
};

const makeClaim = (overrides: Partial<CharacterClaimRecord> = {}): CharacterClaimRecord => ({
    claimId: "claim-12345678",
    guildId,
    discordUserId,
    participantKey: "character:us:stormrage:alyra",
    characterName: "Alyra",
    region: "US",
    realm: "Stormrage",
    status: "pending",
    peerCompareOptIn: false,
    publicPostOptIn: false,
    requestedAt: new Date("2026-04-09T00:00:00.000Z"),
    ...overrides,
});

describe("dashboard auth", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("compares secrets through fixed-length hashes", () => {
        expect(compareDashboardAdminSecret("admin-secret", "admin-secret")).toBe(true);
        expect(compareDashboardAdminSecret("short", "a much longer secret")).toBe(false);
    });

    it("intentionally exempts login from the dashboard mutation header", async () => {
        const { store } = makeStore();
        const app = await makeApp(makeEnv(), store);

        const accepted = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });

        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({ ok: true });

        await app.close();
    });

    it("keeps login harmless and header-exempt when auth is disabled", async () => {
        const { store } = makeStore();
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const response = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: {},
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });
        expect(response.headers["set-cookie"]).toBeUndefined();

        await app.close();
    });

    it("rejects wrong login secrets and accepts correct secrets with a signed HttpOnly cookie", async () => {
        const { store } = makeStore();
        const app = await makeApp(makeEnv(), store);

        const rejected = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "wrong" },
        });
        expect(rejected.statusCode).toBe(401);

        const accepted = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });

        expect(accepted.statusCode).toBe(200);
        const setCookie = firstSetCookieHeader(accepted);
        expect(setCookie).toContain(`${DASHBOARD_COOKIE_NAME}=`);
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("Path=/api/dashboard");

        await app.close();
    });

    it("sets dashboard cookie attributes and signed server-checkable value", async () => {
        const env = makeEnv();
        const { store } = makeStore();
        const app = await makeApp(env, store);

        const beforeLogin = Date.now();
        const login = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });
        const afterLogin = Date.now();

        const setCookie = firstSetCookieHeader(login);
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("SameSite=Strict");
        expect(setCookie).toContain("Max-Age=3600");
        expect(setCookie).toContain("Path=/api/dashboard");

        const unsigned = app.unsignCookie(signedCookieValueFrom(firstSetCookie(login)));
        expect(unsigned.valid).toBe(true);
        expect(unsigned.value).toMatch(/^dashboard:v1:\d+$/);
        expect(unsigned.value).not.toContain(env.DASHBOARD_ADMIN_SECRET);

        const expiresAtMs = Number(unsigned.value?.split(":")[2]);
        expect(expiresAtMs).toBeGreaterThanOrEqual(beforeLogin + 60 * 60 * 1000);
        expect(expiresAtMs).toBeLessThanOrEqual(afterLogin + 60 * 60 * 1000);

        await app.close();
    });

    it("sets Secure on dashboard cookies in production", async () => {
        const { store } = makeStore();
        const app = await makeApp(makeEnv({ NODE_ENV: "production" }), store);

        const login = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });

        expect(firstSetCookieHeader(login)).toContain("Secure");

        await app.close();
    });

    it("sets Secure on dashboard cookies when a public HTTPS app base URL is configured", async () => {
        const { store } = makeStore();
        const app = await makeApp(
            makeEnv({
                PUBLIC_APP_BASE_URL: "https://public.example.test",
                WCL_REDIRECT_URI: undefined,
                DISCORD_CLIENT_SECRET: "discord-client-secret",
                DISCORD_OAUTH_REDIRECT_URI: undefined,
            }),
            store,
        );

        const adminLogin = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });
        const discordLogin = await app.inject("/api/dashboard/discord/login");

        expect(firstSetCookieHeader(adminLogin)).toContain("Secure");
        const discordOAuthStateCookie = firstSetCookieHeader(discordLogin);
        expect(discordOAuthStateCookie).toContain("Secure");
        expect(discordOAuthStateCookie).toContain("HttpOnly");
        expect(discordOAuthStateCookie).toContain("SameSite=Lax");
        expect(discordOAuthStateCookie).toContain("Path=/api/dashboard/discord/callback");

        await app.close();
    });

    it("protects session with missing, invalid, expired, and valid cookies", async () => {
        const env = makeEnv();
        const { store } = makeStore();
        const app = await makeApp(env, store);

        expect((await app.inject("/api/dashboard/session")).statusCode).toBe(401);
        expect(
            (
                await app.inject({
                    url: "/api/dashboard/session",
                    headers: { cookie: `${DASHBOARD_COOKIE_NAME}=not-signed` },
                })
            ).statusCode,
        ).toBe(401);

        const expiredCookie = app.signCookie("dashboard:v1:0");
        expect(
            (
                await app.inject({
                    url: "/api/dashboard/session",
                    headers: { cookie: `${DASHBOARD_COOKIE_NAME}=${expiredCookie}` },
                })
            ).statusCode,
        ).toBe(401);

        const login = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });
        const session = await app.inject({
            url: "/api/dashboard/session",
            headers: { cookie: firstSetCookie(login) },
        });
        expect(session.statusCode).toBe(200);
        expect(session.json()).toEqual({
            authenticated: true,
            auth: { kind: "admin-secret" },
        });

        await app.close();
    });

    it("rejects missing Discord OAuth state before token exchange", async () => {
        const { store } = makeStore();
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp(
            makeEnv({
                DISCORD_CLIENT_SECRET: "discord-client-secret",
                DISCORD_OAUTH_REDIRECT_URI: "https://example.com/api/dashboard/discord/callback",
            }),
            store,
        );

        const callback = await app.inject(
            "/api/dashboard/discord/callback?code=abc&state=missing",
        );

        expect(callback.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();

        await app.close();
    });

    it("rejects expired Discord OAuth state before token exchange", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
        const { store } = makeStore();
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp(makeDiscordOAuthEnv(), store);

        const login = await app.inject("/api/dashboard/discord/login");
        const location = String(login.headers.location);
        const state = new URL(location).searchParams.get("state");
        expect(state).toBeTruthy();

        vi.setSystemTime(new Date("2026-04-09T00:11:00.000Z"));
        const callback = await app.inject({
            url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });

        expect(callback.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();

        await app.close();
    });

    it("handles Discord OAuth denial without token exchange and consumes matching state", async () => {
        const { store } = makeStore();
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp(makeDiscordOAuthEnv(), store);

        const login = await app.inject("/api/dashboard/discord/login");
        const state = new URL(String(login.headers.location)).searchParams.get("state");
        expect(state).toBeTruthy();

        const denied = await app.inject({
            url: `/api/dashboard/discord/callback?error=access_denied&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });
        const replay = await app.inject({
            url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });

        expect(denied.statusCode).toBe(400);
        expect(denied.json()).toEqual({ error: "discord_oauth_denied" });
        expect(replay.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(denied.body).not.toContain("access_denied");

        await app.close();
    });

    it("uses the configured public base URL for Discord OAuth login redirects", async () => {
        const { store } = makeStore();
        const app = await makeApp(
            makeEnv({
                PUBLIC_APP_BASE_URL: "https://public.example.test",
                DISCORD_CLIENT_SECRET: "discord-client-secret",
                DISCORD_OAUTH_REDIRECT_URI: undefined,
            }),
            store,
        );

        const login = await app.inject({
            url: "/api/dashboard/discord/login",
            headers: { host: "evil.example.test" },
        });

        expect(login.statusCode).toBe(302);
        const redirect = new URL(String(login.headers.location));
        expect(redirect.searchParams.get("scope")).toBe("identify guilds");
        expect(redirect.searchParams.get("redirect_uri")).toBe(
            "https://public.example.test/api/dashboard/discord/callback",
        );

        await app.close();
    });

    it("uses the same configured Discord OAuth redirect URI for token exchange", async () => {
        const { store } = makeStore();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ access_token: "access-token" }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    id: discordUserId,
                    username: "yaysa",
                    global_name: "Yaysa",
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue([]),
            });
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp(
            makeEnv({
                PUBLIC_APP_BASE_URL: "https://public.example.test",
                DISCORD_CLIENT_SECRET: "discord-client-secret",
                DISCORD_OAUTH_REDIRECT_URI: undefined,
            }),
            store,
        );

        const login = await app.inject("/api/dashboard/discord/login");
        const state = new URL(String(login.headers.location)).searchParams.get("state");
        expect(state).toBeTruthy();

        const callback = await app.inject({
            url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
            headers: {
                cookie: firstSetCookie(login),
                host: "evil.example.test",
            },
        });

        expect(callback.statusCode).toBe(302);
        const dashboardCookieHeader = setCookieHeaders(callback).find((header) =>
            header.startsWith(`${DASHBOARD_COOKIE_NAME}=`),
        );
        expect(dashboardCookieHeader).toContain("Secure");
        expect(dashboardCookieHeader).toContain("HttpOnly");
        expect(dashboardCookieHeader).toContain("SameSite=Strict");
        const tokenRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        expect(tokenRequest?.body).toBeInstanceOf(URLSearchParams);
        expect((tokenRequest?.body as URLSearchParams).get("redirect_uri")).toBe(
            "https://public.example.test/api/dashboard/discord/callback",
        );
        expect(callback.body).not.toContain("access-token");
        expect(JSON.stringify(callback.headers)).not.toContain("access-token");

        await app.close();
    });

    it("builds Discord sessions from OAuth guild facts and preserves guild isolation", async () => {
        const current = {
            ...defaultGuildConfigFor(guildId),
            dashboardOfficerAccessEnabled: true,
        };
        const other = defaultGuildConfigFor(otherGuildId);
        const { store } = makeStore([current, other]);
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ access_token: "access-token" }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    id: discordUserId,
                    username: "yaysa",
                    global_name: "Yaysa",
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue([
                    {
                        id: guildId,
                        name: "Allowed Guild",
                        owner: false,
                        permissions: "32",
                    },
                ]),
            });
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp(
            makeEnv({
                DISCORD_CLIENT_SECRET: "discord-client-secret",
                DISCORD_OAUTH_REDIRECT_URI: "https://example.com/api/dashboard/discord/callback",
            }),
            store,
        );

        const login = await app.inject("/api/dashboard/discord/login");
        const location = String(login.headers.location);
        expect(login.statusCode).toBe(302);
        expect(new URL(location).searchParams.get("scope")).toBe("identify guilds");
        const state = new URL(location).searchParams.get("state");
        expect(state).toBeTruthy();

        const mismatchedState = await app.inject({
            url: "/api/dashboard/discord/callback?code=abc&state=mismatch",
            headers: { cookie: firstSetCookie(login) },
        });
        expect(mismatchedState.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();

        const callback = await app.inject({
            url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });
        expect(callback.statusCode).toBe(302);
        const sessionCookie = dashboardSetCookie(callback);

        const publicSession = await app.inject({
            url: "/api/dashboard/session",
            headers: { cookie: sessionCookie },
        });
        expect(publicSession.statusCode).toBe(200);
        const publicSessionBody = publicSession.json<{
            authenticated: true;
            auth: Record<string, unknown>;
        }>();
        expect(publicSessionBody.auth).toEqual({
            kind: "discord",
            discordUserId,
            username: "yaysa",
            displayName: "Yaysa",
        });
        expect(publicSessionBody.auth).not.toHaveProperty("oauthGuildsById");
        expect(callback.body).not.toContain("access-token");
        expect(sessionCookie).not.toContain("access-token");
        expect(publicSession.body).not.toContain("access-token");

        const reusedState = await app.inject({
            url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });
        expect(reusedState.statusCode).toBe(400);

        const guilds = await app.inject({
            url: "/api/dashboard/guilds",
            headers: { cookie: sessionCookie },
        });
        expect(guilds.statusCode).toBe(200);
        expect(guilds.json<{ guilds: DashboardGuildConfigSummary[] }>().guilds).toEqual([
            expect.objectContaining({
                guildId,
                guildName: "Allowed Guild",
                capabilities: expect.arrayContaining(["settings:edit", "officers:manage"]),
            }),
        ]);
        expect(store.listGuildConfigSummaries).not.toHaveBeenCalled();
        expect(store.listGuildConfigSummariesForGuilds).toHaveBeenCalledWith([guildId]);

        const forbidden = await app.inject({
            url: `/api/dashboard/guilds/${otherGuildId}/config`,
            headers: { cookie: sessionCookie },
        });
        expect(forbidden.statusCode).toBe(404);

        const deleteAttempt = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        expect(deleteAttempt.statusCode).toBe(404);
        expect(store.deconfigureExistingGuild).not.toHaveBeenCalled();

        await app.close();
    });

    it("clears the dashboard cookie and invalidates Discord sessions on logout", async () => {
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Allowed Guild", permissions: "32" }],
        });

        const beforeLogout = await app.inject({
            url: "/api/dashboard/session",
            headers: { cookie: sessionCookie },
        });
        const logout = await app.inject({
            method: "POST",
            url: "/api/dashboard/logout",
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const afterLogout = await app.inject({
            url: "/api/dashboard/session",
            headers: { cookie: sessionCookie },
        });

        expect(beforeLogout.statusCode).toBe(200);
        expect(logout.statusCode).toBe(200);
        expect(afterLogout.statusCode).toBe(401);
        expect(
            setCookieHeaders(logout).some(
                (header) =>
                    header.startsWith(`${DASHBOARD_COOKIE_NAME}=`) &&
                    header.includes("Max-Age=0") &&
                    header.includes("Path=/api/dashboard"),
            ),
        ).toBe(true);

        await app.close();
    });

    it("rejects expired Discord sessions deterministically", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Allowed Guild", permissions: "32" }],
        });

        const active = await app.inject({
            url: "/api/dashboard/session",
            headers: { cookie: sessionCookie },
        });
        vi.setSystemTime(new Date("2026-04-09T01:01:00.000Z"));
        const expired = await app.inject({
            url: "/api/dashboard/session",
            headers: { cookie: sessionCookie },
        });

        expect(active.statusCode).toBe(200);
        expect(expired.statusCode).toBe(401);

        await app.close();
    });

    it("does not broad-read guild summaries for Discord sessions without guild access", async () => {
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, { guilds: [] });

        const guilds = await app.inject({
            url: "/api/dashboard/guilds",
            headers: { cookie: sessionCookie },
        });

        expect(guilds.statusCode).toBe(200);
        expect(guilds.json<{ guilds: DashboardGuildConfigSummary[] }>().guilds).toEqual([]);
        expect(store.listGuildConfigSummariesForGuilds).toHaveBeenCalledWith([]);
        expect(store.listGuildConfigSummaries).not.toHaveBeenCalled();
        expect(store.getExistingGuildConfig).not.toHaveBeenCalled();

        await app.close();
    });

    it("checks the Discord guild allow-list before reading guild config", async () => {
        const { store } = makeStore([
            defaultGuildConfigFor(guildId),
            defaultGuildConfigFor(otherGuildId),
        ]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Allowed Guild", permissions: "32" }],
        });
        store.getExistingGuildConfig.mockClear();

        const forbidden = await app.inject({
            url: `/api/dashboard/guilds/${otherGuildId}/config`,
            headers: { cookie: sessionCookie },
        });
        expect(forbidden.statusCode).toBe(404);
        expect(store.getExistingGuildConfig).not.toHaveBeenCalled();

        const allowed = await app.inject({
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie },
        });
        expect(allowed.statusCode).toBe(200);
        expect(store.getExistingGuildConfig).toHaveBeenCalledWith(guildId);

        await app.close();
    });

    it("keeps admin-secret guild access using the config read path", async () => {
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv(), store);
        const login = await app.inject({
            method: "POST",
            url: "/api/dashboard/login",
            payload: { adminSecret: "admin-secret" },
        });
        store.getExistingGuildConfig.mockClear();

        const response = await app.inject({
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: firstSetCookie(login) },
        });

        expect(response.statusCode).toBe(200);
        expect(store.getExistingGuildConfig).toHaveBeenCalledWith(guildId);

        await app.close();
    });

    it("keeps mutation header enforcement on state-changing routes even when auth is disabled", async () => {
        const existing = defaultGuildConfigFor(guildId);
        const { store } = makeStore();
        const app = await makeApp(
            makeEnv({ DASHBOARD_AUTH_DISABLED: true }),
            store,
        );
        store.getExistingGuildConfig.mockResolvedValue(existing);
        store.saveExistingGuildConfig.mockResolvedValue(existing);
        store.addOfficerToExistingGuild.mockResolvedValue(existing);
        store.removeOfficerFromExistingGuild.mockResolvedValue(existing);

        expect((await app.inject("/api/dashboard/session")).statusCode).toBe(200);

        const missingHeaderRequests = [
            app.inject({
                method: "POST",
                url: "/api/dashboard/logout",
            }),
            app.inject({
                method: "POST",
                url: "/api/dashboard/guilds",
                payload: { guildId },
            }),
            app.inject({
                method: "PATCH",
                url: `/api/dashboard/guilds/${guildId}/config`,
                payload: { compareModeDefault: "mixed" },
            }),
            app.inject({
                method: "POST",
                url: `/api/dashboard/guilds/${guildId}/officers/${discordUserId}`,
            }),
            app.inject({
                method: "DELETE",
                url: `/api/dashboard/guilds/${guildId}/officers/${discordUserId}`,
            }),
            app.inject({
                method: "POST",
                url: `/api/dashboard/guilds/${guildId}/claims/claim-12345678/approve`,
            }),
            app.inject({
                method: "PATCH",
                url: `/api/dashboard/guilds/${guildId}/onboarding`,
                payload: { seenSteps: ["overview"] },
            }),
            app.inject({
                method: "DELETE",
                url: `/api/dashboard/guilds/${guildId}`,
            }),
        ];
        const missingHeaderResponses = await Promise.all(missingHeaderRequests);
        for (const response of missingHeaderResponses) {
            expect(response.statusCode).toBe(400);
        }

        const accepted = await app.inject({
            method: "POST",
            url: "/api/dashboard/guilds",
            headers: { "x-dashboard-request": "1" },
            payload: { guildId },
        });
        expect(accepted.statusCode).toBe(200);

        await app.close();
    });

    it("rejects cross-site representative dashboard mutations", async () => {
        const existing = defaultGuildConfigFor(guildId);
        const { store } = makeStore([existing]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const originMismatch = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: {
                "x-dashboard-request": "1",
                origin: "https://evil.example",
                host: "dashboard.example",
            },
            payload: { compareModeDefault: "mixed" },
        });
        const claimCrossSite = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/claim-12345678/approve`,
            headers: {
                "x-dashboard-request": "1",
                "sec-fetch-site": "cross-site",
            },
        });
        const onboardingBadOrigin = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/onboarding`,
            headers: {
                "x-dashboard-request": "1",
                origin: "not a url",
                host: "dashboard.example",
            },
            payload: { seenSteps: ["overview"] },
        });
        const deleteCrossSite = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}`,
            headers: {
                "x-dashboard-request": "1",
                "sec-fetch-site": "cross-site",
            },
        });

        expect(originMismatch.statusCode).toBe(403);
        expect(claimCrossSite.statusCode).toBe(403);
        expect(onboardingBadOrigin.statusCode).toBe(403);
        expect(deleteCrossSite.statusCode).toBe(403);
        expect(store.saveExistingGuildConfig).not.toHaveBeenCalled();
        expect(store.deconfigureExistingGuild).not.toHaveBeenCalled();

        await app.close();
    });
});

describe("dashboard guild routes", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("creates guild configs only through explicit onboarding", async () => {
        const { store } = makeStore();
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const missing = await app.inject(`/api/dashboard/guilds/${guildId}/config`);
        expect(missing.statusCode).toBe(404);

        const created = await app.inject({
            method: "POST",
            url: "/api/dashboard/guilds",
            headers: { "x-dashboard-request": "1" },
            payload: { guildId },
        });
        expect(created.statusCode).toBe(200);
        expect(created.json<{ config: GuildConfig }>().config.guildId).toBe(guildId);

        const found = await app.inject(`/api/dashboard/guilds/${guildId}/config`);
        expect(found.statusCode).toBe(200);

        await app.close();
    });

    it("strictly validates config patches and keeps officer IDs out of PATCH", async () => {
        const existing = defaultGuildConfigFor(guildId);
        const { store } = makeStore([existing]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const unknown = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { "x-dashboard-request": "1" },
            payload: { compareOfficerUserIds: [discordUserId] },
        });
        expect(unknown.statusCode).toBe(400);

        const saved = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { "x-dashboard-request": "1" },
            payload: {
                compareModeDefault: "mixed",
                compareAccessMode: "owner_only",
                comparePublicPostingEnabled: true,
                autoReportMode: "auto_preview",
                autoReportChannelIds: [` ${channelId} `, channelId],
                defaultGameFamily: "mop_classic",
            },
        });

        expect(saved.statusCode).toBe(200);
        expect(saved.json<{ config: GuildConfig }>().config).toMatchObject({
            compareModeDefault: "mixed",
            compareAccessMode: "owner_only",
            comparePublicPostingEnabled: true,
            autoReportMode: "auto_preview",
            autoReportChannelIds: [channelId],
            defaultGameFamily: "mop_classic",
        });
        expect(store.saveExistingGuildConfig).toHaveBeenCalledWith(guildId, {
            compareModeDefault: "mixed",
            compareAccessMode: "owner_only",
            comparePublicPostingEnabled: true,
            autoReportMode: "auto_preview",
            autoReportChannelIds: [channelId],
            defaultGameFamily: "mop_classic",
        });

        await app.close();
    });

    it("keeps config mutation success when dashboard activity recording fails", async () => {
        const existing = defaultGuildConfigFor(guildId);
        const { configs, store } = makeStore([existing]);
        const activityStore = {
            recordActivity: vi.fn().mockRejectedValue(new Error("activity down")),
            listActivity: vi.fn(),
        } as unknown as DashboardActivityStore;
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            activityStore,
        });

        const response = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { "x-dashboard-request": "1" },
            payload: { compareModeDefault: "mixed" },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json<{ config: GuildConfig }>().config.compareModeDefault).toBe("mixed");
        expect(configs.get(guildId)?.compareModeDefault).toBe("mixed");
        expect(store.saveExistingGuildConfig).toHaveBeenCalledWith(guildId, {
            compareModeDefault: "mixed",
        });
        expect(activityStore.recordActivity).toHaveBeenCalledOnce();

        await app.close();
    });

    it("never creates guild configs from config or officer mutations against unknown guilds", async () => {
        const { configs, store } = makeStore();
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const patchUnknownGuild = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${otherGuildId}/config`,
            headers: { "x-dashboard-request": "1" },
            payload: { compareModeDefault: "mixed" },
        });
        expect(patchUnknownGuild.statusCode).toBe(404);
        expect(configs.has(otherGuildId)).toBe(false);

        const addUnknownGuildOfficer = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${otherGuildId}/officers/${discordUserId}`,
            headers: { "x-dashboard-request": "1" },
        });
        expect(addUnknownGuildOfficer.statusCode).toBe(404);
        expect(configs.has(otherGuildId)).toBe(false);

        const deleteUnknownGuildOfficer = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${otherGuildId}/officers/${discordUserId}`,
            headers: { "x-dashboard-request": "1" },
        });
        expect(deleteUnknownGuildOfficer.statusCode).toBe(404);
        expect(configs.has(otherGuildId)).toBe(false);

        await app.close();
    });

    it("removes officers idempotently only within existing guild configs", async () => {
        const existing = {
            ...defaultGuildConfigFor(guildId),
            compareOfficerUserIds: [discordUserId],
        };
        const { store, configs } = makeStore([existing]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const removed = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}/officers/${discordUserId}`,
            headers: { "x-dashboard-request": "1" },
        });
        expect(removed.statusCode).toBe(200);
        expect(removed.json<{ config: GuildConfig }>().config.compareOfficerUserIds).toEqual([]);

        const absent = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}/officers/${discordUserId}`,
            headers: { "x-dashboard-request": "1" },
        });
        expect(absent.statusCode).toBe(200);
        expect(absent.json<{ config: GuildConfig }>().config.compareOfficerUserIds).toEqual([]);
        expect(configs.has(otherGuildId)).toBe(false);

        await app.close();
    });

    it("approves pending claims by stable claim ID", async () => {
        const claim = makeClaim({
            status: "approved",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
        });
        const characterClaimStore = {
            approveClaimById: vi.fn().mockResolvedValue(claim),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            characterClaimStore,
        });

        const response = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${claim.claimId}/approve`,
            headers: { "x-dashboard-request": "1" },
        });

        expect(response.statusCode).toBe(200);
        expect(characterClaimStore.approveClaimById).toHaveBeenCalledWith({
            guildId,
            claimId: claim.claimId,
            reviewedByDiscordUserId: undefined,
        });
        expect(response.json<{ claim: { claimId: string; status: string } }>().claim).toMatchObject({
            claimId: claim.claimId,
            status: "approved",
        });

        await app.close();
    });

    it("rejects and revokes claims by stable claim ID", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Discord DM disabled in test")));
        const rejectedClaim = makeClaim({
            claimId: "claim-reject-route",
            status: "rejected",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
        });
        const revokedClaim = makeClaim({
            claimId: "claim-revoke-route",
            status: "revoked",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
            revokedAt: new Date("2026-04-11T00:00:00.000Z"),
            revokeReason: "duplicate_wrong_character",
        });
        const characterClaimStore = {
            rejectClaimById: vi.fn().mockResolvedValue(rejectedClaim),
            revokeClaimById: vi.fn().mockResolvedValue(revokedClaim),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            characterClaimStore,
        });

        const reject = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${rejectedClaim.claimId}/reject`,
            headers: { "x-dashboard-request": "1" },
        });
        const revoke = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${revokedClaim.claimId}/revoke`,
            headers: { "x-dashboard-request": "1" },
            payload: { revokeReason: "duplicate_wrong_character" },
        });

        expect(reject.statusCode).toBe(200);
        expect(characterClaimStore.rejectClaimById).toHaveBeenCalledWith({
            guildId,
            claimId: rejectedClaim.claimId,
            reviewedByDiscordUserId: undefined,
        });
        expect(reject.json<{ claim: { claimId: string; status: string } }>().claim).toMatchObject({
            claimId: rejectedClaim.claimId,
            status: "rejected",
        });
        expect(revoke.statusCode).toBe(200);
        expect(characterClaimStore.revokeClaimById).toHaveBeenCalledWith({
            guildId,
            claimId: revokedClaim.claimId,
            revokedByDiscordUserId: undefined,
            revokeReason: "duplicate_wrong_character",
        });
        expect(revoke.json<{ claim: { claimId: string; status: string; revokeReason: string } }>().claim)
            .toMatchObject({
                claimId: revokedClaim.claimId,
                status: "revoked",
                revokeReason: "duplicate_wrong_character",
            });

        await app.close();
    });

    it("runs revoke notification after dashboard activity recording fails", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ id: "dm-channel" }),
            })
            .mockResolvedValueOnce({
                ok: true,
            });
        vi.stubGlobal("fetch", fetchMock);
        const revokedClaim = makeClaim({
            claimId: "claim-revoke-activity-failure",
            status: "revoked",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
            revokedAt: new Date("2026-04-11T00:00:00.000Z"),
            revokeReason: "requested_by_player",
        });
        const characterClaimStore = {
            revokeClaimById: vi.fn().mockResolvedValue(revokedClaim),
        } as unknown as DashboardCharacterClaimStore;
        const activityStore = {
            recordActivity: vi.fn().mockRejectedValue(new Error("activity down")),
            listActivity: vi.fn(),
        } as unknown as DashboardActivityStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            characterClaimStore,
            activityStore,
        });

        const response = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${revokedClaim.claimId}/revoke`,
            headers: { "x-dashboard-request": "1" },
            payload: { revokeReason: "requested_by_player" },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json<{ claim: { status: string }; notified: boolean }>()).toMatchObject({
            claim: { status: "revoked" },
            notified: true,
        });
        expect(characterClaimStore.revokeClaimById).toHaveBeenCalledWith({
            guildId,
            claimId: revokedClaim.claimId,
            revokedByDiscordUserId: undefined,
            revokeReason: "requested_by_player",
        });
        expect(activityStore.recordActivity).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await app.close();
    });

    it("does not act on another guild's claim IDs", async () => {
        const characterClaimStore = {
            approveClaimById: vi.fn().mockResolvedValue(makeClaim({ status: "approved" })),
            rejectClaimById: vi.fn().mockResolvedValue(makeClaim({ status: "rejected" })),
            revokeClaimById: vi.fn().mockResolvedValue(makeClaim({ status: "revoked" })),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([
            defaultGuildConfigFor(guildId),
            defaultGuildConfigFor(otherGuildId),
        ]);
        const app = await makeApp(makeDiscordOAuthEnv(), store, { characterClaimStore });
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Allowed Guild", permissions: "32" }],
        });

        const approve = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${otherGuildId}/claims/claim-cross-approve/approve`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const reject = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${otherGuildId}/claims/claim-cross-reject/reject`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const revoke = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${otherGuildId}/claims/claim-cross-revoke/revoke`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
            payload: { revokeReason: "other" },
        });

        expect(approve.statusCode).toBe(404);
        expect(reject.statusCode).toBe(404);
        expect(revoke.statusCode).toBe(404);
        expect(characterClaimStore.approveClaimById).not.toHaveBeenCalled();
        expect(characterClaimStore.rejectClaimById).not.toHaveBeenCalled();
        expect(characterClaimStore.revokeClaimById).not.toHaveBeenCalled();

        await app.close();
    });

    it("rejects invalid revoke reasons before mutating claims", async () => {
        const characterClaimStore = {
            revokeClaimById: vi.fn(),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            characterClaimStore,
        });

        const response = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/claim-invalid-reason/revoke`,
            headers: { "x-dashboard-request": "1" },
            payload: { revokeReason: "not_allowed" },
        });

        expect(response.statusCode).toBe(400);
        expect(characterClaimStore.revokeClaimById).not.toHaveBeenCalled();

        await app.close();
    });

    it("rejects invalid claim status for authorized guild access", async () => {
        const characterClaimStore = {
            listClaimsByStatus: vi.fn(),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            characterClaimStore,
        });

        const response = await app.inject(`/api/dashboard/guilds/${guildId}/claims?status=invalid`);

        expect(response.statusCode).toBe(400);
        expect(characterClaimStore.listClaimsByStatus).not.toHaveBeenCalled();

        await app.close();
    });

    it("returns 404 when revoking a claim that is not currently approved", async () => {
        const characterClaimStore = {
            revokeClaimById: vi.fn().mockResolvedValue(null),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store, {
            characterClaimStore,
        });

        const response = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/claim-not-approved/revoke`,
            headers: { "x-dashboard-request": "1" },
            payload: { revokeReason: "other" },
        });

        expect(response.statusCode).toBe(404);
        expect(characterClaimStore.revokeClaimById).toHaveBeenCalledWith({
            guildId,
            claimId: "claim-not-approved",
            revokedByDiscordUserId: undefined,
            revokeReason: "other",
        });

        await app.close();
    });

    it("returns privacy-preserving 404s for another guild before protected route stores run", async () => {
        const characterClaimStore = {
            listClaimsByStatus: vi.fn(),
            approveClaimById: vi.fn(),
            rejectClaimById: vi.fn(),
            revokeClaimById: vi.fn(),
        } as unknown as DashboardCharacterClaimStore;
        const activityStore = {
            listActivity: vi.fn(),
            recordActivity: vi.fn(),
            archiveGuildActivity: vi.fn(),
        } as unknown as DashboardActivityStore;
        const onboardingStore = {
            getOnboardingState: vi.fn(),
            saveOnboardingState: vi.fn(),
            archiveGuildOnboarding: vi.fn(),
        } as unknown as DashboardOnboardingStore;
        const directoryResolver = vi.fn(async () => ({
            guild: { id: otherGuildId, label: otherGuildId, resolved: false },
            channels: {},
            users: {},
            generatedAt: new Date("2026-04-09T00:00:00.000Z").toISOString(),
        }));
        const { store } = makeStore([
            defaultGuildConfigFor(guildId),
            defaultGuildConfigFor(otherGuildId),
        ]);
        const app = await makeApp(makeDiscordOAuthEnv(), store, {
            characterClaimStore,
            activityStore,
            onboardingStore,
            directoryResolver,
        });
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Allowed Guild", permissions: "32" }],
        });

        const forbiddenRequests = [
            app.inject({
                url: `/api/dashboard/guilds/${otherGuildId}/config`,
                headers: { cookie: sessionCookie },
            }),
            app.inject({
                url: `/api/dashboard/guilds/${otherGuildId}/claims?status=pending`,
                headers: { cookie: sessionCookie },
            }),
            app.inject({
                url: `/api/dashboard/guilds/${otherGuildId}/claims?status=not-a-status`,
                headers: { cookie: sessionCookie },
            }),
            app.inject({
                url: `/api/dashboard/guilds/${otherGuildId}/activity`,
                headers: { cookie: sessionCookie },
            }),
            app.inject({
                url: `/api/dashboard/guilds/${otherGuildId}/directory`,
                headers: { cookie: sessionCookie },
            }),
            app.inject({
                url: `/api/dashboard/guilds/${otherGuildId}/onboarding`,
                headers: { cookie: sessionCookie },
            }),
            app.inject({
                method: "PATCH",
                url: `/api/dashboard/guilds/${otherGuildId}/onboarding`,
                headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
                payload: { seenSteps: ["overview"] },
            }),
            app.inject({
                method: "POST",
                url: `/api/dashboard/guilds/${otherGuildId}/claims/claim-cross-revoke/revoke`,
                headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
                payload: { revokeReason: "not_allowed" },
            }),
            app.inject({
                method: "DELETE",
                url: `/api/dashboard/guilds/${otherGuildId}`,
                headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
            }),
        ];

        const responses = await Promise.all(forbiddenRequests);
        for (const response of responses) {
            expect(response.statusCode).toBe(404);
        }
        expect(characterClaimStore.listClaimsByStatus).not.toHaveBeenCalled();
        expect(activityStore.listActivity).not.toHaveBeenCalled();
        expect(onboardingStore.getOnboardingState).not.toHaveBeenCalled();
        expect(onboardingStore.saveOnboardingState).not.toHaveBeenCalled();
        expect(directoryResolver).not.toHaveBeenCalled();
        expect(store.getExistingGuildConfig).not.toHaveBeenCalled();
        expect(store.deconfigureExistingGuild).not.toHaveBeenCalled();

        await app.close();
    });

    it.each([
        { label: "guild owner", guild: { owner: true } },
        {
            label: "guild owner with malformed permissions",
            guild: { owner: true, permissions: "not-a-number" },
        },
        { label: "Discord Administrator", guild: { permissions: "8" } },
    ])("allows $label to deconfigure a guild", async ({ guild }) => {
        const { store, configs } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Managed Guild", ...guild }],
        });

        const response = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ ok: true });
        expect(configs.has(guildId)).toBe(false);

        await app.close();
    });

    it("allows Manage Guild users to manage settings, officers, and claims without deconfiguration", async () => {
        const approvedClaim = makeClaim({
            claimId: "claim-approve",
            status: "approved",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
        });
        const rejectedClaim = makeClaim({
            claimId: "claim-reject",
            status: "rejected",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
        });
        const revokedClaim = makeClaim({
            claimId: "claim-revoke",
            status: "revoked",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
            revokedAt: new Date("2026-04-11T00:00:00.000Z"),
            revokedByDiscordUserId: discordUserId,
            revokeReason: "player_left_guild",
        });
        const characterClaimStore = {
            approveClaimById: vi.fn().mockResolvedValue(approvedClaim),
            rejectClaimById: vi.fn().mockResolvedValue(rejectedClaim),
            revokeClaimById: vi.fn().mockResolvedValue(revokedClaim),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store, { characterClaimStore });
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Managed Guild", permissions: "32" }],
        });

        const settings = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
            payload: { compareModeDefault: "mixed" },
        });
        const addOfficer = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/officers/${channelId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const removeOfficer = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}/officers/${channelId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const approve = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${approvedClaim.claimId}/approve`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const reject = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${rejectedClaim.claimId}/reject`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const revoke = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${revokedClaim.claimId}/revoke`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
            payload: { revokeReason: "player_left_guild" },
        });
        const deconfigure = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });

        expect(settings.statusCode).toBe(200);
        expect(addOfficer.statusCode).toBe(200);
        expect(removeOfficer.statusCode).toBe(200);
        expect(approve.statusCode).toBe(200);
        expect(reject.statusCode).toBe(200);
        expect(revoke.statusCode).toBe(200);
        expect(deconfigure.statusCode).toBe(404);
        expect(store.deconfigureExistingGuild).not.toHaveBeenCalled();

        await app.close();
    });

    it.each([
        { label: "malformed permissions", guild: { permissions: "not-a-number" } },
        { label: "missing permissions", guild: {} },
    ])("grants no elevated dashboard access for $label", async ({ guild }) => {
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "No Access Guild", owner: false, ...guild }],
        });

        const guilds = await app.inject({
            url: "/api/dashboard/guilds",
            headers: { cookie: sessionCookie },
        });
        const config = await app.inject({
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie },
        });

        expect(guilds.statusCode).toBe(200);
        expect(guilds.json<{ guilds: DashboardGuildConfigSummary[] }>().guilds).toEqual([]);
        expect(config.statusCode).toBe(404);

        await app.close();
    });

    it("grants owner capabilities even when permissions are missing", async () => {
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Owner Guild", owner: true }],
        });

        const guilds = await app.inject({
            url: "/api/dashboard/guilds",
            headers: { cookie: sessionCookie },
        });
        const config = await app.inject({
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie },
        });

        expect(guilds.statusCode).toBe(200);
        expect(guilds.json<{ guilds: DashboardGuildConfigSummary[] }>().guilds[0]).toEqual(
            expect.objectContaining({
                guildId,
                capabilities: expect.arrayContaining(["settings:edit", "guild:delete"]),
            }),
        );
        expect(config.statusCode).toBe(200);

        await app.close();
    });

    it("denies configured officers when officer dashboard access is disabled", async () => {
        const { store } = makeStore([
            {
                ...defaultGuildConfigFor(guildId),
                compareOfficerUserIds: [discordUserId],
                dashboardOfficerAccessEnabled: false,
            },
        ]);
        const app = await makeApp(makeDiscordOAuthEnv(), store);
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Officer Guild", permissions: "0" }],
        });

        const guilds = await app.inject({
            url: "/api/dashboard/guilds",
            headers: { cookie: sessionCookie },
        });
        const config = await app.inject({
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie },
        });

        expect(guilds.statusCode).toBe(200);
        expect(guilds.json<{ guilds: DashboardGuildConfigSummary[] }>().guilds).toEqual([]);
        expect(config.statusCode).toBe(404);

        await app.close();
    });

    it("allows configured officers limited claim operations when officer dashboard access is enabled", async () => {
        const approvedClaim = makeClaim({
            claimId: "claim-officer-approve",
            status: "approved",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
        });
        const rejectedClaim = makeClaim({
            claimId: "claim-officer-reject",
            status: "rejected",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
        });
        const revokedClaim = makeClaim({
            claimId: "claim-officer-revoke",
            status: "revoked",
            reviewedAt: new Date("2026-04-10T00:00:00.000Z"),
            revokedAt: new Date("2026-04-11T00:00:00.000Z"),
            revokedByDiscordUserId: discordUserId,
            revokeReason: "requested_by_player",
        });
        const characterClaimStore = {
            approveClaimById: vi.fn().mockResolvedValue(approvedClaim),
            rejectClaimById: vi.fn().mockResolvedValue(rejectedClaim),
            revokeClaimById: vi.fn().mockResolvedValue(revokedClaim),
        } as unknown as DashboardCharacterClaimStore;
        const { store } = makeStore([
            {
                ...defaultGuildConfigFor(guildId),
                compareOfficerUserIds: [discordUserId],
                dashboardOfficerAccessEnabled: true,
            },
        ]);
        const app = await makeApp(makeDiscordOAuthEnv(), store, { characterClaimStore });
        const { sessionCookie } = await loginAsDiscordUser(app, {
            guilds: [{ id: guildId, name: "Officer Guild", permissions: "0" }],
        });

        const guilds = await app.inject({
            url: "/api/dashboard/guilds",
            headers: { cookie: sessionCookie },
        });
        const viewConfig = await app.inject({
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie },
        });
        const editConfig = await app.inject({
            method: "PATCH",
            url: `/api/dashboard/guilds/${guildId}/config`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
            payload: { compareModeDefault: "mixed" },
        });
        const addOfficer = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/officers/${channelId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const approve = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${approvedClaim.claimId}/approve`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const reject = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${rejectedClaim.claimId}/reject`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });
        const revoke = await app.inject({
            method: "POST",
            url: `/api/dashboard/guilds/${guildId}/claims/${revokedClaim.claimId}/revoke`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
            payload: { revokeReason: "requested_by_player" },
        });
        const deconfigure = await app.inject({
            method: "DELETE",
            url: `/api/dashboard/guilds/${guildId}`,
            headers: { cookie: sessionCookie, "x-dashboard-request": "1" },
        });

        expect(guilds.statusCode).toBe(200);
        expect(guilds.json<{ guilds: DashboardGuildConfigSummary[] }>().guilds[0]).toEqual(
            expect.objectContaining({
                guildId,
                capabilities: expect.arrayContaining(["claims:approve", "activity:view"]),
            }),
        );
        expect(viewConfig.statusCode).toBe(200);
        expect(editConfig.statusCode).toBe(404);
        expect(addOfficer.statusCode).toBe(404);
        expect(approve.statusCode).toBe(200);
        expect(reject.statusCode).toBe(200);
        expect(revoke.statusCode).toBe(200);
        expect(deconfigure.statusCode).toBe(404);
        expect(store.deconfigureExistingGuild).not.toHaveBeenCalled();

        await app.close();
    });

    it("returns unresolved directory labels when Discord channel lookup throws", async () => {
        const directoryGuildId = "523456789012345678";
        const directoryChannelId = "623456789012345678";
        const directoryUserId = "723456789012345678";
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
            const endpoint = String(url);
            if (endpoint.endsWith(`/guilds/${directoryGuildId}`)) {
                return {
                    ok: true,
                    json: vi.fn().mockResolvedValue({ name: "Directory Guild" }),
                };
            }
            if (endpoint.endsWith(`/guilds/${directoryGuildId}/channels`)) {
                throw new Error("Discord channel lookup failed");
            }
            if (endpoint.endsWith(`/guilds/${directoryGuildId}/members/${directoryUserId}`)) {
                return {
                    ok: true,
                    json: vi.fn().mockResolvedValue({
                        user: { username: "OfficerName" },
                    }),
                };
            }
            throw new Error(`Unexpected Discord request: ${endpoint}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const { store } = makeStore([
            {
                ...defaultGuildConfigFor(directoryGuildId),
                autoReportChannelIds: [directoryChannelId],
                compareOfficerUserIds: [directoryUserId],
            },
        ]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const response = await app.inject(`/api/dashboard/guilds/${directoryGuildId}/directory`);

        expect(response.statusCode).toBe(200);
        const body = response.json<{
            directory: {
                guild: { id: string; label: string; resolved: boolean };
                channels: Record<string, { id: string; label: string; resolved: boolean }>;
                users: Record<string, { id: string; label: string; resolved: boolean }>;
            };
        }>();
        expect(body.directory.guild).toMatchObject({
            id: directoryGuildId,
            label: "Directory Guild",
            resolved: true,
        });
        expect(body.directory.channels[directoryChannelId]).toEqual({
            id: directoryChannelId,
            label: directoryChannelId,
            resolved: false,
        });
        expect(body.directory.users[directoryUserId]).toMatchObject({
            id: directoryUserId,
            label: "OfficerName",
            resolved: true,
        });

        await app.close();
    });

    it("returns unresolved directory labels for non-2xx and invalid Discord JSON", async () => {
        const directoryGuildId = "823456789012345678";
        const directoryChannelId = "923456789012345678";
        const directoryUserId = "133456789012345678";
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
            const endpoint = String(url);
            if (endpoint.endsWith(`/guilds/${directoryGuildId}`)) {
                return { ok: false, json: vi.fn() };
            }
            if (endpoint.endsWith(`/guilds/${directoryGuildId}/channels`)) {
                return {
                    ok: true,
                    json: vi.fn().mockRejectedValue(new Error("invalid json")),
                };
            }
            if (endpoint.endsWith(`/guilds/${directoryGuildId}/members/${directoryUserId}`)) {
                return { ok: false, json: vi.fn() };
            }
            throw new Error(`Unexpected Discord request: ${endpoint}`);
        });
        vi.stubGlobal("fetch", fetchMock);
        const { store } = makeStore([
            {
                ...defaultGuildConfigFor(directoryGuildId),
                autoReportChannelIds: [directoryChannelId],
                compareOfficerUserIds: [directoryUserId],
            },
        ]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const response = await app.inject(`/api/dashboard/guilds/${directoryGuildId}/directory`);

        expect(response.statusCode).toBe(200);
        const body = response.json<{
            directory: {
                guild: { id: string; label: string; resolved: boolean };
                channels: Record<string, { id: string; label: string; resolved: boolean }>;
                users: Record<string, { id: string; label: string; resolved: boolean }>;
            };
        }>();
        expect(body.directory.guild).toEqual({
            id: directoryGuildId,
            label: directoryGuildId,
            resolved: false,
        });
        expect(body.directory.channels[directoryChannelId]).toEqual({
            id: directoryChannelId,
            label: directoryChannelId,
            resolved: false,
        });
        expect(body.directory.users[directoryUserId]).toEqual({
            id: directoryUserId,
            label: directoryUserId,
            resolved: false,
        });

        await app.close();
    });

    it("requires directory capability before resolving Discord directory data", async () => {
        const directoryGuildId = "153456789012345678";
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ access_token: "access-token" }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    id: discordUserId,
                    username: "viewer",
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue([
                    {
                        id: directoryGuildId,
                        name: "No Dashboard Access",
                        owner: false,
                        permissions: "0",
                    },
                ]),
            });
        vi.stubGlobal("fetch", fetchMock);
        const { store } = makeStore([defaultGuildConfigFor(directoryGuildId)]);
        const app = await makeApp(
            makeEnv({
                DISCORD_CLIENT_SECRET: "discord-client-secret",
                DISCORD_OAUTH_REDIRECT_URI: "https://example.com/api/dashboard/discord/callback",
            }),
            store,
        );
        const login = await app.inject("/api/dashboard/discord/login");
        const location = String(login.headers.location);
        const state = new URL(location).searchParams.get("state");
        const callback = await app.inject({
            url: `/api/dashboard/discord/callback?code=abc&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });
        const sessionCookie = dashboardSetCookie(callback);

        const response = await app.inject({
            url: `/api/dashboard/guilds/${directoryGuildId}/directory`,
            headers: { cookie: sessionCookie },
        });

        expect(response.statusCode).toBe(404);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        await app.close();
    });

    it("rejects malformed IDs before store calls", async () => {
        const { store } = makeStore([defaultGuildConfigFor(guildId)]);
        const app = await makeApp(makeEnv({ DASHBOARD_AUTH_DISABLED: true }), store);

        const response = await app.inject({
            method: "POST",
            url: "/api/dashboard/guilds/bad/officers/also-bad",
            headers: { "x-dashboard-request": "1" },
        });

        expect(response.statusCode).toBe(400);
        expect(store.addOfficerToExistingGuild).not.toHaveBeenCalled();

        await app.close();
    });
});

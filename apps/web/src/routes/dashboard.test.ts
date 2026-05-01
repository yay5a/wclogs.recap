import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGuildConfigFor, type GuildConfig } from "@wcl/domain";
import type { WebEnv } from "../config.js";
import {
    compareDashboardAdminSecret,
    DASHBOARD_COOKIE_NAME,
    registerDashboardRoutes,
    type DashboardGuildConfigStore,
    type DashboardGuildConfigSummary,
} from "./dashboard.js";

const guildId = "123456789012345678";
const otherGuildId = "223456789012345678";
const discordUserId = "323456789012345678";
const channelId = "423456789012345678";

const makeEnv = (overrides: Partial<WebEnv> = {}): WebEnv => ({
    NODE_ENV: "test",
    PORT: 3000,
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
    DASHBOARD_AUTH_DISABLED: false,
    PREVIEW_STATE_TTL_SECONDS: 900,
    ...overrides,
});

const toSummary = (config: GuildConfig): DashboardGuildConfigSummary => ({
    guildId: config.guildId,
    compareModeDefault: config.compareModeDefault,
    compareAccessMode: config.compareAccessMode,
    comparePublicPostingEnabled: config.comparePublicPostingEnabled,
    autoRecapMode: config.autoRecapMode,
    defaultGameFamily: config.defaultGameFamily,
    compareOfficerUserCount: config.compareOfficerUserIds.length,
    autoRecapChannelCount: config.autoRecapChannelIds.length,
});

const makeStore = (initialConfigs: GuildConfig[] = []) => {
    const configs = new Map(initialConfigs.map((config) => [config.guildId, config]));
    const store = {
        listGuildConfigSummaries: vi.fn(async () =>
            [...configs.values()].map(toSummary).sort((left, right) => left.guildId.localeCompare(right.guildId)),
        ),
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
    } satisfies DashboardGuildConfigStore;
    return { store, configs };
};

const makeApp = async (env: WebEnv, store: DashboardGuildConfigStore) => {
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
    await app.register(registerDashboardRoutes, { env, guildConfigStore: store });
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

const signedCookieValueFrom = (cookiePair: string): string => {
    const value = cookiePair.split("=").slice(1).join("=");
    if (!value) throw new Error("missing cookie value");
    return decodeURIComponent(value);
};

describe("dashboard auth", () => {
    afterEach(() => {
        vi.restoreAllMocks();
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
});

describe("dashboard guild routes", () => {
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
                autoRecapMode: "auto_preview",
                autoRecapChannelIds: [` ${channelId} `, channelId],
                defaultGameFamily: "mop_classic",
            },
        });

        expect(saved.statusCode).toBe(200);
        expect(saved.json<{ config: GuildConfig }>().config).toMatchObject({
            compareModeDefault: "mixed",
            compareAccessMode: "owner_only",
            comparePublicPostingEnabled: true,
            autoRecapMode: "auto_preview",
            autoRecapChannelIds: [channelId],
            defaultGameFamily: "mop_classic",
        });
        expect(store.saveExistingGuildConfig).toHaveBeenCalledWith(guildId, {
            compareModeDefault: "mixed",
            compareAccessMode: "owner_only",
            comparePublicPostingEnabled: true,
            autoRecapMode: "auto_preview",
            autoRecapChannelIds: [channelId],
            defaultGameFamily: "mop_classic",
        });

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

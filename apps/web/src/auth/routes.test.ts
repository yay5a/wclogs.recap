import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWebEnv, type WebEnv } from "../config.js";
import { registerWclAuthRoutes, type WclUserAuthStore } from "./routes.js";

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
        PUBLIC_APP_BASE_URL: "https://public.example.test",
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

const makeStore = (): WclUserAuthStore => ({
    get: vi.fn(async () => null),
    upsert: vi.fn(async () => undefined),
});

const makeLogger = () =>
    ({
        error: vi.fn(),
        info: vi.fn(),
    });

type TestLogger = ReturnType<typeof makeLogger>;

const makeApp = async (options: {
    env?: WebEnv;
    store?: WclUserAuthStore;
    logger?: TestLogger;
} = {}) => {
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
    const header = response.headers["set-cookie"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw !== "string") throw new Error("missing set-cookie");
    return raw.split(";")[0] ?? raw;
};

describe("WCL OAuth routes", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("uses the configured public base URL for WCL OAuth login redirects", async () => {
        const app = await makeApp();

        const login = await app.inject({
            url: "/api/auth/wcl/login",
            headers: { host: "evil.example.test" },
        });

        expect(login.statusCode).toBe(302);
        const redirect = new URL(String(login.headers.location));
        expect(redirect.searchParams.get("redirect_uri")).toBe(
            "https://public.example.test/api/auth/wcl/callback",
        );
        expect(redirect.searchParams.get("response_type")).toBe("code");
        expect(redirect.searchParams.get("state")).toBeTruthy();

        await app.close();
    });

    it("uses the same configured WCL redirect URI for token exchange", async () => {
        const store = makeStore();
        const fetchMock = vi.fn().mockResolvedValue({
            status: 200,
            json: vi.fn().mockResolvedValue({
                access_token: "wcl-access-token",
                refresh_token: "wcl-refresh-token",
                expires_in: 3600,
                token_type: "Bearer",
                scope: "view-user-profile",
            }),
        });
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp({ store });

        const login = await app.inject("/api/auth/wcl/login");
        const state = new URL(String(login.headers.location)).searchParams.get("state");
        expect(state).toBeTruthy();

        const callback = await app.inject({
            url: `/api/auth/wcl/callback?code=abc&state=${state}`,
            headers: {
                cookie: firstSetCookie(login),
                host: "evil.example.test",
            },
        });

        expect(callback.statusCode).toBe(200);
        const tokenRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        expect(tokenRequest?.body).toBeInstanceOf(URLSearchParams);
        expect((tokenRequest?.body as URLSearchParams).get("redirect_uri")).toBe(
            "https://public.example.test/api/auth/wcl/callback",
        );
        expect(store.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: "warcraftlogs",
                accessToken: "wcl-access-token",
                refreshToken: "wcl-refresh-token",
                tokenType: "Bearer",
                scope: "view-user-profile",
            }),
        );

        await app.close();
    });

    it("logs safe context only when WCL token exchange fails", async () => {
        const logger = makeLogger();
        const fetchMock = vi.fn().mockResolvedValue({
            status: 400,
            json: vi.fn().mockResolvedValue({
                access_token: "leaked-access-token",
                refresh_token: "leaked-refresh-token",
                client_secret: "leaked-client-secret",
                code: "leaked-authorization-code",
            }),
        });
        vi.stubGlobal("fetch", fetchMock);
        const app = await makeApp({ logger });

        const login = await app.inject("/api/auth/wcl/login");
        const state = new URL(String(login.headers.location)).searchParams.get("state");
        expect(state).toBeTruthy();

        const callback = await app.inject({
            url: `/api/auth/wcl/callback?code=abc&state=${state}`,
            headers: { cookie: firstSetCookie(login) },
        });

        expect(callback.statusCode).toBe(500);
        expect(logger.error).toHaveBeenCalledOnce();
        const [context] = vi.mocked(logger.error).mock.calls[0] ?? [];
        const serializedContext = JSON.stringify(context);
        expect(serializedContext).toContain("warcraftlogs");
        expect(serializedContext).toContain("token_exchange_failed");
        expect(serializedContext).toContain("400");
        for (const secret of [
            "leaked-access-token",
            "leaked-refresh-token",
            "leaked-client-secret",
            "leaked-authorization-code",
            "abc",
        ]) {
            expect(serializedContext).not.toContain(secret);
        }
        expect(context).not.toHaveProperty("tokenPayload");

        await app.close();
    });
});

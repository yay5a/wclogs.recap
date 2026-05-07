import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { describe, expect, it, vi } from "vitest";
import { WclReportFetchError } from "@wcl/wcl-client";
import { parseWebEnv, type WebEnv } from "../config.js";
import { createDiscordSession, setDashboardCookie } from "./dashboard/auth.js";
import { registerReportRoutes } from "./report.js";

const env: WebEnv = parseWebEnv({
    NODE_ENV: "test",
    PORT: "3000",
    MONGODB_URI: "mongodb://localhost:27017/wclogs",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_APPLICATION_ID: "1234567890",
    DISCORD_BOT_TOKEN: "discord-token",
    WCL_CLIENT_ID: "wcl-client-id",
    WCL_CLIENT_SECRET: "wcl-client-secret",
    WCL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    WCL_API_BASE_URL: "https://www.warcraftlogs.com/api/v2/client",
    WCL_REDIRECT_URI: "https://example.com/api/auth/wcl/callback",
    COOKIE_SECRET: "cookie-secret",
    DASHBOARD_AUTH_DISABLED: "false",
});

const makeLogger = () =>
    ({
        info: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }) as never;

const makeApp = async (wclClient: { fetchAndNormalizeReport: ReturnType<typeof vi.fn> }) => {
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
    app.get("/test/session", async (_request, reply) => {
        const session = createDiscordSession({
            kind: "discord",
            discordUserId: "discord-user-1",
            username: "tester",
            displayName: "Tester",
            oauthGuildsById: {},
        });
        setDashboardCookie(
            reply,
            env,
            `dashboard:v2:${session.sessionId}:${session.sessionExpiresAtMs}`,
        );
        return { ok: true };
    });
    await app.register(registerReportRoutes, {
        env,
        wclClient: wclClient as never,
        logger: makeLogger(),
    });
    return app;
};

describe("report routes", () => {
    it("uses the authenticated dashboard Discord user as WCL auth context", async () => {
        const fetchAndNormalizeReport = vi.fn().mockResolvedValue({
            reportCode: "ABC123",
        });
        const app = await makeApp({ fetchAndNormalizeReport });
        const sessionResponse = await app.inject("/test/session");
        const cookie = sessionResponse.headers["set-cookie"];

        const response = await app.inject({
            method: "POST",
            url: "/api/report",
            headers: { cookie: String(cookie) },
            payload: { reportCode: "ABC123" },
        });

        expect(response.statusCode).toBe(200);
        expect(fetchAndNormalizeReport).toHaveBeenCalledWith(
            "https://www.warcraftlogs.com/reports/ABC123",
            { discordUserId: "discord-user-1" },
        );
        await app.close();
    });

    it("returns safe JSON guidance for missing linked WCL auth", async () => {
        const fetchAndNormalizeReport = vi.fn().mockRejectedValue(
            new WclReportFetchError({
                category: "missing_linked_auth",
                reportCode: "ABC123",
                authMode: "userLinked",
            }),
        );
        const app = await makeApp({ fetchAndNormalizeReport });

        const response = await app.inject({
            method: "POST",
            url: "/api/report",
            payload: { reportCode: "ABC123" },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
            ok: false,
            message:
                "This report may require Warcraft Logs authorization. Link your Warcraft Logs account from the dashboard, then try again.",
        });
        expect(response.body).not.toContain("access_token");
        expect(response.body).not.toContain("refresh_token");
        await app.close();
    });

    it("returns safe JSON guidance when linked WCL auth cannot be read", async () => {
        const fetchAndNormalizeReport = vi.fn().mockRejectedValue(
            new WclReportFetchError({
                category: "linked_auth_unreadable",
                reportCode: "ABC123",
                authMode: "userLinked",
            }),
        );
        const app = await makeApp({ fetchAndNormalizeReport });

        const response = await app.inject({
            method: "POST",
            url: "/api/report",
            payload: { reportCode: "ABC123" },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
            ok: false,
            message:
                "Your Warcraft Logs authorization needs to be refreshed. Re-link Warcraft Logs from the dashboard, then try again.",
        });
        expect(response.body).not.toContain("ciphertext");
        expect(response.body).not.toContain("access_token");
        await app.close();
    });
});

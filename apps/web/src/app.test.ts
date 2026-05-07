import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultGuildConfigFor, type GuildConfig } from "@wcl/domain";
import { createWebApp, type CreateWebAppOptions } from "./app.js";
import { parseWebEnv, type WebEnv } from "./config.js";

const guildId = "123456789012345678";

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
    DASHBOARD_AUTH_DISABLED: "true",
});

const makeLogger = () =>
    ({
        info: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    }) as never;

const makeDashboardStore = () => {
    const config = defaultGuildConfigFor(guildId);
    return {
        listGuildConfigSummaries: vi.fn(async () => []),
        listGuildConfigSummariesForGuilds: vi.fn(async () => []),
        getGuildConfig: vi.fn(async () => config),
        saveGuildConfig: vi.fn(async () => config),
        getExistingGuildConfig: vi.fn(async () => config),
        createDefaultGuildConfig: vi.fn(async () => config),
        saveExistingGuildConfig: vi.fn(async (_id: string, update: Partial<GuildConfig>) => ({
            ...config,
            ...update,
        })),
        addOfficerToExistingGuild: vi.fn(async () => config),
        removeOfficerFromExistingGuild: vi.fn(async () => config),
    };
};

const makeOptions = (assetRoot: string): CreateWebAppOptions => {
    const dashboardGuildConfigStore = makeDashboardStore();
    return {
        env,
        logger: makeLogger(),
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: dashboardGuildConfigStore,
        dashboardGuildConfigStore,
        autoReportPromptStateService: {
            savePromptState: vi.fn(),
            getValidPromptState: vi.fn(),
            consumeValidPromptState: vi.fn(),
        } as never,
        autoReportDuplicateTrackingService: {
            claimPassiveDetection: vi.fn(),
            getByConfirmationNonce: vi.fn(),
            updateTracking: vi.fn(),
        } as never,
        comparisonHistoryStore: {
            saveComparisonSnapshot: vi.fn(),
            findCharacterHistory: vi.fn(),
        },
        characterClaimStore: {
            requestCharacterClaim: vi.fn(),
            approveCharacterClaim: vi.fn(),
            rejectCharacterClaim: vi.fn(),
            findApprovedClaimForUserCharacter: vi.fn(),
            findApprovedClaimsForParticipant: vi.fn(),
            updateClaimPrivacy: vi.fn(),
            listClaimsForUser: vi.fn(),
        },
        dashboardCharacterClaimStore: {
            requestCharacterClaim: vi.fn(),
            approveCharacterClaim: vi.fn(),
            rejectCharacterClaim: vi.fn(),
            findApprovedClaimForUserCharacter: vi.fn(),
            findApprovedClaimsForParticipant: vi.fn(),
            updateClaimPrivacy: vi.fn(),
            listClaimsForUser: vi.fn(),
            listClaimsByStatus: vi.fn(async () => []),
            approveClaimById: vi.fn(),
            rejectClaimById: vi.fn(),
            revokeClaimById: vi.fn(),
        },
        wclUserAuthStore: {
            getByDiscordUserId: vi.fn(),
            getStatusByDiscordUserId: vi.fn(),
            upsertForDiscordUser: vi.fn(),
            deleteForDiscordUser: vi.fn(),
        },
        dashboardStatic: {
            enabled: true,
            assetRoot,
        },
    };
};

describe("createWebApp dashboard static serving", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("serves dashboard shell and assets without swallowing existing routes", async () => {
        const assetRoot = await mkdtemp(join(tmpdir(), "wcl-dashboard-"));
        await mkdir(join(assetRoot, "assets"));
        await writeFile(join(assetRoot, "index.html"), "<div id=\"root\"></div>");
        await writeFile(join(assetRoot, "assets", "main-abc123.js"), "console.log('ok');");

        const app = await createWebApp(makeOptions(assetRoot));

        const dashboard = await app.inject("/dashboard");
        expect(dashboard.statusCode).toBe(200);
        expect(dashboard.headers["cache-control"]).toContain("no-cache");
        expect(dashboard.body).toContain("root");

        const login = await app.inject("/dashboard/login");
        expect(login.statusCode).toBe(200);

        const asset = await app.inject("/dashboard/assets/main-abc123.js");
        expect(asset.statusCode).toBe(200);
        expect(asset.headers["cache-control"]).toContain("immutable");

        expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
        const report = await app.inject({
            method: "POST",
            url: "/api/report",
            payload: { reportCode: "ABC123" },
        });
        expect(report.statusCode).toBe(200);
        expect((await app.inject("/api/auth/wcl/status")).statusCode).toBe(403);
        expect((await app.inject("/api/dashboard/session")).statusCode).toBe(200);
        expect((await app.inject({ method: "POST", url: "/discord/interactions" })).statusCode).toBe(
            401,
        );

        await app.close();
    });
});

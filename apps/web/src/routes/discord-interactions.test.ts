import Fastify from "fastify";
import { verifyKey } from "discord-interactions";
import { handleInteraction } from "@wcl/discord";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDiscordInteractionRoutes } from "./discord-interactions.js";
import type { WebEnv } from "../config.js";

vi.mock("discord-interactions", () => ({
    verifyKey: vi.fn(),
}));

vi.mock("@wcl/discord", () => ({
    handleInteraction: vi.fn(),
}));

const env: WebEnv = {
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
    DASHBOARD_AUTH_DISABLED: false,
    PREVIEW_STATE_TTL_SECONDS: 900,
};

const makeLogger = () =>
    ({
        info: vi.fn(),
        error: vi.fn(),
    }) as never;

describe("registerDiscordInteractionRoutes", () => {
    beforeEach(() => {
        vi.mocked(verifyKey).mockResolvedValue(true);
        vi.mocked(handleInteraction).mockResolvedValue({
            type: 4,
            data: { content: "ok" },
        });
    });

    it("passes auto report stores into handleInteraction", async () => {
        const app = Fastify({ logger: false });
        const wclClient = { fetchAndNormalizeReport: vi.fn() } as never;
        const guildConfigStore = { getGuildConfig: vi.fn(), saveGuildConfig: vi.fn() } as never;
        const autoReportPromptStateService = {
            savePromptState: vi.fn(),
            getValidPromptState: vi.fn(),
            consumeValidPromptState: vi.fn(),
        } as never;
        const autoReportDuplicateTrackingService = {
            claimPassiveDetection: vi.fn(),
            getByConfirmationNonce: vi.fn(),
            updateTracking: vi.fn(),
        } as never;
        const comparisonHistoryStore = { saveComparisonSnapshot: vi.fn() } as never;
        const characterClaimStore = { requestCharacterClaim: vi.fn() } as never;

        await app.register(registerDiscordInteractionRoutes, {
            env,
            wclClient,
            guildConfigStore,
            autoReportPromptStateService,
            autoReportDuplicateTrackingService,
            comparisonHistoryStore,
            characterClaimStore,
            logger: makeLogger(),
        });

        const body = {
            type: 3,
            data: { custom_id: "recap:v2:post:ABC123:guild-1:channel-1" },
        };
        const response = await app.inject({
            method: "POST",
            url: "/discord/interactions",
            headers: {
                "content-type": "application/json",
                "x-signature-ed25519": "signature",
                "x-signature-timestamp": "timestamp",
            },
            payload: body,
        });

        expect(response.statusCode).toBe(200);
        expect(verifyKey).toHaveBeenCalledWith("", "signature", "timestamp", env.DISCORD_PUBLIC_KEY);
        expect(handleInteraction).toHaveBeenCalledOnce();
        const [, handleOptions] = vi.mocked(handleInteraction).mock.calls[0] ?? [];
        expect(handleOptions).toEqual(
            expect.objectContaining({
                wclClient,
                guildConfigStore,
                autoReportPromptStateService,
                autoReportDuplicateTrackingService,
                comparisonHistoryStore,
                characterClaimStore,
            }),
        );
        expect(handleOptions?.autoReportPromptStateService).toBe(autoReportPromptStateService);
        expect(handleOptions?.autoReportDuplicateTrackingService).toBe(
            autoReportDuplicateTrackingService,
        );

        await app.close();
    });
});

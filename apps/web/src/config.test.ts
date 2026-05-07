import { describe, expect, it } from "vitest";
import {
    DASHBOARD_PATH,
    DISCORD_INTERACTIONS_PATH,
    DISCORD_OAUTH_CALLBACK_PATH,
    parseWebEnv,
    WCL_OAUTH_CALLBACK_PATH,
} from "./config.js";

const baseEnv = {
    PORT: "3000",
    MONGODB_URI: "mongodb://localhost:27017/wclogs",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_APPLICATION_ID: "1234567890",
    DISCORD_BOT_TOKEN: "discord-token",
    WCL_CLIENT_ID: "wcl-client-id",
    WCL_CLIENT_SECRET: "wcl-client-secret",
    WCL_REDIRECT_URI: "https://example.com/api/auth/wcl/callback",
    COOKIE_SECRET: "cookie-secret",
};

describe("parseWebEnv dashboard config", () => {
    it("requires DASHBOARD_ADMIN_SECRET in production", () => {
        expect(() =>
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "production",
            }),
        ).toThrow();
    });

    it("rejects DASHBOARD_AUTH_DISABLED=true in production", () => {
        expect(() =>
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "production",
                DASHBOARD_ADMIN_SECRET: "admin-secret",
                DASHBOARD_AUTH_DISABLED: "true",
            }),
        ).toThrow();
    });

    it("does not require DASHBOARD_ADMIN_SECRET in test", () => {
        const env = parseWebEnv({
            ...baseEnv,
            NODE_ENV: "test",
        });

        expect(env.DASHBOARD_ADMIN_SECRET).toBeUndefined();
        expect(env.DASHBOARD_AUTH_DISABLED).toBe(false);
    });

    it("requires DASHBOARD_ADMIN_SECRET in development unless auth is disabled", () => {
        expect(() =>
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "development",
            }),
        ).toThrow();

        expect(
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "development",
                DASHBOARD_AUTH_DISABLED: "true",
            }).DASHBOARD_AUTH_DISABLED,
        ).toBe(true);
    });

    it("accepts only literal dashboard auth-disabled values", () => {
        expect(
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "test",
                DASHBOARD_AUTH_DISABLED: "false",
            }).DASHBOARD_AUTH_DISABLED,
        ).toBe(false);

        for (const value of ["1", "yes", "on", ""]) {
            expect(() =>
                parseWebEnv({
                    ...baseEnv,
                    NODE_ENV: "test",
                    DASHBOARD_AUTH_DISABLED: value,
                }),
            ).toThrow();
        }
    });
});

describe("parseWebEnv public URL config", () => {
    it("parses and normalizes PUBLIC_APP_BASE_URL-derived URLs", () => {
        const envWithoutLegacyWcl: Partial<typeof baseEnv> = { ...baseEnv };
        delete envWithoutLegacyWcl.WCL_REDIRECT_URI;

        const env = parseWebEnv({
            ...envWithoutLegacyWcl,
            NODE_ENV: "test",
            PUBLIC_APP_BASE_URL: "https://public.example.test/",
            DISCORD_CLIENT_SECRET: "discord-client-secret",
        });

        expect(env.PUBLIC_APP_BASE_URL).toBe("https://public.example.test");
        expect(env.publicAppBaseUrl).toBe("https://public.example.test");
        expect(env.discordOAuthRedirectUri).toBe(
            `https://public.example.test${DISCORD_OAUTH_CALLBACK_PATH}`,
        );
        expect(env.wclRedirectUri).toBe(
            `https://public.example.test${WCL_OAUTH_CALLBACK_PATH}`,
        );
        expect(env.discordInteractionsUrl).toBe(
            `https://public.example.test${DISCORD_INTERACTIONS_PATH}`,
        );
        expect(env.dashboardPublicUrl).toBe(`https://public.example.test${DASHBOARD_PATH}`);
    });

    it("rejects malformed and non-http public base URLs", () => {
        for (const value of [
            "not-a-url",
            "ftp://public.example.test",
            "https://public.example.test/nested",
            "https://public.example.test?from=test",
            "https://public.example.test#dashboard",
        ]) {
            expect(() =>
                parseWebEnv({
                    ...baseEnv,
                    NODE_ENV: "test",
                    PUBLIC_APP_BASE_URL: value,
                }),
            ).toThrow();
        }
    });

    it("keeps explicit full URL overrides ahead of derived public URLs", () => {
        const env = parseWebEnv({
            ...baseEnv,
            NODE_ENV: "test",
            PUBLIC_APP_BASE_URL: "https://public.example.test",
            DISCORD_CLIENT_SECRET: "discord-client-secret",
            DISCORD_OAUTH_REDIRECT_URI: "https://oauth.example.test/discord/callback",
            WCL_REDIRECT_URI: "https://oauth.example.test/wcl/callback",
            DISCORD_INTERACTIONS_URL: "https://discord.example.test/interactions",
        });

        expect(env.publicAppBaseUrl).toBe("https://public.example.test");
        expect(env.discordOAuthRedirectUri).toBe(
            "https://oauth.example.test/discord/callback",
        );
        expect(env.wclRedirectUri).toBe("https://oauth.example.test/wcl/callback");
        expect(env.discordInteractionsUrl).toBe("https://discord.example.test/interactions");
        expect(env.dashboardPublicUrl).toBe(`https://public.example.test${DASHBOARD_PATH}`);
    });

    it("requires a WCL redirect URI source", () => {
        const envWithoutLegacyWcl: Partial<typeof baseEnv> = { ...baseEnv };
        delete envWithoutLegacyWcl.WCL_REDIRECT_URI;

        expect(() =>
            parseWebEnv({
                ...envWithoutLegacyWcl,
                NODE_ENV: "test",
            }),
        ).toThrow(/WCL OAuth requires WCL_REDIRECT_URI or PUBLIC_APP_BASE_URL/);
    });

    it("requires a Discord OAuth redirect URI source when Discord OAuth is enabled", () => {
        expect(() =>
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "test",
                DISCORD_CLIENT_SECRET: "discord-client-secret",
            }),
        ).toThrow(
            /DISCORD_CLIENT_SECRET requires DISCORD_OAUTH_REDIRECT_URI or PUBLIC_APP_BASE_URL/,
        );
    });

    it("rejects Discord OAuth redirect URI without a Discord client secret", () => {
        expect(() =>
            parseWebEnv({
                ...baseEnv,
                NODE_ENV: "test",
                DISCORD_OAUTH_REDIRECT_URI: "https://oauth.example.test/discord/callback",
            }),
        ).toThrow(/DISCORD_OAUTH_REDIRECT_URI requires DISCORD_CLIENT_SECRET/);
    });
});

import { describe, expect, it } from "vitest";
import { parseWebEnv } from "./config.js";

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

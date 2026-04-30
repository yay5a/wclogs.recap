import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./config.js";

const validEnv = {
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://localhost:27017/wclogs",
    DISCORD_BOT_TOKEN: "discord-token",
    WCL_CLIENT_ID: "wcl-client-id",
    WCL_CLIENT_SECRET: "wcl-client-secret",
    WCL_API_BASE_URL: "https://www.warcraftlogs.com/api/v2/client",
};

describe("parseWorkerEnv", () => {
    it("fails clearly when DISCORD_BOT_TOKEN is missing", () => {
        const env: Partial<typeof validEnv> = { ...validEnv };
        delete env.DISCORD_BOT_TOKEN;

        expect(() => parseWorkerEnv(env)).toThrow(/DISCORD_BOT_TOKEN/);
    });

    it("fails clearly when required Warcraft Logs settings are missing", () => {
        const env: Partial<typeof validEnv> = { ...validEnv };
        delete env.WCL_CLIENT_ID;

        expect(() => parseWorkerEnv(env)).toThrow(/WCL_CLIENT_ID/);
    });

    it("fails clearly when WCL_CLIENT_SECRET is missing", () => {
        const env: Partial<typeof validEnv> = { ...validEnv };
        delete env.WCL_CLIENT_SECRET;

        expect(() => parseWorkerEnv(env)).toThrow(/WCL_CLIENT_SECRET/);
    });

    it("parses required Discord and Warcraft Logs settings", () => {
        expect(parseWorkerEnv(validEnv)).toMatchObject({
            DISCORD_BOT_TOKEN: "discord-token",
            WCL_CLIENT_ID: "wcl-client-id",
            WCL_CLIENT_SECRET: "wcl-client-secret",
        });
    });
});

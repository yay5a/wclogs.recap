import { PassThrough } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { baseLoggerOptions, serializeError } from "./index.js";

describe("serializeError", () => {
    it("serializes normal Error objects", () => {
        expect(serializeError(new Error("boom"))).toMatchObject({
            name: "Error",
            message: "boom",
        });
    });

    it("serializes Error causes recursively", () => {
        const error = new Error("outer", { cause: new TypeError("inner") });

        expect(serializeError(error)).toMatchObject({
            name: "Error",
            message: "outer",
            cause: {
                name: "TypeError",
                message: "inner",
            },
        });
    });

    it("serializes non-Error thrown values", () => {
        expect(serializeError("bad value")).toEqual({ message: "bad value" });
    });
});

describe("logger redaction", () => {
    const captureLogOutput = async (payload: Record<string, unknown>): Promise<string> => {
        const stream = new PassThrough();
        const chunks: string[] = [];
        stream.on("data", (chunk: Buffer) => {
            chunks.push(chunk.toString("utf8"));
        });
        const testLogger = pino(baseLoggerOptions, stream);

        testLogger.info(payload);

        await new Promise((resolve) => setImmediate(resolve));

        return chunks.join("");
    };

    it("redacts dashboard admin secrets and cookies", async () => {
        const output = await captureLogOutput({
            env: { DASHBOARD_ADMIN_SECRET: "admin-env-secret" },
            body: { adminSecret: "submitted-secret" },
            nested: {
                login: { adminSecret: "two-level-admin-secret" },
                cookies: { wcl_dashboard: "two-level-dashboard-cookie" },
            },
            req: {
                headers: { cookie: "req-cookie" },
            },
            request: {
                body: { adminSecret: "nested-secret" },
                headers: { cookie: "wcl_dashboard=request-cookie" },
                cookies: { wcl_dashboard: "request-cookie-object" },
            },
            cookies: { wcl_dashboard: "root-cookie-object" },
            headers: {
                cookie: "root-cookie",
                "set-cookie": "wcl_dashboard=response-cookie",
            },
            reply: {
                headers: {
                    "set-cookie": "wcl_dashboard=reply-cookie",
                },
            },
        });
        expect(output).not.toContain("admin-env-secret");
        expect(output).not.toContain("submitted-secret");
        expect(output).not.toContain("two-level-admin-secret");
        expect(output).not.toContain("two-level-dashboard-cookie");
        expect(output).not.toContain("nested-secret");
        expect(output).not.toContain("req-cookie");
        expect(output).not.toContain("request-cookie");
        expect(output).not.toContain("request-cookie-object");
        expect(output).not.toContain("root-cookie-object");
        expect(output).not.toContain("root-cookie");
        expect(output).not.toContain("response-cookie");
        expect(output).not.toContain("reply-cookie");
        expect(output).toContain("[REDACTED]");
    });

    it("redacts OAuth tokens, secrets, auth headers, cookies, and authorization codes", async () => {
        const output = await captureLogOutput({
            authorization: "Bearer root-access",
            code: "root-authorization-code",
            token: "root-token",
            access_token: "root-access-token",
            refresh_token: "root-refresh-token",
            id_token: "root-id-token",
            client_secret: "root-client-secret",
            reportCode: "ABC123",
            env: {
                DISCORD_CLIENT_SECRET: "discord-env-secret",
                WCL_CLIENT_SECRET: "wcl-env-secret",
            },
            headers: {
                authorization: "Bearer header-access",
                cookie: "dashboard-cookie",
                "set-cookie": "dashboard-set-cookie",
            },
            request: {
                query: { code: "request-query-code" },
                headers: {
                    authorization: "Bearer request-header-access",
                    cookie: "request-cookie",
                },
            },
            nested: {
                tokenResponse: {
                    access_token: "nested-access-token",
                    refresh_token: "nested-refresh-token",
                    id_token: "nested-id-token",
                    client_secret: "nested-client-secret",
                },
            },
        });

        for (const secret of [
            "Bearer root-access",
            "root-authorization-code",
            "root-token",
            "root-access-token",
            "root-refresh-token",
            "root-id-token",
            "root-client-secret",
            "discord-env-secret",
            "wcl-env-secret",
            "Bearer header-access",
            "dashboard-cookie",
            "dashboard-set-cookie",
            "request-query-code",
            "Bearer request-header-access",
            "request-cookie",
            "nested-access-token",
            "nested-refresh-token",
            "nested-id-token",
            "nested-client-secret",
        ]) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain("ABC123");
        expect(output).toContain("[REDACTED]");
    });
});

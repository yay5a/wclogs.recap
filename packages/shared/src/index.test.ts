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
    it("redacts dashboard admin secrets and cookies", async () => {
        const stream = new PassThrough();
        const chunks: string[] = [];
        stream.on("data", (chunk: Buffer) => {
            chunks.push(chunk.toString("utf8"));
        });
        const testLogger = pino(baseLoggerOptions, stream);

        testLogger.info({
            env: { DASHBOARD_ADMIN_SECRET: "admin-env-secret" },
            body: { adminSecret: "submitted-secret" },
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

        await new Promise((resolve) => setImmediate(resolve));

        const output = chunks.join("");
        expect(output).not.toContain("admin-env-secret");
        expect(output).not.toContain("submitted-secret");
        expect(output).not.toContain("nested-secret");
        expect(output).not.toContain("request-cookie");
        expect(output).not.toContain("request-cookie-object");
        expect(output).not.toContain("root-cookie-object");
        expect(output).not.toContain("root-cookie");
        expect(output).not.toContain("response-cookie");
        expect(output).not.toContain("reply-cookie");
        expect(output).toContain("[REDACTED]");
    });
});

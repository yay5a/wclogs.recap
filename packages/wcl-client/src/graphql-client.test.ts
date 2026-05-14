import { describe, expect, it, vi } from "vitest";
import { GraphQLClient } from "graphql-request";
import { userLinkedAuthMode } from "./auth-mode.js";
import { WclGraphqlClient } from "./graphql-client.js";

const jsonResponse = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });

describe("WclGraphqlClient auth modes", () => {
    it("uses the public client endpoint with client credentials", async () => {
        const fetchImpl = vi.fn(
            async (...args: Parameters<typeof fetch>): Promise<Response> => {
                const [input] = args;
                const url = String(input);
                if (url.endsWith("/oauth/token")) {
                    return jsonResponse({ access_token: "public-token" });
                }
                return jsonResponse({ data: { ok: true } });
            },
        );
        const client = new WclGraphqlClient({
            clientId: "client-id",
            clientSecret: "client-secret",
            apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
            fetchImpl: fetchImpl as typeof fetch,
        });

        await client.authorize();
        await client.request("query Test { ok }", {});

        expect(fetchImpl).toHaveBeenCalledWith(
            "https://www.warcraftlogs.com/oauth/token",
            expect.objectContaining({ method: "POST" }),
        );
        expect(fetchImpl.mock.calls.map(([input]) => String(input))).toContain(
            "https://www.warcraftlogs.com/api/v2/client",
        );
    });

    it("wraps unwrapped GraphQL payloads under a data envelope", async () => {
        const requestSpy = vi.spyOn(GraphQLClient.prototype, "request").mockResolvedValue(
            { ok: true } as never,
        );
        try {
            const client = new WclGraphqlClient({
                clientId: "client-id",
                clientSecret: "client-secret",
                apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
                authMode: userLinkedAuthMode("discord-user-1", "linked-token"),
            });

            const payload = await client.request<{ data: { ok: boolean } }>(
                "query Test { ok }",
                {},
            );
            expect(payload).toEqual({ data: { ok: true } });
        } finally {
            requestSpy.mockRestore();
        }
    });

    it("prefers configured client credentials over WCL_OAUTH_TOKEN env fallback", async () => {
        const originalToken = process.env.WCL_OAUTH_TOKEN;
        process.env.WCL_OAUTH_TOKEN = "explicit-env-token";
        try {
            const fetchImpl = vi.fn(
                async (...args: Parameters<typeof fetch>): Promise<Response> => {
                    const [input] = args;
                    const url = String(input);
                    if (url.endsWith("/oauth/token")) {
                        return jsonResponse({ access_token: "oauth-token" });
                    }
                    return jsonResponse({ data: { ok: true } });
                },
            );

            const client = new WclGraphqlClient({
                clientId: "client-id",
                clientSecret: "client-secret",
                apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
                fetchImpl: fetchImpl as typeof fetch,
            });

            await client.request("query Test { ok }", {});

            expect(fetchImpl).toHaveBeenCalledWith(
                "https://www.warcraftlogs.com/oauth/token",
                expect.objectContaining({ method: "POST" }),
            );

            const [, init] = fetchImpl.mock.calls.find(([input]) =>
                String(input).includes("/api/v2/client"),
            ) ?? [];
            expect(new Headers(init?.headers).get("authorization")).toBe(
                "Bearer oauth-token",
            );
        } finally {
            if (typeof originalToken === "string") {
                process.env.WCL_OAUTH_TOKEN = originalToken;
            } else {
                delete process.env.WCL_OAUTH_TOKEN;
            }
        }
    });

    it("uses the user endpoint with the linked user token", async () => {
        const fetchImpl = vi.fn(
            async (...args: Parameters<typeof fetch>): Promise<Response> => {
                void args;
                return jsonResponse({ data: { ok: true } });
            },
        );
        const client = new WclGraphqlClient({
            clientId: "client-id",
            clientSecret: "client-secret",
            apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
            authMode: userLinkedAuthMode("discord-user-1", "linked-token"),
            fetchImpl: fetchImpl as typeof fetch,
        });

        await client.authorize();
        await client.request("query Test { ok }", {});

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0] ?? [];
        expect(String(url)).toBe("https://www.warcraftlogs.com/api/v2/user");
        expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer linked-token",
        );
    });
});

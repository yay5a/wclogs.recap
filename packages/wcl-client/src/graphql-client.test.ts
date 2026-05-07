import { describe, expect, it, vi } from "vitest";
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

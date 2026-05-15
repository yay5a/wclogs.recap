import { describe, expect, it, vi } from "vitest";
import {
    exchangeWclAuthorizationCode,
    getWclTokenExpiresAt,
    parseWclAuthorizationCodeTokenPayload,
    resolveWclPublicClientBearerToken,
} from "./oauth.js";

describe("WCL authorization-code OAuth", () => {
    it("uses explicit client tokens only for client credentials auth", async () => {
        const fetchMock = vi.fn();
        await expect(
            resolveWclPublicClientBearerToken(
                { kind: "clientToken", clientToken: "client-token" },
                fetchMock as typeof fetch,
            ),
        ).resolves.toBe("client-token");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("exchanges a code with the configured redirect URI", async () => {
        const fetchMock = vi.fn(
            async (...args: Parameters<typeof fetch>): Promise<Response> => {
                void args;
                return new Response(
                    JSON.stringify({
                        access_token: "access-token",
                        refresh_token: "refresh-token",
                        expires_in: 3600,
                        token_type: "Bearer",
                        scope: "view-user-profile",
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            },
        );

        const result = await exchangeWclAuthorizationCode({
            clientId: "client-id",
            clientSecret: "client-secret",
            code: "authorization-code",
            redirectUri: "https://public.example.test/api/auth/wcl/callback",
            fetchImpl: fetchMock as typeof fetch,
        });

        expect(result).toEqual({
            status: 200,
            payload: {
                userAccessToken: "access-token",
                userRefreshToken: "refresh-token",
                expiresIn: 3600,
                tokenType: "Bearer",
                scope: "view-user-profile",
            },
        });
        const [, init] = fetchMock.mock.calls[0] ?? [];
        expect(init?.body).toBeInstanceOf(URLSearchParams);
        const body = init?.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("authorization-code");
        expect(body.get("redirect_uri")).toBe(
            "https://public.example.test/api/auth/wcl/callback",
        );
    });

    it("parses token responses with missing optional refresh tokens", () => {
        expect(
            parseWclAuthorizationCodeTokenPayload({
                access_token: "access-token",
                expires_in: 600,
                token_type: "Bearer",
            }),
        ).toEqual({
            userAccessToken: "access-token",
            expiresIn: 600,
            tokenType: "Bearer",
        });
    });

    it("derives expiry deterministically when expires_in is documented in the response", () => {
        const now = new Date("2026-04-09T00:00:00.000Z");

        expect(
            getWclTokenExpiresAt({ userAccessToken: "access-token", expiresIn: 90 }, now),
        )?.toEqual(new Date("2026-04-09T00:01:30.000Z"));
        expect(getWclTokenExpiresAt({ userAccessToken: "access-token" }, now)).toBeUndefined();
    });

    it("does not invent refresh behavior from malformed payloads", () => {
        expect(
            parseWclAuthorizationCodeTokenPayload({
                access_token: "access-token",
                refresh_token: "",
                expires_in: -1,
            }),
        ).toEqual({ userAccessToken: "access-token" });
    });
});

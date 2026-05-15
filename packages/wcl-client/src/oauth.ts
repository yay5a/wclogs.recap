import { Buffer } from "node:buffer";
import type { WclPublicClientAuth } from "./auth-mode.js";

type ResolveWclClientCredentialsTokenOptions = {
    clientId?: string;
    clientSecret?: string;
    fetchImpl?: typeof fetch;
};

export async function resolveWclClientCredentialsToken(
    options: ResolveWclClientCredentialsTokenOptions,
): Promise<string> {
    const clientId = options.clientId;
    const clientSecret = options.clientSecret;

    if (!clientId || !clientSecret) {
        throw new Error(
            "Missing WCL client credentials. Provide WCL_CLIENT_ID and WCL_CLIENT_SECRET.",
        );
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const response = await fetchImpl(
        "https://www.warcraftlogs.com/oauth/token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        },
    );

    if (!response.ok) {
        throw new Error(`WCL OAuth failed: ${response.status}`);
    }

    const payload = (await response.json()) as { access_token?: unknown };
    const token =
        typeof payload.access_token === "string"
            ? payload.access_token
            : undefined;

    if (!token) {
        throw new Error("WCL OAuth response missing valid access token");
    }

    return token;
}

export async function resolveWclPublicClientBearerToken(
    publicClientAuth: WclPublicClientAuth,
    fetchImpl?: typeof fetch,
): Promise<string> {
    if (publicClientAuth.kind === "clientToken") {
        return publicClientAuth.clientToken;
    }

    return resolveWclClientCredentialsToken({
        clientId: publicClientAuth.clientId,
        clientSecret: publicClientAuth.clientSecret,
        ...(fetchImpl ? { fetchImpl } : {}),
    });
}

export interface WclAuthorizationCodeTokenPayload {
    userAccessToken?: string;
    userRefreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
    scope?: string;
}

export type ExchangeWclAuthorizationCodeOptions = {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    fetchImpl?: typeof fetch;
};

const readString = (
    payload: Record<string, unknown>,
    key: string,
): string | undefined => {
    const value = payload[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readExpiresIn = (payload: Record<string, unknown>): number | undefined => {
    const value = payload.expires_in;
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : undefined;
};

export const parseWclAuthorizationCodeTokenPayload = (
    value: unknown,
): WclAuthorizationCodeTokenPayload => {
    if (typeof value !== "object" || value === null) return {};
    const payload = value as Record<string, unknown>;
    const userAccessToken = readString(payload, "access_token");
    const userRefreshToken = readString(payload, "refresh_token");
    const expiresIn = readExpiresIn(payload);
    const tokenType = readString(payload, "token_type");
    const scope = readString(payload, "scope");

    return {
        ...(userAccessToken ? { userAccessToken } : {}),
        ...(userRefreshToken ? { userRefreshToken } : {}),
        ...(expiresIn ? { expiresIn } : {}),
        ...(tokenType ? { tokenType } : {}),
        ...(scope ? { scope } : {}),
    };
};

export const getWclTokenExpiresAt = (
    payload: WclAuthorizationCodeTokenPayload,
    now = new Date(),
): Date | undefined =>
    typeof payload.expiresIn === "number"
        ? new Date(now.getTime() + payload.expiresIn * 1000)
        : undefined;

export const exchangeWclAuthorizationCode = async (
    options: ExchangeWclAuthorizationCodeOptions,
): Promise<{ status: number; payload: WclAuthorizationCodeTokenPayload }> => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const basicAuth = Buffer.from(
        `${options.clientId}:${options.clientSecret}`,
    ).toString("base64");

    const tokenResponse = await fetchImpl("https://www.warcraftlogs.com/oauth/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: options.code,
            redirect_uri: options.redirectUri,
        }),
    });

    const rawPayload: unknown = await tokenResponse.json().catch(() => null);
    return {
        status: tokenResponse.status,
        payload: parseWclAuthorizationCodeTokenPayload(rawPayload),
    };
};

import { Buffer } from "node:buffer";
import type { WebEnv } from "../config.js";

export interface WclTokenPayload {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    [key: string]: unknown;
}

export const exchangeAuthorizationCode = async (args: {
    env: WebEnv;
    code: string;
}): Promise<{ status: number; payload: WclTokenPayload }> => {
    const basicAuth = Buffer.from(
        `${args.env.WCL_CLIENT_ID}:${args.env.WCL_CLIENT_SECRET}`,
    ).toString("base64");

    const tokenResponse = await fetch("https://www.warcraftlogs.com/oauth/token", {
        method: "POST",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: args.code,
            redirect_uri: args.env.WCL_REDIRECT_URI,
        }),
    });

    const payload = (await tokenResponse.json()) as WclTokenPayload;

    return { status: tokenResponse.status, payload };
};

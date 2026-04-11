import { Buffer } from "node:buffer";

type ResolveWclAccessTokenOptions = {
    explicitToken?: string;
    clientId?: string;
    clientSecret?: string;
    fetchImpl?: typeof fetch;
};

export async function resolveWclAccessToken(
    options: ResolveWclAccessTokenOptions,
): Promise<string> {
    if (options.explicitToken) {
        return options.explicitToken;
    }

    const clientId = options.clientId;
    const clientSecret = options.clientSecret;

    if (!clientId || !clientSecret) {
        throw new Error(
            "Missing WCL auth. Provide WCL_OAUTH_TOKEN or WCL_CLIENT_ID and WCL_CLIENT_SECRET.",
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

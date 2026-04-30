import { createLogger } from "@wcl/shared";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_USER_AGENT = "DiscordBot (https://github.com/yay5a/wclogs.recap, 0.1.0)";
const MAX_RATE_LIMIT_RETRIES = 1;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const logger = createLogger("discord");

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const parseDiscordResponseBody = (text: string): unknown => {
    if (text.trim().length === 0) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
};

interface DiscordRateLimitMetadata { retryAfterMs: number; global: boolean | null; source: "header" | "body"; }
export interface DiscordMessageResponse extends Record<string, unknown> { id: string; flags?: number; }
const parseRetryAfterSeconds = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "string") { const parsed = Number.parseFloat(value); if (Number.isFinite(parsed) && parsed >= 0) return parsed; }
    return null;
};
const readDiscordRateLimitMetadata = async (response: Response): Promise<DiscordRateLimitMetadata | null> => {
    const retryAfterFromHeader = parseRetryAfterSeconds(response.headers.get("Retry-After") ?? response.headers.get("X-RateLimit-Reset-After"));
    if (retryAfterFromHeader !== null) return { retryAfterMs: Math.ceil(retryAfterFromHeader * 1000), global: null, source: "header" };
    try {
        const body = (await response.clone().json()) as unknown;
        if (!isObjectRecord(body)) return null;
        const retryAfterValue = parseRetryAfterSeconds(body.retry_after);
        const globalValue = body.global;
        if (retryAfterValue !== null) return { retryAfterMs: Math.ceil(retryAfterValue * 1000), global: typeof globalValue === "boolean" ? globalValue : null, source: "body" };
    } catch {
        return null;
    }
    return null;
};

interface DiscordApiRequestOptions {
    endpoint: string;
    method: "PATCH" | "POST" | "PUT";
    route: string;
    botToken?: string;
    body?: unknown;
    maxRateLimitRetries?: number;
}

export const discordApiRequest = async ({ endpoint, method, route, botToken, body, maxRateLimitRetries = MAX_RATE_LIMIT_RETRIES }: DiscordApiRequestOptions): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(endpoint, {
            method,
            headers: {
                "User-Agent": DISCORD_USER_AGENT,
                ...(botToken ? { Authorization: `Bot ${botToken}` } : {}),
                ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (response.status !== 429) return response;
        if (attempt >= maxRateLimitRetries) return response;
        const rateLimitMetadata = await readDiscordRateLimitMetadata(response);
        if (!rateLimitMetadata) {
            logger.warn({ route, attempt: attempt + 1, status: response.status }, "discord API rate limit hit without retry timing; skipping retry");
            return response;
        }
        const retryAfterMs = Math.min(rateLimitMetadata.retryAfterMs, MAX_RATE_LIMIT_WAIT_MS);
        logger.warn({ route, attempt: attempt + 1, status: response.status, retryAfterMs, retryAfterSource: rateLimitMetadata.source, global: rateLimitMetadata.global }, "discord API rate limit hit; retrying request");
        await delay(retryAfterMs);
    }
};

export const editOriginalInteractionResponse = async (applicationId: string, token: string, body: unknown): Promise<void> => {
    const endpoint = `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${token}/messages/@original`;
    const response = await discordApiRequest({ endpoint, method: "PATCH", route: "/webhooks/{applicationId}/{token}/messages/@original", body });
    if (!response.ok) throw new Error(`Failed to edit original interaction response: ${response.status} ${response.statusText} ${await response.text()}`);
};

export const safeEditOriginalInteractionResponse = async (applicationId: string, token: string, body: unknown): Promise<void> => {
    try {
        await editOriginalInteractionResponse(applicationId, token, body);
    } catch (error) {
        logger.error({ error, applicationId }, "failed to edit original interaction response");
    }
};

export const createFollowupInteractionResponse = async (applicationId: string, token: string, body: unknown): Promise<DiscordMessageResponse> => {
    const endpoint = `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${token}`;
    const route = "/webhooks/{applicationId}/{token}";
    const response = await discordApiRequest({ endpoint, method: "POST", route, body });
    const responseText = await response.text();
    const responseBody = parseDiscordResponseBody(responseText);
    const messageId = isObjectRecord(responseBody) && typeof responseBody.id === "string" ? responseBody.id : null;
    logger.info(
        {
            applicationId,
            route,
            status: response.status,
            ok: response.ok,
            messageId,
            responseBody,
        },
        "discord followup interaction response",
    );
    if (!response.ok) throw new Error(`Failed to create followup interaction response: ${response.status} ${response.statusText} ${responseText}`);
    if (!isObjectRecord(responseBody) || typeof responseBody.id !== "string") {
        throw new Error(`Discord followup interaction response did not return a created message id: ${response.status} ${response.statusText} ${responseText}`);
    }
    return responseBody as DiscordMessageResponse;
};

export const safeCreateFollowupInteractionResponse = async (applicationId: string, token: string, body: unknown): Promise<void> => {
    try {
        await createFollowupInteractionResponse(applicationId, token, body);
    } catch (error) {
        logger.error({ error, applicationId }, "failed to create followup interaction response");
    }
};

export const getDiscordApiBaseUrl = (): string => DISCORD_API_BASE_URL;

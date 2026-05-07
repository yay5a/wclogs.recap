import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebEnv } from "../../config.js";
import { sendError } from "./dto.js";
import {
    DASHBOARD_COOKIE_NAME,
    DASHBOARD_COOKIE_PATH,
    DASHBOARD_OAUTH_STATE_TTL_MS,
    DASHBOARD_REQUEST_HEADER,
    DASHBOARD_SESSION_TTL_MS,
    DISCORD_API_BASE_URL,
    type DashboardAuthContext,
    type DashboardAuthedRequest,
    type DashboardOAuthGuild,
    type DashboardOAuthStateRecord,
    type DashboardSessionRecord,
} from "./types.js";

const discordSessions = new Map<string, DashboardSessionRecord>();
const oauthStates = new Map<string, DashboardOAuthStateRecord>();
export const dashboardAuthContext: DashboardAuthContext = { kind: "admin-secret" };

export const compareDashboardAdminSecret = (
    submittedSecret: string,
    expectedSecret: string,
): boolean => {
    const submittedHash = crypto.createHash("sha256").update(submittedSecret).digest();
    const expectedHash = crypto.createHash("sha256").update(expectedSecret).digest();
    return crypto.timingSafeEqual(submittedHash, expectedHash);
};

const hashOAuthState = (state: string): string =>
    crypto.createHash("sha256").update(state).digest("base64url");

const pruneExpiredOAuthStates = () => {
    const now = Date.now();
    for (const [stateHash, record] of oauthStates.entries()) {
        if (now > record.expiresAtMs) oauthStates.delete(stateHash);
    }
};

export const storeOAuthState = (state: string) => {
    pruneExpiredOAuthStates();
    oauthStates.set(hashOAuthState(state), {
        expiresAtMs: Date.now() + DASHBOARD_OAUTH_STATE_TTL_MS,
    });
};

export const consumeOAuthState = (state: string): boolean => {
    const stateHash = hashOAuthState(state);
    const record = oauthStates.get(stateHash);
    oauthStates.delete(stateHash);
    return !!record && Date.now() <= record.expiresAtMs;
};

export const publicAuthContext = (auth: DashboardAuthContext) =>
    auth.kind === "admin-secret"
        ? auth
        : {
              kind: "discord" as const,
              discordUserId: auth.discordUserId,
              username: auth.username,
              displayName: auth.displayName,
          };

export const shouldUseSecureDashboardCookies = (env: WebEnv): boolean =>
    env.NODE_ENV === "production" || env.publicAppBaseUrl?.startsWith("https://") === true;

export const setDashboardCookie = (
    reply: FastifyReply,
    env: WebEnv,
    value: string,
    maxAgeSeconds = DASHBOARD_SESSION_TTL_MS / 1000,
) => {
    reply.setCookie(DASHBOARD_COOKIE_NAME, value, {
        httpOnly: true,
        signed: true,
        sameSite: "strict",
        secure: shouldUseSecureDashboardCookies(env),
        path: DASHBOARD_COOKIE_PATH,
        maxAge: maxAgeSeconds,
    });
};

const pruneExpiredDiscordSessions = () => {
    const now = Date.now();
    for (const [sessionId, record] of discordSessions.entries()) {
        if (now > record.expiresAtMs) discordSessions.delete(sessionId);
    }
};

const parseSessionCookie = (request: FastifyRequest): DashboardAuthContext | null => {
    pruneExpiredDiscordSessions();
    const rawCookie = request.cookies[DASHBOARD_COOKIE_NAME];
    if (!rawCookie) return null;

    const unsigned = request.unsignCookie(rawCookie);
    if (!unsigned.valid || typeof unsigned.value !== "string") return null;

    const parts = unsigned.value.split(":");
    if (parts.length === 3 && parts[0] === "dashboard" && parts[1] === "v1") {
        const expiresAtMs = Number(parts[2]);
        if (!Number.isSafeInteger(expiresAtMs) || Date.now() > expiresAtMs) return null;
        return dashboardAuthContext;
    }

    if (parts.length === 4 && parts[0] === "dashboard" && parts[1] === "v2") {
        const sessionId = parts[2];
        const expiresAtMs = Number(parts[3]);
        if (!sessionId || !Number.isSafeInteger(expiresAtMs) || Date.now() > expiresAtMs) {
            return null;
        }
        const record = discordSessions.get(sessionId);
        if (!record || Date.now() > record.expiresAtMs) {
            discordSessions.delete(sessionId);
            return null;
        }
        return record.auth;
    }

    return null;
};

export const requireDashboardAuth =
    (env: WebEnv) => async (request: DashboardAuthedRequest, reply: FastifyReply) => {
        if (env.DASHBOARD_AUTH_DISABLED) {
            request.dashboardAuth = dashboardAuthContext;
            return;
        }

        const auth = parseSessionCookie(request);
        if (!auth) return sendError(reply, 401, "unauthorized");
        request.dashboardAuth = auth;
    };

const validateMutationSafety = (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers[DASHBOARD_REQUEST_HEADER] !== "1") {
        return sendError(reply, 400, "missing_dashboard_request_header");
    }

    if (request.headers["sec-fetch-site"] === "cross-site") {
        return sendError(reply, 403, "cross_site_request_rejected");
    }

    const origin = request.headers.origin;
    if (typeof origin === "string") {
        const host = request.headers.host;
        try {
            const originHost = new URL(origin).host;
            if (host && originHost !== host) {
                return sendError(reply, 403, "cross_site_request_rejected");
            }
        } catch {
            return sendError(reply, 403, "cross_site_request_rejected");
        }
    }

    return undefined;
};

export const requireDashboardMutationSafety = async (
    request: FastifyRequest,
    reply: FastifyReply,
) => validateMutationSafety(request, reply);

export const parseOAuthGuild = (value: unknown): DashboardOAuthGuild | null => {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
    return {
        id: raw.id,
        name: raw.name,
        ...(typeof raw.icon === "string" || raw.icon === null ? { icon: raw.icon } : {}),
        owner: raw.owner === true,
        ...(typeof raw.permissions === "string" ? { permissions: raw.permissions } : {}),
    };
};

export const parseDiscordUser = (value: unknown): {
    id: string;
    username: string;
    displayName: string;
} | null => {
    if (typeof value !== "object" || value === null) return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.username !== "string") return null;
    const displayName =
        (typeof raw.global_name === "string" && raw.global_name) ||
        (typeof raw.username === "string" && raw.username) ||
        raw.id;
    return { id: raw.id, username: raw.username, displayName };
};

export const exchangeDiscordCode = async (env: WebEnv, code: string): Promise<string | null> => {
    if (!env.DISCORD_CLIENT_SECRET || !env.discordOAuthRedirectUri) return null;
    const response = await fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: env.DISCORD_APPLICATION_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: env.discordOAuthRedirectUri,
        }),
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return typeof payload?.access_token === "string" ? payload.access_token : null;
};

export const fetchDiscordBearerJson = async (
    endpoint: string,
    accessToken: string,
): Promise<unknown | null> => {
    const response = await fetch(`${DISCORD_API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return response.json().catch(() => null) as Promise<unknown | null>;
};

export const createDiscordSession = (
    auth: DashboardAuthContext,
): { sessionId: string; sessionExpiresAtMs: number } => {
    pruneExpiredDiscordSessions();
    const sessionId = crypto.randomBytes(24).toString("base64url");
    const sessionExpiresAtMs = Date.now() + DASHBOARD_SESSION_TTL_MS;
    discordSessions.set(sessionId, {
        expiresAtMs: sessionExpiresAtMs,
        auth,
    });
    return { sessionId, sessionExpiresAtMs };
};

export const deleteDiscordSessionFromCookie = (request: FastifyRequest) => {
    const rawCookie = request.cookies[DASHBOARD_COOKIE_NAME];
    if (!rawCookie) return;

    const unsigned = request.unsignCookie(rawCookie);
    const parts =
        unsigned.valid && typeof unsigned.value === "string" ? unsigned.value.split(":") : [];
    if (parts[0] === "dashboard" && parts[1] === "v2" && parts[2]) {
        discordSessions.delete(parts[2]);
    }
};

export const clearDiscordSessionsForGuild = (guildId: string) => {
    for (const [sessionId, record] of discordSessions.entries()) {
        if (record.auth.kind === "discord" && guildId in record.auth.oauthGuildsById) {
            discordSessions.delete(sessionId);
        }
    }
};

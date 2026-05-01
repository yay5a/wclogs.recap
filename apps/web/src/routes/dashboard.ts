import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
    parseAutoRecapMode,
    parseCompareAccessMode,
    parseCompareMode,
    parseGameFamily,
    type AutoRecapMode,
    type CompareAccessMode,
    type CompareMode,
    type GameFamily,
    type GuildConfig,
    type GuildConfigStore,
} from "@wcl/domain";
import type { WebEnv } from "../config.js";

export const DASHBOARD_COOKIE_NAME = "wcl_dashboard";
export const DASHBOARD_SESSION_TTL_MS = 60 * 60 * 1000;

const DASHBOARD_COOKIE_PATH = "/api/dashboard";
const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;
const DASHBOARD_REQUEST_HEADER = "x-dashboard-request";

export type DashboardAuthContext =
    | { kind: "admin-secret" }
    | {
          kind: "discord";
          discordUserId: string;
          guildIds: string[];
          permissionsByGuildId: Record<string, string>;
      };

export type DashboardGuildConfigSummary = {
    guildId: string;
    compareModeDefault: CompareMode;
    compareAccessMode: CompareAccessMode;
    comparePublicPostingEnabled: boolean;
    autoRecapMode: AutoRecapMode;
    defaultGameFamily: GameFamily;
    compareOfficerUserCount: number;
    autoRecapChannelCount: number;
    updatedAt?: string;
};

type DashboardConfigPatch = Partial<
    Pick<
        GuildConfig,
        | "compareModeDefault"
        | "compareAccessMode"
        | "comparePublicPostingEnabled"
        | "autoRecapMode"
        | "autoRecapChannelIds"
        | "defaultGameFamily"
    >
>;

export interface DashboardGuildConfigStore extends GuildConfigStore {
    listGuildConfigSummaries(): Promise<DashboardGuildConfigSummary[]>;
    getExistingGuildConfig(guildId: string): Promise<GuildConfig | null>;
    createDefaultGuildConfig(guildId: string): Promise<GuildConfig>;
    saveExistingGuildConfig(
        guildId: string,
        update: DashboardConfigPatch,
    ): Promise<GuildConfig | null>;
    addOfficerToExistingGuild(
        guildId: string,
        discordUserId: string,
    ): Promise<GuildConfig | null>;
    removeOfficerFromExistingGuild(
        guildId: string,
        discordUserId: string,
    ): Promise<GuildConfig | null>;
}

type DashboardRouteOptions = {
    env: WebEnv;
    guildConfigStore: DashboardGuildConfigStore;
};

type DashboardAuthedRequest = FastifyRequest & {
    dashboardAuth?: DashboardAuthContext;
};

const dashboardAuthContext: DashboardAuthContext = { kind: "admin-secret" };

export const compareDashboardAdminSecret = (
    submittedSecret: string,
    expectedSecret: string,
): boolean => {
    const submittedHash = crypto.createHash("sha256").update(submittedSecret).digest();
    const expectedHash = crypto.createHash("sha256").update(expectedSecret).digest();
    return crypto.timingSafeEqual(submittedHash, expectedHash);
};

const sendError = (reply: FastifyReply, statusCode: number, error: string) =>
    reply.code(statusCode).send({ error });

const getRequestBody = (request: FastifyRequest): Record<string, unknown> | undefined =>
    typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : undefined;

const isValidSnowflake = (value: string): boolean => DISCORD_SNOWFLAKE_RE.test(value);

const getSnowflakeParam = (
    request: FastifyRequest,
    name: string,
): string | undefined => {
    const params =
        typeof request.params === "object" && request.params !== null
            ? (request.params as Record<string, unknown>)
            : {};
    const value = params[name];
    return typeof value === "string" && isValidSnowflake(value) ? value : undefined;
};

const parseSessionCookie = (request: FastifyRequest): DashboardAuthContext | null => {
    const rawCookie = request.cookies[DASHBOARD_COOKIE_NAME];
    if (!rawCookie) return null;

    const unsigned = request.unsignCookie(rawCookie);
    if (!unsigned.valid || typeof unsigned.value !== "string") return null;

    const parts = unsigned.value.split(":");
    if (parts.length !== 3 || parts[0] !== "dashboard" || parts[1] !== "v1") {
        return null;
    }

    const expiresAtMs = Number(parts[2]);
    if (!Number.isSafeInteger(expiresAtMs) || Date.now() > expiresAtMs) {
        return null;
    }

    return dashboardAuthContext;
};

const requireDashboardAuth =
    (env: WebEnv) => async (request: DashboardAuthedRequest, reply: FastifyReply) => {
        if (env.DASHBOARD_AUTH_DISABLED) {
            request.dashboardAuth = dashboardAuthContext;
            return;
        }

        const auth = parseSessionCookie(request);
        if (!auth) {
            return sendError(reply, 401, "unauthorized");
        }
        request.dashboardAuth = auth;
    };

const requireDashboardMutationHeader = async (
    request: FastifyRequest,
    reply: FastifyReply,
) => {
    if (request.headers[DASHBOARD_REQUEST_HEADER] !== "1") {
        return sendError(reply, 400, "missing_dashboard_request_header");
    }
};

const readGuildIdFromParams = (
    request: FastifyRequest,
    reply: FastifyReply,
): string | undefined => {
    const guildId = getSnowflakeParam(request, "guildId");
    if (!guildId) {
        sendError(reply, 400, "invalid_guild_id");
        return undefined;
    }
    return guildId;
};

const readGuildAndUserIdsFromParams = (
    request: FastifyRequest,
    reply: FastifyReply,
): { guildId: string; discordUserId: string } | undefined => {
    const guildId = getSnowflakeParam(request, "guildId");
    if (!guildId) {
        sendError(reply, 400, "invalid_guild_id");
        return undefined;
    }

    const discordUserId = getSnowflakeParam(request, "discordUserId");
    if (!discordUserId) {
        sendError(reply, 400, "invalid_discord_user_id");
        return undefined;
    }

    return { guildId, discordUserId };
};

const parseGuildCreateBody = (
    request: FastifyRequest,
    reply: FastifyReply,
): { guildId: string } | undefined => {
    const body = getRequestBody(request);
    const guildId = typeof body?.guildId === "string" ? body.guildId.trim() : "";
    if (!isValidSnowflake(guildId)) {
        sendError(reply, 400, "invalid_guild_id");
        return undefined;
    }
    return { guildId };
};

const parseAutoRecapChannelIds = (
    value: unknown,
): string[] | "invalid" => {
    if (!Array.isArray(value)) return "invalid";

    const deduped: string[] = [];
    for (const rawEntry of value) {
        if (typeof rawEntry !== "string") return "invalid";
        const channelId = rawEntry.trim();
        if (!isValidSnowflake(channelId)) return "invalid";
        if (!deduped.includes(channelId)) deduped.push(channelId);
    }
    return deduped;
};

const parseConfigPatchBody = (
    request: FastifyRequest,
    reply: FastifyReply,
): DashboardConfigPatch | undefined => {
    const body = getRequestBody(request);
    if (!body || Array.isArray(body)) {
        sendError(reply, 400, "invalid_request_body");
        return undefined;
    }

    const allowedFields = new Set([
        "compareModeDefault",
        "compareAccessMode",
        "comparePublicPostingEnabled",
        "autoRecapMode",
        "autoRecapChannelIds",
        "defaultGameFamily",
    ]);
    for (const field of Object.keys(body)) {
        if (!allowedFields.has(field)) {
            sendError(reply, 400, "unknown_field");
            return undefined;
        }
    }

    const update: DashboardConfigPatch = {};
    if ("compareModeDefault" in body && body.compareModeDefault !== undefined) {
        const parsed = parseCompareMode(body.compareModeDefault);
        if (!parsed) {
            sendError(reply, 400, "invalid_compare_mode_default");
            return undefined;
        }
        update.compareModeDefault = parsed;
    }

    if ("compareAccessMode" in body && body.compareAccessMode !== undefined) {
        const parsed = parseCompareAccessMode(body.compareAccessMode);
        if (!parsed) {
            sendError(reply, 400, "invalid_compare_access_mode");
            return undefined;
        }
        update.compareAccessMode = parsed;
    }

    if (
        "comparePublicPostingEnabled" in body &&
        body.comparePublicPostingEnabled !== undefined
    ) {
        if (typeof body.comparePublicPostingEnabled !== "boolean") {
            sendError(reply, 400, "invalid_compare_public_posting_enabled");
            return undefined;
        }
        update.comparePublicPostingEnabled = body.comparePublicPostingEnabled;
    }

    if ("autoRecapMode" in body && body.autoRecapMode !== undefined) {
        const parsed = parseAutoRecapMode(body.autoRecapMode);
        if (!parsed) {
            sendError(reply, 400, "invalid_auto_recap_mode");
            return undefined;
        }
        update.autoRecapMode = parsed;
    }

    if ("autoRecapChannelIds" in body && body.autoRecapChannelIds !== undefined) {
        const parsed = parseAutoRecapChannelIds(body.autoRecapChannelIds);
        if (parsed === "invalid") {
            sendError(reply, 400, "invalid_auto_recap_channel_ids");
            return undefined;
        }
        update.autoRecapChannelIds = parsed;
    }

    if ("defaultGameFamily" in body && body.defaultGameFamily !== undefined) {
        const parsed = parseGameFamily(body.defaultGameFamily);
        if (!parsed) {
            sendError(reply, 400, "invalid_default_game_family");
            return undefined;
        }
        update.defaultGameFamily = parsed;
    }

    return update;
};

export const registerDashboardRoutes: FastifyPluginAsync<DashboardRouteOptions> = async (
    app,
    options,
) => {
    const authPreHandler = requireDashboardAuth(options.env);
    const mutationPreHandlers = [authPreHandler, requireDashboardMutationHeader];

    app.post("/api/dashboard/login", async (request, reply) => {
        if (options.env.DASHBOARD_AUTH_DISABLED) {
            return reply.send({ ok: true });
        }

        const body = getRequestBody(request);
        const submittedSecret =
            typeof body?.adminSecret === "string" ? body.adminSecret : undefined;
        const expectedSecret = options.env.DASHBOARD_ADMIN_SECRET;
        if (
            !submittedSecret ||
            !expectedSecret ||
            !compareDashboardAdminSecret(submittedSecret, expectedSecret)
        ) {
            return sendError(reply, 401, "unauthorized");
        }

        const expiresAtMs = Date.now() + DASHBOARD_SESSION_TTL_MS;
        reply.setCookie(DASHBOARD_COOKIE_NAME, `dashboard:v1:${expiresAtMs}`, {
            httpOnly: true,
            signed: true,
            sameSite: "strict",
            secure: options.env.NODE_ENV === "production",
            path: DASHBOARD_COOKIE_PATH,
            maxAge: DASHBOARD_SESSION_TTL_MS / 1000,
        });
        return reply.send({ ok: true });
    });

    app.post(
        "/api/dashboard/logout",
        { preHandler: mutationPreHandlers },
        async (_request, reply) => {
            reply.clearCookie(DASHBOARD_COOKIE_NAME, { path: DASHBOARD_COOKIE_PATH });
            return reply.send({ ok: true });
        },
    );

    app.get(
        "/api/dashboard/session",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) =>
            reply.send({
                authenticated: true,
                auth: request.dashboardAuth ?? dashboardAuthContext,
            }),
    );

    app.get(
        "/api/dashboard/guilds",
        { preHandler: authPreHandler },
        async (_request, reply) =>
            reply.send({ guilds: await options.guildConfigStore.listGuildConfigSummaries() }),
    );

    app.post(
        "/api/dashboard/guilds",
        { preHandler: mutationPreHandlers },
        async (request, reply) => {
            const parsed = parseGuildCreateBody(request, reply);
            if (!parsed) return reply;
            const config = await options.guildConfigStore.createDefaultGuildConfig(parsed.guildId);
            return reply.send({ config });
        },
    );

    app.get(
        "/api/dashboard/guilds/:guildId/config",
        { preHandler: authPreHandler },
        async (request, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await options.guildConfigStore.getExistingGuildConfig(guildId);
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            return reply.send({ config });
        },
    );

    app.patch(
        "/api/dashboard/guilds/:guildId/config",
        { preHandler: mutationPreHandlers },
        async (request, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const update = parseConfigPatchBody(request, reply);
            if (!update) return reply;

            const config = await options.guildConfigStore.saveExistingGuildConfig(
                guildId,
                update,
            );
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            return reply.send({ config });
        },
    );

    app.post(
        "/api/dashboard/guilds/:guildId/officers/:discordUserId",
        { preHandler: mutationPreHandlers },
        async (request, reply) => {
            const params = readGuildAndUserIdsFromParams(request, reply);
            if (!params) return reply;
            const config = await options.guildConfigStore.addOfficerToExistingGuild(
                params.guildId,
                params.discordUserId,
            );
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            return reply.send({ config });
        },
    );

    app.delete(
        "/api/dashboard/guilds/:guildId/officers/:discordUserId",
        { preHandler: mutationPreHandlers },
        async (request, reply) => {
            const params = readGuildAndUserIdsFromParams(request, reply);
            if (!params) return reply;
            const config = await options.guildConfigStore.removeOfficerFromExistingGuild(
                params.guildId,
                params.discordUserId,
            );
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            return reply.send({ config });
        },
    );
};

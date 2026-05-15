import type { FastifyReply, FastifyRequest } from "fastify";
import {
    parseAutoReportMode,
    parseCompareAccessMode,
    parseCompareMode,
    parseGameFamily,
} from "@wcl/domain";
import type { CharacterClaimRecord } from "@wcl/discord";
import type { DashboardActivityRecord, DashboardConfigPatch } from "./types.js";
import { CLAIM_ID_RE, DISCORD_SNOWFLAKE_RE } from "./types.js";

export const sendError = (reply: FastifyReply, statusCode: number, error: string) =>
    reply.code(statusCode).send({ error });

export const getRequestBody = (request: FastifyRequest): Record<string, unknown> | undefined =>
    typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : undefined;

export const isValidSnowflake = (value: string): boolean => DISCORD_SNOWFLAKE_RE.test(value);
export const isValidClaimId = (value: string): boolean => CLAIM_ID_RE.test(value);

export const getStringParam = (request: FastifyRequest, name: string): string | undefined => {
    const params =
        typeof request.params === "object" && request.params !== null
            ? (request.params as Record<string, unknown>)
            : {};
    const value = params[name];
    return typeof value === "string" ? value : undefined;
};

const getSnowflakeParam = (request: FastifyRequest, name: string): string | undefined => {
    const value = getStringParam(request, name);
    return value && isValidSnowflake(value) ? value : undefined;
};

const serializeDate = (date: Date | undefined): string | undefined => date?.toISOString();

export const readGuildIdFromParams = (
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

export const readGuildAndUserIdsFromParams = (
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

export const parseGuildCreateBody = (
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

const parseAutoReportChannelIds = (value: unknown): string[] | "invalid" => {
    if (!Array.isArray(value)) return "invalid";

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const rawEntry of value) {
        if (typeof rawEntry !== "string") return "invalid";
        const channelId = rawEntry.trim();
        if (!isValidSnowflake(channelId)) return "invalid";
        if (!seen.has(channelId)) {
            seen.add(channelId);
            deduped.push(channelId);
        }
    }
    return deduped;
};

export const parseConfigPatchBody = (
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
        "autoReportMode",
        "autoReportChannelIds",
        "defaultGameFamily",
        "dashboardOfficerAccessEnabled",
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

    if ("dashboardOfficerAccessEnabled" in body && body.dashboardOfficerAccessEnabled !== undefined) {
        if (typeof body.dashboardOfficerAccessEnabled !== "boolean") {
            sendError(reply, 400, "invalid_dashboard_officer_access_enabled");
            return undefined;
        }
        update.dashboardOfficerAccessEnabled = body.dashboardOfficerAccessEnabled;
    }

    if ("autoReportMode" in body && body.autoReportMode !== undefined) {
        const parsed = parseAutoReportMode(body.autoReportMode);
        if (!parsed) {
            sendError(reply, 400, "invalid_auto_report_mode");
            return undefined;
        }
        update.autoReportMode = parsed;
    }

    if ("autoReportChannelIds" in body && body.autoReportChannelIds !== undefined) {
        const parsed = parseAutoReportChannelIds(body.autoReportChannelIds);
        if (parsed === "invalid") {
            sendError(reply, 400, "invalid_auto_report_channel_ids");
            return undefined;
        }
        update.autoReportChannelIds = parsed;
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

export const serializeClaim = (claim: CharacterClaimRecord) => ({
    claimId: claim.claimId,
    guildId: claim.guildId,
    discordUserId: claim.discordUserId,
    participantKey: claim.participantKey,
    characterName: claim.characterName,
    realm: claim.realm,
    region: claim.region,
    status: claim.status,
    peerCompareOptIn: claim.peerCompareOptIn,
    publicPostOptIn: claim.publicPostOptIn,
    requestedAt: claim.requestedAt.toISOString(),
    reviewedAt: serializeDate(claim.reviewedAt),
    reviewedByDiscordUserId: claim.reviewedByDiscordUserId,
    revokedAt: serializeDate(claim.revokedAt),
    revokedByDiscordUserId: claim.revokedByDiscordUserId,
    revokeReason: claim.revokeReason,
});

export const serializeActivity = (event: DashboardActivityRecord) => ({
    guildId: event.guildId,
    channelId: event.channelId,
    sourceMessageId: event.sourceMessageId,
    actor: event.actor,
    kind: event.kind,
    reportCode: event.reportCode,
    sourceUrl: event.sourceUrl,
    discordMessageUrl: event.discordMessageUrl,
    characterLabel: event.characterLabel,
    targetDiscordUserId: event.targetDiscordUserId,
    createdAt: event.createdAt.toISOString(),
});

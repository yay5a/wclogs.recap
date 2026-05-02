import type { FastifyReply } from "fastify";
import { hasDiscordPermission, type ActivityActor, type GuildConfig } from "@wcl/domain";
import { sendError } from "./dto.js";
import {
    ADMIN_CAPABILITIES,
    GUILD_MANAGER_CAPABILITIES,
    OFFICER_CAPABILITIES,
    type DashboardAuthContext,
    type DashboardAuthedRequest,
    type DashboardCapability,
    type DashboardOAuthGuild,
    type DashboardRouteOptions,
} from "./types.js";

const hasAdministrator = (guild: DashboardOAuthGuild): boolean =>
    hasDiscordPermission(guild.permissions, "administrator");

const hasManageGuild = (guild: DashboardOAuthGuild): boolean =>
    hasDiscordPermission(guild.permissions, "manage-guild");

const dedupeCapabilities = (capabilities: DashboardCapability[]): DashboardCapability[] =>
    [...new Set(capabilities)];

export const getEffectiveCapabilities = (
    auth: DashboardAuthContext,
    guildId: string,
    config: GuildConfig,
): DashboardCapability[] => {
    if (auth.kind === "admin-secret") return ADMIN_CAPABILITIES;

    const oauthGuild = auth.oauthGuildsById[guildId];
    if (!oauthGuild) return [];

    if (oauthGuild.owner || hasAdministrator(oauthGuild)) {
        return ADMIN_CAPABILITIES;
    }

    const capabilities: DashboardCapability[] = [];
    if (hasManageGuild(oauthGuild)) capabilities.push(...GUILD_MANAGER_CAPABILITIES);
    if (
        config.dashboardOfficerAccessEnabled &&
        config.compareOfficerUserIds.includes(auth.discordUserId)
    ) {
        capabilities.push(...OFFICER_CAPABILITIES);
    }
    return dedupeCapabilities(capabilities);
};

const hasCapability = (
    auth: DashboardAuthContext,
    guildId: string,
    config: GuildConfig,
    capability: DashboardCapability,
): boolean => getEffectiveCapabilities(auth, guildId, config).includes(capability);

export const requireGuildCapability = async (
    request: DashboardAuthedRequest,
    reply: FastifyReply,
    options: DashboardRouteOptions,
    guildId: string,
    capability: DashboardCapability,
): Promise<GuildConfig | undefined> => {
    const auth = requireRequestAuthContext(request);
    if (auth.kind !== "admin-secret" && !auth.oauthGuildsById[guildId]) {
        sendError(reply, 404, "guild_config_not_found");
        return undefined;
    }

    const config = await options.guildConfigStore.getExistingGuildConfig(guildId);
    if (!config) {
        sendError(reply, 404, "guild_config_not_found");
        return undefined;
    }

    if (!hasCapability(auth, guildId, config, capability)) {
        sendError(reply, 404, "guild_config_not_found");
        return undefined;
    }

    return config;
};

export const requireAdminSecret = (
    request: DashboardAuthedRequest,
    reply: FastifyReply,
): boolean => {
    if (request.dashboardAuth?.kind === "admin-secret") return true;
    sendError(reply, 403, "admin_secret_required");
    return false;
};

export const requireRequestAuthContext = (request: DashboardAuthedRequest): DashboardAuthContext => {
    if (!request.dashboardAuth) {
        throw new Error("Dashboard auth context missing after authentication.");
    }
    return request.dashboardAuth;
};

export const actorFromSession = (auth: DashboardAuthContext): ActivityActor =>
    auth.kind === "discord"
        ? { kind: "discord", discordUserId: auth.discordUserId }
        : { kind: "admin-secret" };

export const actorDiscordUserId = (
    auth: DashboardAuthContext | undefined,
): string | undefined => (auth?.kind === "discord" ? auth.discordUserId : undefined);

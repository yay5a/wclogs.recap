import { InteractionResponseType } from "discord-interactions";
import { isCompareOfficer, type GuildConfig, type GuildConfigStore } from "@wcl/domain";
import type { DiscordInteraction, HandleOptions } from "../types.js";
import { canManageGuildConfig } from "./permissions.js";

const EPHEMERAL_MESSAGE_FLAG = 64;

const getStringOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};

const getRequesterDiscordUserId = (interaction: DiscordInteraction): string | undefined => interaction.member?.user?.id ?? interaction.user?.id;

const getRequesterPermissions = (interaction: DiscordInteraction): string | number | undefined => interaction.member?.permissions;

const ephemeral = (content: string) => ({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL_MESSAGE_FLAG },
});

const mentionUser = (discordUserId: string): string => `<@${discordUserId}>`;

const normalizeOfficerUserIds = (userIds: readonly string[] | undefined): string[] => [...new Set((userIds ?? []).filter((userId) => typeof userId === "string" && userId.trim().length > 0))];

const requireGuild = (interaction: DiscordInteraction): { guildId: string } | { response: unknown } => {
    const guildId = interaction.guild_id;
    if (!guildId) return { response: ephemeral("Guild context is required for this command.") };
    return { guildId };
};

const requireTargetUserId = (interaction: DiscordInteraction): { targetDiscordUserId: string } | { response: unknown } => {
    const targetDiscordUserId = getStringOption(interaction.data?.options, "user")?.trim();
    if (!targetDiscordUserId) return { response: ephemeral("Discord user is required.") };
    return { targetDiscordUserId };
};

const saveCompareOfficerUserIds = (guildConfigStore: GuildConfigStore, guildId: string, compareOfficerUserIds: string[]): Promise<GuildConfig> => guildConfigStore.saveGuildConfig(guildId, { compareOfficerUserIds });

const addCompareOfficerUser = async (guildConfigStore: GuildConfigStore, guildId: string, discordUserId: string): Promise<GuildConfig> => {
    if (guildConfigStore.addCompareOfficerUser) {
        return guildConfigStore.addCompareOfficerUser(guildId, discordUserId);
    }

    const current = await guildConfigStore.getGuildConfig(guildId);
    const rawCurrentUserIds = current.compareOfficerUserIds ?? [];
    const currentUserIds = normalizeOfficerUserIds(current.compareOfficerUserIds);
    const nextUserIds = currentUserIds.includes(discordUserId) ? currentUserIds : [...currentUserIds, discordUserId];
    if (rawCurrentUserIds.length === nextUserIds.length && rawCurrentUserIds.every((userId, index) => userId === nextUserIds[index])) {
        return current;
    }
    return saveCompareOfficerUserIds(guildConfigStore, guildId, nextUserIds);
};

const removeCompareOfficerUser = async (guildConfigStore: GuildConfigStore, guildId: string, discordUserId: string): Promise<{ removed: boolean; config: GuildConfig }> => {
    const current = await guildConfigStore.getGuildConfig(guildId);
    const currentUserIds = normalizeOfficerUserIds(current.compareOfficerUserIds);
    if (!currentUserIds.includes(discordUserId)) {
        return { removed: false, config: current };
    }

    const nextUserIds = currentUserIds.filter((userId) => userId !== discordUserId);
    const config = guildConfigStore.removeCompareOfficerUser ? await guildConfigStore.removeCompareOfficerUser(guildId, discordUserId) : await saveCompareOfficerUserIds(guildConfigStore, guildId, nextUserIds);

    return { removed: true, config };
};

export const handleAddOfficerCommand = async (interaction: DiscordInteraction, options: HandleOptions): Promise<unknown> => {
    const context = requireGuild(interaction);
    if ("response" in context) return context.response;
    if (!canManageGuildConfig(interaction)) {
        return ephemeral("This action requires Manage Server permission.");
    }

    const target = requireTargetUserId(interaction);
    if ("response" in target) return target.response;

    await addCompareOfficerUser(options.guildConfigStore, context.guildId, target.targetDiscordUserId);

    return ephemeral(`Officer added: ${mentionUser(target.targetDiscordUserId)}.`);
};

export const handleRemoveOfficerCommand = async (interaction: DiscordInteraction, options: HandleOptions): Promise<unknown> => {
    const context = requireGuild(interaction);
    if ("response" in context) return context.response;
    if (!canManageGuildConfig(interaction)) {
        return ephemeral("This action requires Manage Server permission.");
    }

    const target = requireTargetUserId(interaction);
    if ("response" in target) return target.response;

    const result = await removeCompareOfficerUser(options.guildConfigStore, context.guildId, target.targetDiscordUserId);

    return ephemeral(result.removed ? `Officer removed: ${mentionUser(target.targetDiscordUserId)}.` : `${mentionUser(target.targetDiscordUserId)} was not configured as an officer.`);
};

export const handleListOfficersCommand = async (interaction: DiscordInteraction, options: HandleOptions): Promise<unknown> => {
    const context = requireGuild(interaction);
    if ("response" in context) return context.response;

    const guildConfig = await options.guildConfigStore.getGuildConfig(context.guildId);
    const requesterDiscordUserId = getRequesterDiscordUserId(interaction) ?? "";
    const canList = isCompareOfficer({
        requesterDiscordUserId,
        requesterPermissions: getRequesterPermissions(interaction),
        guildSettings: guildConfig,
    });
    if (!canList) {
        return ephemeral("This action is limited to authorized officers.");
    }

    const officerUserIds = normalizeOfficerUserIds(guildConfig.compareOfficerUserIds);
    if (officerUserIds.length === 0) {
        return ephemeral("No explicit officers are configured.");
    }

    return ephemeral(["Configured officers:", ...officerUserIds.map(mentionUser)].join("\n"));
};

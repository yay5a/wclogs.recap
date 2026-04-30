import { InteractionResponseType } from "discord-interactions";
import {
    parseAutoRecapMode,
    hasDiscordPermission,
    parseCompareAccessMode,
    parseCompareMode,
    type AutoRecapMode,
    type CompareAccessMode,
    type CompareMode,
    type GameFamily,
    type GuildConfig,
} from "@wcl/domain";
import type { DiscordInteraction, HandleOptions } from "../types.js";

const getStringOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};

const getBooleanOption = (options: unknown, name: string): boolean | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "boolean" ? found.value : undefined;
};

const hasCommandOptions = (options: unknown): boolean => Array.isArray(options) && options.length > 0;

const parseGameFamilyOption = (value: string | undefined): GameFamily | undefined =>
    value === "retail" || value === "mop_classic" ? value : undefined;

const canManageGuildConfig = (interaction: DiscordInteraction): boolean => {
    const permissions = interaction.member?.permissions;
    return (
        hasDiscordPermission(permissions, "administrator") ||
        hasDiscordPermission(permissions, "manage-guild")
    );
};

const getAutoRecapMode = (config: Partial<GuildConfig>): AutoRecapMode =>
    config.autoRecapMode ?? "prompt";

const getAutoRecapChannelIds = (config: Partial<GuildConfig>): string[] =>
    Array.isArray(config.autoRecapChannelIds)
        ? [...new Set(config.autoRecapChannelIds)]
        : [];

const buildConfigStatusResponse = (config: Partial<GuildConfig>): string => {
    const mode = getAutoRecapMode(config);
    const channelIds = getAutoRecapChannelIds(config);
    const lines = [
        "**wclogs.recap setup status**",
        "",
        `Auto recap: \`${mode}\``,
    ];

    if (channelIds.length === 0) {
        lines.push(
            "Auto recap channels: none configured",
            "",
            "**Next step:**",
            "Add a raid-log channel: `/config auto_recap_channel:#raid-logs`",
            "",
            "**Required bot permissions in that channel:**",
            "View Channel, Send Messages, Embed Links",
            "",
            "**Optional:**",
            "Use `/recap <warcraftlogs-url>` anytime without auto recap.",
        );
        return lines.join("\n");
    }

    lines.push(
        "Auto recap channels:",
        "",
        ...channelIds.map((channelId) => `* <#${channelId}>`),
        "",
        mode === "off"
            ? "Passive detection is currently disabled. Configured channels are preserved."
            : "Passive Warcraft Logs detection is active in the listed channels.",
    );
    return lines.join("\n");
};

const getCompareModeResponse = (compareMode: CompareMode): string => {
    if (compareMode === "mixed") {
        return "Default comparison mode set to mixed. Future comparisons will use mapped player history when available. Alts are not guessed automatically.";
    }
    return "Default comparison mode set to character. Future comparisons will match exact character history unless a command overrides it.";
};

const getCompareAccessModeResponse = (compareAccessMode: CompareAccessMode): string => {
    switch (compareAccessMode) {
        case "officer_only":
            return "Compare access mode set to officer_only. Private comparison cards are limited to authorized raid roles.";
        case "owner_or_officer":
            return "Compare access mode set to owner_or_officer. Approved character owners and authorized raid roles can view private comparison cards.";
        case "owner_opt_in_or_officer":
            return "Compare access mode set to owner_opt_in_or_officer. Approved owners, authorized raid roles, and opted-in targets can be viewed privately.";
    }
};

export const handleConfigCommand = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown> => {
    const guildId = interaction.guild_id;
    if (!guildId) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Guild context is required for /config.", flags: 64 },
        };
    }

    if (!canManageGuildConfig(interaction)) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "This action requires Manage Server permission.", flags: 64 },
        };
    }

    const defaultGameFamily = getStringOption(
        interaction.data?.options,
        "game_family",
    );
    const rawCompareMode = getStringOption(
        interaction.data?.options,
        "compare_mode",
    );
    const rawCompareAccessMode = getStringOption(
        interaction.data?.options,
        "compare_access_mode",
    );
    const comparePublicPostingEnabled = getBooleanOption(
        interaction.data?.options,
        "compare_public_posting",
    );
    const compareOfficerRoleId = getStringOption(
        interaction.data?.options,
        "compare_officer_role",
    );
    const rawAutoRecapMode = getStringOption(
        interaction.data?.options,
        "auto_recap_mode",
    );
    const autoRecapChannelId = getStringOption(
        interaction.data?.options,
        "auto_recap_channel",
    );
    const compareModeDefault =
        rawCompareMode === undefined ? undefined : parseCompareMode(rawCompareMode);
    const compareAccessMode =
        rawCompareAccessMode === undefined
            ? undefined
            : parseCompareAccessMode(rawCompareAccessMode);
    const autoRecapMode =
        rawAutoRecapMode === undefined
            ? undefined
            : parseAutoRecapMode(rawAutoRecapMode);

    if (!hasCommandOptions(interaction.data?.options)) {
        const config = await options.guildConfigStore.getGuildConfig(guildId);
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: buildConfigStatusResponse(config),
                flags: 64,
            },
        };
    }

    if (rawCompareMode !== undefined && !compareModeDefault) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content:
                    "Invalid compare_mode. Choose character or mixed.",
                flags: 64,
            },
        };
    }

    if (rawCompareAccessMode !== undefined && !compareAccessMode) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content:
                    "Invalid compare_access_mode. Choose officer_only, owner_or_officer, or owner_opt_in_or_officer.",
                flags: 64,
            },
        };
    }

    if (rawAutoRecapMode !== undefined && !autoRecapMode) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content:
                    "Invalid auto_recap_mode. Choose off, prompt, auto_preview, or auto_post.",
                flags: 64,
            },
        };
    }

    const updateObject: Parameters<
        HandleOptions["guildConfigStore"]["saveGuildConfig"]
    >[1] = {};
    const existingConfig = autoRecapChannelId
        ? await options.guildConfigStore.getGuildConfig(guildId)
        : undefined;
    const parsedGameFamily = parseGameFamilyOption(defaultGameFamily);
    if (parsedGameFamily) updateObject.defaultGameFamily = parsedGameFamily;
    if (compareModeDefault) updateObject.compareModeDefault = compareModeDefault;
    if (compareAccessMode) updateObject.compareAccessMode = compareAccessMode;
    if (autoRecapMode) updateObject.autoRecapMode = autoRecapMode;
    if (comparePublicPostingEnabled !== undefined) {
        updateObject.comparePublicPostingEnabled = comparePublicPostingEnabled;
    }
    if (compareOfficerRoleId) updateObject.compareOfficerRoleIds = [compareOfficerRoleId];
    if (autoRecapChannelId && existingConfig) {
        const currentChannelIds = getAutoRecapChannelIds(existingConfig);
        updateObject.autoRecapChannelIds = currentChannelIds.includes(autoRecapChannelId)
            ? currentChannelIds.filter((channelId) => channelId !== autoRecapChannelId)
            : [...currentChannelIds, autoRecapChannelId];
    }
    const saved = await options.guildConfigStore.saveGuildConfig(guildId, updateObject);
    const responseLines: string[] = [];
    if (compareModeDefault || Object.keys(updateObject).length === 0) {
        responseLines.push(getCompareModeResponse(saved.compareModeDefault));
    }
    if (compareAccessMode) {
        responseLines.push(getCompareAccessModeResponse(saved.compareAccessMode));
    }
    if (comparePublicPostingEnabled !== undefined) {
        responseLines.push(
            saved.comparePublicPostingEnabled
                ? "Public compare posting enabled. Posting still requires explicit visibility and target safeguards."
                : "Public compare posting disabled. Private comparison cards remain the default.",
        );
    }
    if (compareOfficerRoleId) {
        responseLines.push("Compare officer role set. Members with that role can view private compare cards.");
    }
    if (autoRecapMode) {
        responseLines.push(`Auto recap mode set to ${autoRecapMode}.`);
    }
    if (autoRecapChannelId) {
        const enabled = getAutoRecapChannelIds(saved).includes(autoRecapChannelId);
        responseLines.push(
            enabled
                ? `Auto recap enabled in <#${autoRecapChannelId}>.`
                : `Auto recap disabled in <#${autoRecapChannelId}>.`,
        );
    }

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: [...responseLines, buildConfigStatusResponse(saved)].filter(Boolean).join("\n\n"),
            flags: 64,
        },
    };
};

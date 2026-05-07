import { InteractionResponseType } from "discord-interactions";
import { COMPARE_ACCESS_MODES, parseAutoReportMode, parseCompareAccessMode, parseCompareMode, parseGameFamily, type AutoReportMode, type CompareAccessMode, type CompareMode, type GameFamily, type GuildConfig } from "@wcl/domain";
import type { DiscordInteraction, HandleOptions } from "../types.js";
import { canManageGuildConfig } from "./permissions.js";

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
    parseGameFamily(value);

const getAutoReportMode = (config: Partial<GuildConfig>): AutoReportMode => config.autoReportMode ?? "prompt";

const getAutoReportChannelIds = (config: Partial<GuildConfig>): string[] => (Array.isArray(config.autoReportChannelIds) ? [...new Set(config.autoReportChannelIds)] : []);

const buildConfigStatusResponse = (config: Partial<GuildConfig>): string => {
    const mode = getAutoReportMode(config);
    const channelIds = getAutoReportChannelIds(config);
    const lines = ["**wclogs report setup status**", "", `Auto report: \`${mode}\``];

    if (channelIds.length === 0) {
        lines.push("Auto report channels: none configured", "", "**Next step:**", "Add a raid-log channel: `/config auto_report_channel:#raid-logs`", "", "**Required bot permissions in that channel:**", "View Channel, Send Messages, Embed Links", "", "**Optional:**", "Use `/report <wcl_report_url>` anytime without auto report.");
        return lines.join("\n");
    }

    lines.push("Auto report channels:", "", ...channelIds.map((channelId) => `* <#${channelId}>`), "", mode === "off" ? "Passive detection is currently disabled. Configured channels are preserved." : "Passive Warcraft Logs detection is active in the listed channels.");
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
            return "Compare access mode set to officer_only. Private comparison cards are limited to authorized officers.";
        case "owner_or_officer":
            return "Compare access mode set to owner_or_officer. Approved character owners and authorized officers can view private comparison cards.";
        case "owner_opt_in_or_officer":
            return "Compare access mode set to owner_opt_in_or_officer. Approved owners, authorized officers, and opted-in targets can be viewed privately.";
        case "owner_only":
            return "Compare access mode set to owner_only. Only approved character owners can view their own private comparison cards.";
    }
};

export const handleConfigCommand = async (interaction: DiscordInteraction, options: HandleOptions): Promise<unknown> => {
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

    const defaultGameFamily = getStringOption(interaction.data?.options, "game_family");
    const rawCompareMode = getStringOption(interaction.data?.options, "compare_mode");
    const rawCompareAccessMode = getStringOption(interaction.data?.options, "compare_access_mode");
    const comparePublicPostingEnabled = getBooleanOption(interaction.data?.options, "compare_public_posting");
    const rawAutoReportMode = getStringOption(interaction.data?.options, "auto_report_mode");
    const autoReportChannelId = getStringOption(interaction.data?.options, "auto_report_channel");
    const compareModeDefault = rawCompareMode === undefined ? undefined : parseCompareMode(rawCompareMode);
    const compareAccessMode = rawCompareAccessMode === undefined ? undefined : parseCompareAccessMode(rawCompareAccessMode);
    const autoReportMode = rawAutoReportMode === undefined ? undefined : parseAutoReportMode(rawAutoReportMode);

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
                content: "Invalid compare_mode. Choose character or mixed.",
                flags: 64,
            },
        };
    }

    if (rawCompareAccessMode !== undefined && !compareAccessMode) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: `Invalid compare_access_mode. Choose ${COMPARE_ACCESS_MODES.join(", ")}.`,
                flags: 64,
            },
        };
    }

    if (rawAutoReportMode !== undefined && !autoReportMode) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Invalid auto_report_mode. Choose off, prompt, auto_preview, or auto_post.",
                flags: 64,
            },
        };
    }

    const updateObject: Parameters<HandleOptions["guildConfigStore"]["saveGuildConfig"]>[1] = {};
    const needsExistingConfig = Boolean(autoReportChannelId);
    const existingConfig = needsExistingConfig ? await options.guildConfigStore.getGuildConfig(guildId) : undefined;
    const parsedGameFamily = parseGameFamilyOption(defaultGameFamily);
    if (parsedGameFamily) updateObject.defaultGameFamily = parsedGameFamily;
    if (compareModeDefault) updateObject.compareModeDefault = compareModeDefault;
    if (compareAccessMode) updateObject.compareAccessMode = compareAccessMode;
    if (autoReportMode) updateObject.autoReportMode = autoReportMode;
    if (comparePublicPostingEnabled !== undefined) {
        updateObject.comparePublicPostingEnabled = comparePublicPostingEnabled;
    }
    if (autoReportChannelId && existingConfig) {
        const currentChannelIds = getAutoReportChannelIds(existingConfig);
        updateObject.autoReportChannelIds = currentChannelIds.includes(autoReportChannelId) ? currentChannelIds.filter((channelId) => channelId !== autoReportChannelId) : [...currentChannelIds, autoReportChannelId];
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
        responseLines.push(saved.comparePublicPostingEnabled ? "Public compare posting enabled. Posting still requires explicit visibility and target safeguards." : "Public compare posting disabled. Private comparison cards remain the default.");
    }
    if (autoReportMode) {
        responseLines.push(`Auto report mode set to ${autoReportMode}.`);
    }
    if (autoReportChannelId) {
        const enabled = getAutoReportChannelIds(saved).includes(autoReportChannelId);
        responseLines.push(enabled ? `Auto report enabled in <#${autoReportChannelId}>.` : `Auto report disabled in <#${autoReportChannelId}>.`);
    }

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: [...responseLines, buildConfigStatusResponse(saved)].filter(Boolean).join("\n\n"),
            flags: 64,
        },
    };
};

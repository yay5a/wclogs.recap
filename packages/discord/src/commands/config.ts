import { InteractionResponseType } from "discord-interactions";
import {
    hasDiscordPermission,
    parseCompareAccessMode,
    parseCompareMode,
    type CompareAccessMode,
    type CompareMode,
    type GameFamily,
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

const parseGameFamilyOption = (value: string | undefined): GameFamily | undefined =>
    value === "retail" || value === "mop_classic" ? value : undefined;

const canManageGuildConfig = (interaction: DiscordInteraction): boolean => {
    const permissions = interaction.member?.permissions;
    return (
        hasDiscordPermission(permissions, "administrator") ||
        hasDiscordPermission(permissions, "manage-guild")
    );
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
    const compareModeDefault =
        rawCompareMode === undefined ? undefined : parseCompareMode(rawCompareMode);
    const compareAccessMode =
        rawCompareAccessMode === undefined
            ? undefined
            : parseCompareAccessMode(rawCompareAccessMode);

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

    const updateObject: Parameters<
        HandleOptions["guildConfigStore"]["saveGuildConfig"]
    >[1] = {};
    const parsedGameFamily = parseGameFamilyOption(defaultGameFamily);
    if (parsedGameFamily) updateObject.defaultGameFamily = parsedGameFamily;
    if (compareModeDefault) updateObject.compareModeDefault = compareModeDefault;
    if (compareAccessMode) updateObject.compareAccessMode = compareAccessMode;
    if (comparePublicPostingEnabled !== undefined) {
        updateObject.comparePublicPostingEnabled = comparePublicPostingEnabled;
    }
    if (compareOfficerRoleId) updateObject.compareOfficerRoleIds = [compareOfficerRoleId];
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

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: responseLines.join("\n"),
            flags: 64,
        },
    };
};

import { InteractionResponseType } from "discord-interactions";
import { parseCompareMode, type CompareMode, type GameFamily } from "@wcl/domain";
import type { DiscordInteraction, HandleOptions } from "../types.js";

const getStringOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};

const parseGameFamilyOption = (value: string | undefined): GameFamily | undefined =>
    value === "retail" || value === "mop_classic" ? value : undefined;

const getCompareModeResponse = (compareMode: CompareMode): string => {
    if (compareMode === "mixed") {
        return "Default comparison mode set to mixed. Future comparisons will use mapped player history when available. Alts are not guessed automatically.";
    }
    return "Default comparison mode set to character. Future comparisons will match exact character history unless a command overrides it.";
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

    const defaultGameFamily = getStringOption(
        interaction.data?.options,
        "game_family",
    );
    const rawCompareMode = getStringOption(
        interaction.data?.options,
        "compare_mode",
    );
    const compareModeDefault =
        rawCompareMode === undefined ? undefined : parseCompareMode(rawCompareMode);

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

    const updateObject: Parameters<
        HandleOptions["guildConfigStore"]["saveGuildConfig"]
    >[1] = {};
    const parsedGameFamily = parseGameFamilyOption(defaultGameFamily);
    if (parsedGameFamily) updateObject.defaultGameFamily = parsedGameFamily;
    if (compareModeDefault) updateObject.compareModeDefault = compareModeDefault;
    const saved = await options.guildConfigStore.saveGuildConfig(guildId, updateObject);

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: getCompareModeResponse(saved.compareModeDefault),
            flags: 64,
        },
    };
};

import { InteractionResponseType } from "discord-interactions";
import type { DiscordInteraction, HandleOptions } from "../types.js";

const getStringOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
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

    const configUpdate = {
        defaultGameFamily: getStringOption(interaction.data?.options, "game_family"),
        compareModeDefault: getStringOption(interaction.data?.options, "compare_mode"),
    };

    const updateObject = Object.fromEntries(
        Object.entries(configUpdate).filter(([, value]) => typeof value === "string"),
    );
    const saved = await options.guildConfigStore.saveGuildConfig(guildId, updateObject);

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: `Config saved for guild ${guildId}: game_family=${saved.defaultGameFamily}, compare_mode=${saved.compareModeDefault}`,
            flags: 64,
        },
    };
};

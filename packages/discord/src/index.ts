export type {
    ChatInputCommandDefinition,
    CommandDefinition,
    DiscordCommandOption,
    DiscordCommandOptionChoice,
    MessageCommandDefinition,
    UserCommandDefinition,
} from "./infrastructure/command-registration.js";

export type { AutoRecapSendableChannel } from "./commands/auto-recap.js";
export type { RecapPreviewStateService } from "./types.js";

export {
    buildDiscordCommandPayload,
    buildDiscordCommandPayloads,
    commandDefinitions,
    DiscordCommandRegistrationError,
    registerGlobalCommands,
    registerGuildCommands,
} from "./infrastructure/command-registration.js";

export { handleInteraction } from "./infrastructure/interaction-handler.js";
export {
    handleAutoRecapMessageCreate,
    makeAutoRecapDuplicateCustomId,
    makeAutoRecapPromptIgnoreCustomId,
    makeAutoRecapPromptPreviewCustomId,
} from "./commands/auto-recap.js";
export { buildPublicRecapEmbed, buildRecapPreviewBody } from "./renderers/embeds.js";

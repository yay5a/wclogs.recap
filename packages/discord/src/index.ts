export type {
    ChatInputCommandDefinition,
    CommandDefinition,
    DiscordCommandOption,
    DiscordCommandOptionChoice,
    MessageCommandDefinition,
    UserCommandDefinition,
} from "./infrastructure/command-registration.js";

export type { AutoReportSendableChannel } from "./commands/auto-report.js";
export type {
    AutoReportDuplicateTrackingService,
    AutoReportPromptStateService,
    CharacterClaimStore,
    CharacterClaimRecord,
    ComparisonHistoryStore,
    HandleOptions,
} from "./types.js";

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
    handleAutoReportMessageCreate,
    makeAutoReportDuplicateCustomId,
    makeAutoReportPromptIgnoreCustomId,
    makeAutoReportPromptPreviewCustomId,
} from "./commands/auto-report.js";
export { REPORT_RUNTIME_FINGERPRINT } from "./commands/report.js";
export { buildReportResponseBody } from "./renderers/report.js";
export { buildGuildRankResponseBody } from "./renderers/guildrank.js";

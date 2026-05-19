export type {
  DiscordCommandOption,
  DiscordCommandOptionChoice,
} from './infrastructure/command-registration.js';

export type { AutoReportSendableChannel } from './commands/auto-report.js';
export type {
  AutoReportDuplicateTrackingService,
  AutoReportPromptStateService,
  CharacterClaimStore,
  CharacterClaimRecord,
  HandleOptions,
} from './types.js';

export {
  buildDiscordCommandPayload,
  buildDiscordCommandPayloads,
  commandDefinitions,
  DiscordCommandRegistrationError,
  registerGlobalCommands,
  registerGuildCommands,
} from './infrastructure/command-registration.js';

export { handleInteraction } from './infrastructure/interaction-handler.js';
export { hasDiscordPermission } from './discord-permissions.js';
export type { DiscordPermissionName } from './discord-permissions.js';
export {
  handleAutoReportMessageCreate,
  makeAutoReportDuplicateCustomId,
  makeAutoReportPromptIgnoreCustomId,
  makeAutoReportPromptPreviewCustomId,
} from './commands/auto-report.js';
export { REPORT_RUNTIME_FINGERPRINT } from './commands/report.js';
export { buildReportResponseBody } from './renderers/report.js';
export { buildGuildRankResponseBody } from './renderers/guildrank.js';

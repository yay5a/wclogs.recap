import { createLogger } from '@wcl/shared';
import { AUTO_REPORT_MODES, COMPARE_ACCESS_MODES, COMPARE_MODES } from '@wcl/domain';
import { discordApiRequest, getDiscordApiBaseUrl } from './discord-api.js';

const logger = createLogger('discord');
const STRING_OPTION_TYPE = 3;
const INTEGER_OPTION_TYPE = 4;
const BOOLEAN_OPTION_TYPE = 5;
const USER_OPTION_TYPE = 6;
const CHANNEL_OPTION_TYPE = 7;
const NUMBER_OPTION_TYPE = 10;
const GUILD_TEXT_CHANNEL_TYPE = 0;
const GUILD_ANNOUNCEMENT_CHANNEL_TYPE = 5;
const slashCommandNameRegex = /^[\p{Ll}\p{N}_-]{1,32}$/u;

export interface DiscordCommandOptionChoice {
  name: string;
  value: string | number;
}
export interface DiscordCommandOption {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  choices?: DiscordCommandOptionChoice[];
  options?: DiscordCommandOption[];
  channel_types?: number[];
}
export type SlashCommandDefinition = {
  type: 1;
  name: string;
  description: string;
  options?: DiscordCommandOption[];
  integration_types?: number[];
  contexts?: number[];
  default_member_permissions?: string;
  nsfw?: boolean;
};

const compareModeChoices = COMPARE_MODES.map((mode) => ({ name: mode, value: mode }));
const autoReportModeChoices = AUTO_REPORT_MODES.map((mode) => ({ name: mode, value: mode }));
const compareAccessModeChoices = COMPARE_ACCESS_MODES.map((mode) => ({ name: mode, value: mode }));
const guildRankDifficultyChoices = [
  { name: 'normal', value: 'normal' },
  { name: 'heroic', value: 'heroic' },
];
const guildRankSizeChoices = [
  { name: '10man', value: '10man' },
  { name: '25man', value: '25man' },
];
const validateCommandNameUniqueness = (commands: SlashCommandDefinition[]) => {
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.name))
      throw new Error(
        `Command validation failed for '${command.name}': duplicate command name '${command.name}'.`,
      );
    seen.add(command.name);
  }
};
const validateOptionChoices = (
  commandName: string,
  option: DiscordCommandOption,
  optionPath: string,
): void => {
  if (!option.choices?.length) return;
  if (
    !new Set<number>([STRING_OPTION_TYPE, INTEGER_OPTION_TYPE, NUMBER_OPTION_TYPE]).has(option.type)
  )
    throw new Error(
      `Command validation failed for '${commandName}' at '${optionPath}': choices are only valid for STRING, INTEGER, or NUMBER options.`,
    );
  for (const choice of option.choices) {
    if (option.type === STRING_OPTION_TYPE && typeof choice.value !== 'string')
      throw new Error(
        `Command validation failed for '${commandName}' at '${optionPath}': STRING option choices must have string values.`,
      );
    if (
      (option.type === INTEGER_OPTION_TYPE || option.type === NUMBER_OPTION_TYPE) &&
      typeof choice.value !== 'number'
    )
      throw new Error(
        `Command validation failed for '${commandName}' at '${optionPath}': numeric option choices must have number values.`,
      );
  }
};
const validateAndNormalizeOptions = (
  commandName: string,
  options: DiscordCommandOption[],
  path = 'options',
): DiscordCommandOption[] => {
  const seenNames = new Set<string>();
  let foundOptional = false;
  for (const [index, option] of options.entries()) {
    const optionPath = `${path}[${index}]`;
    if (!option.name)
      throw new Error(
        `Command validation failed for '${commandName}' at '${optionPath}': option name is required.`,
      );
    if (seenNames.has(option.name))
      throw new Error(
        `Command validation failed for '${commandName}' at '${optionPath}': duplicate option name '${option.name}'.`,
      );
    seenNames.add(option.name);
    if (option.required === true) {
      if (foundOptional)
        throw new Error(
          `Command validation failed for '${commandName}' at '${optionPath}': required options must appear before optional options.`,
        );
    } else {
      foundOptional = true;
    }
    validateOptionChoices(commandName, option, optionPath);
    if (Array.isArray(option.options) && option.options.length > 0)
      option.options = validateAndNormalizeOptions(
        commandName,
        option.options,
        `${optionPath}.options`,
      );
  }
  return options;
};
const validateCommandDefinition = (command: SlashCommandDefinition): void => {
  if (!command.name || command.name.trim().length === 0)
    throw new Error('Command validation failed: command name is required.');
  if (!slashCommandNameRegex.test(command.name))
    throw new Error(
      `Command validation failed for '${command.name}': slash command names must be lowercase and use [a-z0-9_-] style characters.`,
    );
  if (!command.description || command.description.trim().length === 0)
    throw new Error(
      `Command validation failed for '${command.name}': description is required for chat input commands.`,
    );
  if (command.options) command.options = validateAndNormalizeOptions(command.name, command.options);
};

export const buildDiscordCommandPayload = (
  command: SlashCommandDefinition,
): Record<string, unknown> => {
  validateCommandDefinition(command);
  const basePayload = {
    name: command.name,
    type: command.type,
    integration_types: command.integration_types,
    contexts: command.contexts,
    default_member_permissions: command.default_member_permissions,
    nsfw: command.nsfw,
  };
  return {
    ...basePayload,
    description: command.description,
    ...(command.options ? { options: command.options } : {}),
  };
};
export const buildDiscordCommandPayloads = (
  commands: SlashCommandDefinition[],
): Record<string, unknown>[] => {
  validateCommandNameUniqueness(commands);
  return commands.map(buildDiscordCommandPayload);
};

export const commandDefinitions: SlashCommandDefinition[] = [
  { name: 'health', description: 'Check bot health', type: 1 },
  {
    name: 'config',
    description: 'Configure guild report behavior',
    type: 1,
    default_member_permissions: '48',
    options: [
      {
        name: 'game_family',
        description: 'Default game family',
        type: 3,
        required: false,
        choices: [
          { name: 'retail', value: 'retail' },
          { name: 'mop_classic', value: 'mop_classic' },
        ],
      },
      {
        name: 'compare_mode',
        description: 'Default compare mode',
        type: 3,
        required: false,
        choices: compareModeChoices,
      },
      {
        name: 'compare_access_mode',
        description: 'Who can view private comparison cards',
        type: STRING_OPTION_TYPE,
        required: false,
        choices: compareAccessModeChoices,
      },
      {
        name: 'compare_public_posting',
        description: 'Enable explicit public compare posting safeguards',
        type: BOOLEAN_OPTION_TYPE,
        required: false,
      },
      {
        name: 'auto_report_mode',
        description: 'Passive WCL URL handling mode',
        type: STRING_OPTION_TYPE,
        required: false,
        choices: autoReportModeChoices,
      },
      {
        name: 'auto_report_channel',
        description: 'Toggle a channel for passive WCL URL detection',
        type: CHANNEL_OPTION_TYPE,
        required: false,
        channel_types: [GUILD_TEXT_CHANNEL_TYPE, GUILD_ANNOUNCEMENT_CHANNEL_TYPE],
      },
      {
        name: 'wcl_guild_name',
        description: 'WCL guild name for /guildrank',
        type: STRING_OPTION_TYPE,
        required: false,
      },
      {
        name: 'wcl_guild_server_name',
        description: 'WCL server name for /guildrank',
        type: STRING_OPTION_TYPE,
        required: false,
      },
      {
        name: 'wcl_guild_server_region',
        description: 'WCL server region for /guildrank',
        type: STRING_OPTION_TYPE,
        required: false,
      },
      {
        name: 'wcl_zone_id',
        description: 'WCL zone ID for /guildrank',
        type: INTEGER_OPTION_TYPE,
        required: false,
      },
    ],
  },
  {
    name: 'add_officer',
    description: 'Add an explicit officer user',
    type: 1,
    default_member_permissions: '48',
    options: [
      {
        name: 'user',
        description: 'Discord user to authorize as an officer',
        type: USER_OPTION_TYPE,
        required: true,
      },
    ],
  },
  {
    name: 'remove_officer',
    description: 'Remove an explicit officer user',
    type: 1,
    default_member_permissions: '48',
    options: [
      {
        name: 'user',
        description: 'Discord user to remove from officer authorization',
        type: USER_OPTION_TYPE,
        required: true,
      },
    ],
  },
  { name: 'list_officers', description: 'List explicit officer users', type: 1 },
  {
    name: 'report',
    description: 'Summarize a Warcraft Logs raid-night report',
    type: 1,
    options: [
      {
        name: 'wcl_report_url',
        description: 'Warcraft Logs report URL',
        type: STRING_OPTION_TYPE,
        required: true,
      },
    ],
  },
  {
    name: 'guildrank',
    description: 'Summarize guild rank progress, speed, and execution',
    type: 1,
    options: [
      {
        name: 'difficulty',
        description: 'Raid difficulty',
        type: STRING_OPTION_TYPE,
        required: true,
        choices: guildRankDifficultyChoices,
      },
      {
        name: 'size',
        description: 'Raid size',
        type: STRING_OPTION_TYPE,
        required: true,
        choices: guildRankSizeChoices,
      },
      {
        name: 'partition',
        description: 'current, all, or a partition number',
        type: STRING_OPTION_TYPE,
        required: false,
      },
    ],
  },
  {
    name: 'claim_character',
    description: 'Request officer approval for one character claim',
    type: 1,
    options: [
      {
        name: 'character',
        description: 'Character name',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      {
        name: 'realm',
        description: 'Character realm/server',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      { name: 'region', description: 'Character region', type: STRING_OPTION_TYPE, required: true },
    ],
  },
  {
    name: 'approve_character',
    description: 'Approve a member character claim',
    type: 1,
    options: [
      {
        name: 'user',
        description: 'Discord user who owns the character',
        type: USER_OPTION_TYPE,
        required: true,
      },
      {
        name: 'character',
        description: 'Character name',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      {
        name: 'realm',
        description: 'Character realm/server',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      { name: 'region', description: 'Character region', type: STRING_OPTION_TYPE, required: true },
    ],
  },
  {
    name: 'reject_character',
    description: 'Reject a pending character claim',
    type: 1,
    options: [
      {
        name: 'user',
        description: 'Discord user who requested the character',
        type: USER_OPTION_TYPE,
        required: true,
      },
      {
        name: 'character',
        description: 'Character name',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      {
        name: 'realm',
        description: 'Character realm/server',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      { name: 'region', description: 'Character region', type: STRING_OPTION_TYPE, required: true },
    ],
  },
  { name: 'my_characters', description: 'List your character claims', type: 1 },
  {
    name: 'compare_privacy',
    description: 'Update comparison privacy for an approved character claim',
    type: 1,
    options: [
      {
        name: 'character',
        description: 'Character name',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      {
        name: 'realm',
        description: 'Character realm/server',
        type: STRING_OPTION_TYPE,
        required: true,
      },
      { name: 'region', description: 'Character region', type: STRING_OPTION_TYPE, required: true },
      {
        name: 'peer_compare',
        description: 'Allow or deny guild peer private comparisons',
        type: STRING_OPTION_TYPE,
        required: true,
        choices: [
          { name: 'private', value: 'private' },
          { name: 'allow_guild', value: 'allow_guild' },
        ],
      },
      {
        name: 'public_post',
        description: 'Allow or deny public posting safeguards for this character',
        type: STRING_OPTION_TYPE,
        required: true,
        choices: [
          { name: 'deny', value: 'deny' },
          { name: 'allow', value: 'allow' },
        ],
      },
    ],
  },
];

export class DiscordCommandRegistrationError extends Error {
  constructor(
    message: string,
    readonly details: {
      status: number;
      statusText: string;
      responseBody: string;
      targetScope: 'global' | 'guild';
      payloadSnippet: string;
      remediation?: string;
    },
  ) {
    super(message);
    this.name = 'DiscordCommandRegistrationError';
  }
}

const getRegistrationRemediation = (status: number): string | undefined => {
  if (status !== 401) return undefined;
  return "Discord rejected DISCORD_BOT_TOKEN. Use the raw bot token for the same DISCORD_APPLICATION_ID, without a 'Bot ' prefix.";
};

const registerCommandSet = async (
  botToken: string,
  targetScope: 'global' | 'guild',
  endpoint: string,
  guildId?: string,
): Promise<void> => {
  const payload = buildDiscordCommandPayloads(commandDefinitions);
  logger.info(
    {
      guildId: guildId ?? null,
      payloadCount: payload.length,
      commands: payload.map((command) => ({ name: command.name, type: command.type })),
    },
    'registering Discord commands',
  );
  const response = await discordApiRequest({
    endpoint,
    method: 'PUT',
    route:
      targetScope === 'global'
        ? '/applications/{applicationId}/commands'
        : '/applications/{applicationId}/guilds/{guildId}/commands',
    botToken,
    body: payload,
  });
  const text = await response.text();
  if (!response.ok) {
    const payloadSnippet = JSON.stringify(
      payload.map(({ name, type, description, options }) => ({
        name,
        type,
        ...(description ? { description } : {}),
        ...(options ? { options } : {}),
      })),
    ).slice(0, 2000);
    const remediation = getRegistrationRemediation(response.status);
    const details = {
      status: response.status,
      statusText: response.statusText,
      responseBody: text,
      targetScope,
      payloadSnippet,
      ...(remediation ? { remediation } : {}),
    };
    throw new DiscordCommandRegistrationError(
      `Discord command registration failed (${targetScope}): ${response.status} ${response.statusText}`,
      details,
    );
  }
};

export const registerGlobalCommands = async (appId: string, botToken: string): Promise<void> =>
  registerCommandSet(
    botToken,
    'global',
    `${getDiscordApiBaseUrl()}/applications/${appId}/commands`,
  );
export const registerGuildCommands = async (
  appId: string,
  botToken: string,
  guildId: string,
): Promise<void> => {
  const normalizedGuildId = guildId.trim();
  if (!normalizedGuildId)
    throw new Error(
      'Command validation failed: guildId is required for guild command registration.',
    );
  return registerCommandSet(
    botToken,
    'guild',
    `${getDiscordApiBaseUrl()}/applications/${appId}/guilds/${normalizedGuildId}/commands`,
    normalizedGuildId,
  );
};

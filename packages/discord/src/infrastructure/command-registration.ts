import { createLogger } from "@wcl/shared";
import { discordApiRequest, getDiscordApiBaseUrl } from "./discord-api.js";

const logger = createLogger("discord");
const STRING_OPTION_TYPE = 3;
const INTEGER_OPTION_TYPE = 4;
const NUMBER_OPTION_TYPE = 10;
const slashCommandNameRegex = /^[\p{Ll}\p{N}_-]{1,32}$/u;

export interface DiscordCommandOptionChoice { name: string; value: string | number; }
export interface DiscordCommandOption {
    type: number;
    name: string;
    description?: string;
    required?: boolean;
    choices?: DiscordCommandOptionChoice[];
    options?: DiscordCommandOption[];
}
export type ChatInputCommandDefinition = { type: 1; name: string; description: string; options?: DiscordCommandOption[]; integration_types?: number[]; contexts?: number[]; default_member_permissions?: string; nsfw?: boolean; };
export type UserCommandDefinition = { type: 2; name: string; integration_types?: number[]; contexts?: number[]; default_member_permissions?: string; nsfw?: boolean; };
export type MessageCommandDefinition = { type: 3; name: string; integration_types?: number[]; contexts?: number[]; default_member_permissions?: string; nsfw?: boolean; };
export type CommandDefinition = ChatInputCommandDefinition | UserCommandDefinition | MessageCommandDefinition;

const commandTypeLabel = (type: CommandDefinition["type"]): string => (type === 1 ? "CHAT_INPUT" : type === 2 ? "USER" : "MESSAGE");
const validateCommandNameUniqueness = (commands: CommandDefinition[]) => {
    const seen = new Set<string>();
    for (const command of commands) {
        const key = `${command.type}:${command.name}`;
        if (seen.has(key)) throw new Error(`Command validation failed for '${command.name}': duplicate command name '${command.name}' for type ${command.type}.`);
        seen.add(key);
    }
};
const validateOptionChoices = (commandName: string, option: DiscordCommandOption, optionPath: string): void => {
    if (!option.choices?.length) return;
    if (!new Set<number>([STRING_OPTION_TYPE, INTEGER_OPTION_TYPE, NUMBER_OPTION_TYPE]).has(option.type)) throw new Error(`Command validation failed for '${commandName}' at '${optionPath}': choices are only valid for STRING, INTEGER, or NUMBER options.`);
    for (const choice of option.choices) {
        if (option.type === STRING_OPTION_TYPE && typeof choice.value !== "string") throw new Error(`Command validation failed for '${commandName}' at '${optionPath}': STRING option choices must have string values.`);
        if ((option.type === INTEGER_OPTION_TYPE || option.type === NUMBER_OPTION_TYPE) && typeof choice.value !== "number") throw new Error(`Command validation failed for '${commandName}' at '${optionPath}': numeric option choices must have number values.`);
    }
};
const validateAndNormalizeOptions = (commandName: string, options: DiscordCommandOption[], path = "options"): DiscordCommandOption[] => {
    const seenNames = new Set<string>();
    let foundOptional = false;
    for (const [index, option] of options.entries()) {
        const optionPath = `${path}[${index}]`;
        if (!option.name) throw new Error(`Command validation failed for '${commandName}' at '${optionPath}': option name is required.`);
        if (seenNames.has(option.name)) throw new Error(`Command validation failed for '${commandName}' at '${optionPath}': duplicate option name '${option.name}'.`);
        seenNames.add(option.name);
        if (option.required === true) { if (foundOptional) throw new Error(`Command validation failed for '${commandName}' at '${optionPath}': required options must appear before optional options.`); } else { foundOptional = true; }
        validateOptionChoices(commandName, option, optionPath);
        if (Array.isArray(option.options) && option.options.length > 0) option.options = validateAndNormalizeOptions(commandName, option.options, `${optionPath}.options`);
    }
    return options;
};
const validateCommandDefinition = (command: CommandDefinition): void => {
    if (!command.name || command.name.trim().length === 0) throw new Error("Command validation failed: command name is required.");
    if (command.type === 1) {
        if (!slashCommandNameRegex.test(command.name)) throw new Error(`Command validation failed for '${command.name}': slash command names must be lowercase and use [a-z0-9_-] style characters.`);
        if (!command.description || command.description.trim().length === 0) throw new Error(`Command validation failed for '${command.name}': description is required for chat input commands.`);
        if (command.options) command.options = validateAndNormalizeOptions(command.name, command.options);
        return;
    }
    if ("description" in (command as unknown as Record<string, unknown>) && typeof (command as unknown as { description?: unknown }).description !== "undefined") throw new Error(`Command validation failed for '${command.name}': description is not allowed for ${commandTypeLabel(command.type)} commands.`);
    if ("options" in (command as unknown as Record<string, unknown>) && Array.isArray((command as unknown as { options?: unknown }).options)) throw new Error(`Command validation failed for '${command.name}': options are not allowed for ${commandTypeLabel(command.type)} commands.`);
};

export const buildDiscordCommandPayload = (command: CommandDefinition): Record<string, unknown> => {
    validateCommandDefinition(command);
    const basePayload = { name: command.name, type: command.type, integration_types: command.integration_types, contexts: command.contexts, default_member_permissions: command.default_member_permissions, nsfw: command.nsfw };
    return command.type === 1 ? { ...basePayload, description: command.description, ...(command.options ? { options: command.options } : {}) } : basePayload;
};
export const buildDiscordCommandPayloads = (commands: CommandDefinition[]): Record<string, unknown>[] => { validateCommandNameUniqueness(commands); return commands.map(buildDiscordCommandPayload); };

export const commandDefinitions: CommandDefinition[] = [
    { name: "health", description: "Check bot health", type: 1 },
    { name: "config", description: "Configure guild recap behavior", type: 1, options: [
        { name: "game_family", description: "Default game family", type: 3, required: false, choices: [{ name: "retail", value: "retail" }, { name: "mop_classic", value: "mop_classic" }] },
        { name: "compare_mode", description: "Default compare mode", type: 3, required: false, choices: [{ name: "character", value: "character" }, { name: "mixed", value: "mixed" }] },
    ]},
    { name: "recap", description: "Generate a recap preview from a WCL report URL", type: 1, options: [{ name: "url", description: "WCL report URL", type: 3, required: true }] },
];

export class DiscordCommandRegistrationError extends Error {
    constructor(message: string, readonly details: { status: number; statusText: string; responseBody: string; targetScope: "global" | "guild"; payloadSnippet: string; remediation?: string; }) { super(message); this.name = "DiscordCommandRegistrationError"; }
}

const getRegistrationRemediation = (status: number): string | undefined => {
    if (status !== 401) return undefined;
    return "Discord rejected DISCORD_BOT_TOKEN. Use the raw bot token for the same DISCORD_APPLICATION_ID, without a 'Bot ' prefix.";
};

const registerCommandSet = async (appId: string, botToken: string, targetScope: "global" | "guild", endpoint: string, guildId?: string): Promise<void> => {
    const payload = buildDiscordCommandPayloads(commandDefinitions);
    logger.info({ guildId: guildId ?? null, payloadCount: payload.length, commands: payload.map((command) => ({ name: command.name, type: command.type })) }, "registering Discord commands");
    const response = await discordApiRequest({ endpoint, method: "PUT", route: targetScope === "global" ? "/applications/{applicationId}/commands" : "/applications/{applicationId}/guilds/{guildId}/commands", botToken, body: payload });
    const text = await response.text();
    if (!response.ok) {
        const payloadSnippet = JSON.stringify(payload.map(({ name, type, description, options }) => ({ name, type, ...(description ? { description } : {}), ...(options ? { options } : {}) }))).slice(0, 2000);
        const remediation = getRegistrationRemediation(response.status);
        const details = { status: response.status, statusText: response.statusText, responseBody: text, targetScope, payloadSnippet, ...(remediation ? { remediation } : {}) };
        throw new DiscordCommandRegistrationError(`Discord command registration failed (${targetScope}): ${response.status} ${response.statusText}`, details);
    }
};

export const registerGlobalCommands = async (appId: string, botToken: string): Promise<void> => registerCommandSet(appId, botToken, "global", `${getDiscordApiBaseUrl()}/applications/${appId}/commands`);
export const registerGuildCommands = async (appId: string, botToken: string, guildId: string): Promise<void> => {
    const normalizedGuildId = guildId.trim();
    if (!normalizedGuildId) throw new Error("Command validation failed: guildId is required for guild command registration.");
    return registerCommandSet(appId, botToken, "guild", `${getDiscordApiBaseUrl()}/applications/${appId}/guilds/${normalizedGuildId}/commands`, normalizedGuildId);
};

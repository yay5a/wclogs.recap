import {
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
} from 'discord-interactions';
import type {
  AccountabilityVisibility,
  CoachingShareability,
  ComparisonMode,
  GameFamily,
  GuildConfigInput,
  GuildConfigStore,
  RecapPostMode,
} from '@wcl/domain';
import { buildRecapSummary } from '@wcl/domain';
import type { WclClient } from '@wcl/wcl-client';

interface HandleOptions {
  wclClient: WclClient;
  guildConfigStore: GuildConfigStore;
}

interface InteractionOption {
  name: string;
  value?: string;
  options?: InteractionOption[];
}

interface AppCommandInteraction {
  type: InteractionType.APPLICATION_COMMAND;
  guild_id?: string;
  data: {
    name: string;
    options?: InteractionOption[];
  };
}

interface MessageComponentInteraction {
  type: InteractionType.MESSAGE_COMPONENT;
  guild_id?: string;
  data: {
    custom_id: string;
  };
}

const previewCustomId = 'post_recap';

const isAppCommandInteraction = (value: unknown): value is AppCommandInteraction => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const data = input.data as Record<string, unknown> | undefined;
  return input.type === InteractionType.APPLICATION_COMMAND && typeof data?.name === 'string';
};

const isMessageComponentInteraction = (value: unknown): value is MessageComponentInteraction => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const data = input.data as Record<string, unknown> | undefined;
  return input.type === InteractionType.MESSAGE_COMPONENT && typeof data?.custom_id === 'string';
};

const getNestedOption = (
  options: InteractionOption[] | undefined,
  groupName: string,
  optionName: string,
): string | undefined => {
  const group = options?.find((o) => o.name === groupName);
  const selected = group?.options?.find((o) => o.name === optionName);
  return typeof selected?.value === 'string' ? selected.value : undefined;
};

const getOption = (options: InteractionOption[] | undefined, name: string): string | undefined => {
  const selected = options?.find((o) => o.name === name);
  return typeof selected?.value === 'string' ? selected.value : undefined;
};

export const registerCommands = async (appId: string, botToken: string): Promise<void> => {
  const commands = [
    { name: 'health', description: 'Check bot health', type: 1 },
    {
      name: 'config',
      description: 'Configure guild recap behavior',
      type: 1,
      options: [
        {
          name: 'game_family',
          description: 'Default game family for this guild',
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
          choices: [
            { name: 'character', value: 'character' },
            { name: 'account', value: 'account' },
            { name: 'mixed', value: 'mixed' },
          ],
        },
        {
          name: 'visibility',
          description: 'Set accountability visibility',
          type: 3,
          required: false,
          choices: [
            { name: 'off', value: 'off' },
            { name: 'officers-only', value: 'officers-only' },
            { name: 'shareable', value: 'shareable' },
          ],
        },
        {
          name: 'coaching_shareability',
          description: 'Default coaching shareability',
          type: 3,
          required: false,
          choices: [
            { name: 'officers-only', value: 'officers-only' },
            { name: 'shareable', value: 'shareable' },
          ],
        },
        {
          name: 'recap_post_mode',
          description: 'Default recap posting mode',
          type: 3,
          required: false,
          choices: [
            { name: 'allow-post', value: 'allow-post' },
            { name: 'preview-only', value: 'preview-only' },
          ],
        },
      ],
    },
    {
      name: 'report',
      description: 'Report tools',
      type: 1,
      options: [
        {
          name: 'recap',
          description: 'Generate a recap preview from a WCL report URL',
          type: 1,
          options: [{ name: 'url', description: 'WCL report URL', type: 3, required: true }],
        },
      ],
    },
    { name: 'Analyze Log', type: 3 },
  ];

  await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
};

const formatConfigSaved = (payload: GuildConfigInput): string => {
  const fragments: string[] = [];
  if (payload.defaultGameFamily) fragments.push(`game_family=${payload.defaultGameFamily}`);
  if (payload.compareModeDefault) fragments.push(`compare_mode=${payload.compareModeDefault}`);
  if (payload.accountabilityVisibility) fragments.push(`visibility=${payload.accountabilityVisibility}`);
  if (payload.coachingShareabilityDefault) {
    fragments.push(`coaching_shareability=${payload.coachingShareabilityDefault}`);
  }
  if (payload.recapPostModeDefault) fragments.push(`recap_post_mode=${payload.recapPostModeDefault}`);
  return fragments.length > 0
    ? `Config saved: ${fragments.join(', ')}`
    : 'No changes provided. Existing config remains unchanged.';
};

export const handleInteraction = async (
  interaction: unknown,
  options: HandleOptions,
): Promise<Record<string, unknown>> => {
  if (
    typeof interaction === 'object' &&
    interaction !== null &&
    (interaction as { type?: number }).type === InteractionType.PING
  ) {
    return { type: InteractionResponseType.PONG };
  }

  if (isAppCommandInteraction(interaction)) {
    if (interaction.data.name === 'health') {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'OK', flags: 64 },
      };
    }

    if (interaction.data.name === 'config') {
      if (!interaction.guild_id) {
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '/config only works in a guild.', flags: 64 },
        };
      }

      const payload: GuildConfigInput = {};

      const gameFamily = getOption(interaction.data.options, 'game_family') as GameFamily | undefined;
      const compareMode = getOption(interaction.data.options, 'compare_mode') as ComparisonMode | undefined;
      const visibility = getOption(interaction.data.options, 'visibility') as AccountabilityVisibility | undefined;
      const coachingShareability = getOption(interaction.data.options, 'coaching_shareability') as
        | CoachingShareability
        | undefined;
      const recapPostMode = getOption(interaction.data.options, 'recap_post_mode') as RecapPostMode | undefined;

      if (gameFamily) payload.defaultGameFamily = gameFamily;
      if (compareMode) payload.compareModeDefault = compareMode;
      if (visibility) payload.accountabilityVisibility = visibility;
      if (coachingShareability) payload.coachingShareabilityDefault = coachingShareability;
      if (recapPostMode) payload.recapPostModeDefault = recapPostMode;

      await options.guildConfigStore.saveGuildConfig(interaction.guild_id, payload);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: formatConfigSaved(payload),
          flags: 64,
        },
      };
    }

    if (interaction.data.name === 'Analyze Log') {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Use /report recap <url> to analyze this log.', flags: 64 },
      };
    }

    if (interaction.data.name === 'report') {
      const url = getNestedOption(interaction.data.options, 'recap', 'url');
      if (!url) {
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Missing URL', flags: 64 },
        };
      }

      const report = await options.wclClient.fetchAndNormalizeReport(url, interaction.guild_id);
      const previous = interaction.guild_id
        ? await options.wclClient.findPreviousRaidSummaries(
            interaction.guild_id,
            new Date(report.startTime),
            report.gameFamily,
          )
        : [];

      const summary = buildRecapSummary(report, previous);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: 64,
          embeds: [buildPublicRecapEmbed(summary)],
          components: [
            {
              type: 1,
              components: [
                {
                  type: MessageComponentTypes.BUTTON,
                  style: 1,
                  custom_id: `${previewCustomId}:${report.reportCode}:${encodeURIComponent(url)}`,
                  label: 'Post Recap',
                },
              ],
            },
          ],
        },
      };
    }
  }

  if (isMessageComponentInteraction(interaction)) {
    const id = interaction.data.custom_id;
    if (id.startsWith(previewCustomId)) {
      const [, , encodedUrl] = id.split(':');
      if (!encodedUrl) {
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: 'Could not recover report URL from preview state.', flags: 64 },
        };
      }

      const url = decodeURIComponent(encodedUrl);
      const report = await options.wclClient.fetchAndNormalizeReport(url, interaction.guild_id);
      const previous = interaction.guild_id
        ? await options.wclClient.findPreviousRaidSummaries(
            interaction.guild_id,
            new Date(report.startTime),
            report.gameFamily,
          )
        : [];
      const summary = buildRecapSummary(report, previous);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [buildPublicRecapEmbed(summary)],
        },
      };
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unsupported interaction in MVP.', flags: 64 },
  };
};

export const buildPublicRecapEmbed = (summary: ReturnType<typeof buildRecapSummary>) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Report Date', value: summary.reportDateISO, inline: true },
    { name: 'Game Family', value: summary.gameFamily, inline: true },
    { name: 'Bosses Killed', value: String(summary.bossesKilled), inline: true },
  ];
  if (summary.zoneName) fields.push({ name: 'Raid/Zone', value: summary.zoneName, inline: true });
  if (summary.bestSingleBossParse)
    fields.push({
      name: 'Best Single-Boss Parse',
      value: `${summary.bestSingleBossParse.playerName} (${summary.bestSingleBossParse.value.toFixed(1)})`,
    });
  if (summary.bestAverageParse)
    fields.push({
      name: 'Best Average Parse',
      value: `${summary.bestAverageParse.playerName} (${summary.bestAverageParse.value.toFixed(1)})`,
    });
  if (summary.bestExecution)
    fields.push({
      name: 'Best Execution',
      value: `${summary.bestExecution.playerName} (${summary.bestExecution.value.toFixed(1)})`,
    });
  if (summary.mostImprovedPlayer)
    fields.push({
      name: 'Most Improved',
      value: `${summary.mostImprovedPlayer.playerName} (+${summary.mostImprovedPlayer.delta.toFixed(1)})`,
    });

  fields.push({ name: 'Team Note', value: summary.teamNote });

  return {
    title: summary.reportTitle,
    fields,
  };
};

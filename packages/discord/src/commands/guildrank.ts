import { InteractionResponseType } from 'discord-interactions';
import { createLogger, serializeError } from '@wcl/shared';
import type { DiscordInteraction, HandleOptions } from '../types.js';
import {
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import { buildGuildRankResponseBody } from '../renderers/guildrank.js';
import { getInteractionDiscordUserId } from './report.js';

const logger = createLogger('discord');
const EPHEMERAL_MESSAGE_FLAG = 64;

const getStringOption = (options: unknown, name: string): string | undefined => {
  if (!Array.isArray(options)) return undefined;
  const found = options.find(
    (option) =>
      typeof option === 'object' && option !== null && (option as { name?: unknown }).name === name,
  ) as { value?: unknown } | undefined;
  return typeof found?.value === 'string' ? found.value : undefined;
};

export const processGuildRankInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
): Promise<void> => {
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;
  const guildId = interaction.guild_id;

  if (!applicationId || !interactionToken || !guildId) return;

  const difficulty = getStringOption(interaction.data?.options, 'difficulty');
  const size = getStringOption(interaction.data?.options, 'size');

  if (!difficulty || !size) {
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      flags: EPHEMERAL_MESSAGE_FLAG,
      content: 'Missing required difficulty or size.',
    });
    return;
  }

  try {
    const guildConfig = await options.guildConfigStore.getGuildConfig(guildId);
    if (
      !guildConfig.wclGuildName ||
      !guildConfig.wclGuildServerSlug ||
      !guildConfig.wclGuildServerRegion ||
      typeof guildConfig.wclZoneId !== 'number'
    ) {
      await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
        flags: EPHEMERAL_MESSAGE_FLAG,
        content:
          'Missing /guildrank WCL target config. Set wcl_guild_name, wcl_guild_server_slug, wcl_guild_server_region, and wcl_zone_id in /config.',
      });
      return;
    }

    const discordUserId = getInteractionDiscordUserId(interaction);
    const summary = await options.wclClient.fetchGuildRankSummary(
      {
        guildName: guildConfig.wclGuildName,
        guildServerSlug: guildConfig.wclGuildServerSlug,
        guildServerRegion: guildConfig.wclGuildServerRegion,
        zoneId: guildConfig.wclZoneId,
        difficulty,
        size,
      },
      discordUserId ? { discordUserId } : undefined,
    );

    await editOriginalInteractionResponse(
      applicationId,
      interactionToken,
      buildGuildRankResponseBody(summary),
    );
  } catch (error) {
    logger.error(
      { guildId, interactionId: interaction.id, error: serializeError(error) },
      'guildrank processing failed',
    );
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      flags: EPHEMERAL_MESSAGE_FLAG,
      content: 'Could not build guild rankings right now. Verify /config WCL target values and try again.',
    });
  }
};

export const handleGuildRankCommand = (
  interaction: DiscordInteraction,
  options: HandleOptions,
): unknown => {
  const backgroundTask = () => {
    void processGuildRankInteraction(interaction, options);
  };
  if (options.scheduleBackgroundTask) {
    options.scheduleBackgroundTask(backgroundTask);
  } else {
    queueMicrotask(backgroundTask);
  }

  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL_MESSAGE_FLAG },
  };
};

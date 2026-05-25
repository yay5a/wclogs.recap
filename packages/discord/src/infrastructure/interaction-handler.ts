import { InteractionResponseType, InteractionType } from 'discord-interactions';
import { createLogger } from '@wcl/shared';
import type { HandleOptions } from '../types.js';
import {
  handleApproveCharacterCommand,
  handleClaimCharacterCommand,
  handleComparePrivacyCommand,
  handleMyCharactersCommand,
  handleRejectCharacterCommand,
} from '../commands/character-claims.js';
import { handleConfigCommand } from '../commands/config.js';
import {
  handleAddOfficerCommand,
  handleListOfficersCommand,
  handleRemoveOfficerCommand,
} from '../commands/officer-management.js';
import { handleAutoReportComponentInteraction } from '../commands/auto-report.js';
import { handleGuildRankCommand } from '../commands/guildrank.js';
import { processReportInteraction } from '../commands/report.js';

const logger = createLogger('discord');
const EPHEMERAL_MESSAGE_FLAG = 64;

export const handleInteraction = async (
  interaction: unknown,
  options: HandleOptions,
): Promise<unknown> => {
  const typedInteraction = interaction as import('../types.js').DiscordInteraction;

  if (typedInteraction.type === InteractionType.PING) {
    return { type: InteractionResponseType.PONG };
  }

  if (typedInteraction.type === InteractionType.APPLICATION_COMMAND) {
    if (typedInteraction.data?.name === 'health') {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'OK', flags: EPHEMERAL_MESSAGE_FLAG },
      };
    }

    if (typedInteraction.data?.name === 'config') {
      return handleConfigCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'add_officer') {
      return handleAddOfficerCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'remove_officer') {
      return handleRemoveOfficerCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'list_officers') {
      return handleListOfficersCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'claim_character') {
      return handleClaimCharacterCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'approve_character') {
      return handleApproveCharacterCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'reject_character') {
      return handleRejectCharacterCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'my_characters') {
      return handleMyCharactersCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'compare_privacy') {
      return handleComparePrivacyCommand(typedInteraction, options);
    }

    if (typedInteraction.data?.name === 'report') {
      const url = getStringCommandOption(typedInteraction.data.options, 'wcl_report_url');
      logger.info(
        { interactionId: typedInteraction.id, rawUrl: url ?? null },
        'report url received',
      );
      if (!url || typeof url !== 'string') {
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Missing URL',
            flags: EPHEMERAL_MESSAGE_FLAG,
          },
        };
      }

      const backgroundTask = () => {
        void processReportInteraction(typedInteraction, options, url);
      };
      if (options.scheduleBackgroundTask) {
        options.scheduleBackgroundTask(backgroundTask);
      } else {
        queueMicrotask(backgroundTask);
      }
      return {
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      };
    }

    if (typedInteraction.data?.name === 'guildrank') {
      return handleGuildRankCommand(typedInteraction, options);
    }
  }

  if (typedInteraction.type === InteractionType.MESSAGE_COMPONENT) {
    const autoReportResponse = await handleAutoReportComponentInteraction(
      typedInteraction,
      options,
    );
    if (autoReportResponse) {
      return autoReportResponse;
    }
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: 'Unsupported interaction.', flags: 64 },
  };
};

const getStringCommandOption = (options: unknown, name: string): string | undefined => {
  if (!Array.isArray(options)) return undefined;
  const found = options.find(
    (option) =>
      typeof option === 'object' && option !== null && (option as { name?: unknown }).name === name,
  ) as { value?: unknown } | undefined;
  return typeof found?.value === 'string' ? found.value : undefined;
};

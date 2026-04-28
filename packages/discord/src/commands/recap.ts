import { createLogger } from '@wcl/shared';
import { buildRecapSummary } from '@wcl/domain';
import type { DiscordInteraction, HandleOptions, SavePreviewStateInput } from '../types.js';
import {
  buildPublicRecapEmbed,
  buildRecapPreviewBody,
  parseRecapComponentCustomId,
} from '../renderers/embeds.js';
import {
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';

const logger = createLogger('discord');
const DEFAULT_PREVIEW_STATE_TTL_SECONDS = 900;
const EPHEMERAL_MESSAGE_FLAG = 64;
const POST_RECAP_ACTION = 'post';
const CANCEL_RECAP_ACTION = 'cancel';

const toDurationMs = (startedAt: number): number => Date.now() - startedAt;
const logRecapStep = (interactionId: string | undefined, step: string, startedAt: number) => {
  logger.info({ interactionId, step, durationMs: toDurationMs(startedAt) }, 'recap step complete');
};

export const processRecapInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
  url: string,
): Promise<void> => {
  const previewStateTtlMs =
    (options.previewStateTtlSeconds ?? DEFAULT_PREVIEW_STATE_TTL_SECONDS) * 1000;
  const interactionId = interaction.id;
  const guildId = interaction.guild_id ?? 'dm';
  const channelId = interaction.channel_id ?? 'unknown';
  const createdByUserId = interaction.member?.user?.id ?? interaction.user?.id ?? 'unknown';
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;

  if (!applicationId || !interactionToken) {
    logger.error(
      {
        interactionId,
        applicationIdPresent: Boolean(applicationId),
        tokenPresent: Boolean(interactionToken),
      },
      'recap missing application id or token',
    );
    return;
  }

  try {
    const guildConfigStart = Date.now();
    const guildConfig = await options.guildConfigStore.getGuildConfig(guildId);
    logRecapStep(interactionId, 'guild_config_load', guildConfigStart);

    const reportFetchStart = Date.now();
    const report = await options.wclClient.fetchAndNormalizeReport(url);
    logRecapStep(interactionId, 'report_fetch_normalize', reportFetchStart);

    const previousLookupStart = Date.now();
    const previousPlayers = options.wclClient.findPreviousRaidSummaries
      ? await options.wclClient.findPreviousRaidSummaries(guildId, new Date(report.startTime))
      : [];
    logRecapStep(interactionId, 'previous_raid_summary_lookup', previousLookupStart);

    const summaryBuildStart = Date.now();
    const summary = buildRecapSummary(report, previousPlayers, { guildConfig });
    logRecapStep(interactionId, 'summary_build', summaryBuildStart);

    const createdAt = new Date();
    const previewStateInput: SavePreviewStateInput = {
      guildId,
      channelId,
      reportCode: report.reportCode,
      sourceUrl: url,
      summaryPayload: summary,
      createdByUserId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + previewStateTtlMs),
      ...(interactionId ? { interactionId } : {}),
    };
    await options.recapPreviewStateService.savePreviewState(previewStateInput);

    const editStart = Date.now();
    await editOriginalInteractionResponse(
      applicationId,
      interactionToken,
      buildRecapPreviewBody(summary, report.reportCode, guildId),
    );
    logRecapStep(interactionId, 'original_response_edit', editStart);
  } catch (error) {
    logger.error({ error, interactionId, guildId }, 'recap processing failed');
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
    const userFacingContent = errorMessage.includes('report code')
      ? "I couldn't find a Warcraft Logs report code in that URL. Paste the full report link."
      : 'Could not build recap preview for that report. Please verify the URL and try again.';
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      flags: EPHEMERAL_MESSAGE_FLAG,
      content: userFacingContent,
    });
  }
};

export const handleRecapComponentInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
): Promise<unknown | undefined> => {
  const id = interaction.data?.custom_id;
  if (typeof id !== 'string') return undefined;
  const parsedCustomId = parseRecapComponentCustomId(id);
  if (!parsedCustomId) {
    return { type: 4, data: { content: 'Unsupported interaction.', flags: 64 } };
  }

  const { action, reportCode, guildId } = parsedCustomId;

  if (action == CANCEL_RECAP_ACTION) {
    await options.recapPreviewStateService.deletePreviewState({ reportCode, guildId });
    return { type: 4, data: { content: 'Preview was cancelled, nothing was posted.', flags: 64 } };
  }

  if (action !== POST_RECAP_ACTION) {
    return { type: 4, data: { content: 'Unsupported recap action.', flags: 64 } };
  }

  const previewState = await options.recapPreviewStateService.consumeValidPreviewState({
    reportCode,
    guildId,
  });
  if (!previewState) {
    logger.info(
      {
        action: 'recap.post.consume_preview_state_noop',
        guildId,
        reportCode,
        interactionId: interaction.id,
      },
      'recap post ignored because preview state was already consumed or expired',
    );
    return {
      type: 4,
      data: {
        content:
          'This recap preview has already been posted or expired. Please run /recap with the URL again.',
        flags: 64,
      },
    };
  }

  return { type: 4, data: { embeds: [buildPublicRecapEmbed(previewState.summaryPayload)] } };
};

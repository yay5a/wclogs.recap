import { createLogger, serializeError } from '@wcl/shared';
import { buildRecapSummary, extractComparisonSnapshots } from '@wcl/domain';
import type { NormalizedReport } from '@wcl/domain';
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

const persistComparisonSnapshotsForReport = async ({
  guildId,
  interactionId,
  report,
  options,
}: {
  guildId: string;
  interactionId?: string;
  report: NormalizedReport;
  options: HandleOptions;
}): Promise<void> => {
  const comparisonHistoryStore = options.comparisonHistoryStore;
  if (!comparisonHistoryStore) return;

  try {
    const extraction = extractComparisonSnapshots({ guildId, report });

    if (extraction.issues.length > 0) {
      logger.debug(
        {
          interactionId,
          guildId,
          reportCode: report.reportCode,
          issueCount: extraction.issues.length,
          issues: extraction.issues,
        },
        'comparison snapshot extraction skipped participants',
      );
    }

    if (extraction.snapshots.length === 0) {
      logger.info(
        { interactionId, guildId, reportCode: report.reportCode },
        'comparison snapshot extraction produced no snapshots',
      );
      return;
    }

    const saveResults = await Promise.allSettled(
      extraction.snapshots.map(async (snapshot) =>
        comparisonHistoryStore.saveComparisonSnapshot(snapshot),
      ),
    );

    const rejectedResults = saveResults.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ error: result.reason, snapshot: extraction.snapshots[index] }]
        : [],
    );

    if (rejectedResults.length > 0) {
      for (const rejected of rejectedResults) {
        logger.error(
          {
            interactionId,
            guildId,
            reportCode: report.reportCode,
            participantKey: rejected.snapshot?.participantKey,
            error: serializeError(rejected.error),
          },
          'comparison snapshot persistence failed',
        );
      }
    }

    logger.debug(
      {
        interactionId,
        guildId,
        reportCode: report.reportCode,
        snapshotCount: extraction.snapshots.length,
        savedCount: saveResults.length - rejectedResults.length,
        failedCount: rejectedResults.length,
      },
      'comparison snapshot persistence completed',
    );
  } catch (error) {
    logger.error(
      { interactionId, guildId, reportCode: report.reportCode, error: serializeError(error) },
      'comparison snapshot persistence skipped after unexpected error',
    );
  }
};

export const getRecapFailureMessage = (error: unknown): string => {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
  if (errorMessage.includes('report code')) {
    return "I couldn't find a Warcraft Logs report code in that URL. Paste the full report link.";
  }
  if (errorMessage.includes('wcl oauth failed') || errorMessage.includes('missing wcl auth')) {
    return 'Warcraft Logs authentication failed; check server configuration.';
  }
  if (errorMessage.includes('unexpected wcl payload shape')) {
    return 'Warcraft Logs returned an unexpected payload for that report.';
  }
  return 'Could not build recap preview for that report. Please verify the URL and try again.';
};

interface RecapArtifact {
  report: NormalizedReport;
  summary: ReturnType<typeof buildRecapSummary>;
  previewBody: ReturnType<typeof buildRecapPreviewBody>;
  publicEmbed: ReturnType<typeof buildPublicRecapEmbed>;
  previewStateInputBase: Omit<SavePreviewStateInput, 'createdAt' | 'expiresAt'>;
}

export const buildRecapArtifact = async ({
  guildId,
  channelId,
  createdByUserId,
  interactionId,
  options,
  url,
}: {
  guildId: string;
  channelId: string;
  createdByUserId: string;
  interactionId?: string;
  options: HandleOptions;
  url: string;
}): Promise<RecapArtifact> => {
  const guildConfigStart = Date.now();
  const guildConfig = await options.guildConfigStore.getGuildConfig(guildId);
  logRecapStep(interactionId, 'guild_config_load', guildConfigStart);

  const reportFetchStart = Date.now();
  const report = await options.wclClient.fetchAndNormalizeReport(url);
  logRecapStep(interactionId, 'report_fetch_normalize', reportFetchStart);

  const comparisonSnapshotStart = Date.now();
  await persistComparisonSnapshotsForReport({
    guildId,
    ...(interactionId ? { interactionId } : {}),
    report,
    options,
  });
  logRecapStep(interactionId, 'comparison_snapshot_persist', comparisonSnapshotStart);

  const previousLookupStart = Date.now();
  const previousPlayers = options.wclClient.findPreviousRaidSummaries
    ? await options.wclClient.findPreviousRaidSummaries(guildId, new Date(report.startTime))
    : [];
  logRecapStep(interactionId, 'previous_raid_summary_lookup', previousLookupStart);

  const summaryBuildStart = Date.now();
  const summary = buildRecapSummary(report, previousPlayers, { guildConfig });
  logRecapStep(interactionId, 'summary_build', summaryBuildStart);

  return {
    report,
    summary,
    previewBody: buildRecapPreviewBody(summary, report.reportCode, guildId, channelId),
    publicEmbed: buildPublicRecapEmbed(summary),
    previewStateInputBase: {
      guildId,
      channelId,
      reportCode: report.reportCode,
      sourceUrl: url,
      summaryPayload: summary,
      createdByUserId,
      ...(interactionId ? { interactionId } : {}),
    },
  };
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
    const artifact = await buildRecapArtifact({
      guildId,
      channelId,
      createdByUserId,
      ...(interactionId ? { interactionId } : {}),
      options,
      url,
    });

    const createdAt = new Date();
    const previewStateInput: SavePreviewStateInput = {
      ...artifact.previewStateInputBase,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + previewStateTtlMs),
    };
    await options.recapPreviewStateService.savePreviewState(previewStateInput);

    const editStart = Date.now();
    await editOriginalInteractionResponse(
      applicationId,
      interactionToken,
      artifact.previewBody,
    );
    logRecapStep(interactionId, 'original_response_edit', editStart);
  } catch (error) {
    logger.error({ error: serializeError(error), interactionId, guildId }, 'recap processing failed');
    const userFacingContent = getRecapFailureMessage(error);
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
  if (action !== POST_RECAP_ACTION && action !== CANCEL_RECAP_ACTION) {
    return { type: 4, data: { content: 'Unsupported recap action.', flags: 64 } };
  }

  const channelId = parsedCustomId.channelId ?? interaction.channel_id;
  if (!channelId) {
    return {
      type: 4,
      data: {
        content:
          'This recap preview has already been posted or expired. Please run /recap with the URL again.',
        flags: 64,
      },
    };
  }

  if (action == CANCEL_RECAP_ACTION) {
    await options.recapPreviewStateService.deletePreviewState({ reportCode, guildId, channelId });
    return { type: 4, data: { content: 'Preview was cancelled, nothing was posted.', flags: 64 } };
  }

  const previewState = await options.recapPreviewStateService.consumeValidPreviewState({
    reportCode,
    guildId,
    channelId,
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

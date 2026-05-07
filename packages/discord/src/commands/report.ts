import { buildReportSummary, extractComparisonSnapshots } from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
import type { NormalizedReport } from '@wcl/domain';
import type { DiscordInteraction, HandleOptions } from '../types.js';
import {
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import { buildReportResponseBody } from '../renderers/report.js';

const logger = createLogger('discord');
const EPHEMERAL_MESSAGE_FLAG = 64;

const toDurationMs = (startedAt: number): number => Date.now() - startedAt;

const logReportStep = (interactionId: string | undefined, step: string, startedAt: number) => {
  logger.info({ interactionId, step, durationMs: toDurationMs(startedAt) }, 'report step complete');
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

export const getReportFailureMessage = (error: unknown): string => {
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
  return 'Could not build a report summary for that Warcraft Logs report. Please verify the URL and try again.';
};

export const buildReportArtifact = async ({
  guildId,
  interactionId,
  options,
  url,
}: {
  guildId: string;
  interactionId?: string;
  options: HandleOptions;
  url: string;
}) => {
  const reportFetchStart = Date.now();
  const report = await options.wclClient.fetchAndNormalizeReport(url);
  logReportStep(interactionId, 'report_fetch_normalize', reportFetchStart);

  const comparisonSnapshotStart = Date.now();
  await persistComparisonSnapshotsForReport({
    guildId,
    ...(interactionId ? { interactionId } : {}),
    report,
    options,
  });
  logReportStep(interactionId, 'comparison_snapshot_persist', comparisonSnapshotStart);

  const summaryBuildStart = Date.now();
  const summary = buildReportSummary(report);
  logReportStep(interactionId, 'summary_build', summaryBuildStart);

  return {
    report,
    summary,
    responseBody: buildReportResponseBody(summary),
    publicBody: buildReportResponseBody(summary, { ephemeral: false }),
  };
};

export const processReportInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
  url: string,
): Promise<void> => {
  const interactionId = interaction.id;
  const guildId = interaction.guild_id ?? 'dm';
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;

  if (!applicationId || !interactionToken) {
    logger.error(
      {
        interactionId,
        applicationIdPresent: Boolean(applicationId),
        tokenPresent: Boolean(interactionToken),
      },
      'report missing application id or token',
    );
    return;
  }

  try {
    const artifact = await buildReportArtifact({
      guildId,
      ...(interactionId ? { interactionId } : {}),
      options,
      url,
    });

    const editStart = Date.now();
    await editOriginalInteractionResponse(
      applicationId,
      interactionToken,
      artifact.responseBody,
    );
    logReportStep(interactionId, 'original_response_edit', editStart);
  } catch (error) {
    logger.error({ error: serializeError(error), interactionId, guildId }, 'report processing failed');
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      flags: EPHEMERAL_MESSAGE_FLAG,
      content: getReportFailureMessage(error),
    });
  }
};

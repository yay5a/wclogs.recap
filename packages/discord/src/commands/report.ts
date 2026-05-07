import { buildReportSummary, extractComparisonSnapshots } from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
import { WclReportFetchError } from '@wcl/wcl-client';
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

export const serializeReportFetchFailureForLog = (
  error: unknown,
): ReturnType<typeof serializeError> | Record<string, unknown> => {
  if (!(error instanceof WclReportFetchError)) return serializeError(error);
  return {
    name: error.name,
    category: error.category,
    reportCode: error.reportCode,
    authMode: error.authMode,
    ...(typeof error.status === 'number' ? { status: error.status } : {}),
  };
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
      {
        interactionId,
        guildId,
        reportCode: report.reportCode,
        error: serializeReportFetchFailureForLog(error),
      },
      'comparison snapshot persistence skipped after unexpected error',
    );
  }
};

export const getReportFailureMessage = (error: unknown): string => {
  if (error instanceof WclReportFetchError) {
    switch (error.category) {
      case 'private_or_auth_required':
      case 'missing_linked_auth':
        return 'This report may require Warcraft Logs authorization. Link your Warcraft Logs account from the dashboard, then try again.';
      case 'expired_linked_auth':
      case 'linked_auth_unreadable':
        return 'Your Warcraft Logs authorization has expired. Re-link Warcraft Logs from the dashboard, then try again.';
      case 'user_auth_rejected':
        return 'Warcraft Logs rejected your linked authorization for this report. Re-link Warcraft Logs from the dashboard, then try again.';
      case 'public_report_not_found':
        return 'I could not find that Warcraft Logs report. Verify the URL and try again.';
      case 'wcl_rate_limit':
        return 'Warcraft Logs is rate limiting requests right now. Try again later.';
      case 'network_failure':
        return 'Warcraft Logs could not be reached right now. Try again later.';
      case 'archived_report':
        return 'That Warcraft Logs report appears to be archived or inaccessible.';
      case 'malformed_wcl_response':
        return 'Warcraft Logs returned an unexpected payload for that report.';
      case 'wcl_auth_failed':
        return 'Warcraft Logs authentication failed; check server configuration.';
      case 'unknown':
      default:
        return 'Could not build a report summary for that Warcraft Logs report. Please verify the URL and try again.';
    }
  }
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
  discordUserId,
  guildId,
  interactionId,
  options,
  url,
}: {
  discordUserId?: string;
  guildId: string;
  interactionId?: string;
  options: HandleOptions;
  url: string;
}) => {
  const reportFetchStart = Date.now();
  const report = await options.wclClient.fetchAndNormalizeReport(
    url,
    discordUserId ? { discordUserId } : undefined,
  );
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
    const discordUserId = getInteractionDiscordUserId(interaction);
    const artifact = await buildReportArtifact({
      ...(discordUserId ? { discordUserId } : {}),
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
    logger.error(
      { error: serializeReportFetchFailureForLog(error), interactionId, guildId },
      'report processing failed',
    );
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      flags: EPHEMERAL_MESSAGE_FLAG,
      content: getReportFailureMessage(error),
    });
  }
};

export const getInteractionDiscordUserId = (
  interaction: DiscordInteraction,
): string | undefined => interaction.member?.user?.id ?? interaction.user?.id;

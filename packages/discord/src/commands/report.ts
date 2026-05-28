import { createLogger, serializeError } from '@wcl/shared';
import { WclReportFetchError } from '@wcl/wcl-client';
import type { DiscordInteraction, HandleOptions } from '../types.js';
import {
  type DiscordMessageBody,
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import { buildReportMessageFlags, buildReportV2ResponseBody } from '../renderers/report.js';
import { InteractionResponseType } from 'discord-interactions';
import {
  isReportEncounterCustomIdCandidate,
  parseReportEncounterCustomId,
} from './report-encounter-custom-id.js';
import { EPHEMERAL_MESSAGE_FLAG, IS_COMPONENTS_V2_MESSAGE_FLAG } from '../renderers/report.js';

const logger = createLogger('discord');
const DISCORD_PACKAGE_ID = '@wcl/discord@0.1.0';
export const REPORT_RUNTIME_FINGERPRINT = 'render-fingerprint: report-runtime-canary-2026-05-14-A';
export type ReportRenderPath = 'slash-command' | 'passive-detection' | 'auto-post' | 'preview-post';

export const reportPathFingerprint = (path: ReportRenderPath): string => `report-path: ${path}`;

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

  return 'Could not build a report summary for that Warcraft Logs report. Please verify the URL and try again.';
};

export const buildReportArtifact = async ({
  discordUserId,
  guildId: _guildId,
  logContext = {},
  options,
  reportPath,
  url,
}: {
  discordUserId?: string;
  guildId?: string;
  logContext?: Record<string, unknown>;
  options: HandleOptions;
  reportPath: ReportRenderPath;
  url: string;
}) => {
  const summary = await options.wclClient.fetchReportSummary(
    url,
    discordUserId ? { discordUserId } : undefined,
  );
  const runtime = {
    fingerprint: REPORT_RUNTIME_FINGERPRINT,
    pathFingerprint: reportPathFingerprint(reportPath),
    reportPath,
    packageId: DISCORD_PACKAGE_ID,
    buildReportResponseBodyCalled: true as const,
  };
  const resolvedLogContext = { ...(_guildId ? { guildId: _guildId } : {}), ...logContext };

  logger.info(
    {
      ...resolvedLogContext,
      reportRuntimeFingerprint: runtime.fingerprint,
      reportPath: runtime.reportPath,
      reportPathFingerprint: runtime.pathFingerprint,
      cwd: process.cwd(),
      packageId: runtime.packageId,
      buildReportResponseBodyCalled: runtime.buildReportResponseBodyCalled,
    },
    'report runtime fingerprint',
  );

  const publicBody = await buildReportV2ResponseBody(summary, { ephemeral: false });
  const responseBody: DiscordMessageBody = {
    ...publicBody,
    flags: (publicBody.flags ?? 0) | buildReportMessageFlags({ ephemeral: true }),
  };

  return {
    summary,
    responseBody,
    publicBody,
    runtime,
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
      logContext: { interactionId, guildId },
      options,
      reportPath: 'slash-command',
      url,
    });
    await editOriginalInteractionResponse(applicationId, interactionToken, artifact.publicBody);
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

export const getInteractionDiscordUserId = (interaction: DiscordInteraction): string | undefined =>
  interaction.member?.user?.id ?? interaction.user?.id;

export const handleReportEncounterComponentInteraction = (
  interaction: DiscordInteraction,
): unknown | undefined => {
  const customId = interaction.data?.custom_id;

  if (!isReportEncounterCustomIdCandidate(customId)) {
    return undefined;
  }

  const parsed = parseReportEncounterCustomId(customId);

  const message = parsed.ok
    ? interaction.guild_id
      ? [
          '## Encounter Breakdown',
          '',
          'Encounter details coming soon',
          '',
          `Report: \`${parsed.reportCode}\``,
          `Encounter ID: \${parsed.encounterId}\``,
        ].join('\n')
      : 'Encounter details are only available inside a Discord server.'
    : 'That encounter button is no longer valid';

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: EPHEMERAL_MESSAGE_FLAG | IS_COMPONENTS_V2_MESSAGE_FLAG,
      allowed_mentions: { parse: [] },
      components: [
        {
          type: 17,
          accent_color: 0x7d3cff,
          components: [
            {
              type: 10,
              content: message,
            },
          ],
        },
      ],
    },
  };
};

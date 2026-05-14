import { createLogger, serializeError } from '@wcl/shared';
import { WclReportFetchError } from '@wcl/wcl-client';
import type { DiscordInteraction, HandleOptions } from '../types.js';
import {
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import { buildReportResponseBody } from '../renderers/report.js';

const logger = createLogger('discord');
const EPHEMERAL_MESSAGE_FLAG = 64;
const DISCORD_PACKAGE_ID = '@wcl/discord@0.1.0';
export const REPORT_RUNTIME_FINGERPRINT = 'render-fingerprint: report-runtime-canary-2026-05-14-A';

type ResponseEmbedField = { name?: string; value?: string };
type ResponseEmbed = { fields?: ResponseEmbedField[]; footer?: { text?: string } };
type ResponseBodyWithEmbeds = { embeds?: ResponseEmbed[] };

const injectReportRuntimeFingerprint = <TBody>(body: TBody): TBody => {
  const typedBody = body as unknown as ResponseBodyWithEmbeds;
  const embeds = Array.isArray(typedBody.embeds) ? typedBody.embeds : [];
  const primaryEmbed = embeds[0];
  if (!primaryEmbed) return body;

  const fields = Array.isArray(primaryEmbed.fields) ? primaryEmbed.fields : [];
  const dataSourceField = fields.find((field) => field.name === 'Data & Source');
  if (dataSourceField && typeof dataSourceField.value === 'string') {
    if (!dataSourceField.value.includes(REPORT_RUNTIME_FINGERPRINT)) {
      dataSourceField.value = `${dataSourceField.value}\n${REPORT_RUNTIME_FINGERPRINT}`;
    }
    return body;
  }

  const footerText = primaryEmbed.footer?.text ?? '';
  if (footerText.includes(REPORT_RUNTIME_FINGERPRINT)) return body;
  primaryEmbed.footer = {
    text: footerText ? `${footerText} | ${REPORT_RUNTIME_FINGERPRINT}` : REPORT_RUNTIME_FINGERPRINT,
  };
  return body;
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
  options,
  url,
}: {
  discordUserId?: string;
  guildId?: string;
  options: HandleOptions;
  url: string;
}) => {
  const summary = await options.wclClient.fetchReportSummary(
    url,
    discordUserId ? { discordUserId } : undefined,
  );

  return {
    summary,
    responseBody: injectReportRuntimeFingerprint(buildReportResponseBody(summary)),
    publicBody: injectReportRuntimeFingerprint(buildReportResponseBody(summary, { ephemeral: false })),
    runtime: {
      fingerprint: REPORT_RUNTIME_FINGERPRINT,
      packageId: DISCORD_PACKAGE_ID,
      buildReportResponseBodyCalled: true as const,
    },
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
      options,
      url,
    });
    const responseBody = injectReportRuntimeFingerprint(artifact.responseBody);
    logger.info(
      {
        interactionId,
        guildId,
        reportRuntimeFingerprint: artifact.runtime.fingerprint,
        cwd: process.cwd(),
        packageId: artifact.runtime.packageId,
        buildReportResponseBodyCalled: artifact.runtime.buildReportResponseBodyCalled,
      },
      'report runtime fingerprint',
    );
    await editOriginalInteractionResponse(applicationId, interactionToken, responseBody);
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

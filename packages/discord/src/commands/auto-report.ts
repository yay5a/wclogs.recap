import { InteractionResponseType } from 'discord-interactions';
import { createLogger, serializeError } from '@wcl/shared';
import { parseReportUrl } from '@wcl/wcl-client';
import type { ParsedReportUrl } from '@wcl/wcl-client';
import { randomUUID } from 'node:crypto';
import type {
  AutoReportDuplicateTrackingRecord,
  DiscordInteraction,
  HandleOptions,
} from '../types.js';
import {
  buildReportArtifact,
  getInteractionDiscordUserId,
  getReportFailureMessage,
  serializeReportFetchFailureForLog,
} from './report.js';
import {
  createFollowupInteractionResponse,
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import { recordDashboardActivityAfterSuccess } from './dashboard-activity.js';

const logger = createLogger('discord');
const EPHEMERAL_MESSAGE_FLAG = 64;
const PROMPT_PREVIEW_PREFIX = 'ar:p:';
const PROMPT_IGNORE_PREFIX = 'ar:i:';
const DUPLICATE_PREFIX = 'ar:d:';
const PROMPT_EXPIRED_MESSAGE =
  'This auto report prompt has expired. Paste the Warcraft Logs URL again if you still want a report summary.';
const AUTO_REPORT_UNAVAILABLE_MESSAGE =
  'Auto report is temporarily unavailable. Please try again later.';
const SAFE_ALLOWED_MENTIONS = { parse: [] as string[] };
const DEFAULT_DUPLICATE_TTL_MS = 15 * 60 * 1000;

type AutoReportComponent =
  | { action: 'prompt_preview'; sourceMessageId: string }
  | { action: 'prompt_ignore'; sourceMessageId: string }
  | { action: 'duplicate_preview'; confirmationNonce: string }
  | { action: 'duplicate_try'; confirmationNonce: string }
  | { action: 'duplicate_post'; confirmationNonce: string }
  | { action: 'duplicate_ignore'; confirmationNonce: string };

interface AutoReportInboundMessage {
  guildId?: string | null;
  channelId: string;
  messageId: string;
  authorId: string;
  authorBot?: boolean;
  content?: string | null;
}

export interface AutoReportSendableChannel {
  send(body: Record<string, unknown>): Promise<{ id: string }>;
}

interface AutoReportFailureThrottle {
  shouldPostFailure(key: string, ttlMs: number): boolean;
}

interface AutoReportMessageCreateOptions {
  message: AutoReportInboundMessage;
  channel: AutoReportSendableChannel | null;
  handleOptions: HandleOptions;
  duplicateTtlMs?: number;
  failureTtlMs?: number;
  failureThrottle?: AutoReportFailureThrottle;
}

export const makeAutoReportPromptPreviewCustomId = (sourceMessageId: string): string =>
  `${PROMPT_PREVIEW_PREFIX}${sourceMessageId}`;

export const makeAutoReportPromptIgnoreCustomId = (sourceMessageId: string): string =>
  `${PROMPT_IGNORE_PREFIX}${sourceMessageId}`;

export const makeAutoReportDuplicateCustomId = (
  action: 'p' | 't' | 'o' | 'i',
  confirmationNonce: string,
): string => `${DUPLICATE_PREFIX}${action}:${confirmationNonce}`;

export const parseAutoReportComponentCustomId = (
  customId: string,
): AutoReportComponent | undefined => {
  if (customId.startsWith(PROMPT_PREVIEW_PREFIX)) {
    const sourceMessageId = customId.slice(PROMPT_PREVIEW_PREFIX.length);
    return sourceMessageId ? { action: 'prompt_preview', sourceMessageId } : undefined;
  }
  if (customId.startsWith(PROMPT_IGNORE_PREFIX)) {
    const sourceMessageId = customId.slice(PROMPT_IGNORE_PREFIX.length);
    return sourceMessageId ? { action: 'prompt_ignore', sourceMessageId } : undefined;
  }
  if (customId.startsWith(DUPLICATE_PREFIX)) {
    const [, , action, confirmationNonce] = customId.split(':');
    if (!confirmationNonce) return undefined;
    if (action === 'p') return { action: 'duplicate_preview', confirmationNonce };
    if (action === 't') return { action: 'duplicate_try', confirmationNonce };
    if (action === 'o') return { action: 'duplicate_post', confirmationNonce };
    if (action === 'i') return { action: 'duplicate_ignore', confirmationNonce };
  }
  return undefined;
};

const stripUrlCandidate = (candidate: string): string =>
  candidate
    .trim()
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .replace(/[)\].,!?;:]+$/u, '');

const isSupportedWarcraftLogsHost = (hostname: string): boolean => {
  const lowerHost = hostname.toLowerCase();
  return lowerHost === 'www.warcraftlogs.com' || lowerHost === 'classic.warcraftlogs.com';
};

export const extractFirstWarcraftLogsReportUrl = (content: string): ParsedReportUrl | null => {
  const candidates = content.match(/https?:\/\/[^\s<>\]]+/giu) ?? [];
  for (const rawCandidate of candidates) {
    const candidate = stripUrlCandidate(rawCandidate);
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (!isSupportedWarcraftLogsHost(url.hostname)) continue;
    try {
      return parseReportUrl(candidate);
    } catch {
      continue;
    }
  }
  return null;
};

export const buildAutoReportPromptBody = (sourceMessageId: string) => ({
  content: 'Detected a Warcraft Logs report.\nGenerate a report summary?',
  allowed_mentions: SAFE_ALLOWED_MENTIONS,
  components: [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          custom_id: makeAutoReportPromptPreviewCustomId(sourceMessageId),
          label: 'Preview report',
        },
        {
          type: 2,
          style: 2,
          custom_id: makeAutoReportPromptIgnoreCustomId(sourceMessageId),
          label: 'Ignore',
        },
      ],
    },
  ],
});

const toPublicReportBody = (body: Record<string, unknown>): Record<string, unknown> => ({
  ...body,
  allowed_mentions: SAFE_ALLOWED_MENTIONS,
});

const statusMessage = (status: string): string => {
  switch (status) {
    case 'preview_posted':
      return 'A preview for this Warcraft Logs report was already posted here recently.';
    case 'final_posted':
      return 'A report summary for this Warcraft Logs report was already posted here recently.';
    case 'ignored':
      return 'This Warcraft Logs report was recently ignored here.';
    case 'failed':
      return 'This Warcraft Logs report recently failed to process.';
    case 'processing':
      return 'This Warcraft Logs report is already being processed here.';
    case 'prompted':
    default:
      return 'This Warcraft Logs report was already detected here recently.';
  }
};

const duplicateActionsForStatus = (
  status: string,
): Array<{ label: string; action: 'p' | 't' | 'o' | 'i'; style: number }> => {
  if (status === 'final_posted') {
    return [
      { label: 'Post again', action: 'o', style: 1 },
      { label: 'Ignore', action: 'i', style: 2 },
    ];
  }
  if (status === 'ignored' || status === 'failed') {
    return [
      { label: 'Try again', action: 't', style: 1 },
      { label: 'Ignore', action: 'i', style: 2 },
    ];
  }
  return [
    { label: 'Preview again', action: 'p', style: 1 },
    { label: 'Ignore', action: 'i', style: 2 },
  ];
};

const buildDuplicateConfirmationBody = (status: string, confirmationNonce: string) => ({
  content: statusMessage(status),
  allowed_mentions: SAFE_ALLOWED_MENTIONS,
  components: [
    {
      type: 1,
      components: duplicateActionsForStatus(status).map((action) => ({
        type: 2,
        style: action.style,
        custom_id: makeAutoReportDuplicateCustomId(action.action, confirmationNonce),
        label: action.label,
      })),
    },
  ],
});

const isDuplicateComponent = (
  component: AutoReportComponent,
): component is Extract<AutoReportComponent, { confirmationNonce: string }> =>
  'confirmationNonce' in component;

const getRequesterDiscordUserId = (interaction: DiscordInteraction): string =>
  interaction.member?.user?.id ?? interaction.user?.id ?? 'unknown';

const getRequesterDiscordUserIdOrFallback = (
  interaction: DiscordInteraction,
  fallback?: string,
): string | undefined => getInteractionDiscordUserId(interaction) ?? fallback;

const autoReportUnavailableResponse = (
  interaction: DiscordInteraction,
  details: Record<string, unknown>,
): unknown => {
  logger.error(
    {
      interactionId: interaction.id,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      ...details,
    },
    'auto report component configuration error',
  );
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: AUTO_REPORT_UNAVAILABLE_MESSAGE,
      flags: EPHEMERAL_MESSAGE_FLAG,
    },
  };
};

const runPromptPreview = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
  sourceMessageId: string,
): Promise<void> => {
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;
  if (!applicationId || !interactionToken) return;

  try {
    const promptState =
      await options.autoReportPromptStateService?.getValidPromptState(sourceMessageId);
    if (!promptState) {
      await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
        content: PROMPT_EXPIRED_MESSAGE,
        flags: EPHEMERAL_MESSAGE_FLAG,
      });
      return;
    }

    const discordUserId = getRequesterDiscordUserIdOrFallback(
      interaction,
      promptState.sourceAuthorId,
    );
    const artifact = await buildReportArtifact({
      ...(discordUserId ? { discordUserId } : {}),
      guildId: promptState.guildId,
      logContext: {
        interactionId: interaction.id,
        guildId: promptState.guildId,
        channelId: promptState.channelId,
        sourceMessageId,
      },
      options,
      reportPath: 'preview-post',
      url: promptState.sourceUrl,
    });
    await editOriginalInteractionResponse(applicationId, interactionToken, artifact.responseBody);
    await recordDashboardActivityAfterSuccess(options.botActivityStore, {
      guildId: promptState.guildId,
      channelId: promptState.channelId,
      sourceMessageId: interaction.id,
      actor: { kind: 'discord', discordUserId: getRequesterDiscordUserId(interaction) },
      kind: 'report_preview_created',
      reportCode: promptState.reportCode,
      sourceUrl: promptState.sourceUrl,
      idempotencyKey: interaction.id ? `report_prompt_preview:${interaction.id}` : undefined,
      createdAt: new Date(),
    });
  } catch (error) {
    logger.error(
      {
        interactionId: interaction.id,
        sourceMessageId,
        error: serializeReportFetchFailureForLog(error),
      },
      'auto report prompt preview failed',
    );
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      content: getReportFailureMessage(error),
      flags: EPHEMERAL_MESSAGE_FLAG,
    });
  }
};

const scheduleTask = (options: HandleOptions, task: () => void): void => {
  if (options.scheduleBackgroundTask) {
    options.scheduleBackgroundTask(task);
    return;
  }
  queueMicrotask(task);
};

const runDuplicatePreview = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
  confirmationNonce: string,
  postPublicly: boolean,
): Promise<void> => {
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;
  if (!applicationId || !interactionToken) return;

  try {
    const duplicateState =
      await options.autoReportDuplicateTrackingService?.getByConfirmationNonce?.(confirmationNonce);
    if (!duplicateState) {
      await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
        content: 'This duplicate confirmation has expired.',
        flags: EPHEMERAL_MESSAGE_FLAG,
      });
      return;
    }
    const discordUserId = getRequesterDiscordUserIdOrFallback(
      interaction,
      duplicateState.sourceAuthorId,
    );
    const artifact = await buildReportArtifact({
      ...(discordUserId ? { discordUserId } : {}),
      guildId: duplicateState.guildId,
      logContext: {
        interactionId: interaction.id,
        guildId: duplicateState.guildId,
        channelId: duplicateState.channelId,
        confirmationNonce,
      },
      options,
      reportPath: 'preview-post',
      url: duplicateState.sourceUrl,
    });

    if (postPublicly) {
      const publicMessage = await createFollowupInteractionResponse(
        applicationId,
        interactionToken,
        toPublicReportBody(artifact.publicBody),
      );
      await options.autoReportDuplicateTrackingService?.updateTracking({
        guildId: duplicateState.guildId,
        channelId: duplicateState.channelId,
        reportCode: duplicateState.reportCode,
        status: 'final_posted',
        latestOutputMessageId: publicMessage.id,
        latestOutputKind: 'public_final_report',
      });
      await recordDashboardActivityAfterSuccess(options.botActivityStore, {
        guildId: duplicateState.guildId,
        channelId: duplicateState.channelId,
        sourceMessageId: interaction.id,
        actor: { kind: 'discord', discordUserId: getRequesterDiscordUserId(interaction) },
        kind: 'report_posted',
        reportCode: duplicateState.reportCode,
        sourceUrl: duplicateState.sourceUrl,
        idempotencyKey: interaction.id ? `report_duplicate_posted:${interaction.id}` : undefined,
        createdAt: new Date(),
      });
      await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
        content: 'Report summary posted to this channel.',
        flags: EPHEMERAL_MESSAGE_FLAG,
      });
      return;
    }

    await editOriginalInteractionResponse(applicationId, interactionToken, artifact.responseBody);
    await recordDashboardActivityAfterSuccess(options.botActivityStore, {
      guildId: duplicateState.guildId,
      channelId: duplicateState.channelId,
      sourceMessageId: interaction.id,
      actor: { kind: 'discord', discordUserId: getRequesterDiscordUserId(interaction) },
      kind: 'report_preview_created',
      reportCode: duplicateState.reportCode,
      sourceUrl: duplicateState.sourceUrl,
      idempotencyKey: interaction.id ? `report_duplicate_preview:${interaction.id}` : undefined,
      createdAt: new Date(),
    });
  } catch (error) {
    logger.error(
      {
        interactionId: interaction.id,
        confirmationNonce,
        error: serializeReportFetchFailureForLog(error),
      },
      'auto report duplicate action failed',
    );
    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      content: getReportFailureMessage(error),
      flags: EPHEMERAL_MESSAGE_FLAG,
    });
  }
};

const sendPublicFailure = async (input: {
  key: string;
  channel: AutoReportSendableChannel;
  reportCode: string;
  error: unknown;
  failureTtlMs: number;
  failureThrottle?: AutoReportFailureThrottle;
}): Promise<string | null> => {
  if (
    input.failureThrottle &&
    !input.failureThrottle.shouldPostFailure(input.key, input.failureTtlMs)
  ) {
    return null;
  }
  try {
    const sent = await input.channel.send({
      content: 'Could not build a report summary for that Warcraft Logs report. Please try again.',
      allowed_mentions: SAFE_ALLOWED_MENTIONS,
    });
    return sent.id;
  } catch (sendError) {
    logger.error(
      {
        reportCode: input.reportCode,
        error: serializeError(sendError),
      },
      'auto report public failure message could not be sent',
    );
    return null;
  }
};

const handleDuplicatePassiveDetection = async (input: {
  existing: AutoReportDuplicateTrackingRecord;
  channel: AutoReportSendableChannel;
  duplicateService: NonNullable<HandleOptions['autoReportDuplicateTrackingService']>;
}): Promise<void> => {
  if (input.existing.duplicateConfirmationMessageId) return;
  const confirmationNonce = input.existing.confirmationNonce ?? randomUUID();
  try {
    const sent = await input.channel.send(
      buildDuplicateConfirmationBody(input.existing.status, confirmationNonce),
    );
    await input.duplicateService.updateTracking({
      guildId: input.existing.guildId,
      channelId: input.existing.channelId,
      reportCode: input.existing.reportCode,
      confirmationNonce,
      duplicateConfirmationMessageId: sent.id,
      latestOutputMessageId: sent.id,
      latestOutputKind: 'duplicate_confirmation',
    });
  } catch (error) {
    logger.error(
      {
        guildId: input.existing.guildId,
        channelId: input.existing.channelId,
        reportCode: input.existing.reportCode,
        error: serializeError(error),
      },
      'auto report duplicate confirmation could not be sent',
    );
  }
};

export const handleAutoReportMessageCreate = async ({
  message,
  channel,
  handleOptions,
  duplicateTtlMs = DEFAULT_DUPLICATE_TTL_MS,
  failureTtlMs = DEFAULT_DUPLICATE_TTL_MS,
  failureThrottle,
}: AutoReportMessageCreateOptions): Promise<void> => {
  if (message.authorBot) return;
  if (!message.guildId) return;
  if (!message.content) return;

  const guildConfig = await handleOptions.guildConfigStore.getGuildConfig(message.guildId);
  if (guildConfig.autoReportMode === 'off') return;
  if (guildConfig.autoReportChannelIds.length === 0) return;
  if (!guildConfig.autoReportChannelIds.includes(message.channelId)) return;

  const parsed = extractFirstWarcraftLogsReportUrl(message.content);
  if (!parsed) return;
  if (!channel) {
    logger.info(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        reportCode: parsed.reportCode,
      },
      'auto report skipped because channel is not sendable',
    );
    return;
  }

  const duplicateService = handleOptions.autoReportDuplicateTrackingService;
  if (!duplicateService) return;
  const expiresAt = new Date(Date.now() + duplicateTtlMs);
  const claim = await duplicateService.claimPassiveDetection({
    guildId: message.guildId,
    channelId: message.channelId,
    reportCode: parsed.reportCode,
    gameFamily: parsed.gameFamily,
    sourceUrl: parsed.rawUrl,
    sourceMessageId: message.messageId,
    sourceAuthorId: message.authorId,
    mode: guildConfig.autoReportMode,
    expiresAt,
  });

  if (!claim.claimed) {
    if (claim.record) {
      // Multiple gateway consumers can race on the same Discord message create event.
      // If the existing tracking record came from this exact message, treat it as already
      // claimed by a peer and suppress duplicate confirmation noise.
      if (claim.record.sourceMessageId === message.messageId) {
        return;
      }
      await handleDuplicatePassiveDetection({
        existing: claim.record,
        channel,
        duplicateService,
      });
    }
    return;
  }

  const key = `${message.guildId}:${message.channelId}:${parsed.reportCode}`;
  let channelSendFailed = false;
  const sendChannelMessage = async (body: Record<string, unknown>): Promise<{ id: string }> => {
    try {
      return await channel.send(body);
    } catch (error) {
      channelSendFailed = true;
      throw error;
    }
  };
  try {
    if (guildConfig.autoReportMode === 'prompt') {
      const sent = await sendChannelMessage(buildAutoReportPromptBody(message.messageId));
      await handleOptions.autoReportPromptStateService?.savePromptState({
        guildId: message.guildId,
        channelId: message.channelId,
        reportCode: parsed.reportCode,
        gameFamily: parsed.gameFamily,
        sourceUrl: parsed.rawUrl,
        sourceMessageId: message.messageId,
        sourceAuthorId: message.authorId,
        promptMessageId: sent.id,
        expiresAt,
      });
      await duplicateService.updateTracking({
        guildId: message.guildId,
        channelId: message.channelId,
        reportCode: parsed.reportCode,
        status: 'prompted',
        latestOutputMessageId: sent.id,
        latestOutputKind: 'prompt',
      });
      return;
    }

    const artifact = await buildReportArtifact({
      discordUserId: message.authorId,
      guildId: message.guildId,
      logContext: {
        guildId: message.guildId,
        channelId: message.channelId,
        sourceMessageId: message.messageId,
      },
      options: handleOptions,
      reportPath: guildConfig.autoReportMode === 'auto_post' ? 'auto-post' : 'passive-detection',
      url: parsed.rawUrl,
    });

    if (guildConfig.autoReportMode === 'auto_preview') {
      const sent = await sendChannelMessage(toPublicReportBody(artifact.publicBody));
      await duplicateService.updateTracking({
        guildId: message.guildId,
        channelId: message.channelId,
        reportCode: parsed.reportCode,
        status: 'preview_posted',
        latestOutputMessageId: sent.id,
        latestOutputKind: 'public_preview',
      });
      await recordDashboardActivityAfterSuccess(handleOptions.botActivityStore, {
        guildId: message.guildId,
        channelId: message.channelId,
        sourceMessageId: message.messageId,
        actor: { kind: 'discord', discordUserId: message.authorId },
        kind: 'report_preview_created',
        reportCode: parsed.reportCode,
        sourceUrl: parsed.rawUrl,
        idempotencyKey: `auto_report_preview:${message.guildId}:${message.channelId}:${parsed.reportCode}:${message.messageId}`,
        createdAt: new Date(),
      });
      return;
    }

    logger.info(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        sourceMessageId: message.messageId,
        reportCode: parsed.reportCode,
        reportRuntimeFingerprint: artifact.runtime.fingerprint,
        reportPath: artifact.runtime.reportPath,
        reportPathFingerprint: artifact.runtime.pathFingerprint,
        cwd: process.cwd(),
        packageId: artifact.runtime.packageId,
        buildReportResponseBodyCalled: artifact.runtime.buildReportResponseBodyCalled,
        publicBodySent: true,
        workerAppIdentifier: 'worker-gateway-auto-report',
      },
      'auto report public report artifact built',
    );
    const sent = await sendChannelMessage(toPublicReportBody(artifact.publicBody));
    await duplicateService.updateTracking({
      guildId: message.guildId,
      channelId: message.channelId,
      reportCode: parsed.reportCode,
      status: 'final_posted',
      latestOutputMessageId: sent.id,
      latestOutputKind: 'public_final_report',
    });
    await recordDashboardActivityAfterSuccess(handleOptions.botActivityStore, {
      guildId: message.guildId,
      channelId: message.channelId,
      sourceMessageId: message.messageId,
      actor: { kind: 'discord', discordUserId: message.authorId },
      kind: 'report_posted',
      reportCode: parsed.reportCode,
      sourceUrl: parsed.rawUrl,
      idempotencyKey: `auto_report_posted:${message.guildId}:${message.channelId}:${parsed.reportCode}:${message.messageId}`,
      createdAt: new Date(),
    });
  } catch (error) {
    logger.error(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        reportCode: parsed.reportCode,
        error: serializeReportFetchFailureForLog(error),
      },
      'auto report passive handling failed',
    );
    const failureMessageId = channelSendFailed
      ? null
      : await sendPublicFailure({
          key,
          channel,
          reportCode: parsed.reportCode,
          error,
          failureTtlMs,
          ...(failureThrottle ? { failureThrottle } : {}),
        });
    await duplicateService.updateTracking({
      guildId: message.guildId,
      channelId: message.channelId,
      reportCode: parsed.reportCode,
      status: 'failed',
      ...(failureMessageId
        ? {
            latestOutputMessageId: failureMessageId,
            latestOutputKind: 'public_failure' as const,
          }
        : {}),
    });
  }
};

export const handleAutoReportComponentInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
): Promise<unknown | undefined> => {
  const id = interaction.data?.custom_id;
  if (typeof id !== 'string') return undefined;
  const parsed = parseAutoReportComponentCustomId(id);
  if (!parsed) return undefined;

  if (isDuplicateComponent(parsed)) {
    if (!options.autoReportDuplicateTrackingService?.getByConfirmationNonce) {
      return autoReportUnavailableResponse(interaction, {
        componentAction: parsed.action,
        missingStore: 'autoReportDuplicateTrackingService',
      });
    }

    if (parsed.action === 'duplicate_ignore') {
      const duplicateState =
        await options.autoReportDuplicateTrackingService.getByConfirmationNonce(
          parsed.confirmationNonce,
        );
      if (!duplicateState) {
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'This duplicate confirmation has expired.',
            flags: EPHEMERAL_MESSAGE_FLAG,
          },
        };
      }
      await options.autoReportDuplicateTrackingService.updateTracking({
        guildId: duplicateState.guildId,
        channelId: duplicateState.channelId,
        reportCode: duplicateState.reportCode,
        status: 'ignored',
      });
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'Duplicate report action ignored.', flags: EPHEMERAL_MESSAGE_FLAG },
      };
    }

    if (!interaction.application_id || !interaction.token) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Could not prepare report action. Please try again.',
          flags: EPHEMERAL_MESSAGE_FLAG,
        },
      };
    }

    scheduleTask(options, () => {
      void runDuplicatePreview(
        interaction,
        options,
        parsed.confirmationNonce,
        parsed.action === 'duplicate_post',
      );
    });
    return {
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: EPHEMERAL_MESSAGE_FLAG },
    };
  }

  if (!options.autoReportPromptStateService) {
    return autoReportUnavailableResponse(interaction, {
      componentAction: parsed.action,
      missingStore: 'autoReportPromptStateService',
    });
  }

  if (parsed.action === 'prompt_ignore') {
    const promptState = await options.autoReportPromptStateService.consumeValidPromptState(
      parsed.sourceMessageId,
    );
    if (!promptState) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: PROMPT_EXPIRED_MESSAGE,
          flags: EPHEMERAL_MESSAGE_FLAG,
        },
      };
    }
    await options.autoReportDuplicateTrackingService?.updateTracking({
      guildId: promptState.guildId,
      channelId: promptState.channelId,
      reportCode: promptState.reportCode,
      status: 'ignored',
    });
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: 'Auto report prompt ignored.', flags: EPHEMERAL_MESSAGE_FLAG },
    };
  }

  const promptState = await options.autoReportPromptStateService.getValidPromptState(
    parsed.sourceMessageId,
  );
  if (!promptState) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: PROMPT_EXPIRED_MESSAGE,
        flags: EPHEMERAL_MESSAGE_FLAG,
      },
    };
  }

  if (!interaction.application_id || !interaction.token) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Could not prepare report preview. Please try again.',
        flags: EPHEMERAL_MESSAGE_FLAG,
      },
    };
  }

  scheduleTask(options, () => {
    void runPromptPreview(interaction, options, parsed.sourceMessageId);
  });
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL_MESSAGE_FLAG },
  };
};

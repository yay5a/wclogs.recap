import { InteractionResponseType } from 'discord-interactions';
import {
  buildComparisonBaseline,
  extractComparisonSnapshots,
  authorizeCompareRequest,
  DEFAULT_COMPARE_VISIBILITY,
  getCompareAuthorizationDenialMessage,
  historyLimit,
  normalizeIdentityPart,
  parseCompareVisibility,
  parseCompareMode,
  resolveCharacterComparisonIdentity,
  type CompareMode,
  type CompareVisibility,
  type NormalizedPlayer,
  type NormalizedReport,
} from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
import type { DiscordInteraction, HandleOptions } from '../types.js';
import {
  createFollowupInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import {
  buildCompareErrorBody,
  buildPublicCompareResponseBody,
  buildCompareResponseBody,
  buildMixedCompareUnavailableBody,
} from '../renderers/compare.js';
import {
  getRequesterDiscordUserId,
  getRequesterPermissions,
  getRequesterRoleIds,
} from './character-claims.js';

const logger = createLogger('discord');
const EPHEMERAL_MESSAGE_FLAG = 64;

interface CompareCommandParams {
  reportUrl: string;
  characterName: string;
  mode: Extract<CompareMode, 'character'>;
  visibility: CompareVisibility;
}

const getStringOption = (options: unknown, name: string): string | undefined => {
  if (!Array.isArray(options)) return undefined;
  const found = options.find(
    (option) => typeof option === 'object' && option !== null && (option as { name?: unknown }).name === name,
  ) as { value?: unknown } | undefined;
  return typeof found?.value === 'string' ? found.value : undefined;
};

const findCharacterByName = (
  report: NormalizedReport,
  characterName: string,
): NormalizedPlayer | undefined => {
  const requestedName = normalizeIdentityPart(characterName);
  if (!requestedName) return undefined;

  return report.players.find((player) => normalizeIdentityPart(player.name) === requestedName);
};

const resolveCurrentSnapshot = (
  guildId: string,
  report: NormalizedReport,
  player: NormalizedPlayer,
) => {
  const identity = resolveCharacterComparisonIdentity({
    characterName: player.name,
    ...(typeof player.realm === 'string' ? { realm: player.realm } : {}),
    ...(typeof player.server === 'string' ? { server: player.server } : {}),
    ...(typeof player.region === 'string' ? { region: player.region } : {}),
  });

  if (identity.status !== 'ready' || identity.kind !== 'character') {
    return {
      identity,
      snapshot: undefined,
    };
  }

  const extraction = extractComparisonSnapshots({ guildId, report });
  const snapshot = extraction.snapshots.find(
    (candidate) => candidate.participantKey === identity.participantKey,
  );

  return {
    identity,
    snapshot,
  };
};

const processCompareInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
  params: CompareCommandParams,
): Promise<void> => {
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;
  const guildId = interaction.guild_id;

  if (!applicationId || !interactionToken || !guildId) {
    logger.error(
      {
        interactionId: interaction.id,
        applicationIdPresent: Boolean(applicationId),
        tokenPresent: Boolean(interactionToken),
        guildIdPresent: Boolean(guildId),
      },
      'compare missing interaction context',
    );
    return;
  }

  try {
    const report = await options.wclClient.fetchAndNormalizeReport(params.reportUrl);
    const player = findCharacterByName(report, params.characterName);

    if (!player) {
      await safeEditOriginalInteractionResponse(
        applicationId,
        interactionToken,
        buildCompareErrorBody(`Character not found in the current report: ${params.characterName}.`),
      );
      return;
    }

    const { identity, snapshot } = resolveCurrentSnapshot(guildId, report, player);

    if (identity.status !== 'ready' || identity.kind !== 'character') {
      const reason =
        identity.status === 'ready'
          ? 'Character comparison requires exact character identity.'
          : identity.reason;
      await safeEditOriginalInteractionResponse(
        applicationId,
        interactionToken,
        buildCompareErrorBody(reason),
      );
      return;
    }

    if (!snapshot) {
      await safeEditOriginalInteractionResponse(
        applicationId,
        interactionToken,
        buildCompareErrorBody(
          `Could not build a comparison snapshot for ${player.name}. Missing identity data was not guessed.`,
        ),
      );
      return;
    }

    if (!options.characterClaimStore) {
      await safeEditOriginalInteractionResponse(
        applicationId,
        interactionToken,
        buildCompareErrorBody('Comparison authorization is not available yet.'),
      );
      return;
    }

    const requesterDiscordUserId = getRequesterDiscordUserId(interaction);
    if (!requesterDiscordUserId) {
      await safeEditOriginalInteractionResponse(
        applicationId,
        interactionToken,
        buildCompareErrorBody('Discord user context is required for /compare.'),
      );
      return;
    }

    const guildConfig = await options.guildConfigStore.getGuildConfig(guildId);
    const [requesterApprovedClaim, targetApprovedClaims] = await Promise.all([
      options.characterClaimStore.findApprovedClaimForUserCharacter({
        guildId,
        discordUserId: requesterDiscordUserId,
        participantKey: identity.participantKey,
      }),
      options.characterClaimStore.findApprovedClaimsForParticipant({
        guildId,
        participantKey: identity.participantKey,
      }),
    ]);

    const authorization = authorizeCompareRequest({
      requesterDiscordUserId,
      requesterRoleIds: getRequesterRoleIds(interaction),
      requesterPermissions: getRequesterPermissions(interaction),
      targetParticipantKey: identity.participantKey,
      requestedVisibility: params.visibility,
      guildSettings: guildConfig,
      requesterApprovedClaim,
      targetApprovedClaims,
    });

    logger.info(
      {
        guildId,
        requesterDiscordUserId,
        targetCharacterName: player.name,
        targetParticipantKey: identity.participantKey,
        reportCode: report.reportCode,
        mode: params.mode,
        requestedVisibility: params.visibility,
        allowed: authorization.allowed,
        reason: authorization.reason,
        isOfficer: authorization.isOfficer,
        isOwner: authorization.isOwner,
        timestamp: new Date().toISOString(),
      },
      'compare authorization decision',
    );

    if (!authorization.allowed) {
      await safeEditOriginalInteractionResponse(
        applicationId,
        interactionToken,
        buildCompareErrorBody(getCompareAuthorizationDenialMessage(authorization)),
      );
      return;
    }

    const history = await options.comparisonHistoryStore?.findCharacterHistory({
      guildId,
      participantKey: identity.participantKey,
      before: snapshot.reportStartedAt,
      limit: historyLimit,
    });

    const baseline = buildComparisonBaseline(snapshot, history ?? []);
    const viewModel = {
      characterName: player.name,
      mode: params.mode,
      historyCount: history?.length ?? 0,
      baseline,
    };

    if (params.visibility === 'public') {
      try {
        await createFollowupInteractionResponse(
          applicationId,
          interactionToken,
          buildPublicCompareResponseBody(viewModel),
        );
        await safeEditOriginalInteractionResponse(
          applicationId,
          interactionToken,
          buildCompareErrorBody('Comparison posted to this channel.'),
        );
      } catch (error) {
        logger.error(
          {
            interactionId: interaction.id,
            guildId,
            reportCode: report.reportCode,
            error: serializeError(error),
          },
          'public compare posting failed',
        );
        await safeEditOriginalInteractionResponse(
          applicationId,
          interactionToken,
          buildCompareErrorBody('Comparison was authorized, but public posting failed. Please try again.'),
        );
      }
      return;
    }

    await safeEditOriginalInteractionResponse(
      applicationId,
      interactionToken,
      buildCompareResponseBody(viewModel),
    );
  } catch (error) {
    logger.error(
      {
        interactionId: interaction.id,
        guildId,
        error: serializeError(error),
      },
      'compare processing failed',
    );
    await safeEditOriginalInteractionResponse(
      applicationId,
      interactionToken,
      buildCompareErrorBody('Could not build comparison for that report. Please verify the URL and try again.'),
    );
  }
};

export const handleCompareCommand = (
  interaction: DiscordInteraction,
  options: HandleOptions,
): unknown => {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Guild context is required for /compare.'),
    };
  }

  const reportUrl = getStringOption(interaction.data?.options, 'report');
  const characterName = getStringOption(interaction.data?.options, 'character');
  const rawMode = getStringOption(interaction.data?.options, 'mode');
  const mode = parseCompareMode(rawMode);
  const rawVisibility = getStringOption(interaction.data?.options, 'visibility');
  const visibility =
    rawVisibility === undefined ? DEFAULT_COMPARE_VISIBILITY : parseCompareVisibility(rawVisibility);

  if (!reportUrl) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Missing report URL.'),
    };
  }

  if (!characterName) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Missing character name.'),
    };
  }

  if (!mode) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Invalid compare mode. Choose character or mixed.'),
    };
  }

  if (!visibility) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Invalid visibility. Choose private or public.'),
    };
  }

  if (mode === 'mixed') {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildMixedCompareUnavailableBody(),
    };
  }

  if (!options.comparisonHistoryStore) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Comparison history is not available yet.'),
    };
  }

  if (!options.characterClaimStore) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: buildCompareErrorBody('Comparison authorization is not available yet.'),
    };
  }

  const backgroundTask = () => {
    void processCompareInteraction(interaction, options, { reportUrl, characterName, mode, visibility });
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

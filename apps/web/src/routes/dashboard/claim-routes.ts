import type { FastifyInstance } from 'fastify';
import { recordActivity } from './activity.js';
import { requireDashboardAuth, requireDashboardMutationSafety } from './auth.js';
import {
  actorDiscordUserId,
  actorFromSession,
  requireGuildCapability,
  requireRequestAuthContext,
} from './capabilities.js';
import { allowedRevokeReasons, notifyClaimRevoked } from './claims.js';
import {
  getRequestBody,
  getStringParam,
  isValidClaimId,
  readGuildIdFromParams,
  sendError,
  serializeClaim,
} from './dto.js';
import type { DashboardAuthedRequest, DashboardRouteOptions } from './types.js';

export const registerDashboardClaimRoutes = (
  app: FastifyInstance,
  options: DashboardRouteOptions,
) => {
  const authPreHandler = requireDashboardAuth(options.env);
  const mutationPreHandlers = [authPreHandler, requireDashboardMutationSafety];

  app.get(
    '/api/dashboard/guilds/:guildId/claims',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const config = await requireGuildCapability(request, reply, options, guildId, 'claims:view');
      if (!config) return reply;
      const status =
        typeof (request.query as { status?: unknown } | null)?.status === 'string'
          ? (request.query as { status: string }).status
          : 'pending';
      if (status !== 'pending' && status !== 'approved' && status !== 'revoked') {
        return sendError(reply, 400, 'invalid_claim_status');
      }
      if (!options.characterClaimStore) return reply.send({ claims: [] });
      const claims = await options.characterClaimStore.listClaimsByStatus({
        guildId,
        status,
      });
      return reply.send({ claims: claims.map(serializeClaim) });
    },
  );

  app.post(
    '/api/dashboard/guilds/:guildId/claims/:claimId/approve',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      const claimId = getStringParam(request, 'claimId');
      if (!guildId) return reply;
      if (!claimId || !isValidClaimId(claimId)) return sendError(reply, 400, 'invalid_claim_id');
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'claims:approve',
      );
      if (!config) return reply;
      if (!options.characterClaimStore) return sendError(reply, 501, 'claims_unavailable');
      const claim = await options.characterClaimStore.approveClaimById({
        guildId,
        claimId,
        reviewedByDiscordUserId: actorDiscordUserId(request.dashboardAuth),
      });
      if (!claim) return sendError(reply, 404, 'claim_not_found');
      await recordActivity(options.activityStore, {
        guildId,
        actor: actorFromSession(requireRequestAuthContext(request)),
        kind: 'claim_approved',
        characterLabel: `${claim.characterName} - ${claim.realm}-${claim.region}`,
        targetDiscordUserId: claim.discordUserId,
      });
      return reply.send({ claim: serializeClaim(claim) });
    },
  );

  app.post(
    '/api/dashboard/guilds/:guildId/claims/:claimId/reject',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      const claimId = getStringParam(request, 'claimId');
      if (!guildId) return reply;
      if (!claimId || !isValidClaimId(claimId)) return sendError(reply, 400, 'invalid_claim_id');
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'claims:reject',
      );
      if (!config) return reply;
      if (!options.characterClaimStore) return sendError(reply, 501, 'claims_unavailable');
      const claim = await options.characterClaimStore.rejectClaimById({
        guildId,
        claimId,
        reviewedByDiscordUserId: actorDiscordUserId(request.dashboardAuth),
      });
      if (!claim) return sendError(reply, 404, 'claim_not_found');
      await recordActivity(options.activityStore, {
        guildId,
        actor: actorFromSession(requireRequestAuthContext(request)),
        kind: 'claim_rejected',
        characterLabel: `${claim.characterName} - ${claim.realm}-${claim.region}`,
        targetDiscordUserId: claim.discordUserId,
      });
      return reply.send({ claim: serializeClaim(claim) });
    },
  );

  app.post(
    '/api/dashboard/guilds/:guildId/claims/:claimId/revoke',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      const claimId = getStringParam(request, 'claimId');
      if (!guildId) return reply;
      if (!claimId || !isValidClaimId(claimId)) return sendError(reply, 400, 'invalid_claim_id');
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'claims:revoke',
      );
      if (!config) return reply;
      const body = getRequestBody(request);
      const revokeReason =
        typeof body?.revokeReason === 'string' ? body.revokeReason.trim() : undefined;
      if (revokeReason && !allowedRevokeReasons.has(revokeReason)) {
        return sendError(reply, 400, 'invalid_revoke_reason');
      }
      if (!options.characterClaimStore) return sendError(reply, 501, 'claims_unavailable');
      const claim = await options.characterClaimStore.revokeClaimById({
        guildId,
        claimId,
        revokedByDiscordUserId: actorDiscordUserId(request.dashboardAuth),
        ...(revokeReason ? { revokeReason } : {}),
      });
      if (!claim) return sendError(reply, 404, 'claim_not_found');
      await recordActivity(options.activityStore, {
        guildId,
        actor: actorFromSession(requireRequestAuthContext(request)),
        kind: 'claim_revoked',
        characterLabel: `${claim.characterName} - ${claim.realm}-${claim.region}`,
        targetDiscordUserId: claim.discordUserId,
      });
      const notified = await notifyClaimRevoked(options.env, claim);
      return reply.send({ claim: serializeClaim(claim), notified });
    },
  );
};

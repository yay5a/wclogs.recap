import type { FastifyInstance } from 'fastify';
import { recordActivity } from './activity.js';
import {
  clearDiscordSessionsForGuild,
  dashboardAuthContext,
  requireDashboardAuth,
  requireDashboardMutationSafety,
} from './auth.js';
import {
  actorFromSession,
  getEffectiveCapabilities,
  requireAdminSecret,
  requireGuildCapability,
  requireRequestAuthContext,
} from './capabilities.js';
import {
  defaultDirectoryResolver,
  getClaimsForDirectory,
  resolvedGuildLabel,
} from './directory.js';
import {
  getRequestBody,
  parseConfigPatchBody,
  parseGuildCreateBody,
  readGuildAndUserIdsFromParams,
  readGuildIdFromParams,
  sendError,
  serializeActivity,
} from './dto.js';
import { defaultOnboardingState, onboardingUserKey } from './onboarding.js';
import {
  ADMIN_CAPABILITIES,
  ONBOARDING_VERSION,
  type DashboardAuthedRequest,
  type DashboardGuildConfigSummary,
  type DashboardOnboardingState,
  type DashboardRouteOptions,
} from './types.js';

export const registerDashboardGuildRoutes = (
  app: FastifyInstance,
  options: DashboardRouteOptions,
) => {
  const authPreHandler = requireDashboardAuth(options.env);
  const mutationPreHandlers = [authPreHandler, requireDashboardMutationSafety];
  const resolveDirectory = options.directoryResolver ?? defaultDirectoryResolver(options.env);

  app.get(
    '/api/dashboard/guilds',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) => {
      const auth = request.dashboardAuth ?? dashboardAuthContext;
      if (auth.kind === 'admin-secret') {
        const summaries = await options.guildConfigStore.listGuildConfigSummaries();
        const guilds = await Promise.all(
          summaries.map(async (summary) => {
            const guild = await resolvedGuildLabel(summary.guildId, options.env.DISCORD_BOT_TOKEN);
            return {
              ...summary,
              ...(guild.resolved ? { guildName: guild.label } : {}),
              capabilities: ADMIN_CAPABILITIES,
            };
          }),
        );
        return reply.send({ guilds });
      }

      const allowedGuildIds = Object.keys(auth.oauthGuildsById);
      const summaries =
        await options.guildConfigStore.listGuildConfigSummariesForGuilds(allowedGuildIds);
      const visible: DashboardGuildConfigSummary[] = [];
      for (const summary of summaries) {
        const oauthGuild = auth.oauthGuildsById[summary.guildId];
        if (!oauthGuild) continue;
        const config = await options.guildConfigStore.getExistingGuildConfig(summary.guildId);
        if (!config) continue;
        const capabilities = getEffectiveCapabilities(auth, summary.guildId, config);
        if (capabilities.length === 0) continue;
        visible.push({
          ...summary,
          guildName: oauthGuild.name,
          capabilities,
        });
      }
      return reply.send({ guilds: visible });
    },
  );

  app.post(
    '/api/dashboard/guilds',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      if (!requireAdminSecret(request, reply)) return reply;
      const parsed = parseGuildCreateBody(request, reply);
      if (!parsed) return reply;
      const config = await options.guildConfigStore.createDefaultGuildConfig(parsed.guildId);
      return reply.send({ config });
    },
  );

  app.get(
    '/api/dashboard/guilds/:guildId/config',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'settings:view',
      );
      if (!config) return reply;
      return reply.send({ config });
    },
  );

  app.patch(
    '/api/dashboard/guilds/:guildId/config',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const existingConfig = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'settings:edit',
      );
      if (!existingConfig) return reply;
      const update = parseConfigPatchBody(request, reply);
      if (!update) return reply;

      const config = await options.guildConfigStore.saveExistingGuildConfig(guildId, update);
      if (!config) return sendError(reply, 404, 'guild_config_not_found');
      await recordActivity(options.activityStore, {
        guildId,
        actor: actorFromSession(requireRequestAuthContext(request)),
        kind: 'config_updated',
      });
      return reply.send({ config });
    },
  );

  app.post(
    '/api/dashboard/guilds/:guildId/officers/:discordUserId',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const params = readGuildAndUserIdsFromParams(request, reply);
      if (!params) return reply;
      const existingConfig = await requireGuildCapability(
        request,
        reply,
        options,
        params.guildId,
        'officers:manage',
      );
      if (!existingConfig) return reply;
      const config = await options.guildConfigStore.addOfficerToExistingGuild(
        params.guildId,
        params.discordUserId,
      );
      if (!config) return sendError(reply, 404, 'guild_config_not_found');
      await recordActivity(options.activityStore, {
        guildId: params.guildId,
        actor: actorFromSession(requireRequestAuthContext(request)),
        kind: 'officer_added',
        targetDiscordUserId: params.discordUserId,
      });
      return reply.send({ config });
    },
  );

  app.delete(
    '/api/dashboard/guilds/:guildId/officers/:discordUserId',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const params = readGuildAndUserIdsFromParams(request, reply);
      if (!params) return reply;
      const existingConfig = await requireGuildCapability(
        request,
        reply,
        options,
        params.guildId,
        'officers:manage',
      );
      if (!existingConfig) return reply;
      const config = await options.guildConfigStore.removeOfficerFromExistingGuild(
        params.guildId,
        params.discordUserId,
      );
      if (!config) return sendError(reply, 404, 'guild_config_not_found');
      await recordActivity(options.activityStore, {
        guildId: params.guildId,
        actor: actorFromSession(requireRequestAuthContext(request)),
        kind: 'officer_removed',
        targetDiscordUserId: params.discordUserId,
      });
      return reply.send({ config });
    },
  );

  app.delete(
    '/api/dashboard/guilds/:guildId',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const existingConfig = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'guild:delete',
      );
      if (!existingConfig) return reply;
      const deleted = options.guildConfigStore.deconfigureExistingGuild
        ? await options.guildConfigStore.deconfigureExistingGuild(guildId)
        : false;
      if (!deleted) return sendError(reply, 404, 'guild_config_not_found');
      clearDiscordSessionsForGuild(guildId);
      await Promise.all([
        options.activityStore?.archiveGuildActivity?.(guildId),
        options.onboardingStore?.archiveGuildOnboarding?.(guildId),
      ]);
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/api/dashboard/guilds/:guildId/activity',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'activity:view',
      );
      if (!config) return reply;
      const activity = options.activityStore
        ? await options.activityStore.listActivity({ guildId, limit: 50 })
        : [];
      return reply.send({ activity: activity.map(serializeActivity) });
    },
  );

  app.get(
    '/api/dashboard/guilds/:guildId/directory',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'directory:view',
      );
      if (!config) return reply;
      const [claims, activity] = await Promise.all([
        getClaimsForDirectory(options.characterClaimStore, guildId),
        options.activityStore?.listActivity({ guildId, limit: 100 }) ?? [],
      ]);
      return reply.send({
        directory: await resolveDirectory({ guildId, config, claims, activity }),
      });
    },
  );

  app.get(
    '/api/dashboard/guilds/:guildId/onboarding',
    { preHandler: authPreHandler },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'settings:view',
      );
      if (!config) return reply;
      const auth = request.dashboardAuth ?? dashboardAuthContext;
      const userKey = onboardingUserKey(auth);
      const state = options.onboardingStore
        ? await options.onboardingStore.getOnboardingState({
            userKey,
            guildId,
            onboardingVersion: ONBOARDING_VERSION,
          })
        : defaultOnboardingState(userKey, guildId);
      return reply.send({ onboarding: state });
    },
  );

  app.patch(
    '/api/dashboard/guilds/:guildId/onboarding',
    { preHandler: mutationPreHandlers },
    async (request: DashboardAuthedRequest, reply) => {
      const guildId = readGuildIdFromParams(request, reply);
      if (!guildId) return reply;
      const config = await requireGuildCapability(
        request,
        reply,
        options,
        guildId,
        'settings:view',
      );
      if (!config) return reply;
      const body = getRequestBody(request);
      const seenSteps = Array.isArray(body?.seenSteps)
        ? body.seenSteps.filter((step): step is string => typeof step === 'string')
        : [];
      const dismissed = body?.dismissed === true;
      const auth = request.dashboardAuth ?? dashboardAuthContext;
      const userKey = onboardingUserKey(auth);
      const state: DashboardOnboardingState = {
        userKey,
        guildId,
        seenSteps: [...new Set(seenSteps)],
        onboardingVersion: ONBOARDING_VERSION,
        ...(dismissed ? { dismissedAt: new Date() } : {}),
      };
      const saved = options.onboardingStore
        ? await options.onboardingStore.saveOnboardingState(state)
        : state;
      return reply.send({ onboarding: saved });
    },
  );
};

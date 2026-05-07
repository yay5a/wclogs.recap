import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { recordActivity } from "./dashboard/activity.js";
import {
    compareDashboardAdminSecret,
    consumeOAuthState,
    createDiscordSession,
    dashboardAuthContext,
    deleteDiscordSessionFromCookie,
    exchangeDiscordCode,
    fetchDiscordBearerJson,
    parseDiscordUser,
    parseOAuthGuild,
    publicAuthContext,
    requireDashboardAuth,
    requireDashboardMutationSafety,
    setDashboardCookie,
    shouldUseSecureDashboardCookies,
    storeOAuthState,
    clearDiscordSessionsForGuild,
} from "./dashboard/auth.js";
import {
    actorDiscordUserId,
    actorFromSession,
    getEffectiveCapabilities,
    requireAdminSecret,
    requireGuildCapability,
    requireRequestAuthContext,
} from "./dashboard/capabilities.js";
import { allowedRevokeReasons, notifyClaimRevoked } from "./dashboard/claims.js";
import { defaultDirectoryResolver, getClaimsForDirectory } from "./dashboard/directory.js";
import {
    getRequestBody,
    getStringParam,
    isValidClaimId,
    parseConfigPatchBody,
    parseGuildCreateBody,
    readGuildAndUserIdsFromParams,
    readGuildIdFromParams,
    sendError,
    serializeActivity,
    serializeClaim,
} from "./dashboard/dto.js";
import { defaultOnboardingState, onboardingUserKey } from "./dashboard/onboarding.js";
import {
    ADMIN_CAPABILITIES,
    DASHBOARD_COOKIE_NAME,
    DASHBOARD_COOKIE_PATH,
    DASHBOARD_OAUTH_STATE_COOKIE_NAME,
    DASHBOARD_OAUTH_STATE_TTL_MS,
    DASHBOARD_SESSION_TTL_MS,
    ONBOARDING_VERSION,
    type DashboardAuthedRequest,
    type DashboardGuildConfigSummary,
    type DashboardOAuthGuild,
    type DashboardOnboardingState,
    type DashboardRouteOptions,
} from "./dashboard/types.js";

export { compareDashboardAdminSecret, DASHBOARD_COOKIE_NAME };
export type {
    DashboardActivityRecord,
    DashboardActivityStore,
    DashboardAuthContext,
    DashboardCapability,
    DashboardCharacterClaimStore,
    DashboardDirectory,
    DashboardGuildConfigStore,
    DashboardGuildConfigSummary,
    DashboardOnboardingStore,
} from "./dashboard/types.js";

export const registerDashboardRoutes: FastifyPluginAsync<DashboardRouteOptions> = async (
    app,
    options,
) => {
    const authPreHandler = requireDashboardAuth(options.env);
    const mutationPreHandlers = [authPreHandler, requireDashboardMutationSafety];
    const resolveDirectory = options.directoryResolver ?? defaultDirectoryResolver(options.env);

    app.post("/api/dashboard/login", async (request, reply) => {
        if (options.env.DASHBOARD_AUTH_DISABLED) return reply.send({ ok: true });

        const body = getRequestBody(request);
        const submittedSecret =
            typeof body?.adminSecret === "string" ? body.adminSecret : undefined;
        const expectedSecret = options.env.DASHBOARD_ADMIN_SECRET;
        if (
            !submittedSecret ||
            !expectedSecret ||
            !compareDashboardAdminSecret(submittedSecret, expectedSecret)
        ) {
            return sendError(reply, 401, "unauthorized");
        }

        const expiresAtMs = Date.now() + DASHBOARD_SESSION_TTL_MS;
        setDashboardCookie(reply, options.env, `dashboard:v1:${expiresAtMs}`);
        return reply.send({ ok: true });
    });

    app.get("/api/dashboard/discord/login", async (_request, reply) => {
        if (!options.env.DISCORD_CLIENT_SECRET || !options.env.discordOAuthRedirectUri) {
            return sendError(reply, 503, "discord_login_not_configured");
        }

        const state = crypto.randomBytes(24).toString("base64url");
        storeOAuthState(state);
        reply.setCookie(DASHBOARD_OAUTH_STATE_COOKIE_NAME, state, {
            httpOnly: true,
            signed: true,
            sameSite: "lax",
            secure: shouldUseSecureDashboardCookies(options.env),
            path: "/api/dashboard/discord/callback",
            maxAge: DASHBOARD_OAUTH_STATE_TTL_MS / 1000,
        });

        const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("client_id", options.env.DISCORD_APPLICATION_ID);
        authorizeUrl.searchParams.set("scope", "identify guilds");
        authorizeUrl.searchParams.set("redirect_uri", options.env.discordOAuthRedirectUri);
        authorizeUrl.searchParams.set("state", state);
        return reply.redirect(authorizeUrl.toString());
    });

    app.get("/api/dashboard/discord/callback", async (request, reply) => {
        const query =
            typeof request.query === "object" && request.query !== null
                ? (request.query as Record<string, unknown>)
                : {};
        const oauthError = typeof query.error === "string" ? query.error : "";
        const code = typeof query.code === "string" ? query.code : "";
        const state = typeof query.state === "string" ? query.state : "";
        const rawStateCookie = request.cookies[DASHBOARD_OAUTH_STATE_COOKIE_NAME];
        const unsignedState = rawStateCookie ? request.unsignCookie(rawStateCookie) : null;
        reply.clearCookie(DASHBOARD_OAUTH_STATE_COOKIE_NAME, {
            path: "/api/dashboard/discord/callback",
        });

        if (oauthError) {
            if (state && unsignedState?.valid && unsignedState.value === state) {
                consumeOAuthState(state);
            }
            return sendError(reply, 400, "discord_oauth_denied");
        }

        if (!code || !state || !unsignedState?.valid || unsignedState.value !== state) {
            return sendError(reply, 400, "invalid_oauth_state");
        }

        if (!consumeOAuthState(state)) {
            return sendError(reply, 400, "invalid_oauth_state");
        }

        const accessToken = await exchangeDiscordCode(options.env, code);
        if (!accessToken) return sendError(reply, 401, "discord_oauth_failed");

        const [rawUser, rawGuilds] = await Promise.all([
            fetchDiscordBearerJson("/users/@me", accessToken),
            fetchDiscordBearerJson("/users/@me/guilds", accessToken),
        ]);
        const user = parseDiscordUser(rawUser);
        if (!user || !Array.isArray(rawGuilds)) {
            return sendError(reply, 401, "discord_oauth_failed");
        }

        const oauthGuildsById: Record<string, DashboardOAuthGuild> = {};
        for (const rawGuild of rawGuilds) {
            const guild = parseOAuthGuild(rawGuild);
            if (guild) oauthGuildsById[guild.id] = guild;
        }

        const { sessionId, sessionExpiresAtMs } = createDiscordSession({
            kind: "discord",
            discordUserId: user.id,
            username: user.username,
            displayName: user.displayName,
            oauthGuildsById,
        });
        setDashboardCookie(reply, options.env, `dashboard:v2:${sessionId}:${sessionExpiresAtMs}`);
        return reply.redirect("/dashboard");
    });

    app.post(
        "/api/dashboard/logout",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            deleteDiscordSessionFromCookie(request);
            reply.clearCookie(DASHBOARD_COOKIE_NAME, { path: DASHBOARD_COOKIE_PATH });
            return reply.send({ ok: true });
        },
    );

    app.get(
        "/api/dashboard/session",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) =>
            reply.send({
                authenticated: true,
                auth: publicAuthContext(request.dashboardAuth ?? dashboardAuthContext),
            }),
    );

    app.get(
        "/api/dashboard/guilds",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) => {
            const auth = request.dashboardAuth ?? dashboardAuthContext;
            if (auth.kind === "admin-secret") {
                const summaries = await options.guildConfigStore.listGuildConfigSummaries();
                return reply.send({
                    guilds: summaries.map((summary) => ({
                        ...summary,
                        capabilities: ADMIN_CAPABILITIES,
                    })),
                });
            }

            const allowedGuildIds = Object.keys(auth.oauthGuildsById);
            const summaries = await options.guildConfigStore.listGuildConfigSummariesForGuilds(
                allowedGuildIds,
            );
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
        "/api/dashboard/guilds",
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
        "/api/dashboard/guilds/:guildId/config",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "settings:view",
            );
            if (!config) return reply;
            return reply.send({ config });
        },
    );

    app.patch(
        "/api/dashboard/guilds/:guildId/config",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const existingConfig = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "settings:edit",
            );
            if (!existingConfig) return reply;
            const update = parseConfigPatchBody(request, reply);
            if (!update) return reply;

            const config = await options.guildConfigStore.saveExistingGuildConfig(guildId, update);
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            await recordActivity(options.activityStore, {
                guildId,
                actor: actorFromSession(requireRequestAuthContext(request)),
                kind: "config_updated",
            });
            return reply.send({ config });
        },
    );

    app.post(
        "/api/dashboard/guilds/:guildId/officers/:discordUserId",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const params = readGuildAndUserIdsFromParams(request, reply);
            if (!params) return reply;
            const existingConfig = await requireGuildCapability(
                request,
                reply,
                options,
                params.guildId,
                "officers:manage",
            );
            if (!existingConfig) return reply;
            const config = await options.guildConfigStore.addOfficerToExistingGuild(
                params.guildId,
                params.discordUserId,
            );
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            await recordActivity(options.activityStore, {
                guildId: params.guildId,
                actor: actorFromSession(requireRequestAuthContext(request)),
                kind: "officer_added",
                targetDiscordUserId: params.discordUserId,
            });
            return reply.send({ config });
        },
    );

    app.delete(
        "/api/dashboard/guilds/:guildId/officers/:discordUserId",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const params = readGuildAndUserIdsFromParams(request, reply);
            if (!params) return reply;
            const existingConfig = await requireGuildCapability(
                request,
                reply,
                options,
                params.guildId,
                "officers:manage",
            );
            if (!existingConfig) return reply;
            const config = await options.guildConfigStore.removeOfficerFromExistingGuild(
                params.guildId,
                params.discordUserId,
            );
            if (!config) return sendError(reply, 404, "guild_config_not_found");
            await recordActivity(options.activityStore, {
                guildId: params.guildId,
                actor: actorFromSession(requireRequestAuthContext(request)),
                kind: "officer_removed",
                targetDiscordUserId: params.discordUserId,
            });
            return reply.send({ config });
        },
    );

    app.delete(
        "/api/dashboard/guilds/:guildId",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const existingConfig = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "guild:delete",
            );
            if (!existingConfig) return reply;
            const deleted = options.guildConfigStore.deconfigureExistingGuild
                ? await options.guildConfigStore.deconfigureExistingGuild(guildId)
                : false;
            if (!deleted) return sendError(reply, 404, "guild_config_not_found");
            clearDiscordSessionsForGuild(guildId);
            await Promise.all([
                options.activityStore?.archiveGuildActivity?.(guildId),
                options.onboardingStore?.archiveGuildOnboarding?.(guildId),
            ]);
            return reply.send({ ok: true });
        },
    );

    app.get(
        "/api/dashboard/guilds/:guildId/claims",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "claims:view",
            );
            if (!config) return reply;
            const status =
                typeof (request.query as { status?: unknown } | null)?.status === "string"
                    ? (request.query as { status: string }).status
                    : "pending";
            if (status !== "pending" && status !== "approved" && status !== "revoked") {
                return sendError(reply, 400, "invalid_claim_status");
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
        "/api/dashboard/guilds/:guildId/claims/:claimId/approve",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            const claimId = getStringParam(request, "claimId");
            if (!guildId) return reply;
            if (!claimId || !isValidClaimId(claimId)) return sendError(reply, 400, "invalid_claim_id");
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "claims:approve",
            );
            if (!config) return reply;
            if (!options.characterClaimStore) return sendError(reply, 501, "claims_unavailable");
            const claim = await options.characterClaimStore.approveClaimById({
                guildId,
                claimId,
                reviewedByDiscordUserId: actorDiscordUserId(request.dashboardAuth),
            });
            if (!claim) return sendError(reply, 404, "claim_not_found");
            await recordActivity(options.activityStore, {
                guildId,
                actor: actorFromSession(requireRequestAuthContext(request)),
                kind: "claim_approved",
                characterLabel: `${claim.characterName} - ${claim.realm}-${claim.region}`,
                targetDiscordUserId: claim.discordUserId,
            });
            return reply.send({ claim: serializeClaim(claim) });
        },
    );

    app.post(
        "/api/dashboard/guilds/:guildId/claims/:claimId/reject",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            const claimId = getStringParam(request, "claimId");
            if (!guildId) return reply;
            if (!claimId || !isValidClaimId(claimId)) return sendError(reply, 400, "invalid_claim_id");
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "claims:reject",
            );
            if (!config) return reply;
            if (!options.characterClaimStore) return sendError(reply, 501, "claims_unavailable");
            const claim = await options.characterClaimStore.rejectClaimById({
                guildId,
                claimId,
                reviewedByDiscordUserId: actorDiscordUserId(request.dashboardAuth),
            });
            if (!claim) return sendError(reply, 404, "claim_not_found");
            await recordActivity(options.activityStore, {
                guildId,
                actor: actorFromSession(requireRequestAuthContext(request)),
                kind: "claim_rejected",
                characterLabel: `${claim.characterName} - ${claim.realm}-${claim.region}`,
                targetDiscordUserId: claim.discordUserId,
            });
            return reply.send({ claim: serializeClaim(claim) });
        },
    );

    app.post(
        "/api/dashboard/guilds/:guildId/claims/:claimId/revoke",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            const claimId = getStringParam(request, "claimId");
            if (!guildId) return reply;
            if (!claimId || !isValidClaimId(claimId)) return sendError(reply, 400, "invalid_claim_id");
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "claims:revoke",
            );
            if (!config) return reply;
            const body = getRequestBody(request);
            const revokeReason =
                typeof body?.revokeReason === "string" ? body.revokeReason.trim() : undefined;
            if (revokeReason && !allowedRevokeReasons.has(revokeReason)) {
                return sendError(reply, 400, "invalid_revoke_reason");
            }
            if (!options.characterClaimStore) return sendError(reply, 501, "claims_unavailable");
            const claim = await options.characterClaimStore.revokeClaimById({
                guildId,
                claimId,
                revokedByDiscordUserId: actorDiscordUserId(request.dashboardAuth),
                ...(revokeReason ? { revokeReason } : {}),
            });
            if (!claim) return sendError(reply, 404, "claim_not_found");
            await recordActivity(options.activityStore, {
                guildId,
                actor: actorFromSession(requireRequestAuthContext(request)),
                kind: "claim_revoked",
                characterLabel: `${claim.characterName} - ${claim.realm}-${claim.region}`,
                targetDiscordUserId: claim.discordUserId,
            });
            const notified = await notifyClaimRevoked(options.env, claim);
            return reply.send({ claim: serializeClaim(claim), notified });
        },
    );

    app.get(
        "/api/dashboard/guilds/:guildId/activity",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "activity:view",
            );
            if (!config) return reply;
            const activity = options.activityStore
                ? await options.activityStore.listActivity({ guildId, limit: 50 })
                : [];
            return reply.send({ activity: activity.map(serializeActivity) });
        },
    );

    app.get(
        "/api/dashboard/guilds/:guildId/directory",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "directory:view",
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
        "/api/dashboard/guilds/:guildId/onboarding",
        { preHandler: authPreHandler },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "settings:view",
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
        "/api/dashboard/guilds/:guildId/onboarding",
        { preHandler: mutationPreHandlers },
        async (request: DashboardAuthedRequest, reply) => {
            const guildId = readGuildIdFromParams(request, reply);
            if (!guildId) return reply;
            const config = await requireGuildCapability(
                request,
                reply,
                options,
                guildId,
                "settings:view",
            );
            if (!config) return reply;
            const body = getRequestBody(request);
            const seenSteps = Array.isArray(body?.seenSteps)
                ? body.seenSteps.filter((step): step is string => typeof step === "string")
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

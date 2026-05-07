import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyRawBody from "fastify-raw-body";
import type {
    AutoReportDuplicateTrackingService,
    AutoReportPromptStateService,
    CharacterClaimStore,
    ComparisonHistoryStore,
} from "@wcl/discord";
import type { GuildConfigStore } from "@wcl/domain";
import type { createLogger } from "@wcl/shared";
import type { WclClient } from "@wcl/wcl-client";
import type { WclUserAuthStore } from "./auth/routes.js";
import { registerWclAuthRoutes } from "./auth/routes.js";
import type { WebEnv } from "./config.js";
import { registerDashboardRoutes, type DashboardGuildConfigStore } from "./routes/dashboard.js";
import type {
    DashboardActivityStore,
    DashboardOnboardingStore,
    DashboardCharacterClaimStore,
} from "./routes/dashboard.js";
import { registerDiscordInteractionRoutes } from "./routes/discord-interactions.js";
import { registerReportRoutes } from "./routes/report.js";

export type CreateWebAppOptions = {
    env: WebEnv;
    logger: ReturnType<typeof createLogger>;
    wclClient: WclClient;
    guildConfigStore: GuildConfigStore;
    dashboardGuildConfigStore: DashboardGuildConfigStore;
    autoReportPromptStateService: AutoReportPromptStateService;
    autoReportDuplicateTrackingService: AutoReportDuplicateTrackingService;
    comparisonHistoryStore: ComparisonHistoryStore;
    characterClaimStore: CharacterClaimStore;
    dashboardCharacterClaimStore: DashboardCharacterClaimStore;
    dashboardActivityStore?: DashboardActivityStore;
    dashboardOnboardingStore?: DashboardOnboardingStore;
    wclUserAuthStore: WclUserAuthStore;
    dashboardStatic?: {
        enabled: boolean;
        assetRoot: string;
    };
};

const sendDashboardShell =
    (assetRoot: string) => async (_request: FastifyRequest, reply: FastifyReply) => {
        reply.header("Cache-Control", "no-cache");
        return reply.sendFile("index.html", assetRoot, {
            cacheControl: false,
        });
    };

export const createWebApp = async (options: CreateWebAppOptions): Promise<FastifyInstance> => {
    const app = Fastify({ logger: false });

    await app.register(fastifyRawBody, {
        field: "rawBody",
        global: false,
        encoding: "utf8",
        runFirst: true,
    });

    await app.register(fastifyCookie, {
        secret: options.env.COOKIE_SECRET,
    });

    app.get("/health", async () => ({ status: "ok" }));

    await app.register(registerWclAuthRoutes, {
        env: options.env,
        logger: options.logger,
        wclUserAuthStore: options.wclUserAuthStore,
    });

    await app.register(registerReportRoutes, {
        env: options.env,
        wclClient: options.wclClient,
        logger: options.logger,
    });

    await app.register(registerDiscordInteractionRoutes, {
        env: options.env,
        wclClient: options.wclClient,
        guildConfigStore: options.guildConfigStore,
        autoReportPromptStateService: options.autoReportPromptStateService,
        autoReportDuplicateTrackingService: options.autoReportDuplicateTrackingService,
        comparisonHistoryStore: options.comparisonHistoryStore,
        characterClaimStore: options.characterClaimStore,
        botActivityStore: options.dashboardActivityStore,
        logger: options.logger,
    });

    await app.register(registerDashboardRoutes, {
        env: options.env,
        guildConfigStore: options.dashboardGuildConfigStore,
        characterClaimStore: options.dashboardCharacterClaimStore,
        activityStore: options.dashboardActivityStore,
        onboardingStore: options.dashboardOnboardingStore,
    });

    if (options.dashboardStatic?.enabled) {
        const assetRoot = options.dashboardStatic.assetRoot;
        const assetsRoot = resolve(assetRoot, "assets");
        await app.register(fastifyStatic, {
            root: assetRoot,
            serve: false,
        });

        if (existsSync(assetsRoot)) {
            await app.register(fastifyStatic, {
                root: assetsRoot,
                prefix: "/dashboard/assets/",
                decorateReply: false,
                index: false,
                maxAge: "30d",
                immutable: true,
            });
        }

        const shell = sendDashboardShell(assetRoot);
        app.get("/dashboard", shell);
        app.get("/dashboard/login", shell);
        app.get("/dashboard/*", async (request, reply) => {
            if (request.url.startsWith("/dashboard/assets/")) {
                return reply.code(404).send({ error: "not_found" });
            }
            return shell(request, reply);
        });
    }

    return app;
};

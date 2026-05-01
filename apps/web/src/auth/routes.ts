import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { UpsertWclUserAuthInput } from "@wcl/db";
import type { createLogger } from "@wcl/shared";
import type { WebEnv } from "../config.js";
import { exchangeAuthorizationCode } from "./wcl-oauth.js";

export type WclUserAuthStore = {
    get(): Promise<{
        provider?: string;
        accessToken?: string;
        refreshToken?: string;
        tokenType?: string;
        scope?: string;
        expiresAt?: Date;
        updatedAt?: Date;
    } | null>;
    upsert(entry: UpsertWclUserAuthInput): Promise<void>;
};

type WclAuthRouteOptions = {
    env: WebEnv;
    logger: ReturnType<typeof createLogger>;
    wclUserAuthStore: WclUserAuthStore;
};

export const registerWclAuthRoutes: FastifyPluginAsync<WclAuthRouteOptions> = async (
    app,
    options,
) => {
    const { env, logger, wclUserAuthStore } = options;

    app.get("/api/auth/wcl/status", async (_request, reply) => {
        const auth = await wclUserAuthStore.get();

        return reply.send({
            ok: true,
            authorized: !!auth,
            provider: auth?.provider ?? null,
            hasAccessToken: typeof auth?.accessToken === "string",
            hasRefreshToken: typeof auth?.refreshToken === "string",
            tokenType: auth?.tokenType ?? null,
            scope: auth?.scope ?? null,
            expiresAt: auth?.expiresAt ?? null,
            updatedAt: auth?.updatedAt ?? null,
        });
    });

    app.get("/api/auth/wcl/login", async (_request, reply) => {
        const state = crypto.randomUUID();

        reply.setCookie("wcl_oauth_state", state, {
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            signed: true,
            maxAge: 60 * 10,
        });

        const authorizeUrl = new URL("https://www.warcraftlogs.com/oauth/authorize");
        authorizeUrl.searchParams.set("client_id", env.WCL_CLIENT_ID);
        authorizeUrl.searchParams.set("redirect_uri", env.WCL_REDIRECT_URI);
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("state", state);

        return reply.redirect(authorizeUrl.toString());
    });

    app.get("/api/auth/wcl/callback", async (request, reply) => {
        const query = request.query as {
            code?: string;
            state?: string;
            error?: string;
        };

        if (query.error) {
            return reply.code(400).send({
                ok: false,
                message: "WCL authorization failed or was denied",
                error: query.error,
            });
        }

        if (!query.code || !query.state) {
            return reply.code(400).send({ ok: false, message: "Missing code or state" });
        }

        const cookie = request.unsignCookie(request.cookies.wcl_oauth_state ?? "");
        if (!cookie.valid || cookie.value !== query.state) {
            return reply.code(400).send({ ok: false, message: "Invalid OAuth state" });
        }

        const tokenResult = await exchangeAuthorizationCode({
            env,
            code: query.code,
        });

        reply.clearCookie("wcl_oauth_state", { path: "/" });

        if (!tokenResult.payload.access_token || tokenResult.status < 200 || tokenResult.status >= 300) {
            logger.error(
                { status: tokenResult.status, tokenPayload: tokenResult.payload },
                "WCL token exchange failed",
            );

            return reply.code(500).send({
                ok: false,
                message: "WCL token exchange failed",
                status: tokenResult.status,
            });
        }

        await wclUserAuthStore.upsert({
            provider: "warcraftlogs",
            accessToken: tokenResult.payload.access_token,
            updatedAt: new Date(),
            ...(typeof tokenResult.payload.refresh_token === "string"
                ? { refreshToken: tokenResult.payload.refresh_token }
                : {}),
            ...(typeof tokenResult.payload.token_type === "string"
                ? { tokenType: tokenResult.payload.token_type }
                : {}),
            ...(typeof tokenResult.payload.scope === "string"
                ? { scope: tokenResult.payload.scope }
                : {}),
            ...(typeof tokenResult.payload.expires_in === "number"
                ? { expiresAt: new Date(Date.now() + tokenResult.payload.expires_in * 1000) }
                : {}),
        });

        return reply.send({ ok: true, message: "WCL authorization completed" });
    });
};

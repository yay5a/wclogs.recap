import pino, { type Logger, type LoggerOptions } from "pino";
import { z } from "zod";

export const loggerRedactionPaths = [
    "headers.authorization",
    "req.headers.authorization",
    "request.headers.authorization",
    "authorization",
    "*.authorization",
    "*.*.authorization",
    "headers.Authorization",
    "req.headers.Authorization",
    "request.headers.Authorization",
    "env.DISCORD_BOT_TOKEN",
    "env.WCL_CLIENT_SECRET",
    "env.WCL_TOKEN_ENCRYPTION_KEY",
    "env.DISCORD_CLIENT_SECRET",
    "env.MONGODB_URI",
    "env.DASHBOARD_ADMIN_SECRET",
    "DASHBOARD_ADMIN_SECRET",
    "WCL_TOKEN_ENCRYPTION_KEY",
    "client_secret",
    "*.client_secret",
    "*.*.client_secret",
    "adminSecret",
    "*.adminSecret",
    "*.*.adminSecret",
    "*.*.*.adminSecret",
    "*.*.*.*.adminSecret",
    "body.adminSecret",
    "req.body.adminSecret",
    "request.body.adminSecret",
    "headers.cookie",
    "req.headers.cookie",
    "request.headers.cookie",
    "cookie",
    "*.cookie",
    "*.*.cookie",
    "cookies",
    "*.cookies",
    "req.cookies",
    "request.cookies",
    "wcl_dashboard",
    "*.wcl_dashboard",
    "*.*.wcl_dashboard",
    "*.*.*.wcl_dashboard",
    "*.*.*.*.wcl_dashboard",
    "cookies.wcl_dashboard",
    "req.cookies.wcl_dashboard",
    "request.cookies.wcl_dashboard",
    "[\"set-cookie\"]",
    "headers[\"set-cookie\"]",
    "reply.headers[\"set-cookie\"]",
    "res.headers[\"set-cookie\"]",
    "response.headers[\"set-cookie\"]",
    "set-cookie",
    "*.set-cookie",
    "*.*.set-cookie",
    "token",
    "*.token",
    "*.*.token",
    "access_token",
    "*.access_token",
    "*.*.access_token",
    "refresh_token",
    "*.refresh_token",
    "*.*.refresh_token",
    "id_token",
    "*.id_token",
    "*.*.id_token",
    "accessTokenEnvelope",
    "*.accessTokenEnvelope",
    "*.*.accessTokenEnvelope",
    "refreshTokenEnvelope",
    "*.refreshTokenEnvelope",
    "*.*.refreshTokenEnvelope",
    "ciphertext",
    "*.ciphertext",
    "*.*.ciphertext",
    "iv",
    "*.iv",
    "*.*.iv",
    "authTag",
    "*.authTag",
    "*.*.authTag",
    "code",
    "*.code",
    "*.*.code",
    "*.secret",
    "*.*.secret",
    "*.password",
    "*.*.password",
] as const;

export const baseLoggerOptions: LoggerOptions = {
    redact: {
        paths: [...loggerRedactionPaths],
        censor: "[REDACTED]",
    },
};

export const logger = pino(baseLoggerOptions);

let developmentRootLogger: Logger | undefined;

const getDevelopmentRootLogger = (): Logger => {
    developmentRootLogger ??= pino(
        {
            ...baseLoggerOptions,
            level: "debug",
        },
        pino.transport({
            target: "pino-pretty",
            options: { colorize: true },
        }),
    );

    return developmentRootLogger;
};

export const createLogger = (name: string) => {
    if (process.env.NODE_ENV === "production") {
        return pino({
            ...baseLoggerOptions,
            name,
            level: "info",
        });
    }

    return getDevelopmentRootLogger().child({ name });
};

export const trimmed = () => z.string().trim().min(1);

export type SerializedError = {
    name?: string;
    message: string;
    stack?: string;
    cause?: SerializedError;
};

const serializeErrorCause = (cause: unknown): SerializedError | undefined =>
    typeof cause === "undefined" ? undefined : serializeError(cause);

export const serializeError = (error: unknown): SerializedError => {
    if (error instanceof Error) {
        const cause = serializeErrorCause(error.cause);
        return {
            name: error.name,
            message: error.message,
            ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack }),
            ...(cause ? { cause } : {}),
        };
    }

    return { message: String(error) };
};

export type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };

export { z };

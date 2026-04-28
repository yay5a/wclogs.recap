import pino, { type LoggerOptions } from "pino";
import { z } from "zod";

const baseLoggerOptions: LoggerOptions = {
    redact: {
        paths: [
            "headers.authorization",
            "req.headers.authorization",
            "env.DISCORD_BOT_TOKEN",
            "env.WCL_CLIENT_SECRET",
            "env.MONGODB_URI",
            "token",
            "*.token",
            "*.secret",
            "*.password",
        ],
        censor: "[REDACTED]",
    },
};

export const logger = pino(baseLoggerOptions);

export const createLogger = (name: string) => {
    if (process.env.NODE_ENV === "production") {
        return pino({
            ...baseLoggerOptions,
            name,
            level: "info",
        });
    }

    return pino({
        ...baseLoggerOptions,
        name,
        level: "debug",
        transport: {
            target: "pino-pretty",
            options: { colorize: true },
        },
    });
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

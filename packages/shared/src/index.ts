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

const trimmed = () => z.string().trim().min(1);

export const envSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    PORT: z.coerce.number().default(3000),

    MONGODB_URI: trimmed().url(),

    DISCORD_PUBLIC_KEY: trimmed().regex(
        /^[a-fA-F0-9]{64}$/,
        "DISCORD_PUBLIC_KEY must be a 64-character hex string",
    ),

    DISCORD_APPLICATION_ID: trimmed().regex(
        /^\d+$/,
        "DISCORD_APPLICATION_ID must be numeric",
    ),

    DISCORD_BOT_TOKEN: trimmed().regex(
        /^\S+$/,
        "DISCORD_BOT_TOKEN must not contain whitespace",
    ),

    WCL_CLIENT_ID: trimmed(),
    WCL_CLIENT_SECRET: trimmed(),
    WCL_API_BASE_URL: trimmed()
        .url()
        .default("https://www.warcraftlogs.com/api/v2/client"),
    PREVIEW_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

export type AppEnv = z.infer<typeof envSchema>;

export const parseEnv = (rawEnv: NodeJS.ProcessEnv): AppEnv =>
    envSchema.parse(rawEnv);

export type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };

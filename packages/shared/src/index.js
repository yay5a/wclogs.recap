import pino from "pino";
import { z } from "zod";
export const envSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    PORT: z.coerce.number().default(3000),
    MONGODB_URI: z.string().url(),
    DISCORD_PUBLIC_KEY: z.string().min(1),
    DISCORD_APPLICATION_ID: z.string().min(1),
    DISCORD_BOT_TOKEN: z.string().min(1),
    WCL_CLIENT_ID: z.string().min(1),
    WCL_CLIENT_SECRET: z.string().min(1),
    WCL_API_BASE_URL: z
        .string()
        .url()
        .default("https://www.warcraftlogs.com/api/v2/client"),
});
export const parseEnv = (rawEnv) => envSchema.parse(rawEnv);
export const logger = pino({
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
});
export const createLogger = (name) => {
    if (process.env.NODE_ENV === "production") {
        return pino({ name, level: "info" });
    }
    return pino({
        name,
        level: "debug",
        transport: {
            target: "pino-pretty",
            options: { colorize: true },
        },
    });
};
//# sourceMappingURL=index.js.map
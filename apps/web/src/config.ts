import { trimmed, z } from "@wcl/shared";

const webEnvSchema = z.object({
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
    WCL_REDIRECT_URI: trimmed().url(),
    COOKIE_SECRET: trimmed().min(1, "COOKIE_SECRET is required"),
    PREVIEW_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const parseWebEnv = (rawEnv: NodeJS.ProcessEnv): WebEnv =>
    webEnvSchema.parse(rawEnv);

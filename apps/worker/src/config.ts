import { trimmed, z } from "@wcl/shared";

const workerEnvSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    MONGODB_URI: trimmed().url(),
    DISCORD_BOT_TOKEN: trimmed().regex(
        /^\S+$/,
        "DISCORD_BOT_TOKEN must not contain whitespace",
    ),
    WCL_CLIENT_ID: trimmed().min(1, "WCL_CLIENT_ID is required"),
    WCL_CLIENT_SECRET: trimmed().min(1, "WCL_CLIENT_SECRET is required"),
    WCL_API_BASE_URL: trimmed()
        .url()
        .default("https://www.warcraftlogs.com/api/v2/client"),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const parseWorkerEnv = (rawEnv: NodeJS.ProcessEnv): WorkerEnv =>
    workerEnvSchema.parse(rawEnv);

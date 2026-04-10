import { trimmed, z } from "@wcl/shared";

const workerEnvSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    MONGODB_URI: trimmed().url(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const parseWorkerEnv = (rawEnv: NodeJS.ProcessEnv): WorkerEnv =>
    workerEnvSchema.parse(rawEnv);

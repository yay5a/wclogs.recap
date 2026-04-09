import pino from "pino";
import { z } from "zod";
export declare const envSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    PORT: z.ZodDefault<z.ZodNumber>;
    MONGODB_URI: z.ZodString;
    DISCORD_PUBLIC_KEY: z.ZodString;
    DISCORD_APPLICATION_ID: z.ZodString;
    DISCORD_BOT_TOKEN: z.ZodString;
    WCL_CLIENT_ID: z.ZodString;
    WCL_CLIENT_SECRET: z.ZodString;
    WCL_API_BASE_URL: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    MONGODB_URI: string;
    DISCORD_PUBLIC_KEY: string;
    DISCORD_APPLICATION_ID: string;
    DISCORD_BOT_TOKEN: string;
    WCL_CLIENT_ID: string;
    WCL_CLIENT_SECRET: string;
    WCL_API_BASE_URL: string;
}, {
    MONGODB_URI: string;
    DISCORD_PUBLIC_KEY: string;
    DISCORD_APPLICATION_ID: string;
    DISCORD_BOT_TOKEN: string;
    WCL_CLIENT_ID: string;
    WCL_CLIENT_SECRET: string;
    NODE_ENV?: "development" | "test" | "production" | undefined;
    PORT?: number | undefined;
    WCL_API_BASE_URL?: string | undefined;
}>;
export type AppEnv = z.infer<typeof envSchema>;
export declare const parseEnv: (rawEnv: NodeJS.ProcessEnv) => AppEnv;
export declare const logger: pino.Logger<never, boolean>;
export declare const createLogger: (name: string) => pino.Logger<never, boolean>;
export type Result<T, E = Error> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
//# sourceMappingURL=index.d.ts.map
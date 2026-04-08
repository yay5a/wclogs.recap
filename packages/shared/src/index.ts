<<<<<<< HEAD
import pino from 'pino';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  MONGODB_URI: z.string().url(),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  WCL_CLIENT_ID: z.string().min(1),
  WCL_CLIENT_SECRET: z.string().min(1),
  WCL_API_BASE_URL: z.string().url().default('https://www.warcraftlogs.com/api/v2/client'),
=======
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
>>>>>>> c1868b4 (generated framework through codex)
});

export type AppEnv = z.infer<typeof envSchema>;

<<<<<<< HEAD
export const parseEnv = (rawEnv: NodeJS.ProcessEnv): AppEnv => envSchema.parse(rawEnv);

export const createLogger = (name: string) => {
  if (process.env.NODE_ENV === 'production') {
    return pino({ name, level: 'info' });
  }

  return pino({
    name,
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  });
};

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
=======
export const parseEnv = (rawEnv: NodeJS.ProcessEnv): AppEnv =>
    envSchema.parse(rawEnv);

export const createLogger = (name: string) => {
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

export type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E };
>>>>>>> c1868b4 (generated framework through codex)

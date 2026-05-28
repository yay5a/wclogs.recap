import { isValidWclTokenEncryptionKey, mongoUriRequestsTls } from '@wcl/db';
import { trimmed, z } from '@wcl/shared';
import { resolveWclPublicClientAuth } from '@wcl/wcl-client';

const booleanFlag = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((value) => value === 'true');

const wclTokenEncryptionKey = trimmed().superRefine((value, context) => {
  if (!isValidWclTokenEncryptionKey(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'WCL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    });
  }
});

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    MONGODB_URI: trimmed().url(),
    MONGODB_ENCRYPTION_AT_REST_CONFIRMED: booleanFlag,
    DISCORD_BOT_TOKEN: trimmed().regex(/^\S+$/, 'DISCORD_BOT_TOKEN must not contain whitespace'),
    WCL_CLIENT_ID: trimmed().optional(),
    WCL_CLIENT_SECRET: trimmed().optional(),
    WCL_OAUTH_CLIENT_TOKEN: trimmed().optional(),
    WCL_TOKEN_ENCRYPTION_KEY: wclTokenEncryptionKey,
    WCL_API_BASE_URL: trimmed().url().default('https://www.warcraftlogs.com/api/v2/client'),
    WCL_USER_API_BASE_URL: trimmed().url().optional(),
    WCL_V1_CLIENT_KEY: trimmed().optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production') {
      if (!mongoUriRequestsTls(env.MONGODB_URI)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MONGODB_URI'],
          message:
            'MONGODB_URI must request TLS in production; use mongodb+srv:// or tls=true/ssl=true',
        });
      }

      if (!env.MONGODB_ENCRYPTION_AT_REST_CONFIRMED) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MONGODB_ENCRYPTION_AT_REST_CONFIRMED'],
          message: 'MONGODB_ENCRYPTION_AT_REST_CONFIRMED=true is required in production',
        });
      }

      if (!isHttpsUrl(env.WCL_API_BASE_URL)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WCL_API_BASE_URL'],
          message: 'WCL_API_BASE_URL must use https in production',
        });
      }

      if (env.WCL_USER_API_BASE_URL && !isHttpsUrl(env.WCL_USER_API_BASE_URL)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WCL_USER_API_BASE_URL'],
          message: 'WCL_USER_API_BASE_URL must use https in production',
        });
      }
    }

    if (
      (env.WCL_CLIENT_ID && !env.WCL_CLIENT_SECRET) ||
      (!env.WCL_CLIENT_ID && env.WCL_CLIENT_SECRET)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WCL_CLIENT_ID'],
        message: 'WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set together',
      });
    }

    if (!env.WCL_CLIENT_ID && !env.WCL_CLIENT_SECRET && !env.WCL_OAUTH_CLIENT_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WCL_CLIENT_ID'],
        message:
          'WCL public client auth requires WCL_CLIENT_ID and WCL_CLIENT_SECRET or WCL_OAUTH_CLIENT_TOKEN',
      });
    }
  })
  .transform((env) => ({
    ...env,
    wclPublicClientAuth: resolveWclPublicClientAuth({
      clientId: env.WCL_CLIENT_ID,
      clientSecret: env.WCL_CLIENT_SECRET,
      clientToken: env.WCL_OAUTH_CLIENT_TOKEN,
    }),
  }));

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const parseWorkerEnv = (rawEnv: NodeJS.ProcessEnv): WorkerEnv =>
  workerEnvSchema.parse(rawEnv);

import { isValidWclTokenEncryptionKey, mongoUriRequestsTls } from '@wcl/db';
import { trimmed, z } from '@wcl/shared';
import { resolveWclPublicClientAuth } from '@wcl/wcl-client';

export const DISCORD_OAUTH_CALLBACK_PATH = '/api/dashboard/discord/callback';
export const WCL_OAUTH_CALLBACK_PATH = '/api/auth/wcl/callback';
export const DISCORD_INTERACTIONS_PATH = '/discord/interactions';
export const DASHBOARD_PATH = '/dashboard';
export const TERMS_PATH = '/dashboard/terms';
export const PRIVACY_PATH = '/dashboard/privacy';

const dashboardAuthDisabled = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((value) => value === 'true');

const booleanFlag = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((value) => value === 'true');

const httpUrl = (name: string) =>
  trimmed()
    .url()
    .superRefine((value, context) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} must use http or https`,
        });
      }
    });

const publicAppBaseUrl = httpUrl('PUBLIC_APP_BASE_URL')
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUBLIC_APP_BASE_URL must be an origin without path, query, or hash',
      });
    }
  })
  .transform((value) => new URL(value).origin);

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

const requireProductionHttps = (
  context: z.RefinementCtx,
  name: string,
  value: string | undefined,
) => {
  if (!value || isHttpsUrl(value)) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [name],
    message: `${name} must use https in production`,
  });
};

const buildPublicUrl = (baseUrl: string | undefined, path: string): string | undefined =>
  baseUrl ? `${baseUrl}${path}` : undefined;

const discordApplicationId = trimmed().regex(/^\d+$/, 'DISCORD_APPLICATION_ID must be numeric');

const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    MONGODB_URI: trimmed().url(),
    MONGODB_ENCRYPTION_AT_REST_CONFIRMED: booleanFlag,
    DISCORD_PUBLIC_KEY: trimmed().regex(
      /^[a-fA-F0-9]{64}$/,
      'DISCORD_PUBLIC_KEY must be a 64-character hex string',
    ),
    DISCORD_APPLICATION_ID: discordApplicationId.optional(),
    DISCORD_CLIENT_ID: discordApplicationId.optional(),
    DISCORD_BOT_TOKEN: trimmed().regex(/^\S+$/, 'DISCORD_BOT_TOKEN must not contain whitespace'),
    DISCORD_CLIENT_SECRET: trimmed().min(1, 'DISCORD_CLIENT_SECRET must not be empty').optional(),
    PUBLIC_APP_BASE_URL: publicAppBaseUrl.optional(),
    DISCORD_OAUTH_REDIRECT_URI: httpUrl('DISCORD_OAUTH_REDIRECT_URI').optional(),
    DISCORD_INTERACTIONS_URL: httpUrl('DISCORD_INTERACTIONS_URL').optional(),
    WCL_CLIENT_ID: trimmed().optional(),
    WCL_CLIENT_SECRET: trimmed().optional(),
    WCL_OAUTH_CLIENT_TOKEN: trimmed().optional(),
    WCL_TOKEN_ENCRYPTION_KEY: wclTokenEncryptionKey,
    WCL_API_BASE_URL: trimmed().url().default('https://www.warcraftlogs.com/api/v2/client'),
    WCL_USER_API_BASE_URL: trimmed().url().optional(),
    WCL_V1_CLIENT_KEY: trimmed().optional(),
    WCL_REDIRECT_URI: httpUrl('WCL_REDIRECT_URI').optional(),
    COOKIE_SECRET: trimmed().min(1, 'COOKIE_SECRET is required'),
    DASHBOARD_ADMIN_SECRET: trimmed().min(1, 'DASHBOARD_ADMIN_SECRET must not be empty').optional(),
    DASHBOARD_AUTH_DISABLED: dashboardAuthDisabled,
  })
  .superRefine((env, context) => {
    if (!env.DISCORD_APPLICATION_ID && !env.DISCORD_CLIENT_ID) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DISCORD_APPLICATION_ID'],
        message: 'DISCORD_APPLICATION_ID is required',
      });
    }

    if (
      env.DISCORD_APPLICATION_ID &&
      env.DISCORD_CLIENT_ID &&
      env.DISCORD_APPLICATION_ID !== env.DISCORD_CLIENT_ID
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DISCORD_CLIENT_ID'],
        message: 'DISCORD_CLIENT_ID must match DISCORD_APPLICATION_ID when both are set',
      });
    }

    if (env.NODE_ENV === 'production' && env.DASHBOARD_AUTH_DISABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_AUTH_DISABLED'],
        message: 'DASHBOARD_AUTH_DISABLED=true is not allowed in production',
      });
    }

    if (env.NODE_ENV === 'production' && !env.DASHBOARD_ADMIN_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_ADMIN_SECRET'],
        message: 'DASHBOARD_ADMIN_SECRET is required in production',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (!env.PUBLIC_APP_BASE_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PUBLIC_APP_BASE_URL'],
          message: 'PUBLIC_APP_BASE_URL is required in production',
        });
      }

      requireProductionHttps(context, 'PUBLIC_APP_BASE_URL', env.PUBLIC_APP_BASE_URL);
      requireProductionHttps(
        context,
        'DISCORD_OAUTH_REDIRECT_URI',
        env.DISCORD_OAUTH_REDIRECT_URI,
      );
      requireProductionHttps(context, 'DISCORD_INTERACTIONS_URL', env.DISCORD_INTERACTIONS_URL);
      requireProductionHttps(context, 'WCL_REDIRECT_URI', env.WCL_REDIRECT_URI);
      requireProductionHttps(context, 'WCL_API_BASE_URL', env.WCL_API_BASE_URL);
      requireProductionHttps(context, 'WCL_USER_API_BASE_URL', env.WCL_USER_API_BASE_URL);

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
    }

    if (
      (env.DISCORD_CLIENT_SECRET && !env.DISCORD_OAUTH_REDIRECT_URI && !env.PUBLIC_APP_BASE_URL) ||
      (!env.DISCORD_CLIENT_SECRET && env.DISCORD_OAUTH_REDIRECT_URI)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DISCORD_OAUTH_REDIRECT_URI'],
        message:
          'DISCORD_CLIENT_SECRET requires DISCORD_OAUTH_REDIRECT_URI or PUBLIC_APP_BASE_URL; DISCORD_OAUTH_REDIRECT_URI requires DISCORD_CLIENT_SECRET',
      });
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

    if (
      env.WCL_CLIENT_ID &&
      env.WCL_CLIENT_SECRET &&
      !env.WCL_REDIRECT_URI &&
      !env.PUBLIC_APP_BASE_URL
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WCL_REDIRECT_URI'],
        message: 'WCL OAuth requires WCL_REDIRECT_URI or PUBLIC_APP_BASE_URL',
      });
    }

    if (
      env.NODE_ENV === 'development' &&
      !env.DASHBOARD_AUTH_DISABLED &&
      !env.DASHBOARD_ADMIN_SECRET
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_ADMIN_SECRET'],
        message:
          'DASHBOARD_ADMIN_SECRET is required in development unless DASHBOARD_AUTH_DISABLED=true',
      });
    }
  })
  .transform((env) => {
    const publicAppBaseUrl = env.PUBLIC_APP_BASE_URL;
    const resolvedDiscordApplicationId = env.DISCORD_APPLICATION_ID ?? env.DISCORD_CLIENT_ID;
    // Transitional full-URL overrides keep existing deployments working; otherwise
    // callback URLs are derived from the canonical public app origin.
    const discordOAuthRedirectUri =
      env.DISCORD_OAUTH_REDIRECT_URI ??
      buildPublicUrl(publicAppBaseUrl, DISCORD_OAUTH_CALLBACK_PATH);
    const wclRedirectUri =
      env.WCL_REDIRECT_URI ?? buildPublicUrl(publicAppBaseUrl, WCL_OAUTH_CALLBACK_PATH);
    const discordInteractionsUrl =
      env.DISCORD_INTERACTIONS_URL ?? buildPublicUrl(publicAppBaseUrl, DISCORD_INTERACTIONS_PATH);
    const dashboardPublicUrl = buildPublicUrl(publicAppBaseUrl, DASHBOARD_PATH);
    const termsPublicUrl = buildPublicUrl(publicAppBaseUrl, TERMS_PATH);
    const privacyPublicUrl = buildPublicUrl(publicAppBaseUrl, PRIVACY_PATH);

    return {
      ...env,
      DISCORD_APPLICATION_ID: resolvedDiscordApplicationId as string,
      wclPublicClientAuth: resolveWclPublicClientAuth({
        clientId: env.WCL_CLIENT_ID,
        clientSecret: env.WCL_CLIENT_SECRET,
        clientToken: env.WCL_OAUTH_CLIENT_TOKEN,
      }),
      publicAppBaseUrl,
      discordOAuthRedirectUri,
      wclRedirectUri,
      discordInteractionsUrl,
      dashboardPublicUrl,
      termsPublicUrl,
      privacyPublicUrl,
    };
  });

export type WebEnv = z.infer<typeof webEnvSchema>;

export const parseWebEnv = (rawEnv: NodeJS.ProcessEnv): WebEnv => webEnvSchema.parse(rawEnv);

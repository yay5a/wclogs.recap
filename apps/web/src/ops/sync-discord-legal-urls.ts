import { createLogger, trimmed, z } from '@wcl/shared';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { PRIVACY_PATH, TERMS_PATH } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, '../../../../.env');

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_USER_AGENT = 'DiscordBot (https://github.com/yay5a/wclogs.report, 0.1.0)';

const discordApplicationId = trimmed().regex(/^\d+$/);

const publicAppBaseUrl = trimmed()
  .pipe(z.url())
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        message: 'PUBLIC_APP_BASE_URL must use https',
      });
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      context.addIssue({
        code: 'custom',
        message: 'PUBLIC_APP_BASE_URL must be an origin without path, query, or hash',
      });
    }
  })
  .transform((value) => new URL(value).origin);

const envSchema = z
  .object({
    DISCORD_APPLICATION_ID: discordApplicationId.optional(),
    DISCORD_CLIENT_ID: discordApplicationId.optional(),
    DISCORD_BOT_TOKEN: trimmed()
      .regex(/^\S+$/)
      .refine((token) => !token.toLowerCase().startsWith('bot '), {
        message: "DISCORD_BOT_TOKEN must be the raw token without a 'Bot ' prefix.",
      })
      .refine((token) => !/^[a-f0-9]{64}$/i.test(token), {
        message:
          'DISCORD_BOT_TOKEN looks like DISCORD_PUBLIC_KEY. Use the bot token from the Discord Developer Portal Bot page.',
      }),
    PUBLIC_APP_BASE_URL: publicAppBaseUrl,
  })
  .superRefine((env, context) => {
    if (
      env.DISCORD_APPLICATION_ID &&
      env.DISCORD_CLIENT_ID &&
      env.DISCORD_APPLICATION_ID !== env.DISCORD_CLIENT_ID
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DISCORD_CLIENT_ID'],
        message: 'DISCORD_CLIENT_ID must match DISCORD_APPLICATION_ID when both are set',
      });
    }
  })
  .transform((env) => ({
    ...env,
    DISCORD_APPLICATION_ID: env.DISCORD_APPLICATION_ID ?? env.DISCORD_CLIENT_ID,
    termsOfServiceUrl: `${env.PUBLIC_APP_BASE_URL}${TERMS_PATH}`,
    privacyPolicyUrl: `${env.PUBLIC_APP_BASE_URL}${PRIVACY_PATH}`,
  }));

const env = envSchema.parse(process.env);
const logger = createLogger('discord-application-legal-urls');

const response = await fetch(`${DISCORD_API_BASE_URL}/applications/@me`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': DISCORD_USER_AGENT,
  },
  body: JSON.stringify({
    terms_of_service_url: env.termsOfServiceUrl,
    privacy_policy_url: env.privacyPolicyUrl,
  }),
});

const responseText = await response.text();
const responseBody = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};

if (!response.ok) {
  logger.error(
    {
      status: response.status,
      statusText: response.statusText,
      responseBody,
    },
    'failed to update Discord application legal URLs',
  );
  process.exitCode = 1;
} else {
  if (
    env.DISCORD_APPLICATION_ID &&
    typeof responseBody.id === 'string' &&
    responseBody.id !== env.DISCORD_APPLICATION_ID
  ) {
    logger.error(
      {
        expectedApplicationId: env.DISCORD_APPLICATION_ID,
        actualApplicationId: responseBody.id,
      },
      'Discord application id mismatch after legal URL update',
    );
    process.exitCode = 1;
  } else if (
    responseBody.terms_of_service_url !== env.termsOfServiceUrl ||
    responseBody.privacy_policy_url !== env.privacyPolicyUrl
  ) {
    logger.error(
      {
        expectedTermsOfServiceUrl: env.termsOfServiceUrl,
        actualTermsOfServiceUrl: responseBody.terms_of_service_url,
        expectedPrivacyPolicyUrl: env.privacyPolicyUrl,
        actualPrivacyPolicyUrl: responseBody.privacy_policy_url,
      },
      'Discord application legal URLs did not match expected values after update',
    );
    process.exitCode = 1;
  } else {
    logger.info(
      {
        applicationId: responseBody.id,
        termsOfServiceUrl: env.termsOfServiceUrl,
        privacyPolicyUrl: env.privacyPolicyUrl,
      },
      'updated Discord application legal URLs',
    );
  }
}

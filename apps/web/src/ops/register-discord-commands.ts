import { registerGlobalCommands, registerGuildCommands } from '@wcl/discord';
import { createLogger, trimmed, z } from '@wcl/shared';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, '../../../../.env');

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const discordApplicationId = trimmed().regex(/^\d+$/);

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
    DISCORD_GUILD_ID: trimmed().regex(/^\d+$/).optional(),
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
  })
  .transform((env) => ({
    ...env,
    DISCORD_APPLICATION_ID: (env.DISCORD_APPLICATION_ID ?? env.DISCORD_CLIENT_ID) as string,
  }));

const env = envSchema.parse(process.env);
const logger = createLogger('discord-command-registration');

const guildIdArg = process.argv[2]?.trim();
const guildId = guildIdArg && guildIdArg.length > 0 ? guildIdArg : env.DISCORD_GUILD_ID;

try {
  if (guildId) {
    await registerGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_BOT_TOKEN, guildId);
    logger.info({ guildId }, 'registered guild commands');
  } else {
    await registerGlobalCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_BOT_TOKEN);
    logger.info('registered global commands');
  }
} catch (error) {
  logger.error({ error, guildId: guildId ?? null }, 'failed to register commands');
  process.exitCode = 1;
}

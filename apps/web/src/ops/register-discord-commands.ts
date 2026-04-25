import { registerGlobalCommands, registerGuildCommands } from "@wcl/discord";
import { createLogger, trimmed, z } from "@wcl/shared";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, "../../../../.env");

if (existsSync(envPath)) {
    loadEnvFile(envPath);
}

const envSchema = z.object({
    DISCORD_APPLICATION_ID: trimmed().regex(/^\d+$/),
    DISCORD_BOT_TOKEN: trimmed().regex(/^\S+$/),
    DISCORD_GUILD_ID: trimmed().regex(/^\d+$/).optional(),
});

const env = envSchema.parse(process.env);
const logger = createLogger("discord-command-registration");

const guildIdArg = process.argv[2]?.trim();
const guildId = guildIdArg && guildIdArg.length > 0 ? guildIdArg : env.DISCORD_GUILD_ID;

try {
    if (guildId) {
        await registerGuildCommands(
            env.DISCORD_APPLICATION_ID,
            env.DISCORD_BOT_TOKEN,
            guildId,
        );
        logger.info({ guildId }, "registered guild commands");
    } else {
        await registerGlobalCommands(
            env.DISCORD_APPLICATION_ID,
            env.DISCORD_BOT_TOKEN,
        );
        logger.info("registered global commands");
    }
} catch (error) {
    logger.error({ error, guildId: guildId ?? null }, "failed to register commands");
    process.exitCode = 1;
}

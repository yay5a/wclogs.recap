import type { CharacterClaimRecord } from "@wcl/discord";
import type { WebEnv } from "../../config.js";
import { DISCORD_API_BASE_URL } from "./types.js";

export const allowedRevokeReasons = new Set([
    "player_left_guild",
    "character_inactive",
    "duplicate_wrong_character",
    "requested_by_player",
    "other",
]);

export const notifyClaimRevoked = async (
    env: WebEnv,
    claim: CharacterClaimRecord,
): Promise<boolean> => {
    try {
        const dmResponse = await fetch(`${DISCORD_API_BASE_URL}/users/@me/channels`, {
            method: "POST",
            headers: {
                Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
                "Content-Type": "application/json",
                "User-Agent": "DiscordBot (https://github.com/yay5a/wclogs.recap, 0.1.0)",
            },
            body: JSON.stringify({ recipient_id: claim.discordUserId }),
        });
        if (!dmResponse.ok) return false;
        const dm = (await dmResponse.json().catch(() => null)) as { id?: unknown } | null;
        if (typeof dm?.id !== "string") return false;
        const messageResponse = await fetch(`${DISCORD_API_BASE_URL}/channels/${dm.id}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
                "Content-Type": "application/json",
                "User-Agent": "DiscordBot (https://github.com/yay5a/wclogs.recap, 0.1.0)",
            },
            body: JSON.stringify({
                content: `Your approved character claim for ${claim.characterName} - ${claim.realm}-${claim.region} was removed by guild staff. Historical activity was not deleted.`,
                allowed_mentions: { parse: [] },
            }),
        });
        return messageResponse.ok;
    } catch {
        return false;
    }
};

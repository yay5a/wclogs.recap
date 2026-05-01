import { hasDiscordPermission } from "@wcl/domain";
import type { DiscordInteraction } from "../types.js";

export const canManageGuildConfig = (interaction: DiscordInteraction): boolean => {
    const permissions = interaction.member?.permissions;
    return hasDiscordPermission(permissions, "administrator") || hasDiscordPermission(permissions, "manage-guild");
};

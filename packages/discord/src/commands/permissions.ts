import { hasDiscordPermission } from '../discord-permissions.js';
import type { DiscordInteraction } from '../types.js';

const getPermissions = (interaction: DiscordInteraction): string | number | undefined =>
  interaction.member?.permissions;

export const canManageGuildConfig = (interaction: DiscordInteraction): boolean => {
  const permissions = getPermissions(interaction);
  return (
    hasDiscordPermission(permissions, 'administrator') ||
    hasDiscordPermission(permissions, 'manage-guild') ||
    hasDiscordPermission(permissions, 'manage-channels')
  );
};

export const canManageOfficers = (interaction: DiscordInteraction): boolean => {
  const permissions = getPermissions(interaction);
  return (
    hasDiscordPermission(permissions, 'administrator') ||
    hasDiscordPermission(permissions, 'manage-guild') ||
    hasDiscordPermission(permissions, 'manage-channels')
  );
};

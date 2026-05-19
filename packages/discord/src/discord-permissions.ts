const DISCORD_PERMISSION_BITS = {
  administrator: 0x8n,
  'manage-guild': 0x20n,
  'manage-channels': 0x10n,
} as const;

export type DiscordPermissionName = keyof typeof DISCORD_PERMISSION_BITS;

const parsePermissions = (value: string | number | bigint | null | undefined): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
};

export const hasDiscordPermission = (
  permissions: string | number | bigint | null | undefined,
  permission: DiscordPermissionName,
): boolean => {
  const parsed = parsePermissions(permissions);
  const bit = DISCORD_PERMISSION_BITS[permission];
  return (parsed & bit) === bit;
};

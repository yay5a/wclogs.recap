declare const DISCORD_PERMISSION_BITS: {
    readonly administrator: 8n;
    readonly 'manage-guild': 32n;
    readonly 'manage-channels': 16n;
};
export type DiscordPermissionName = keyof typeof DISCORD_PERMISSION_BITS;
export declare const hasDiscordPermission: (permissions: string | number | bigint | null | undefined, permission: DiscordPermissionName) => boolean;
export {};
//# sourceMappingURL=discord-permissions.d.ts.map
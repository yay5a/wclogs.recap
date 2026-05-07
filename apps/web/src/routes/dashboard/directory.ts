import type { GuildConfig } from "@wcl/domain";
import type { CharacterClaimRecord } from "@wcl/discord";
import type { WebEnv } from "../../config.js";
import {
    DIRECTORY_CACHE_TTL_MS,
    DISCORD_API_BASE_URL,
    type DashboardActivityRecord,
    type DashboardCharacterClaimStore,
    type DashboardDirectory,
    type DashboardResolvedLabel,
} from "./types.js";

const labelCache = new Map<string, { expiresAtMs: number; label: DashboardResolvedLabel }>();

export const getClaimsForDirectory = async (
    store: DashboardCharacterClaimStore | undefined,
    guildId: string,
): Promise<CharacterClaimRecord[]> => {
    if (!store) return [];
    const [pending, approved, revoked] = await Promise.all([
        store.listClaimsByStatus({ guildId, status: "pending" }),
        store.listClaimsByStatus({ guildId, status: "approved" }),
        store.listClaimsByStatus({ guildId, status: "revoked" }),
    ]);
    return [...pending, ...approved, ...revoked];
};

const fetchDiscordJson = async (endpoint: string, botToken: string): Promise<unknown | null> => {
    try {
        const response = await fetch(`${DISCORD_API_BASE_URL}${endpoint}`, {
            headers: {
                Authorization: `Bot ${botToken}`,
                "User-Agent": "DiscordBot (https://github.com/yay5a/wclogs.report, 0.1.0)",
            },
        });
        if (!response.ok) return null;
        return response.json().catch(() => null) as Promise<unknown | null>;
    } catch {
        return null;
    }
};

const cachedLabel = async (
    key: string,
    fallback: DashboardResolvedLabel,
    load: () => Promise<DashboardResolvedLabel>,
): Promise<DashboardResolvedLabel> => {
    const cached = labelCache.get(key);
    if (cached && Date.now() < cached.expiresAtMs) return cached.label;
    try {
        const label = await load();
        labelCache.set(key, { label, expiresAtMs: Date.now() + DIRECTORY_CACHE_TTL_MS });
        return label;
    } catch {
        return fallback;
    }
};

export const defaultDirectoryResolver =
    (env: WebEnv) =>
    async ({
        guildId,
        config,
        claims,
        activity,
    }: {
        guildId: string;
        config: GuildConfig;
        claims: CharacterClaimRecord[];
        activity: DashboardActivityRecord[];
    }): Promise<DashboardDirectory> => {
        const unresolved = (id: string): DashboardResolvedLabel => ({ id, label: id, resolved: false });
        const botToken = env.DISCORD_BOT_TOKEN;
        const channelIds = new Set(config.autoReportChannelIds);
        for (const event of activity) {
            if (event.channelId) channelIds.add(event.channelId);
        }
        const userIds = new Set(config.compareOfficerUserIds);
        for (const claim of claims) {
            userIds.add(claim.discordUserId);
            if (claim.reviewedByDiscordUserId) userIds.add(claim.reviewedByDiscordUserId);
            if (claim.revokedByDiscordUserId) userIds.add(claim.revokedByDiscordUserId);
        }
        for (const event of activity) {
            if (event.actor?.kind === "discord") userIds.add(event.actor.discordUserId);
            if (event.targetDiscordUserId) userIds.add(event.targetDiscordUserId);
        }

        const guild = await cachedLabel(`guild:${guildId}`, unresolved(guildId), async () => {
            const payload = await fetchDiscordJson(`/guilds/${guildId}`, botToken);
            if (typeof payload !== "object" || payload === null) return unresolved(guildId);
            const raw = payload as Record<string, unknown>;
            return typeof raw.name === "string"
                ? {
                      id: guildId,
                      label: raw.name,
                      resolved: true,
                      ...(typeof raw.icon === "string" ? { icon: raw.icon } : {}),
                  }
                : unresolved(guildId);
        });

        const rawChannels = await fetchDiscordJson(`/guilds/${guildId}/channels`, botToken);
        const channels: Record<string, DashboardResolvedLabel> = {};
        const channelPayloads = Array.isArray(rawChannels) ? rawChannels : [];
        for (const channelId of channelIds) {
            const found = channelPayloads.find(
                (entry) =>
                    typeof entry === "object" &&
                    entry !== null &&
                    (entry as { id?: unknown }).id === channelId,
            ) as { name?: unknown } | undefined;
            channels[channelId] =
                typeof found?.name === "string"
                    ? { id: channelId, label: `#${found.name}`, resolved: true }
                    : unresolved(channelId);
        }

        const users: Record<string, DashboardResolvedLabel> = {};
        await Promise.all(
            [...userIds].map(async (userId) => {
                users[userId] = await cachedLabel(`member:${guildId}:${userId}`, unresolved(userId), async () => {
                    const payload = await fetchDiscordJson(
                        `/guilds/${guildId}/members/${userId}`,
                        botToken,
                    );
                    if (typeof payload !== "object" || payload === null) return unresolved(userId);
                    const raw = payload as Record<string, unknown>;
                    const user =
                        typeof raw.user === "object" && raw.user !== null
                            ? (raw.user as Record<string, unknown>)
                            : {};
                    const label =
                        (typeof raw.nick === "string" && raw.nick) ||
                        (typeof user.global_name === "string" && user.global_name) ||
                        (typeof user.username === "string" && user.username) ||
                        "";
                    return label ? { id: userId, label, resolved: true } : unresolved(userId);
                });
            }),
        );

        return {
            guild,
            channels,
            users,
            generatedAt: new Date().toISOString(),
        };
    };

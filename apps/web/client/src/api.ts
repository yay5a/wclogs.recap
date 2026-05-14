export type CompareMode = "character" | "mixed";
export type CompareAccessMode =
    | "officer_only"
    | "owner_or_officer"
    | "owner_opt_in_or_officer"
    | "owner_only";
export type AutoReportMode = "off" | "prompt" | "auto_preview" | "auto_post";
export type GameFamily = "retail" | "mop_classic";

export type DashboardCapability =
    | "settings:view"
    | "settings:edit"
    | "officers:manage"
    | "claims:view"
    | "claims:approve"
    | "claims:reject"
    | "claims:revoke"
    | "activity:view"
    | "directory:view"
    | "guild:delete";

export type DashboardAuth =
    | { kind: "admin-secret" }
    | {
          kind: "discord";
          discordUserId: string;
          username: string;
          displayName: string;
      };

export type GuildConfig = {
    guildId: string;
    defaultGameFamily: GameFamily;
    compareModeDefault: CompareMode;
    compareAccessMode: CompareAccessMode;
    compareOfficerUserIds: string[];
    dashboardOfficerAccessEnabled: boolean;
    comparePublicPostingEnabled: boolean;
    autoReportMode: AutoReportMode;
    autoReportChannelIds: string[];
    wclGuildName?: string;
    wclGuildServerSlug?: string;
    wclGuildServerRegion?: string;
    wclZoneId?: number;
};

export type GuildSummary = {
    guildId: string;
    guildName?: string;
    capabilities?: DashboardCapability[];
    compareModeDefault: CompareMode;
    compareAccessMode: CompareAccessMode;
    comparePublicPostingEnabled: boolean;
    autoReportMode: AutoReportMode;
    defaultGameFamily: GameFamily;
    dashboardOfficerAccessEnabled: boolean;
    compareOfficerUserCount: number;
    autoReportChannelCount: number;
    updatedAt?: string;
};

export type ConfigPatch = Partial<
    Pick<
        GuildConfig,
        | "compareModeDefault"
        | "compareAccessMode"
        | "comparePublicPostingEnabled"
        | "autoReportMode"
        | "autoReportChannelIds"
        | "defaultGameFamily"
        | "dashboardOfficerAccessEnabled"
    >
>;

export type ClaimStatus = "pending" | "approved" | "revoked";

export type CharacterClaim = {
    claimId: string;
    guildId: string;
    discordUserId: string;
    participantKey: string;
    characterName: string;
    realm: string;
    region: string;
    status: ClaimStatus | "rejected";
    peerCompareOptIn: boolean;
    publicPostOptIn: boolean;
    requestedAt: string;
    reviewedAt?: string;
    reviewedByDiscordUserId?: string;
    revokedAt?: string;
    revokedByDiscordUserId?: string;
    revokeReason?: string;
};

export type ActivityEvent = {
    guildId: string;
    channelId?: string;
    sourceMessageId?: string;
    actor?: { kind: "discord"; discordUserId: string } | { kind: "admin-secret" } | { kind: "system" };
    kind: string;
    reportCode?: string;
    sourceUrl?: string;
    discordMessageUrl?: string;
    characterLabel?: string;
    targetDiscordUserId?: string;
    createdAt: string;
};

export type ResolvedLabel = {
    id: string;
    label: string;
    resolved: boolean;
    icon?: string | null;
};

export type Directory = {
    guild: ResolvedLabel;
    channels: Record<string, ResolvedLabel>;
    users: Record<string, ResolvedLabel>;
    generatedAt: string;
};

export type OnboardingState = {
    userKey: string;
    guildId?: string;
    seenSteps: string[];
    dismissedAt?: string;
    onboardingVersion: number;
};

const dashboardRequestHeader = { "X-Dashboard-Request": "1" };

const parseJson = async <T>(response: Response): Promise<T> => {
    const payload = (await response.json().catch(() => ({}))) as T | { error?: string };
    if (!response.ok) {
        const message =
            typeof (payload as { error?: unknown }).error === "string"
                ? (payload as { error: string }).error
                : `Request failed with ${response.status}`;
        throw new Error(message);
    }
    return payload as T;
};

export const api = {
    async login(adminSecret: string): Promise<void> {
        await parseJson<{ ok: true }>(
            await fetch("/api/dashboard/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ adminSecret }),
            }),
        );
    },

    discordLoginUrl(): string {
        return "/api/dashboard/discord/login";
    },

    async logout(): Promise<void> {
        await parseJson<{ ok: true }>(
            await fetch("/api/dashboard/logout", {
                method: "POST",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
    },

    async session(): Promise<DashboardAuth | null> {
        const response = await fetch("/api/dashboard/session", { credentials: "same-origin" });
        if (response.status === 401) return null;
        const payload = await parseJson<{ authenticated: true; auth: DashboardAuth }>(response);
        return payload.auth;
    },

    async listGuilds(): Promise<GuildSummary[]> {
        const payload = await parseJson<{ guilds: GuildSummary[] }>(
            await fetch("/api/dashboard/guilds", { credentials: "same-origin" }),
        );
        return payload.guilds;
    },

    async createGuild(guildId: string): Promise<GuildConfig> {
        const payload = await parseJson<{ config: GuildConfig }>(
            await fetch("/api/dashboard/guilds", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...dashboardRequestHeader },
                credentials: "same-origin",
                body: JSON.stringify({ guildId }),
            }),
        );
        return payload.config;
    },

    async deconfigureGuild(guildId: string): Promise<void> {
        await parseJson<{ ok: true }>(
            await fetch(`/api/dashboard/guilds/${guildId}`, {
                method: "DELETE",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
    },

    async getConfig(guildId: string): Promise<GuildConfig> {
        const payload = await parseJson<{ config: GuildConfig }>(
            await fetch(`/api/dashboard/guilds/${guildId}/config`, {
                credentials: "same-origin",
            }),
        );
        return payload.config;
    },

    async saveConfig(guildId: string, patch: ConfigPatch): Promise<GuildConfig> {
        const payload = await parseJson<{ config: GuildConfig }>(
            await fetch(`/api/dashboard/guilds/${guildId}/config`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...dashboardRequestHeader },
                credentials: "same-origin",
                body: JSON.stringify(patch),
            }),
        );
        return payload.config;
    },

    async addOfficer(guildId: string, discordUserId: string): Promise<GuildConfig> {
        const payload = await parseJson<{ config: GuildConfig }>(
            await fetch(`/api/dashboard/guilds/${guildId}/officers/${discordUserId}`, {
                method: "POST",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
        return payload.config;
    },

    async removeOfficer(guildId: string, discordUserId: string): Promise<GuildConfig> {
        const payload = await parseJson<{ config: GuildConfig }>(
            await fetch(`/api/dashboard/guilds/${guildId}/officers/${discordUserId}`, {
                method: "DELETE",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
        return payload.config;
    },

    async getDirectory(guildId: string): Promise<Directory> {
        const payload = await parseJson<{ directory: Directory }>(
            await fetch(`/api/dashboard/guilds/${guildId}/directory`, {
                credentials: "same-origin",
            }),
        );
        return payload.directory;
    },

    async listClaims(guildId: string, status: ClaimStatus): Promise<CharacterClaim[]> {
        const payload = await parseJson<{ claims: CharacterClaim[] }>(
            await fetch(`/api/dashboard/guilds/${guildId}/claims?status=${status}`, {
                credentials: "same-origin",
            }),
        );
        return payload.claims;
    },

    async approveClaim(guildId: string, claimId: string): Promise<CharacterClaim> {
        const payload = await parseJson<{ claim: CharacterClaim }>(
            await fetch(`/api/dashboard/guilds/${guildId}/claims/${claimId}/approve`, {
                method: "POST",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
        return payload.claim;
    },

    async rejectClaim(guildId: string, claimId: string): Promise<CharacterClaim> {
        const payload = await parseJson<{ claim: CharacterClaim }>(
            await fetch(`/api/dashboard/guilds/${guildId}/claims/${claimId}/reject`, {
                method: "POST",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
        return payload.claim;
    },

    async revokeClaim(
        guildId: string,
        claimId: string,
        revokeReason: string,
    ): Promise<CharacterClaim> {
        const payload = await parseJson<{ claim: CharacterClaim }>(
            await fetch(`/api/dashboard/guilds/${guildId}/claims/${claimId}/revoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...dashboardRequestHeader },
                credentials: "same-origin",
                body: JSON.stringify({ revokeReason }),
            }),
        );
        return payload.claim;
    },

    async listActivity(guildId: string): Promise<ActivityEvent[]> {
        const payload = await parseJson<{ activity: ActivityEvent[] }>(
            await fetch(`/api/dashboard/guilds/${guildId}/activity`, {
                credentials: "same-origin",
            }),
        );
        return payload.activity;
    },

    async getOnboarding(guildId: string): Promise<OnboardingState> {
        const payload = await parseJson<{ onboarding: OnboardingState }>(
            await fetch(`/api/dashboard/guilds/${guildId}/onboarding`, {
                credentials: "same-origin",
            }),
        );
        return payload.onboarding;
    },

    async saveOnboarding(
        guildId: string,
        input: { seenSteps: string[]; dismissed?: boolean },
    ): Promise<OnboardingState> {
        const payload = await parseJson<{ onboarding: OnboardingState }>(
            await fetch(`/api/dashboard/guilds/${guildId}/onboarding`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...dashboardRequestHeader },
                credentials: "same-origin",
                body: JSON.stringify(input),
            }),
        );
        return payload.onboarding;
    },
};

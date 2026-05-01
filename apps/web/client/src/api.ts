export type CompareMode = "character" | "mixed";
export type CompareAccessMode =
    | "officer_only"
    | "owner_or_officer"
    | "owner_opt_in_or_officer"
    | "owner_only";
export type AutoRecapMode = "off" | "prompt" | "auto_preview" | "auto_post";
export type GameFamily = "retail" | "mop_classic";

export type GuildConfig = {
    guildId: string;
    defaultGameFamily: GameFamily;
    compareModeDefault: CompareMode;
    compareAccessMode: CompareAccessMode;
    compareOfficerUserIds: string[];
    comparePublicPostingEnabled: boolean;
    accountabilityVisibility: string;
    coachingShareabilityDefault: string;
    recapPostModeDefault: string;
    autoRecapMode: AutoRecapMode;
    autoRecapChannelIds: string[];
};

export type GuildSummary = {
    guildId: string;
    compareModeDefault: CompareMode;
    compareAccessMode: CompareAccessMode;
    comparePublicPostingEnabled: boolean;
    autoRecapMode: AutoRecapMode;
    defaultGameFamily: GameFamily;
    compareOfficerUserCount: number;
    autoRecapChannelCount: number;
    updatedAt?: string;
};

export type ConfigPatch = Partial<
    Pick<
        GuildConfig,
        | "compareModeDefault"
        | "compareAccessMode"
        | "comparePublicPostingEnabled"
        | "autoRecapMode"
        | "autoRecapChannelIds"
        | "defaultGameFamily"
    >
>;

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

    async logout(): Promise<void> {
        await parseJson<{ ok: true }>(
            await fetch("/api/dashboard/logout", {
                method: "POST",
                headers: dashboardRequestHeader,
                credentials: "same-origin",
            }),
        );
    },

    async session(): Promise<boolean> {
        const response = await fetch("/api/dashboard/session", {
            credentials: "same-origin",
        });
        if (response.status === 401) return false;
        await parseJson<{ authenticated: true }>(response);
        return true;
    },

    async listGuilds(): Promise<GuildSummary[]> {
        const payload = await parseJson<{ guilds: GuildSummary[] }>(
            await fetch("/api/dashboard/guilds", {
                credentials: "same-origin",
            }),
        );
        return payload.guilds;
    },

    async createGuild(guildId: string): Promise<GuildConfig> {
        const payload = await parseJson<{ config: GuildConfig }>(
            await fetch("/api/dashboard/guilds", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...dashboardRequestHeader,
                },
                credentials: "same-origin",
                body: JSON.stringify({ guildId }),
            }),
        );
        return payload.config;
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
                headers: {
                    "Content-Type": "application/json",
                    ...dashboardRequestHeader,
                },
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
};

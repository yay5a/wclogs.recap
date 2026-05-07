import type { FastifyRequest } from "fastify";
import type {
    AutoReportMode,
    BotActivityEvent,
    BotActivityStore,
    CharacterClaimStatus,
    CompareAccessMode,
    CompareMode,
    GameFamily,
    GuildConfig,
    GuildConfigStore,
} from "@wcl/domain";
import type { CharacterClaimRecord, CharacterClaimStore } from "@wcl/discord";
import type { WebEnv } from "../../config.js";

export const DASHBOARD_COOKIE_NAME = "wcl_dashboard";
export const DASHBOARD_SESSION_TTL_MS = 60 * 60 * 1000;
export const DASHBOARD_COOKIE_PATH = "/api/dashboard";
export const DASHBOARD_OAUTH_STATE_COOKIE_NAME = "wcl_dashboard_oauth_state";
export const DASHBOARD_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const DASHBOARD_REQUEST_HEADER = "x-dashboard-request";
export const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
export const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;
export const CLAIM_ID_RE = /^[a-zA-Z0-9:_-]{8,80}$/;
export const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;
export const ONBOARDING_VERSION = 1;

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

export const ADMIN_CAPABILITIES: DashboardCapability[] = [
    "settings:view",
    "settings:edit",
    "officers:manage",
    "claims:view",
    "claims:approve",
    "claims:reject",
    "claims:revoke",
    "activity:view",
    "directory:view",
    "guild:delete",
];

export const GUILD_MANAGER_CAPABILITIES: DashboardCapability[] = [
    "settings:view",
    "settings:edit",
    "officers:manage",
    "claims:view",
    "claims:approve",
    "claims:reject",
    "claims:revoke",
    "activity:view",
    "directory:view",
];

export const OFFICER_CAPABILITIES: DashboardCapability[] = [
    "settings:view",
    "claims:view",
    "claims:approve",
    "claims:reject",
    "claims:revoke",
    "activity:view",
    "directory:view",
];

export type DashboardOAuthGuild = {
    id: string;
    name: string;
    icon?: string | null;
    owner: boolean;
    permissions?: string;
};

export type DashboardAuthContext =
    | { kind: "admin-secret" }
    | {
          kind: "discord";
          discordUserId: string;
          username: string;
          displayName: string;
          oauthGuildsById: Record<string, DashboardOAuthGuild>;
      };

export type DashboardGuildConfigSummary = {
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

export type DashboardConfigPatch = Partial<
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

export interface DashboardGuildConfigStore extends GuildConfigStore {
    listGuildConfigSummaries(): Promise<DashboardGuildConfigSummary[]>;
    listGuildConfigSummariesForGuilds(guildIds: string[]): Promise<DashboardGuildConfigSummary[]>;
    getExistingGuildConfig(guildId: string): Promise<GuildConfig | null>;
    createDefaultGuildConfig(guildId: string): Promise<GuildConfig>;
    saveExistingGuildConfig(
        guildId: string,
        update: DashboardConfigPatch,
    ): Promise<GuildConfig | null>;
    addOfficerToExistingGuild(
        guildId: string,
        discordUserId: string,
    ): Promise<GuildConfig | null>;
    removeOfficerFromExistingGuild(
        guildId: string,
        discordUserId: string,
    ): Promise<GuildConfig | null>;
    deconfigureExistingGuild?(guildId: string): Promise<boolean>;
}

export interface DashboardCharacterClaimStore extends CharacterClaimStore {
    listClaimsByStatus(input: {
        guildId: string;
        status: CharacterClaimStatus;
    }): Promise<CharacterClaimRecord[]>;
    approveClaimById(input: {
        guildId: string;
        claimId: string;
        reviewedByDiscordUserId?: string | undefined;
    }): Promise<CharacterClaimRecord | null>;
    rejectClaimById(input: {
        guildId: string;
        claimId: string;
        reviewedByDiscordUserId?: string | undefined;
    }): Promise<CharacterClaimRecord | null>;
    revokeClaimById(input: {
        guildId: string;
        claimId: string;
        revokedByDiscordUserId?: string | undefined;
        revokeReason?: string | undefined;
    }): Promise<CharacterClaimRecord | null>;
}

export interface DashboardActivityStore extends BotActivityStore {
    listActivity(input: { guildId: string; limit?: number }): Promise<DashboardActivityRecord[]>;
    archiveGuildActivity?(guildId: string): Promise<void>;
}

export type DashboardActivityRecord = BotActivityEvent & {
    expiresAt?: Date;
    archivedAt?: Date;
};

export interface DashboardOnboardingState {
    userKey: string;
    guildId?: string;
    seenSteps: string[];
    dismissedAt?: Date;
    onboardingVersion: number;
}

export interface DashboardOnboardingStore {
    getOnboardingState(input: {
        userKey: string;
        guildId?: string;
        onboardingVersion: number;
    }): Promise<DashboardOnboardingState>;
    saveOnboardingState(input: DashboardOnboardingState): Promise<DashboardOnboardingState>;
    archiveGuildOnboarding?(guildId: string): Promise<void>;
}

export type DashboardResolvedLabel = {
    id: string;
    label: string;
    resolved: boolean;
    icon?: string | null;
};

export type DashboardDirectory = {
    guild: DashboardResolvedLabel;
    channels: Record<string, DashboardResolvedLabel>;
    users: Record<string, DashboardResolvedLabel>;
    generatedAt: string;
};

export type DashboardRouteOptions = {
    env: WebEnv;
    guildConfigStore: DashboardGuildConfigStore;
    characterClaimStore?: DashboardCharacterClaimStore | undefined;
    activityStore?: DashboardActivityStore | undefined;
    onboardingStore?: DashboardOnboardingStore | undefined;
    directoryResolver?: (input: {
        guildId: string;
        config: GuildConfig;
        claims: CharacterClaimRecord[];
        activity: DashboardActivityRecord[];
    }) => Promise<DashboardDirectory>;
};

export type DashboardAuthedRequest = FastifyRequest & {
    dashboardAuth?: DashboardAuthContext;
};

export type DashboardSessionRecord = {
    auth: DashboardAuthContext;
    expiresAtMs: number;
};

export type DashboardOAuthStateRecord = {
    expiresAtMs: number;
};

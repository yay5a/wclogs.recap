export type GameFamily = "retail" | "mop_classic";
export type CompareMode = "character" | "mixed";
export type AccountabilityVisibility = "off" | "officers-only" | "shareable";
export type CoachingShareability = "private" | "shareable";
export type RecapPostMode = "preview-and-post" | "preview-only";
export interface GuildConfig {
    guildId: string;
    defaultGameFamily: GameFamily;
    compareModeDefault: CompareMode;
    accountabilityVisibility: AccountabilityVisibility;
    coachingShareabilityDefault: CoachingShareability;
    recapPostModeDefault: RecapPostMode;
}
export interface GuildConfigStore {
    getGuildConfig(guildId: string): Promise<GuildConfig>;
    saveGuildConfig(guildId: string, update: Partial<Omit<GuildConfig, "guildId">>): Promise<GuildConfig>;
}
export declare const defaultGuildConfigFor: (guildId: string) => GuildConfig;
export interface NormalizedPlayer {
    id: string;
    name: string;
    realm?: string;
    className?: string;
    specName?: string;
    bestParse?: number;
    avgParse?: number;
    executionScore?: number;
}
export interface NormalizedFight {
    id: number;
    name: string;
    startTime: number;
    endTime: number;
    kill: boolean;
}
export interface NormalizedReport {
    reportCode: string;
    title: string;
    startTime: number;
    endTime: number;
    gameFamily: GameFamily;
    zoneName?: string;
    fights: NormalizedFight[];
    players: NormalizedPlayer[];
}
export interface RecapSummary {
    reportTitle: string;
    reportDateISO: string;
    gameFamily: GameFamily;
    zoneName?: string;
    bossesKilled: number;
    compareModeUsed: CompareMode;
    accountabilityVisibility: AccountabilityVisibility;
    coachingShareability: CoachingShareability;
    recapPostMode: RecapPostMode;
    bestSingleBossParse?: {
        playerName: string;
        value: number;
    };
    bestAverageParse?: {
        playerName: string;
        value: number;
    };
    bestExecution?: {
        playerName: string;
        value: number;
    };
    mostImprovedPlayer?: {
        playerName: string;
        delta: number;
    };
    teamNote: string;
}
export interface PreviousRaidLookup {
    findPreviousRaidSummaries(guildId: string, beforeDate: Date): Promise<NormalizedPlayer[]>;
}
export declare const deriveDeterministicTeamNote: (bossesKilled: number) => string;
interface BuildRecapSummaryOptions {
    guildConfig?: GuildConfig;
}
export declare const buildRecapSummary: (report: NormalizedReport, previousPlayers?: NormalizedPlayer[], options?: BuildRecapSummaryOptions) => RecapSummary;
export interface CoachingViewService {
    buildShareableCoachingView(reportCode: string): Promise<unknown>;
}
export interface AccountabilityViewService {
    buildAccountabilityView(reportCode: string, visibility: AccountabilityVisibility): Promise<unknown>;
}
export interface TrendTrackingService {
    ingestRaidHistory(guildId: string, report: NormalizedReport): Promise<void>;
    recomputeTrendsForGuild(guildId: string): Promise<void>;
}
export interface SubscriptionService {
    scheduleReportSubscription(guildId: string, channelId: string): Promise<void>;
}
export interface IdentityMergeReviewService {
    enqueueCandidateReview(profileId: string): Promise<void>;
}
export {};
//# sourceMappingURL=index.d.ts.map
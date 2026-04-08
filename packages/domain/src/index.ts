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
    saveGuildConfig(
        guildId: string,
        update: Partial<Omit<GuildConfig, "guildId">>,
    ): Promise<GuildConfig>;
}

export const defaultGuildConfigFor = (guildId: string): GuildConfig => ({
    guildId,
    defaultGameFamily: "retail",
    compareModeDefault: "character",
    accountabilityVisibility: "off",
    coachingShareabilityDefault: "private",
    recapPostModeDefault: "preview-and-post",
});

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
    bestSingleBossParse?: { playerName: string; value: number };
    bestAverageParse?: { playerName: string; value: number };
    bestExecution?: { playerName: string; value: number };
    mostImprovedPlayer?: { playerName: string; delta: number };
    teamNote: string;
}

export interface PreviousRaidLookup {
    findPreviousRaidSummaries(
        guildId: string,
        beforeDate: Date,
    ): Promise<NormalizedPlayer[]>;
}

export const deriveDeterministicTeamNote = (bossesKilled: number): string => {
    if (bossesKilled >= 8)
        return "Team note: Full-clear momentum is strong; capture callout clips.";
    if (bossesKilled >= 4)
        return "Team note: Progress is stable; set one focus mechanic for next raid.";
    return "Team note: Early progression week; prioritize clean mechanic reps.";
};

interface BuildRecapSummaryOptions {
    guildConfig?: GuildConfig;
}

export const buildRecapSummary = (
    report: NormalizedReport,
    previousPlayers?: NormalizedPlayer[],
    options?: BuildRecapSummaryOptions,
): RecapSummary => {
    const killed = report.fights.filter((f) => f.kill).length;
    const byParse = [...report.players]
        .filter((p) => typeof p.bestParse === "number")
        .sort((a, b) => (b.bestParse ?? 0) - (a.bestParse ?? 0));
    const byAvg = [...report.players]
        .filter((p) => typeof p.avgParse === "number")
        .sort((a, b) => (b.avgParse ?? 0) - (a.avgParse ?? 0));
    const byExec = [...report.players]
        .filter((p) => typeof p.executionScore === "number")
        .sort((a, b) => (b.executionScore ?? 0) - (a.executionScore ?? 0));

    const previousByName = new Map(
        (previousPlayers ?? []).map((p) => [p.name, p]),
    );
    const improved = report.players
        .map((p) => {
            const prev = previousByName.get(p.name);
            if (
                !prev ||
                typeof p.avgParse !== "number" ||
                typeof prev.avgParse !== "number"
            )
                return undefined;
            return { playerName: p.name, delta: p.avgParse - prev.avgParse };
        })
        .filter((x): x is { playerName: string; delta: number } => Boolean(x))
        .sort((a, b) => b.delta - a.delta);

    const guildConfig = options?.guildConfig;
    const summary: RecapSummary = {
        reportTitle: report.title,
        reportDateISO: new Date(report.startTime).toISOString(),
        gameFamily: report.gameFamily,
        bossesKilled: killed,
        compareModeUsed: guildConfig?.compareModeDefault ?? "character",
        accountabilityVisibility:
            guildConfig?.accountabilityVisibility ?? "off",
        coachingShareability:
            guildConfig?.coachingShareabilityDefault ?? "private",
        recapPostMode: guildConfig?.recapPostModeDefault ?? "preview-and-post",
        teamNote: deriveDeterministicTeamNote(killed),
    };

    if (report.zoneName) summary.zoneName = report.zoneName;
    if (byParse[0])
        summary.bestSingleBossParse = {
            playerName: byParse[0].name,
            value: byParse[0].bestParse ?? 0,
        };
    if (byAvg[0])
        summary.bestAverageParse = {
            playerName: byAvg[0].name,
            value: byAvg[0].avgParse ?? 0,
        };
    if (byExec[0])
        summary.bestExecution = {
            playerName: byExec[0].name,
            value: byExec[0].executionScore ?? 0,
        };
    if (improved[0] && improved[0].delta > 0)
        summary.mostImprovedPlayer = improved[0];

    return summary;
};

export interface CoachingViewService {
    buildShareableCoachingView(reportCode: string): Promise<unknown>;
}

export interface AccountabilityViewService {
    buildAccountabilityView(
        reportCode: string,
        visibility: AccountabilityVisibility,
    ): Promise<unknown>;
}

export interface TrendTrackingService {
    ingestRaidHistory(guildId: string, report: NormalizedReport): Promise<void>;
    recomputeTrendsForGuild(guildId: string): Promise<void>;
}

export interface SubscriptionService {
    scheduleReportSubscription(
        guildId: string,
        channelId: string,
    ): Promise<void>;
}

export interface IdentityMergeReviewService {
    enqueueCandidateReview(profileId: string): Promise<void>;
}

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
    actorId?: number;
    name: string;
    nameKey?: string;
    realm?: string;
    className?: string;
    specName?: string;
    role?: string;
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

export interface NormalizedLeaderboardEntry {
    scope: "report" | "boss";
    bossName?: string;
    fightId?: number;
    playerId?: number;
    playerName?: string;
    className?: string;
    specName?: string;
    role?: string;
    metric: string;
    selectedMetric?: string;
    value: number;
    rank?: number;
}

export interface NormalizedBossPerformance {
    bossName: string;
    fightId: number;
    encounterId?: number;
    difficulty?: number;
    difficultyName?: string;
    kill?: boolean;
    pullCount?: number;
    fightDate?: number;
    fightDurationMs?: number;
    guildName?: string;
    realmName?: string;
    zoneName?: string;
    reportUrl?: string;
    fastestPhaseTimes?: Array<{
        phaseId: number;
        label: string;
        name?: string;
        durationMs: number;
    }>;
    bestParses?: Array<{
        playerName: string;
        parse: number;
        amount?: number;
        metric?: string;
        className?: string;
        specName?: string;
    }>;
    topDamageTaken?: Array<{
        playerName: string;
        value: number;
        className?: string;
        specName?: string;
    }>;
    topHealers?: Array<{
        playerName: string;
        value: number;
        className?: string;
        specName?: string;
    }>;
    deaths?: number;
    raidDamageTaken?: number;
    dispels?: number;
    battleRezzes?: number;
    kicks?: number;
    topParse?: NormalizedLeaderboardEntry;
    topDamage?: { playerName: string; value: number };
    topHealing?: { playerName: string; value: number };
    mostDeaths?: { playerName: string; value: number };
    topInterrupts?: { playerName: string; value: number };
    topSurvivability?: { playerName: string; value: number };
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
    leaderboards?: NormalizedLeaderboardEntry[];
    bossPerformances?: NormalizedBossPerformance[];
}

export interface RecapSummary {
    reportTitle: string;
    titleLine: string;
    secondaryLine: string;
    reportDateISO: string;
    reportDateLabel: string;
    killTimeLabel: string;
    pullCount: number;
    reportLink: string;
    gameFamily: GameFamily;
    zoneName?: string;
    bossesKilled: number;
    compareModeUsed: CompareMode;
    accountabilityVisibility: AccountabilityVisibility;
    coachingShareability: CoachingShareability;
    recapPostMode: RecapPostMode;
    fastestPhaseTimes: Array<{ label: string; durationMs: number; name?: string }>;
    bestPlayerParses: Array<{
        playerName: string;
        parse: number;
        metricLabel: string;
        amount?: number;
        classSpecLabel?: string;
    }>;
    topDamageTaken: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
    topHealers: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
    totals: {
        totalDeaths: number;
        mostWipesBoss?: string;
        mostWipesCount?: number;
        raidDamageTaken: number;
        dispels: number;
        battleRezzes: number;
        kicks: number;
    };
    bestSingleBossParse?: {
        playerName: string;
        value: number;
        bossName: string;
        fightId: number;
        metric: string;
    };
    bestAverageParse?: { playerName: string; value: number; metric: string };
    bestExecution?: { playerName: string; value: number };
    mostImprovedPlayer?: { playerName: string; delta: number };
    topOverallParsers: Array<{
        playerName: string;
        value: number;
        metric: string;
    }>;
    bossHighlights: Array<{ bossName: string; fightId: number; text: string }>;
    raidSuperlatives: Array<{ label: string; text: string }>;
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

const toMetricLabel = (value: string | undefined): string => {
    if (!value) return "DPS";
    return value
        .replace(/([A-Z])/g, " $1")
        .replace(/[_-]/g, " ")
        .trim()
        .toUpperCase();
};

const formatDateMmDdYyyy = (timestampMs: number): string => {
    const date = new Date(timestampMs);
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const year = String(date.getUTCFullYear());
    return `${month}/${day}/${year}`;
};

const formatDurationMmSs = (durationMs: number): string => {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const toClassSpecLabel = (className?: string, specName?: string): string | undefined => {
    if (specName && className) return `${specName} ${className}`;
    return specName ?? className;
};

export const buildRecapSummary = (
    report: NormalizedReport,
    previousPlayers?: NormalizedPlayer[],
    options?: BuildRecapSummaryOptions,
): RecapSummary => {
    void previousPlayers;
    const killed = report.fights.filter((f) => f.kill).length;

    const guildConfig = options?.guildConfig;
    const bossPerformances = [...(report.bossPerformances ?? [])];
    const selectedBoss =
        [...bossPerformances]
            .filter((boss) => boss.kill)
            .sort((left, right) => (right.fightDate ?? 0) - (left.fightDate ?? 0))[0] ??
        [...bossPerformances].sort(
            (left, right) => (right.fightDate ?? 0) - (left.fightDate ?? 0),
        )[0];

    const bossName = selectedBoss?.bossName ?? report.fights.at(-1)?.name ?? report.title;
    const difficultyLabel = selectedBoss?.difficultyName ?? "Unknown Difficulty";
    const zoneName = selectedBoss?.zoneName ?? report.zoneName;
    const titleLine = `${bossName} - ${difficultyLabel}${zoneName ? ` - ${zoneName}` : ""}`;
    const secondaryLine = selectedBoss?.guildName
        ? `${selectedBoss.guildName} on ${selectedBoss.realmName ?? "Unknown Realm"}`
        : "Unknown Guild on Unknown Realm";
    const pullCount = selectedBoss?.pullCount ?? 0;
    const killTimeLabel = formatDurationMmSs(selectedBoss?.fightDurationMs ?? 0);
    const reportDateMs = selectedBoss?.fightDate ?? report.startTime;

    const bestPlayerParses = (selectedBoss?.bestParses ?? [])
        .slice(0, 3)
        .map((entry) => {
            const classSpecLabel = toClassSpecLabel(
                entry.className,
                entry.specName,
            );
            return {
                playerName: entry.playerName,
                parse: entry.parse,
                metricLabel: toMetricLabel(entry.metric),
                ...(typeof entry.amount === "number"
                    ? { amount: entry.amount }
                    : {}),
                ...(classSpecLabel ? { classSpecLabel } : {}),
            };
        });
    const topDamageTaken = (selectedBoss?.topDamageTaken ?? [])
        .slice(0, 3)
        .map((entry) => {
            const classSpecLabel = toClassSpecLabel(
                entry.className,
                entry.specName,
            );
            return {
                playerName: entry.playerName,
                value: entry.value,
                ...(classSpecLabel ? { classSpecLabel } : {}),
            };
        });
    const topHealers = (selectedBoss?.topHealers ?? []).slice(0, 3).map((entry) => {
        const classSpecLabel = toClassSpecLabel(entry.className, entry.specName);
        return {
            playerName: entry.playerName,
            value: entry.value,
            ...(classSpecLabel ? { classSpecLabel } : {}),
        };
    });

    const mostWipesEntry = [...bossPerformances]
        .map((boss) => ({
            bossName: boss.bossName,
            wipes: Math.max(0, (boss.pullCount ?? 0) - (boss.kill ? 1 : 0)),
        }))
        .sort((left, right) => right.wipes - left.wipes)[0];

    const summary: RecapSummary = {
        reportTitle: titleLine,
        titleLine,
        secondaryLine,
        reportDateISO: new Date(reportDateMs).toISOString(),
        reportDateLabel: formatDateMmDdYyyy(reportDateMs),
        killTimeLabel,
        pullCount,
        reportLink:
            selectedBoss?.reportUrl ??
            `https://www.warcraftlogs.com/reports/${report.reportCode}`,
        gameFamily: report.gameFamily,
        bossesKilled: killed,
        compareModeUsed: guildConfig?.compareModeDefault ?? "character",
        accountabilityVisibility:
            guildConfig?.accountabilityVisibility ?? "off",
        coachingShareability:
            guildConfig?.coachingShareabilityDefault ?? "private",
        recapPostMode: guildConfig?.recapPostModeDefault ?? "preview-and-post",
        fastestPhaseTimes: (selectedBoss?.fastestPhaseTimes ?? []).map((phase) => ({
            label: phase.label,
            durationMs: phase.durationMs,
            ...(phase.name ? { name: phase.name } : {}),
        })),
        bestPlayerParses,
        topDamageTaken,
        topHealers,
        totals: {
            totalDeaths: selectedBoss?.deaths ?? 0,
            ...(mostWipesEntry && mostWipesEntry.wipes > 0
                ? {
                      mostWipesBoss: mostWipesEntry.bossName,
                      mostWipesCount: mostWipesEntry.wipes,
                  }
                : {}),
            raidDamageTaken: selectedBoss?.raidDamageTaken ?? 0,
            dispels: selectedBoss?.dispels ?? 0,
            battleRezzes: selectedBoss?.battleRezzes ?? 0,
            kicks: selectedBoss?.kicks ?? 0,
        },
        topOverallParsers: [],
        bossHighlights: [],
        raidSuperlatives: [],
        teamNote: deriveDeterministicTeamNote(killed),
    };

    if (zoneName) summary.zoneName = zoneName;

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

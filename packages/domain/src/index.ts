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

const pushUniqueSuperlative = (
    target: Array<{ label: string; text: string }>,
    label: string,
    text: string,
): void => {
    if (target.some((x) => x.label === label && x.text === text)) return;
    target.push({ label, text });
};

const hasPlayerIdentity = (
    entry: NormalizedLeaderboardEntry | undefined,
): entry is NormalizedLeaderboardEntry & {
    playerId: number;
    playerName: string;
} => typeof entry?.playerId === "number" && Boolean(entry.playerName);

const hasBossFightLinkage = (
    entry: NormalizedLeaderboardEntry | undefined,
): entry is NormalizedLeaderboardEntry & {
    bossName: string;
    fightId: number;
} => Boolean(entry?.bossName) && typeof entry?.fightId === "number";

export const buildRecapSummary = (
    report: NormalizedReport,
    previousPlayers?: NormalizedPlayer[],
    options?: BuildRecapSummaryOptions,
): RecapSummary => {
    const killed = report.fights.filter((f) => f.kill).length;

    const reportLeaderboard = (report.leaderboards ?? []).filter(
        (entry) => entry.scope === "report",
    );
    const bossLeaderboard = (report.leaderboards ?? []).filter(
        (entry) => entry.scope === "boss",
    );

    // Metric assumption (phase 1): rankings(playerMetric: default) is treated as parse-like percentile.
    const byReportValue = [...reportLeaderboard].sort(
        (a, b) => b.value - a.value,
    );
    const byBossValue = [...bossLeaderboard].sort((a, b) => b.value - a.value);

    const byParseFallback = [...report.players]
        .filter((p) => typeof p.bestParse === "number")
        .sort((a, b) => (b.bestParse ?? 0) - (a.bestParse ?? 0));
    const byExec = [...report.players]
        .filter((p) => typeof p.executionScore === "number")
        .sort((a, b) => (b.executionScore ?? 0) - (a.executionScore ?? 0));

    const previousByActorId = new Map(
        (previousPlayers ?? [])
            .filter((player) => typeof player.actorId === "number")
            .map((player) => [player.actorId as number, player]),
    );
    const previousByName = new Map(
        (previousPlayers ?? []).map((player) => [
            player.name.toLowerCase(),
            player,
        ]),
    );
    const improved = report.players
        .map((player) => {
            const previous =
                (typeof player.actorId === "number"
                    ? previousByActorId.get(player.actorId)
                    : undefined) ??
                previousByName.get(player.name.toLowerCase());
            if (
                !previous ||
                typeof player.avgParse !== "number" ||
                typeof previous.avgParse !== "number"
            ) {
                return undefined;
            }
            return {
                playerName: player.name,
                delta: player.avgParse - previous.avgParse,
            };
        })
        .filter((value): value is { playerName: string; delta: number } =>
            Boolean(value),
        )
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
        topOverallParsers: [],
        bossHighlights: [],
        raidSuperlatives: [],
        teamNote: deriveDeterministicTeamNote(killed),
    };

    if (report.zoneName) summary.zoneName = report.zoneName;

    for (const entry of byReportValue.slice(0, 3)) {
        if (!hasPlayerIdentity(entry)) continue;
        summary.topOverallParsers.push({
            playerName: entry.playerName,
            value: entry.value,
            metric: entry.metric,
        });
    }
    if (summary.topOverallParsers.length === 0) {
        for (const player of byParseFallback.slice(0, 3)) {
            summary.topOverallParsers.push({
                playerName: player.name,
                value: player.bestParse ?? 0,
                metric: "bestParse",
            });
        }
    }

    const topReport = byReportValue.find((entry) => hasPlayerIdentity(entry));
    if (topReport) {
        summary.bestAverageParse = {
            playerName: topReport.playerName,
            value: topReport.value,
            metric: topReport.metric,
        };
    }

    const topBoss = byBossValue.find(
        (entry) => hasPlayerIdentity(entry) && hasBossFightLinkage(entry),
    );
    if (topBoss) {
        summary.bestSingleBossParse = {
            playerName: topBoss.playerName,
            value: topBoss.value,
            bossName: topBoss.bossName,
            fightId: topBoss.fightId,
            metric: topBoss.metric,
        };
    }

    if (byExec[0]) {
        summary.bestExecution = {
            playerName: byExec[0].name,
            value: byExec[0].executionScore ?? 0,
        };
    }

    if (improved[0] && improved[0].delta > 0) {
        summary.mostImprovedPlayer = improved[0];
    }

    for (const boss of report.bossPerformances ?? []) {
        const parts: string[] = [];
        if (boss.topDamage)
            parts.push(
                `DPS ${boss.topDamage.playerName} (${boss.topDamage.value.toFixed(0)})`,
            );
        if (boss.topHealing)
            parts.push(
                `HPS ${boss.topHealing.playerName} (${boss.topHealing.value.toFixed(0)})`,
            );
        if (boss.topInterrupts)
            parts.push(
                `INT ${boss.topInterrupts.playerName} (${boss.topInterrupts.value.toFixed(0)})`,
            );
        if (parts.length === 0 && boss.topParse?.playerName) {
            parts.push(
                `Parse ${boss.topParse.playerName} (${boss.topParse.value.toFixed(1)})`,
            );
        }
        if (parts.length > 0) {
            summary.bossHighlights.push({
                bossName: boss.bossName,
                fightId: boss.fightId,
                text: parts.slice(0, 2).join(" • "),
            });
        }

        if (boss.mostDeaths) {
            pushUniqueSuperlative(
                summary.raidSuperlatives,
                "Most deaths",
                `${boss.mostDeaths.playerName} (${boss.mostDeaths.value.toFixed(0)}) on ${boss.bossName}`,
            );
        }
        if (boss.topSurvivability) {
            pushUniqueSuperlative(
                summary.raidSuperlatives,
                "Survivor",
                `${boss.topSurvivability.playerName} (${boss.topSurvivability.value.toFixed(1)}) on ${boss.bossName}`,
            );
        }
    }

    if (summary.raidSuperlatives.length === 0 && summary.bestExecution) {
        summary.raidSuperlatives.push({
            label: "Execution anchor",
            text: `${summary.bestExecution.playerName} (${summary.bestExecution.value.toFixed(1)})`,
        });
    }

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

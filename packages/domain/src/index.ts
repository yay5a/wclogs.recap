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
    amount?: number;
    best?: number;
    rankPercent?: number;
    bracketPercent?: number;
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
    reportWideRecap?: {
        topDamageDone: Array<{
            playerName: string;
            value: number;
            className?: string;
            specName?: string;
        }>;
        topHealingDone: Array<{
            playerName: string;
            value: number;
            className?: string;
            specName?: string;
        }>;
        totals: {
            deaths?: number;
            raidDamageTaken?: number;
            dispels?: number;
            interrupts?: number;
        };
    };
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
        metric?: string;
        amount?: number;
        className?: string;
        specName?: string;
        classSpecLabel?: string;
    }>;
    topDamageTaken: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
    topHealers: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
    totals: {
        totalDeaths?: number;
        mostWipesBoss?: string;
        mostWipesCount?: number;
        raidDamageTaken?: number;
        dispels?: number;
        battleRezzes?: number;
        kicks?: number;
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
    topOverallDamageParsers: Array<{
        playerName: string;
        value: number;
        metric: "DPS";
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

const toMetricLabel = (
    value: string | undefined,
    role?: string,
): string => {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return "DPS";
    if (normalized === "DPS" || normalized === "HPS" || normalized === "DTPS") {
        return normalized;
    }
    const normalizedRole = role?.trim().toLowerCase();
    if (normalizedRole === "healer") return "HPS";
    if (normalizedRole === "tank") return "DTPS";
    return "DPS";
};

const resolveMetricLabelFromEntry = (
    entry: Pick<NormalizedLeaderboardEntry, "selectedMetric" | "metric" | "role">,
): string =>
    toMetricLabel(
        entry.selectedMetric ??
            (entry.metric === "DPS" ||
            entry.metric === "HPS" ||
            entry.metric === "DTPS"
                ? entry.metric
                : undefined),
        entry.role,
    );

const formatDateMmDdYyyy = (timestampMs: number): string => {
    const date = new Date(timestampMs);
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const year = String(date.getUTCFullYear());
    return `${month}/${day}/${year}`;
};

const formatRaidDurationHoursMinutes = (durationMs: number): string => {
    const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 1) return `${minutes} Min`;

    const hourLabel = hours === 1 ? "Hour" : "Hours";
    const minuteLabel = minutes === 1 ? "Min" : "Min";
    return `${String(hours).padStart(2, "0")} ${hourLabel} ${String(minutes).padStart(2, "0")} ${minuteLabel}`;
};

const toDisplayClassName = (className?: string): string | undefined => {
    if (!className) return undefined;
    return className.replace(/([a-z])([A-Z])/g, "$1 $2");
};

const toClassSpecLabel = (className?: string, specName?: string): string | undefined => {
    const displayClassName = toDisplayClassName(className);
    if (specName && displayClassName) return `${specName} ${displayClassName}`;
    return specName ?? displayClassName;
};

const toNormalizedPlayerKey = (playerName: string): string => playerName.trim().toLowerCase();

const identityRichnessScore = (
    row: { className?: string; specName?: string; classSpecLabel?: string },
): number => {
    let score = 0;
    if (row.className) score += 1;
    if (row.specName) score += 1;
    if (row.classSpecLabel) score += 1;
    return score;
};

const dedupeRowsByPlayerStrongest = <
    T extends { playerName: string; value: number; amount?: number; className?: string; specName?: string; classSpecLabel?: string },
>(
    rows: readonly T[],
): T[] => {
    const strongestByPlayer = new Map<string, T>();
    for (const row of rows) {
        const key = toNormalizedPlayerKey(row.playerName);
        const current = strongestByPlayer.get(key);
        if (!current) {
            strongestByPlayer.set(key, row);
            continue;
        }

        if (row.value > current.value) {
            strongestByPlayer.set(key, row);
            continue;
        }
        if (row.value < current.value) continue;

        const rowHasAmount = typeof row.amount === "number";
        const currentHasAmount = typeof current.amount === "number";
        if (rowHasAmount && !currentHasAmount) {
            strongestByPlayer.set(key, row);
            continue;
        }
        if (!rowHasAmount && currentHasAmount) continue;

        const rowIdentityScore = identityRichnessScore(row);
        const currentIdentityScore = identityRichnessScore(current);
        if (rowIdentityScore > currentIdentityScore) {
            strongestByPlayer.set(key, row);
        }
    }
    return [...strongestByPlayer.values()];
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

    const zoneName = selectedBoss?.zoneName ?? report.zoneName;
    const titleLine = zoneName
        ? `${report.title} - ${zoneName}`
        : report.title;
    const secondaryLine = selectedBoss?.guildName
        ? `${selectedBoss.guildName} on ${selectedBoss.realmName ?? "Unknown Realm"}`
        : "Unknown Guild on Unknown Realm";
    const pullCount = report.fights.length;
    const killTimeLabel = formatRaidDurationHoursMinutes(
        Math.max(0, report.endTime - report.startTime),
    );
    const reportDateMs = report.startTime;

    const reportDamageByName = new Map(
        (report.reportWideRecap?.topDamageDone ?? []).map((entry) => [
            entry.playerName.toLowerCase(),
            entry,
        ]),
    );
    const reportLeaderboards = (report.leaderboards ?? []).filter(
        (entry) => entry.scope === "report",
    );
    const bestPlayerParses = dedupeRowsByPlayerStrongest(
        [...reportLeaderboards]
            .sort((left, right) => right.value - left.value)
            .flatMap((entry) => {
                if (!entry.playerName) return [];
                const damageRow = reportDamageByName.get(entry.playerName.toLowerCase());
                const className = entry.className ?? damageRow?.className;
                const specName = entry.specName ?? damageRow?.specName;
                const classSpecLabel = toClassSpecLabel(
                    className,
                    specName,
                );
                return [{
                    playerName: entry.playerName,
                    value: entry.value,
                    metricLabel: resolveMetricLabelFromEntry(entry),
                    metric: resolveMetricLabelFromEntry(entry),
                    ...(typeof damageRow?.value === "number"
                        ? { amount: damageRow.value }
                        : {}),
                    ...(className ? { className } : {}),
                    ...(specName ? { specName } : {}),
                    ...(classSpecLabel ? { classSpecLabel } : {}),
                }];
            }),
    )
        .slice(0, 3)
        .map((entry) => ({
        playerName: entry.playerName,
        parse: entry.value,
        metricLabel: entry.metricLabel,
        ...(entry.metric ? { metric: entry.metric } : {}),
        ...(typeof entry.amount === "number" ? { amount: entry.amount } : {}),
        ...(entry.className ? { className: entry.className } : {}),
        ...(entry.specName ? { specName: entry.specName } : {}),
        ...(entry.classSpecLabel ? { classSpecLabel: entry.classSpecLabel } : {}),
    }));
    const topHealers = (report.reportWideRecap?.topHealingDone ?? []).slice(0, 3).map((entry) => {
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

    const bestAverageParseEntry = [...reportLeaderboards]
        .sort((left, right) => right.value - left.value)[0];
    const bestSingleBossParseEntry = (report.leaderboards ?? [])
        .filter((entry) => entry.scope === "boss")
        .sort((left, right) => right.value - left.value)[0];
    const topOverallParsers = dedupeRowsByPlayerStrongest(
        [...reportLeaderboards]
            .sort((left, right) => right.value - left.value)
            .flatMap((entry) => {
                if (!entry.playerName) return [];
                const metric = resolveMetricLabelFromEntry(entry);
                return [{ playerName: entry.playerName, value: entry.value, metric }];
            }),
    )
        .slice(0, 3)
        .map((entry) => ({
            playerName: entry.playerName,
            value: entry.value,
            metric: entry.metric,
        }));
    const topOverallDamageParsers = dedupeRowsByPlayerStrongest(
        [...reportLeaderboards]
            .filter((entry) => resolveMetricLabelFromEntry(entry) === "DPS")
            .sort((left, right) => right.value - left.value)
            .flatMap((entry) => {
                if (!entry.playerName) return [];
                return [{ playerName: entry.playerName, value: entry.value }];
            }),
    )
        .slice(0, 3)
        .map((entry) => ({
            playerName: entry.playerName,
            value: entry.value,
            metric: "DPS" as const,
        }));

    const bossHighlights = bossPerformances
        .filter((boss) => typeof boss.fightId === "number")
        .slice(0, 4)
        .map((boss) => ({
            bossName: boss.bossName,
            fightId: boss.fightId,
            text: boss.kill === true ? "Kill secured." : "Progress pull.",
        }));

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
        fastestPhaseTimes: [],
        bestPlayerParses,
        topDamageTaken: [],
        topHealers,
        totals: {
            ...(typeof report.reportWideRecap?.totals.deaths === "number"
                ? { totalDeaths: report.reportWideRecap.totals.deaths }
                : {}),
            ...(mostWipesEntry && mostWipesEntry.wipes > 0
                ? {
                      mostWipesBoss: mostWipesEntry.bossName,
                      mostWipesCount: mostWipesEntry.wipes,
                  }
                : {}),
            ...(typeof report.reportWideRecap?.totals.raidDamageTaken === "number"
                ? { raidDamageTaken: report.reportWideRecap.totals.raidDamageTaken }
                : {}),
            ...(typeof report.reportWideRecap?.totals.dispels === "number"
                ? { dispels: report.reportWideRecap.totals.dispels }
                : {}),
            ...(typeof report.reportWideRecap?.totals.interrupts === "number"
                ? { kicks: report.reportWideRecap.totals.interrupts }
                : {}),
        },
        ...(bestSingleBossParseEntry?.playerName &&
        bestSingleBossParseEntry.bossName &&
        typeof bestSingleBossParseEntry.fightId === "number"
            ? {
                  bestSingleBossParse: {
                      playerName: bestSingleBossParseEntry.playerName,
                      value: bestSingleBossParseEntry.value,
                      bossName: bestSingleBossParseEntry.bossName,
                      fightId: bestSingleBossParseEntry.fightId,
                      metric: resolveMetricLabelFromEntry(bestSingleBossParseEntry),
                  },
              }
            : {}),
        ...(bestAverageParseEntry?.playerName
            ? {
                  bestAverageParse: {
                      playerName: bestAverageParseEntry.playerName,
                      value: bestAverageParseEntry.value,
                      metric: resolveMetricLabelFromEntry(bestAverageParseEntry),
                  },
              }
            : {}),
        topOverallParsers,
        topOverallDamageParsers,
        bossHighlights,
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

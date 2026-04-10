import { GraphQLClient, gql } from "graphql-request";
import fixture from "./fixtures/report-fixture.json" with { type: "json" };
import type {
    GameFamily,
    NormalizedBossPerformance,
    NormalizedFight,
    NormalizedLeaderboardEntry,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import { ReportCacheModel } from "@wcl/db";
import {
    asNumber,
    asObject,
    asString,
    indexLeaderboardByActorAndName,
    normalizeName,
    parseBossRankingsPayload,
    parsePlayerDetailsPayload,
    parseReportRankingsPayload,
    parseTablePayload,
    type ParsedTableEntry,
    type TableDataType,
} from "./parsers/index.js";

export interface ParsedReportUrl {
    reportCode: string;
    gameFamily: GameFamily;
    rawUrl: string;
}

const REPORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;

const SHORT_LIVED_REPORT_TTL_MS = 10 * 60 * 1000;
const IN_PROGRESS_REPORT_TTL_MS = 2 * 60 * 1000;
const INACCESSIBLE_REPORT_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_REPORT_WINDOW_MS = 6 * 60 * 60 * 1000;
// Reports are fetched from user-submitted URLs/codes, so we intentionally allow unlisted reports.
const DEFAULT_ALLOW_UNLISTED_REPORTS = true;

const BASE_REPORT_QUERY = gql`
  query BaseReportSummary(
    $code: String!
    $allowUnlisted: Boolean!
    $includeRateLimitData: Boolean! = false
  ) {
    rateLimitData @include(if: $includeRateLimitData) {
      limitPerHour
      pointsSpentThisHour
      pointsResetIn
    }
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        archiveStatus {
          isArchived
          isAccessible
          archiveDate
        }
        title
        startTime
        endTime
        zone {
          name
          frozen
        }
        guild {
          name
          server {
            name
            region { compactName }
          }
        }
        phases {
          encounterID
          phases {
            id
            name
            isIntermission
          }
        }
        fights(killType: Encounters) {
          id
          encounterID
          difficulty
          averageItemLevel
          name
          startTime
          endTime
          kill
          bossPercentage
          fightPercentage
          size
          lastPhase
          inProgress
          originalEncounterID
          wipeCalledTime
          phaseTransitions {
            id
            startTime
          }
        }
        masterData {
          actors(type: "Player") {
            id
            name
            subType
            server
          }
        }
      }
    }
  }
`;

const REPORT_RANKINGS_QUERY = gql`
  query ReportRankings($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default)
      }
    }
  }
`;

const BOSS_RANKINGS_QUERY = gql`
  query BossRankings(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default, fightIDs: $fightIDs)
      }
    }
  }
`;

const PLAYER_DETAILS_QUERY = gql`
  query PlayerDetails($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        playerDetails(includeCombatantInfo: true)
      }
    }
  }
`;

const TABLE_QUERY = gql`
  query ReportTable($code: String!, $allowUnlisted: Boolean!, $fightIDs: [Int]) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        damageDone: table(dataType: DamageDone, fightIDs: $fightIDs)
        damageTaken: table(dataType: DamageTaken, fightIDs: $fightIDs)
        healing: table(dataType: Healing, fightIDs: $fightIDs)
        deaths: table(dataType: Deaths, fightIDs: $fightIDs)
        dispels: table(dataType: Dispels, fightIDs: $fightIDs)
        interrupts: table(dataType: Interrupts, fightIDs: $fightIDs)
        survivability: table(dataType: Survivability, fightIDs: $fightIDs)
      }
    }
  }
`;

const RESURRECT_EVENTS_QUERY = gql`
  query FightResurrectionEvents(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
    $startTime: Float
    $filterExpression: String
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        events(
          dataType: All
          fightIDs: $fightIDs
          startTime: $startTime
          filterExpression: $filterExpression
        ) {
          data
          nextPageTimestamp
        }
      }
    }
  }
`;

interface WclClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
}

interface FightPhaseTransition {
    id: number;
    startTime: number;
}

interface FightSummaryRow {
    id: number;
    encounterID: number;
    difficulty?: number;
    averageItemLevel?: number;
    name: string;
    startTime: number;
    endTime: number;
    kill: boolean;
    bossPercentage?: number;
    fightPercentage?: number;
    size?: number;
    lastPhase?: number;
    inProgress?: boolean;
    originalEncounterID?: number;
    wipeCalledTime?: number;
    phaseTransitions: FightPhaseTransition[];
}

type ReportCacheState = "in_progress" | "recent" | "completed" | "inaccessible";

interface EncounterPhaseRow {
    id: number;
    name: string;
    isIntermission?: boolean;
}

interface EncounterSummaryRow {
    encounterID: number;
    bossName: string;
    fightId: number;
    difficulty?: number;
    kill: boolean;
    rankings?: unknown;
    resurrects?: number;
    tables: Partial<Record<TableDataType, unknown>>;
}

const getBossEncounterId = (fight: FightSummaryRow): number | undefined => {
    if (fight.encounterID > 0) return fight.encounterID;
    if (
        fight.encounterID === 0 &&
        typeof fight.originalEncounterID === "number" &&
        fight.originalEncounterID > 0
    ) {
        return fight.originalEncounterID;
    }

    return undefined;
};

interface EnrichedRawReport {
    base: unknown;
    // TODO(domain): expose archive accessibility status on NormalizedReport when the domain model supports it.
    archiveAccessLimited?: boolean;
    rateLimitData?: RateLimitDataSnapshot;
    skippedEnrichments?: string[];
    reportRankings?: unknown;
    playerDetails?: unknown;
    reportTables?: Partial<Record<TableDataType, unknown>>;
    encounterSummaries: EncounterSummaryRow[];
}

interface RateLimitDataSnapshot {
    limitPerHour: number;
    pointsSpentThisHour: number;
    pointsResetIn: number;
}

type RatePressureLevel = "normal" | "high" | "critical";

type BossPerformanceRecap = NormalizedBossPerformance & {
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
};

const WCL_DIFFICULTY_LABELS = new Map<number, string>([
    [1, "LFR"],
    [2, "Flex"],
    [3, "Normal"],
    [4, "Heroic"],
    [5, "Mythic"],
    [10, "Dungeon"],
]);

const getReportNode = (raw: unknown): Record<string, unknown> | undefined => {
    const root = asObject(raw);
    const data = asObject(root?.data);
    const reportData = asObject(data?.reportData ?? root?.reportData);
    return asObject(reportData?.report);
};

const getRateLimitData = (raw: unknown): RateLimitDataSnapshot | undefined => {
    const root = asObject(raw);
    const data = asObject(root?.data ?? root);
    const rateLimitData = asObject(data?.rateLimitData);
    const limitPerHour = asNumber(rateLimitData?.limitPerHour);
    const pointsSpentThisHour = asNumber(rateLimitData?.pointsSpentThisHour);
    const pointsResetIn = asNumber(rateLimitData?.pointsResetIn);

    if (
        typeof limitPerHour !== "number" ||
        typeof pointsSpentThisHour !== "number" ||
        typeof pointsResetIn !== "number"
    ) {
        return undefined;
    }

    return { limitPerHour, pointsSpentThisHour, pointsResetIn };
};

const getRatePressure = (
    rateLimitData?: RateLimitDataSnapshot,
): { level: RatePressureLevel; usage: number } => {
    if (!rateLimitData || rateLimitData.limitPerHour <= 0) {
        return { level: "normal", usage: 0 };
    }

    const usage = rateLimitData.pointsSpentThisHour / rateLimitData.limitPerHour;
    const remainingPoints =
        rateLimitData.limitPerHour - rateLimitData.pointsSpentThisHour;
    const nearReset = rateLimitData.pointsResetIn <= 90;

    if (usage >= 0.97 || (usage >= 0.9 && remainingPoints <= 25 && !nearReset)) {
        return { level: "critical", usage };
    }

    if (usage >= 0.85 || (usage >= 0.8 && !nearReset)) {
        return { level: "high", usage };
    }

    return { level: "normal", usage };
};

const toFightIDs = (
    fightIDs?: number | number[] | null,
): number[] | undefined => {
    if (fightIDs == null) return undefined;
    return Array.isArray(fightIDs) ? fightIDs : [fightIDs];
};

const getDifficultyLabel = (difficulty?: number): string | undefined => {
    if (typeof difficulty !== "number") return undefined;
    return WCL_DIFFICULTY_LABELS.get(difficulty) ?? `Difficulty ${difficulty}`;
};

const sumTableValues = (entries?: ParsedTableEntry[]): number =>
    (entries ?? []).reduce((sum, entry) => sum + (entry.value ?? 0), 0);

const getArchiveStatus = (
    report: Record<string, unknown>,
): { isArchived: boolean; isAccessible: boolean; archiveDate?: number } => {
    const archiveStatus = asObject(report.archiveStatus);
    const archiveDate = asNumber(archiveStatus?.archiveDate);

    return {
        isArchived: Boolean(archiveStatus?.isArchived),
        isAccessible: Boolean(archiveStatus?.isAccessible),
        ...(typeof archiveDate === "number" ? { archiveDate } : {}),
    };
};

const takeTopEntries = (
    entries: ParsedTableEntry[] | undefined,
    limit = 3,
): ParsedTableEntry[] =>
    [...(entries ?? [])]
        .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
        .slice(0, limit);

const buildRealmLabel = (
    report: Record<string, unknown>,
): string | undefined => {
    const guild = asObject(report.guild);
    const server = asObject(guild?.server);
    const serverName = asString(server?.name);
    const region = asString(asObject(server?.region)?.compactName);

    if (serverName && region) return `${serverName}-${region}`;
    return serverName;
};

const parseFightSummaries = (
    report: Record<string, unknown>,
): FightSummaryRow[] =>
    (Array.isArray(report.fights) ? report.fights : []).flatMap((value) => {
        const fight = asObject(value);
        if (!fight) return [];

        const id = asNumber(fight.id);
        const encounterID = asNumber(fight.encounterID);
        const name = asString(fight.name);
        const startTime = asNumber(fight.startTime);
        const endTime = asNumber(fight.endTime);

        if (
            typeof id !== "number" ||
            typeof encounterID !== "number" ||
            typeof name !== "string" ||
            typeof startTime !== "number" ||
            typeof endTime !== "number"
        ) {
            return [];
        }

        const phaseTransitions = (
            Array.isArray(fight.phaseTransitions) ? fight.phaseTransitions : []
        ).flatMap((transitionValue) => {
            const transition = asObject(transitionValue);
            const phaseId = asNumber(transition?.id);
            const transitionStart = asNumber(transition?.startTime);
            if (
                typeof phaseId !== "number" ||
                typeof transitionStart !== "number"
            ) {
                return [];
            }

            return [{ id: phaseId, startTime: transitionStart }];
        });
        const difficulty = asNumber(fight.difficulty);
        const bossPercentage = asNumber(fight.bossPercentage);
        const fightPercentage = asNumber(fight.fightPercentage);
        const averageItemLevel = asNumber(fight.averageItemLevel);
        const size = asNumber(fight.size);
        const lastPhase = asNumber(fight.lastPhase);
        const inProgress =
            typeof fight.inProgress === "boolean" ? fight.inProgress : undefined;
        const originalEncounterID = asNumber(fight.originalEncounterID);
        const wipeCalledTime = asNumber(fight.wipeCalledTime);

        return [
            {
                id,
                encounterID,
                name,
                startTime,
                endTime,
                kill: fight.kill === true,
                phaseTransitions,
                ...(typeof difficulty === "number" ? { difficulty } : {}),
                ...(typeof averageItemLevel === "number"
                    ? { averageItemLevel }
                    : {}),
                ...(typeof bossPercentage === "number"
                    ? { bossPercentage }
                    : {}),
                ...(typeof fightPercentage === "number"
                    ? { fightPercentage }
                    : {}),
                ...(typeof size === "number" ? { size } : {}),
                ...(typeof lastPhase === "number" ? { lastPhase } : {}),
                ...(typeof inProgress === "boolean" ? { inProgress } : {}),
                ...(typeof originalEncounterID === "number"
                    ? { originalEncounterID }
                    : {}),
                ...(typeof wipeCalledTime === "number"
                    ? { wipeCalledTime }
                    : {}),
            },
        ];
    });

const isWithinTtl = (fetchedAt: unknown, ttlMs: number): boolean => {
    if (!(fetchedAt instanceof Date)) return false;
    return Date.now() - fetchedAt.getTime() <= ttlMs;
};

const getReportCacheState = (rawPayload: unknown): ReportCacheState => {
    const enriched = asObject(rawPayload);
    const base = enriched?.base ?? rawPayload;
    const report = getReportNode(base);

    if (!report) {
        return "inaccessible";
    }

    const zone = asObject(report.zone);
    if (zone && "frozen" in zone && Boolean(zone.frozen)) {
        return "completed";
    }

    const archiveStatus = getArchiveStatus(report);
    if (archiveStatus.isArchived && !archiveStatus.isAccessible) {
        return "inaccessible";
    }

    const fights = parseFightSummaries(report);
    if (fights.some((fight) => fight.inProgress)) {
        return "in_progress";
    }

    const endTime = asNumber(report.endTime);
    if (
        typeof endTime === "number" &&
        Date.now() - endTime <= RECENT_REPORT_WINDOW_MS
    ) {
        return "recent";
    }

    return "completed";
};

const shouldUseCachedReport = (cached: {
    rawPayload: unknown;
    fetchedAt?: Date;
}): boolean => {
    const state = getReportCacheState(cached.rawPayload);

    if (state === "completed") {
        return true;
    }

    if (state === "in_progress") {
        return isWithinTtl(cached.fetchedAt, IN_PROGRESS_REPORT_TTL_MS);
    }

    if (state === "recent") {
        return isWithinTtl(cached.fetchedAt, SHORT_LIVED_REPORT_TTL_MS);
    }

    return isWithinTtl(cached.fetchedAt, INACCESSIBLE_REPORT_TTL_MS);
};

const parseEncounterPhases = (
    report: Record<string, unknown>,
): Map<number, EncounterPhaseRow[]> => {
    const result = new Map<number, EncounterPhaseRow[]>();

    for (const value of Array.isArray(report.phases) ? report.phases : []) {
        const row = asObject(value);
        const encounterID = asNumber(row?.encounterID);
        if (typeof encounterID !== "number") continue;

        const phaseRows =
            row && Array.isArray(row.phases) ? row.phases : [];
        const phases = phaseRows.flatMap(
            (phaseValue) => {
                const phase = asObject(phaseValue);
                const id = asNumber(phase?.id);
                const name = asString(phase?.name);
                if (typeof id !== "number" || typeof name !== "string") {
                    return [];
                }

                // Build the phase entry, omitting isIntermission when undefined. Use optional chaining
                // on phase to safely access isIntermission. Under exactOptionalPropertyTypes, avoid
                // assigning undefined explicitly to optional properties.
                const entry: EncounterPhaseRow = {
                    id,
                    name,
                    // When phase is undefined or does not contain isIntermission, this will be false.
                    // We conditionally include the property only if it exists on the source.
                    ...(phase && "isIntermission" in phase
                        ? {
                              isIntermission: Boolean(
                                  (phase as any).isIntermission,
                              ),
                          }
                        : {}),
                };
                return [entry];
            },
        );

        result.set(encounterID, phases);
    }

    return result;
};

const pickEncounterSummaryFight = (
    fights: FightSummaryRow[],
): FightSummaryRow | undefined => {
    if (fights.length === 0) return undefined;

    const kills = fights
        .filter((fight) => fight.kill)
        .sort((left, right) => right.endTime - left.endTime);

    if (kills.length > 0) {
        return kills[0];
    }

    return [...fights].sort((left, right) => {
        // fightPercentage tracks encounter completion for wipes and is the schema-backed
        // progress metric; bossPercentage is only remaining active boss health at pull end.
        // Prefer fightPercentage for wipe depth ordering and keep bossPercentage as fallback.
        const leftProgress = left.fightPercentage ?? -Infinity;
        const rightProgress = right.fightPercentage ?? -Infinity;
        if (leftProgress !== rightProgress) return rightProgress - leftProgress;

        const leftBossPercentage = left.bossPercentage ?? Infinity;
        const rightBossPercentage = right.bossPercentage ?? Infinity;
        if (leftBossPercentage !== rightBossPercentage) {
            return leftBossPercentage - rightBossPercentage;
        }

        const leftDuration = left.endTime - left.startTime;
        const rightDuration = right.endTime - right.startTime;
        if (leftDuration !== rightDuration) return rightDuration - leftDuration;

        return right.endTime - left.endTime;
    })[0];
};

const getMetricFromLeaderboard = (
    entry: NormalizedLeaderboardEntry,
): string | undefined => {
    const row = asObject(entry as unknown);
    const metric = asString(row?.metric);
    if (metric) return metric.toUpperCase();

    const role = asString(row?.role)?.toLowerCase();
    if (role === "healer") return "HPS";
    if (role === "tank") return "DTPS";

    return "DPS";
};

const getAmountFromLeaderboard = (
    entry: NormalizedLeaderboardEntry,
): number | undefined => {
    const row = asObject(entry as unknown);

    return (
        asNumber(row?.amount) ??
        asNumber(row?.metricValue) ??
        asNumber(row?.total) ??
        asNumber(row?.score) ??
        asNumber(row?.dps) ??
        asNumber(row?.hps) ??
        asNumber(row?.tankhps)
    );
};

const getNameFromLeaderboard = (
    entry: NormalizedLeaderboardEntry,
): string | undefined => {
    const row = asObject(entry as unknown);
    return (
        asString(row?.playerName) ??
        asString(row?.name) ??
        asString(row?.actorName)
    );
};

const getActorIdFromLeaderboard = (
    entry: NormalizedLeaderboardEntry,
): number | undefined => {
    const row = asObject(entry as unknown);
    return asNumber(row?.actorId) ?? asNumber(row?.id);
};

const getSpecFromLeaderboard = (
    entry: NormalizedLeaderboardEntry,
): string | undefined => {
    const row = asObject(entry as unknown);
    return asString(row?.specName) ?? asString(row?.spec);
};

const getClassFromLeaderboard = (
    entry: NormalizedLeaderboardEntry,
): string | undefined => {
    const row = asObject(entry as unknown);
    return asString(row?.className) ?? asString(row?.class);
};

const computeFastestPhaseTimes = (
    fights: FightSummaryRow[],
    metadata: EncounterPhaseRow[],
): Array<{
    phaseId: number;
    label: string;
    name?: string;
    durationMs: number;
}> => {
    const phaseById = new Map<number, EncounterPhaseRow>(
        metadata.map((phase) => [phase.id, phase]),
    );
    const fastestByPhase = new Map<number, number>();

    for (const fight of fights) {
        const transitions = [...fight.phaseTransitions].sort(
            (left, right) => left.startTime - right.startTime,
        );

        let currentPhaseId = 1;
        let currentStart = fight.startTime;

        for (const transition of transitions) {
            const duration = transition.startTime - currentStart;
            const phaseInfo = phaseById.get(currentPhaseId);
            const isIntermission = phaseInfo
                ? Boolean(phaseInfo.isIntermission)
                : false;

            if (duration > 0 && !isIntermission) {
                const currentFastest = fastestByPhase.get(currentPhaseId);
                if (
                    typeof currentFastest !== "number" ||
                    duration < currentFastest
                ) {
                    fastestByPhase.set(currentPhaseId, duration);
                }
            }

            currentPhaseId = transition.id;
            currentStart = transition.startTime;
        }

        const finalDuration = fight.endTime - currentStart;
        {
            const phaseInfoFinal = phaseById.get(currentPhaseId);
            const isIntermissionFinal = phaseInfoFinal
                ? Boolean(phaseInfoFinal.isIntermission)
                : false;

            if (finalDuration > 0 && !isIntermissionFinal) {
                const currentFastest = fastestByPhase.get(currentPhaseId);
                if (
                    typeof currentFastest !== "number" ||
                    finalDuration < currentFastest
                ) {
                    fastestByPhase.set(currentPhaseId, finalDuration);
                }
            }
        }
    }

    return [...fastestByPhase.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([phaseId, durationMs]) => {
            const metadataRow = phaseById.get(phaseId);
            const row: {
                phaseId: number;
                label: string;
                durationMs: number;
                name?: string;
            } = {
                phaseId,
                label: `P${phaseId}`,
                durationMs,
            };
            if (metadataRow && metadataRow.name) {
                row.name = metadataRow.name;
            }
            return row;
        });
};

const parseEncounterSummariesFromRaw = (
    enriched?: Record<string, unknown>,
): EncounterSummaryRow[] => {
    if (!enriched) return [];

    if (Array.isArray(enriched.encounterSummaries)) {
        return enriched.encounterSummaries.flatMap((value) => {
            const row = asObject(value);
            const encounterID = asNumber(row?.encounterID);
            const fightId = asNumber(row?.fightId);
            const bossName = asString(row?.bossName);
            if (
                typeof encounterID !== "number" ||
                typeof fightId !== "number" ||
                typeof bossName !== "string"
            ) {
                return [];
            }

            const difficulty = asNumber(row?.difficulty);
            const resurrects = asNumber(row?.resurrects);
            const summary: EncounterSummaryRow = {
                encounterID,
                fightId,
                bossName,
                kill: Boolean(row?.kill),
                rankings: (row as any)?.rankings,
                tables: asObject(row?.tables) ?? {},
                ...(typeof difficulty === "number" ? { difficulty } : {}),
                ...(typeof resurrects === "number" ? { resurrects } : {}),
            };
            return [summary];
        });
    }

    const rankingsByFightId = new Map<number, unknown>();
    for (const value of Array.isArray(enriched.bossRankings)
        ? enriched.bossRankings
        : []) {
        const row = asObject(value);
        const fightId = asNumber(row?.fightId);
        if (typeof fightId !== "number") continue;
        rankingsByFightId.set(fightId, row?.payload);
    }

    return (
        Array.isArray(enriched.bossTables) ? enriched.bossTables : []
    ).flatMap((value) => {
        const row = asObject(value);
        const fightId = asNumber(row?.fightId);
        const bossName = asString(row?.bossName);

        if (typeof fightId !== "number" || typeof bossName !== "string") {
            return [];
        }

        const difficulty = asNumber(row?.difficulty);
        const summary: EncounterSummaryRow = {
            encounterID: asNumber(row?.encounterID) ?? 0,
            fightId,
            bossName,
            kill: Boolean(row?.kill),
            rankings: rankingsByFightId.get(fightId),
            tables: asObject(row?.tables) ?? {},
            ...(typeof difficulty === "number" ? { difficulty } : {}),
        };
        return [summary];
    });
};

const summarizeBossTables = (
    bossName: string,
    fightId: number,
    parsedTables: Partial<Record<TableDataType, ParsedTableEntry[]>>,
    parseEntry?: NormalizedLeaderboardEntry,
): NormalizedBossPerformance => {
    const topByValue = (entries?: ParsedTableEntry[]) =>
        (entries ?? [])
            .slice()
            .sort((left, right) => right.value - left.value)[0] as
            | ParsedTableEntry
            | undefined;

    const topParse = parseEntry;

    const topDamageEntry = topByValue(parsedTables.DamageDone);
    const topDamage = topDamageEntry
        ? {
              playerName: topDamageEntry.playerName ?? "Unknown",
              value: topDamageEntry.value ?? 0,
          }
        : undefined;

    const topHealingEntry = topByValue(parsedTables.Healing);
    const topHealing = topHealingEntry
        ? {
              playerName: topHealingEntry.playerName ?? "Unknown",
              value: topHealingEntry.value ?? 0,
          }
        : undefined;

    const mostDeathsEntry = topByValue(parsedTables.Deaths);
    const mostDeaths = mostDeathsEntry
        ? {
              playerName: mostDeathsEntry.playerName ?? "Unknown",
              value: mostDeathsEntry.value ?? 0,
          }
        : undefined;

    const topInterruptsEntry = topByValue(parsedTables.Interrupts);
    const topInterrupts = topInterruptsEntry
        ? {
              playerName: topInterruptsEntry.playerName ?? "Unknown",
              value: topInterruptsEntry.value ?? 0,
          }
        : undefined;

    const result: NormalizedBossPerformance = {
        bossName,
        fightId,
        ...(topParse ? { topParse } : {}),
        ...(topDamage ? { topDamage } : {}),
        ...(topHealing ? { topHealing } : {}),
        ...(mostDeaths ? { mostDeaths } : {}),
        ...(topInterrupts ? { topInterrupts } : {}),
    };

    return result;
};

export const normalizeReportUrlInput = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("Report URL is empty");
    }

    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        const unwrapped = trimmed.slice(1, -1).trim();
        if (!unwrapped) {
            throw new Error("Report URL is empty");
        }
        return unwrapped;
    }

    return trimmed;
};

const extractReportCodeFromPath = (pathname: string): string | undefined => {
    const segments = pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i]?.toLowerCase();
        if (segment !== "reports" && segment !== "report") continue;

        const candidate = decodeURIComponent(segments[i + 1] ?? "").trim();
        if (candidate && REPORT_CODE_PATTERN.test(candidate)) {
            return candidate;
        }
    }

    return undefined;
};

export const parseReportUrl = (url: string): ParsedReportUrl => {
    const normalizedInput = normalizeReportUrlInput(url);
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(normalizedInput);
    } catch {
        throw new Error("Invalid Warcraft Logs report URL");
    }

    const queryReportCode =
        parsedUrl.searchParams.get("report") ??
        parsedUrl.searchParams.get("code");
    const reportCode =
        queryReportCode?.trim() ||
        extractReportCodeFromPath(parsedUrl.pathname);

    if (!reportCode || !REPORT_CODE_PATTERN.test(reportCode)) {
        throw new Error(
            "Could not find a Warcraft Logs report code in the URL",
        );
    }

    const lowerHost = parsedUrl.hostname.toLowerCase();
    const lowerPath = parsedUrl.pathname.toLowerCase();
    const gameFamily: GameFamily =
        lowerHost.includes("classic") ||
        lowerPath.includes("classic") ||
        lowerPath.includes("mop")
            ? "mop_classic"
            : "retail";

    return { reportCode, gameFamily, rawUrl: normalizedInput };
};

export class WclClient {
    private token: string | null = null;
    private readonly gqlClient: GraphQLClient;

    public constructor(private readonly options: WclClientOptions) {
        this.gqlClient = options.fetchImpl
            ? new GraphQLClient(options.apiBaseUrl, {
                  fetch: options.fetchImpl,
              })
            : new GraphQLClient(options.apiBaseUrl);
    }

    private async getAccessToken(): Promise<string> {
        if (this.token) return this.token;

        const auth = Buffer.from(
            `${this.options.clientId}:${this.options.clientSecret}`,
        ).toString("base64");
        const fetchImpl = this.options.fetchImpl ?? fetch;

        const response = await fetchImpl(
            "https://www.warcraftlogs.com/oauth/token",
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${auth}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: "grant_type=client_credentials",
            },
        );

        if (!response.ok) {
            throw new Error(`WCL OAuth failed: ${response.status}`);
        }

        const payload = (await response.json()) as { access_token: string };
        this.token = payload.access_token;
        return payload.access_token;
    }

    private async fetchFightResurrectionCount(
        code: string,
        fightId: number,
    ): Promise<number> {
        let startTime: number | undefined;
        let resurrects = 0;

        for (;;) {
            const payload = await this.gqlClient.request(
                RESURRECT_EVENTS_QUERY,
                {
                    code,
                    allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                    fightIDs: toFightIDs(fightId),
                    startTime,
                    filterExpression: 'type = "resurrect"',
                },
            );

            const eventsNode = asObject(getReportNode(payload)?.events);
            const rows = Array.isArray(eventsNode?.data) ? eventsNode.data : [];

            resurrects += rows.filter((value) => {
                const event = asObject(value);
                return asString(event?.type) === "resurrect";
            }).length;

            const nextPageTimestamp = asNumber(eventsNode?.nextPageTimestamp);
            if (typeof nextPageTimestamp !== "number") {
                break;
            }

            startTime = nextPageTimestamp;
        }

        return resurrects;
    }

    private async fetchEnrichedRawReport(
        code: string,
    ): Promise<EnrichedRawReport> {
        const skippedEnrichments: string[] = [];
        const noteSkippedEnrichment = (message: string): void => {
            skippedEnrichments.push(message);
            console.warn(`[wcl-client] ${message}`);
        };

        const base = await this.gqlClient.request(BASE_REPORT_QUERY, {
            code,
            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
            includeRateLimitData: true,
        });
        const rateLimitData = getRateLimitData(base);
        const ratePressure = getRatePressure(rateLimitData);
        const baseReport = getReportNode(base);
        const archiveStatus = baseReport
            ? getArchiveStatus(baseReport)
            : undefined;
        const isArchiveAccessLimited =
            archiveStatus?.isArchived && !archiveStatus.isAccessible;

        if (isArchiveAccessLimited) {
            return {
                base,
                archiveAccessLimited: true,
                ...(rateLimitData ? { rateLimitData } : {}),
                ...(skippedEnrichments.length > 0 ? { skippedEnrichments } : {}),
                encounterSummaries: [],
            };
        }

        const reportRankingsRaw = await this.gqlClient.request(
            REPORT_RANKINGS_QUERY,
            { code, allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS },
        );
        const playerDetailsRaw = await this.gqlClient.request(
            PLAYER_DETAILS_QUERY,
            { code, allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS },
        );
        const reportTablesRaw = await this.gqlClient.request(TABLE_QUERY, {
            code,
            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
        });

        const rawFights = baseReport ? parseFightSummaries(baseReport) : [];
        const fightsByEncounterId = new Map<number, FightSummaryRow[]>();

        for (const fight of rawFights) {
            const encounterID = getBossEncounterId(fight);
            if (typeof encounterID !== "number") continue;

            const existing = fightsByEncounterId.get(encounterID) ?? [];
            existing.push(fight);
            fightsByEncounterId.set(encounterID, existing);
        }

        const encounterSummaries: EncounterSummaryRow[] = [];

        for (const [encounterID, fights] of fightsByEncounterId.entries()) {
            const summaryFight = pickEncounterSummaryFight(fights);
            if (!summaryFight) continue;

            const fightIDs = toFightIDs(summaryFight.id);

            let rankingsPayload: unknown;
            let tableNode: Record<string, unknown> | undefined;
            let resurrects = 0;

            if (ratePressure.level === "critical") {
                noteSkippedEnrichment(
                    `Skipped encounter enrichments for fight ${summaryFight.id} (${summaryFight.name}) due to critical rate pressure (${Math.round(ratePressure.usage * 100)}% used).`,
                );
            } else {
                rankingsPayload = await this.gqlClient.request(
                    BOSS_RANKINGS_QUERY,
                    {
                        code,
                        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                        fightIDs,
                    },
                );

                if (ratePressure.level === "high") {
                    noteSkippedEnrichment(
                        `Skipped encounter table/resurrect enrichments for fight ${summaryFight.id} (${summaryFight.name}) due to high rate pressure (${Math.round(ratePressure.usage * 100)}% used).`,
                    );
                } else {
                    const tablesPayload = await this.gqlClient.request(
                        TABLE_QUERY,
                        {
                            code,
                            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                            fightIDs,
                        },
                    );
                    tableNode = getReportNode(tablesPayload);
                    resurrects = summaryFight.kill
                        ? await this.fetchFightResurrectionCount(
                              code,
                              summaryFight.id,
                          )
                        : 0;
                }
            }

            // Construct the encounter summary without assigning undefined to optional properties.
            const summary: EncounterSummaryRow = {
                encounterID,
                bossName: summaryFight.name,
                fightId: summaryFight.id,
                kill: summaryFight.kill,
                rankings: getReportNode(rankingsPayload)?.rankings,
                tables: {
                    DamageDone: tableNode?.damageDone,
                    DamageTaken: tableNode?.damageTaken,
                    Healing: tableNode?.healing,
                    Deaths: tableNode?.deaths,
                    Dispels: tableNode?.dispels,
                    Interrupts: tableNode?.interrupts,
                    Survivability: tableNode?.survivability,
                },
                ...(typeof summaryFight.difficulty === "number"
                    ? { difficulty: summaryFight.difficulty }
                    : {}),
                ...(typeof resurrects === "number" && resurrects > 0
                    ? { resurrects }
                    : {}),
            };
            encounterSummaries.push(summary);
        }

        return {
            base,
            ...(rateLimitData ? { rateLimitData } : {}),
            ...(skippedEnrichments.length > 0 ? { skippedEnrichments } : {}),
            reportRankings: getReportNode(reportRankingsRaw)?.rankings,
            playerDetails: getReportNode(playerDetailsRaw)?.playerDetails,
            reportTables: {
                DamageDone: getReportNode(reportTablesRaw)?.damageDone,
                DamageTaken: getReportNode(reportTablesRaw)?.damageTaken,
                Healing: getReportNode(reportTablesRaw)?.healing,
                Deaths: getReportNode(reportTablesRaw)?.deaths,
                Dispels: getReportNode(reportTablesRaw)?.dispels,
                Interrupts: getReportNode(reportTablesRaw)?.interrupts,
                Survivability: getReportNode(reportTablesRaw)?.survivability,
            },
            encounterSummaries,
        };
    }

    public async fetchAndNormalizeReport(
        url: string,
    ): Promise<NormalizedReport> {
        const parsed = parseReportUrl(url);
        const cached = await ReportCacheModel.findOne({
            reportCode: parsed.reportCode,
        }).lean();

        if (
            cached &&
            shouldUseCachedReport({
                rawPayload: cached.rawPayload,
                fetchedAt: cached.fetchedAt,
            })
        ) {
            return cached.normalizedPayload as NormalizedReport;
        }

        let rawPayload: unknown;
        if (process.env.WCL_USE_FIXTURES === "true") {
            rawPayload = {
                base: fixture,
                reportRankings: getReportNode(fixture)?.rankings,
                playerDetails: undefined,
                reportTables: {},
                encounterSummaries: [],
            } satisfies EnrichedRawReport;
        } else {
            const token = await this.getAccessToken();
            this.gqlClient.setHeader("Authorization", `Bearer ${token}`);
            rawPayload = await this.fetchEnrichedRawReport(parsed.reportCode);
        }

        const normalized = normalizeEnrichedReport(rawPayload, parsed);

        await ReportCacheModel.findOneAndUpdate(
            { reportCode: parsed.reportCode },
            {
                reportCode: parsed.reportCode,
                sourceUrl: url,
                gameFamily: parsed.gameFamily,
                rawPayload,
                normalizedPayload: normalized,
                fetchedAt: new Date(),
            },
            { upsert: true },
        );

        return normalized;
    }
}

export const normalizeEnrichedReport = (
    raw: unknown,
    parsed: ParsedReportUrl,
): NormalizedReport => {
    const enriched = asObject(raw);
    const base = enriched?.base ?? raw;
    const report = getReportNode(base);

    if (!report) {
        throw new Error("Unexpected WCL payload shape");
    }

    const allEncounterFights = parseFightSummaries(report);
    const killFights = allEncounterFights.filter((fight) => fight.kill);
    const fightsToExpose =
        killFights.length > 0 ? killFights : allEncounterFights;

    const fights: NormalizedFight[] = fightsToExpose.map((fight) => ({
        id: fight.id,
        name: fight.name,
        startTime: fight.startTime,
        endTime: fight.endTime,
        kill: fight.kill,
    }));

    const reportLeaderboards = parseReportRankingsPayload(
        enriched?.reportRankings ?? report.rankings,
    );

    const encounterSummaries = parseEncounterSummariesFromRaw(enriched);
    const bossLeaderboards = encounterSummaries.flatMap((summary) => {
        const context: { bossName?: string; fightId?: number } = {
            bossName: summary.bossName,
            fightId: summary.fightId,
        };

        return parseBossRankingsPayload(summary.rankings, context);
    });

    const playerDetails = parsePlayerDetailsPayload(enriched?.playerDetails);
    const detailByName = new Map(
        playerDetails.map((entry) => [normalizeName(entry.name), entry]),
    );

    const leaderboardIndex = indexLeaderboardByActorAndName([
        ...reportLeaderboards,
        ...bossLeaderboards,
    ]);

    const players: NormalizedPlayer[] = (
        asObject(report.masterData)?.actors instanceof Array
            ? (asObject(report.masterData)?.actors as unknown[])
            : []
    ).flatMap((actorValue, index) => {
        const actor = asObject(actorValue);
        if (!actor) return [];

        const name = asString(actor.name);
        if (!name) return [];

        const actorId = asNumber(actor.id);
        const detail = detailByName.get(normalizeName(name));
        const leaderboardMatches =
            (typeof actorId === "number"
                ? leaderboardIndex.byActorId.get(actorId)
                : undefined) ??
            leaderboardIndex.byName.get(normalizeName(name)) ??
            [];

        const player: NormalizedPlayer = {
            id: String(actorId ?? index),
            name,
            nameKey: normalizeName(name),
        };

        if (typeof actorId === "number") {
            player.actorId = actorId;
        }

        const className = asString(actor.subType) ?? detail?.className;
        const realm = asString(actor.server);

        if (className) player.className = className;
        if (realm) player.realm = realm;
        if (detail?.specName) player.specName = detail.specName;
        if (detail?.role) player.role = detail.role;

        const reportEntries = leaderboardMatches.filter(
            (entry) => entry.scope === "report",
        );

        if (reportEntries.length > 0) {
            const values = reportEntries.map((entry) => entry.value);
            player.bestParse = Math.max(...values);
            player.avgParse =
                values.reduce((sum, value) => sum + value, 0) / values.length;
        }

        return [player];
    });

    const playerByName = new Map(
        players.map((player) => [player.nameKey, player]),
    );
    const playerByActorId = new Map<number, NormalizedPlayer>();
    for (const player of players) {
        if (typeof player.actorId === "number") {
            playerByActorId.set(player.actorId, player);
        }
    }

    const phaseMetadataByEncounterId = parseEncounterPhases(report);
    const fightsByEncounterId = new Map<number, FightSummaryRow[]>();

    for (const fight of allEncounterFights) {
        const encounterID = getBossEncounterId(fight);
        if (typeof encounterID !== "number") continue;
        const existing = fightsByEncounterId.get(encounterID) ?? [];
        existing.push(fight);
        fightsByEncounterId.set(encounterID, existing);
    }

    const summaryByEncounterId = new Map<number, EncounterSummaryRow>(
        encounterSummaries.map((summary) => [summary.encounterID, summary]),
    );

    const bossLeaderboardsByFightId = new Map<
        number,
        NormalizedLeaderboardEntry[]
    >();
    for (const entry of bossLeaderboards) {
        if (typeof entry.fightId !== "number") continue;
        const existing = bossLeaderboardsByFightId.get(entry.fightId) ?? [];
        existing.push(entry);
        bossLeaderboardsByFightId.set(entry.fightId, existing);
    }

    const guildName = asString(asObject(report.guild)?.name);
    const realmName = buildRealmLabel(report);
    const zoneName = asString(asObject(report.zone)?.name);
    const reportStartTime = asNumber(report.startTime) ?? 0;

    const bossPerformances: NormalizedBossPerformance[] = [];

    for (const [
        encounterID,
        encounterFights,
    ] of fightsByEncounterId.entries()) {
        const summaryFight =
            summaryByEncounterId.get(encounterID) ??
            (() => {
                const fallbackFight =
                    pickEncounterSummaryFight(encounterFights);
                if (!fallbackFight) return undefined;
                return {
                    encounterID,
                    bossName: fallbackFight.name,
                    fightId: fallbackFight.id,
                    kill: fallbackFight.kill,
                    resurrects: 0,
                    tables: {},
                    ...(typeof fallbackFight.difficulty === "number"
                        ? { difficulty: fallbackFight.difficulty }
                        : {}),
                } satisfies EncounterSummaryRow;
            })();

        if (!summaryFight) continue;

        const tableNode = asObject(summaryFight.tables);
        const parsedTables: Partial<Record<TableDataType, ParsedTableEntry[]>> =
            {
                DamageDone: parseTablePayload(
                    tableNode?.DamageDone,
                    "DamageDone",
                ),
                DamageTaken: parseTablePayload(
                    tableNode?.DamageTaken,
                    "DamageTaken",
                ),
                Healing: parseTablePayload(tableNode?.Healing, "Healing"),
                Deaths: parseTablePayload(tableNode?.Deaths, "Deaths"),
                Dispels: parseTablePayload(tableNode?.Dispels, "Dispels"),
                Interrupts: parseTablePayload(
                    tableNode?.Interrupts,
                    "Interrupts",
                ),
                Survivability: parseTablePayload(
                    tableNode?.Survivability,
                    "Survivability",
                ),
            };

        const bossEntries = [
            ...(bossLeaderboardsByFightId.get(summaryFight.fightId) ?? []),
        ].sort((left, right) => right.value - left.value);

        const topBossParse = bossEntries[0];
        const basePerformance = summarizeBossTables(
            summaryFight.bossName,
            summaryFight.fightId,
            parsedTables,
            topBossParse,
        );

        const bestParses = bossEntries.slice(0, 3).flatMap((entry) => {
            const playerName = getNameFromLeaderboard(entry);
            if (!playerName) return [];

            const actorId = getActorIdFromLeaderboard(entry);
            const player =
                (typeof actorId === "number"
                    ? playerByActorId.get(actorId)
                    : undefined) ?? playerByName.get(normalizeName(playerName));
            const amount = getAmountFromLeaderboard(entry);
            const metric = getMetricFromLeaderboard(entry);
            const className =
                getClassFromLeaderboard(entry) ?? player?.className;
            const specName = getSpecFromLeaderboard(entry) ?? player?.specName;

            return [
                {
                    playerName,
                    parse: entry.value,
                    ...(typeof amount === "number" ? { amount } : {}),
                    ...(typeof metric === "string" && metric.length > 0
                        ? { metric }
                        : {}),
                    ...(className ? { className } : {}),
                    ...(specName ? { specName } : {}),
                },
            ];
        });

        const mapTableRows = (
            entries: ParsedTableEntry[] | undefined,
            limit = 3,
        ) =>
            takeTopEntries(entries, limit).map((entry) => {
                const player = entry.playerName
                    ? playerByName.get(normalizeName(entry.playerName))
                    : undefined;
                const className = player?.className;
                const specName = player?.specName;

                return {
                    playerName: entry.playerName ?? "Unknown",
                    value: entry.value ?? 0,
                    ...(className ? { className } : {}),
                    ...(specName ? { specName } : {}),
                };
            });

        const summaryFightRow = encounterFights.find(
            (fight) => fight.id === summaryFight.fightId,
        );
        const difficultyName = getDifficultyLabel(summaryFight.difficulty);
        const fightDurationMs = summaryFightRow
            ? summaryFightRow.endTime - summaryFightRow.startTime
            : undefined;
        const fightDate =
            reportStartTime > 0 && summaryFightRow
                ? reportStartTime + summaryFightRow.startTime
                : undefined;

        const recap: BossPerformanceRecap = {
            ...basePerformance,
            encounterId: encounterID,
            // Include difficulty only when defined to satisfy exactOptionalPropertyTypes
            ...(typeof summaryFight.difficulty === "number"
                ? { difficulty: summaryFight.difficulty }
                : {}),
            ...(difficultyName ? { difficultyName } : {}),
            kill: summaryFight.kill,
            pullCount: encounterFights.length,
            ...(typeof fightDurationMs === "number" ? { fightDurationMs } : {}),
            ...(typeof fightDate === "number" ? { fightDate } : {}),
            ...(guildName ? { guildName } : {}),
            ...(realmName ? { realmName } : {}),
            ...(zoneName ? { zoneName } : {}),
            reportUrl: parsed.rawUrl,
            fastestPhaseTimes: computeFastestPhaseTimes(
                encounterFights,
                phaseMetadataByEncounterId.get(encounterID) ?? [],
            ),
            bestParses,
            topDamageTaken: mapTableRows(parsedTables.DamageTaken),
            topHealers: mapTableRows(parsedTables.Healing),
            deaths: sumTableValues(parsedTables.Deaths),
            raidDamageTaken: sumTableValues(parsedTables.DamageTaken),
            dispels: sumTableValues(parsedTables.Dispels),
            battleRezzes: summaryFight.resurrects ?? 0,
            kicks: sumTableValues(parsedTables.Interrupts),
        };

        bossPerformances.push(recap);
    }

    const normalized = {
        reportCode: parsed.reportCode,
        title: asString(report.title) ?? "Untitled Report",
        startTime: asNumber(report.startTime) ?? Date.now(),
        endTime: asNumber(report.endTime) ?? Date.now(),
        gameFamily: parsed.gameFamily,
        fights,
        players,
        leaderboards: [...reportLeaderboards, ...bossLeaderboards],
        bossPerformances,
    } as NormalizedReport;

    if (zoneName) {
        (normalized as NormalizedReport & { zoneName?: string }).zoneName =
            zoneName;
    }

    return normalized;
};

export const normalizeReport = (
    raw: unknown,
    parsed: ParsedReportUrl,
): NormalizedReport => normalizeEnrichedReport({ base: raw }, parsed);

export const retailAdapter = normalizeEnrichedReport;
export const mopClassicAdapter = normalizeEnrichedReport;

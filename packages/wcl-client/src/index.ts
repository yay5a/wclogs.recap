import { GraphQLClient } from "graphql-request";
import fixture from "./fixtures/report-fixture.json" with { type: "json" };
import type {
    GameFamily,
    NormalizedBossPerformance,
    NormalizedFight,
    NormalizedLeaderboardEntry,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import { resolveWclAccessToken } from "./oauth.js";
import { createLogger } from "@wcl/shared";
import type { ReportCacheStore } from "./report-cache-store.js";
import {
    asArray,
    asNumber,
    asObject,
    asString,
    indexLeaderboardByActorAndName,
    normalizeName,
    parseBossRankingsPayload,
    parsePlayerDetailsPayload,
    parseReportRankingsPayload,
    parseTablePayloadDetailed,
    type ParsedTableEntry,
} from "./parsers/index.js";
import {
    KILL_TYPES,
    REPORT_TABLE_DATA_TYPES,
    type TableDataType,
} from "./schema-enums.js";

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
const NORMALIZED_PAYLOAD_VERSION = 2;
const logger = createLogger("wcl-client");

const BASE_REPORT_QUERY = `
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
          difficulties {
            id
            name
          }
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
        fights(killType: ${KILL_TYPES[1]}) {
          id
          encounterID
          difficulty
          name
          startTime
          endTime
          kill
          bossPercentage
          fightPercentage
          inProgress
          originalEncounterID
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

const REPORT_RANKINGS_QUERY = `
  query ReportRankings($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default)
      }
    }
  }
`;

const BOSS_RANKINGS_QUERY = `
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

const PLAYER_DETAILS_QUERY = `
  query PlayerDetails(
    $code: String!
    $allowUnlisted: Boolean!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        playerDetails(
          includeCombatantInfo: true
          startTime: $startTime
          endTime: $endTime
        )
      }
    }
  }
`;

const TABLE_QUERY = `
  query ReportTable($code: String!, $allowUnlisted: Boolean!, $fightIDs: [Int]) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        damageDone: table(dataType: ${REPORT_TABLE_DATA_TYPES[0]}, fightIDs: $fightIDs)
        damageTaken: table(dataType: ${REPORT_TABLE_DATA_TYPES[1]}, fightIDs: $fightIDs)
        healing: table(dataType: ${REPORT_TABLE_DATA_TYPES[2]}, fightIDs: $fightIDs)
        deaths: table(dataType: ${REPORT_TABLE_DATA_TYPES[3]}, fightIDs: $fightIDs)
        dispels: table(dataType: ${REPORT_TABLE_DATA_TYPES[4]}, fightIDs: $fightIDs)
        interrupts: table(dataType: ${REPORT_TABLE_DATA_TYPES[5]}, fightIDs: $fightIDs)
        survivability: table(dataType: ${REPORT_TABLE_DATA_TYPES[6]}, fightIDs: $fightIDs)
      }
    }
  }
`;

const REPORT_WIDE_TABLE_QUERY = `
  query ReportWideTable(
    $code: String!
    $allowUnlisted: Boolean!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        damageDone: table(dataType: ${REPORT_TABLE_DATA_TYPES[0]}, startTime: $startTime, endTime: $endTime)
        damageTaken: table(dataType: ${REPORT_TABLE_DATA_TYPES[1]}, startTime: $startTime, endTime: $endTime)
        healing: table(dataType: ${REPORT_TABLE_DATA_TYPES[2]}, startTime: $startTime, endTime: $endTime)
        deaths: table(dataType: ${REPORT_TABLE_DATA_TYPES[3]}, startTime: $startTime, endTime: $endTime)
        dispels: table(dataType: ${REPORT_TABLE_DATA_TYPES[4]}, startTime: $startTime, endTime: $endTime)
        interrupts: table(dataType: ${REPORT_TABLE_DATA_TYPES[5]}, startTime: $startTime, endTime: $endTime)
        survivability: table(dataType: ${REPORT_TABLE_DATA_TYPES[6]}, startTime: $startTime, endTime: $endTime)
      }
    }
  }
`;

interface WclClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
    reportCacheStore?: ReportCacheStore;
}

interface FightPhaseTransition {
    id: number;
    startTime: number;
}

interface DungeonPullSummaryRow {
    id: number;
    encounterID: number;
    name: string;
    startTime: number;
    endTime: number;
    kill: boolean;
}

interface FightSummaryRow {
    id: number;
    encounterID: number;
    difficulty?: number;
    name: string;
    startTime: number;
    endTime: number;
    kill: boolean;
    bossPercentage?: number;
    fightPercentage?: number;
    inProgress?: boolean;
    originalEncounterID?: number;
    phaseTransitions: FightPhaseTransition[];
    dungeonPulls?: DungeonPullSummaryRow[];
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
    tables: Partial<Record<TableDataType, unknown>>;
}

const TABLE_FIELD_BY_TYPE: Record<
    (typeof REPORT_TABLE_DATA_TYPES)[number],
    string
> = {
    DamageDone: "damageDone",
    DamageTaken: "damageTaken",
    Healing: "healing",
    Deaths: "deaths",
    Dispels: "dispels",
    Interrupts: "interrupts",
    Survivability: "survivability",
};

const mapReportTablesByType = (
    tableNode: Record<string, unknown> | undefined,
): Partial<Record<TableDataType, unknown>> =>
    Object.fromEntries(
        REPORT_TABLE_DATA_TYPES.map((dataType) => [
            dataType,
            tableNode?.[TABLE_FIELD_BY_TYPE[dataType]],
        ]),
    );

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

const hasDungeonPullData = (fight: FightSummaryRow): boolean =>
    Array.isArray(fight.dungeonPulls) && fight.dungeonPulls.length > 0;

interface EnrichedRawReport {
    base: unknown;
    // TODO(domain): expose archive accessibility status on NormalizedReport when the domain model supports it.
    archiveAccessLimited?: boolean;
    rateLimitData?: RateLimitDataSnapshot;
    skippedEnrichments?: string[];
    reportRankings?: unknown;
    playerDetails?: unknown;
    reportTables?: Partial<Record<TableDataType, unknown>>;
    encounterPhaseTimes?: unknown;
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

// Best-effort fallback labels only. Difficulty IDs are zone-specific in practice;
// prefer Zone.difficulties metadata from the report's zone when present.
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

    const usage =
        rateLimitData.pointsSpentThisHour / rateLimitData.limitPerHour;
    const remainingPoints =
        rateLimitData.limitPerHour - rateLimitData.pointsSpentThisHour;
    const nearReset = rateLimitData.pointsResetIn <= 90;

    if (
        usage >= 0.97 ||
        (usage >= 0.9 && remainingPoints <= 25 && !nearReset)
    ) {
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

const getZoneDifficultyLabels = (
    report?: Record<string, unknown>,
): Map<number, string> => {
    const zone = asObject(report?.zone);
    const rows =
        zone && Array.isArray(zone.difficulties) ? zone.difficulties : [];

    const labels = new Map<number, string>();
    for (const value of rows) {
        const row = asObject(value);
        const id = asNumber(row?.id);
        const name = asString(row?.name);
        if (
            typeof id === "number" &&
            typeof name === "string" &&
            name.length > 0
        ) {
            labels.set(id, name);
        }
    }

    return labels;
};

const getDifficultyLabel = (
    difficulty?: number,
    report?: Record<string, unknown>,
): string | undefined => {
    if (typeof difficulty !== "number") return undefined;
    const zoneDifficultyName = getZoneDifficultyLabels(report).get(difficulty);
    if (zoneDifficultyName) return zoneDifficultyName;
    // TODO(world-data): when we add world/game data lookups, resolve zone-specific
    // difficulty names from canonical zone metadata before using static fallbacks.
    return WCL_DIFFICULTY_LABELS.get(difficulty) ?? `Difficulty ${difficulty}`;
};

const sumTableValues = (entries?: ParsedTableEntry[]): number | undefined => {
    if (!entries) return undefined;
    return entries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
};

const getFightDeathsFromRankingsPayload = (
    payload: unknown,
    fightId: number,
): number | undefined => {
    if (typeof payload !== "string") return undefined;
    try {
        const root = asObject(JSON.parse(payload));
        if (!root) return undefined;
        const rows = Array.isArray(root.data) ? root.data : [];
        for (const value of rows) {
            const row = asObject(value);
            const rowFightId = asNumber(row?.fightID) ?? asNumber(row?.fightId);
            if (rowFightId !== fightId) continue;
            const deaths = asNumber(row?.deaths);
            if (typeof deaths === "number") return deaths;
        }
    } catch {
        return undefined;
    }
    return undefined;
};

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
        const inProgress =
            typeof fight.inProgress === "boolean"
                ? fight.inProgress
                : undefined;
        const originalEncounterIDRaw = asNumber(fight.originalEncounterID);
        const originalEncounterID =
            typeof originalEncounterIDRaw === "number" &&
            originalEncounterIDRaw > 0
                ? originalEncounterIDRaw
                : undefined;
        const dungeonPulls = (
            Array.isArray(fight.dungeonPulls) ? fight.dungeonPulls : []
        ).flatMap((pullValue) => {
            const pull = asObject(pullValue);
            const pullId = asNumber(pull?.id);
            const pullEncounterID = asNumber(pull?.encounterID);
            const pullName = asString(pull?.name);
            const pullStartTime = asNumber(pull?.startTime);
            const pullEndTime = asNumber(pull?.endTime);

            if (
                typeof pullId !== "number" ||
                typeof pullEncounterID !== "number" ||
                typeof pullName !== "string" ||
                typeof pullStartTime !== "number" ||
                typeof pullEndTime !== "number"
            ) {
                return [];
            }

            return [
                {
                    id: pullId,
                    encounterID: pullEncounterID,
                    name: pullName,
                    startTime: pullStartTime,
                    endTime: pullEndTime,
                    kill: pull?.kill === true,
                } satisfies DungeonPullSummaryRow,
            ];
        });

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
                ...(typeof bossPercentage === "number"
                    ? { bossPercentage }
                    : {}),
                ...(typeof fightPercentage === "number"
                    ? { fightPercentage }
                    : {}),
                ...(typeof inProgress === "boolean" ? { inProgress } : {}),
                ...(typeof originalEncounterID === "number"
                    ? { originalEncounterID }
                    : {}),
                ...(dungeonPulls.length > 0 ? { dungeonPulls } : {}),
            },
        ];
    });

const resolveReportWideTableRangeFromFights = (
    report: Record<string, unknown> | undefined,
): { startTime: number; endTime: number } | undefined => {
    if (!report) return undefined;

    const validFightRanges = parseFightSummaries(report).map((fight) => ({
        startTime: fight.startTime,
        endTime: fight.endTime,
    }));

    if (validFightRanges.length === 0) return undefined;

    return {
        startTime: Math.min(...validFightRanges.map((row) => row.startTime)),
        endTime: Math.max(...validFightRanges.map((row) => row.endTime)),
    };
};

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
        // Completed includes frozen zones; these are stable and safe to cache forever.
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

const shouldUseCachedNormalizedPayload = (cached: {
    normalizedPayloadVersion?: number;
}): boolean =>
    cached.normalizedPayloadVersion === NORMALIZED_PAYLOAD_VERSION &&
    process.env.WCL_BYPASS_CACHE !== "true";

const parseEncounterPhases = (
    report: Record<string, unknown>,
): Map<number, EncounterPhaseRow[]> => {
    const result = new Map<number, EncounterPhaseRow[]>();

    for (const value of Array.isArray(report.phases) ? report.phases : []) {
        const row = asObject(value);
        const encounterID = asNumber(row?.encounterID);
        if (typeof encounterID !== "number") continue;

        const phaseRows = row && Array.isArray(row.phases) ? row.phases : [];
        const phases = phaseRows.flatMap((phaseValue) => {
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
                          isIntermission: phase.isIntermission === true,
                      }
                    : {}),
            };
            return [entry];
        });

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
    const explicitMetricCandidates = [
        asString(row?.selectedMetric),
        asString(row?.playerMetric),
        asString(row?.metric),
    ];
    for (const metric of explicitMetricCandidates) {
        const normalized = metric?.trim().toUpperCase();
        if (normalized === "DPS" || normalized === "HPS" || normalized === "DTPS") {
            return normalized;
        }
    }

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
    entry: NormalizedLeaderboardEntry | undefined,
): string | undefined => {
    if (!entry) return undefined;
    const row = asObject(entry as unknown);
    return asString(row?.specName) ?? asString(row?.spec);
};

const getClassFromLeaderboard = (
    entry: NormalizedLeaderboardEntry | undefined,
): string | undefined => {
    if (!entry) return undefined;
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

        // phaseTransitions.id and PhaseMetadata.id are schema "absolute phase index"
        // values (normal phases + intermissions in one sequence). Keep this index for
        // timing windows, then filter intermissions via metadata before recording fastest
        // "real phase" timings.
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

const computeSelectedFightPhaseTimes = (
    fight: FightSummaryRow | undefined,
    metadata: EncounterPhaseRow[],
): Array<{
    phaseId: number;
    label: string;
    name?: string;
    durationMs: number;
}> => {
    if (!fight) return [];
    const phaseById = new Map<number, EncounterPhaseRow>(
        metadata.map((phase) => [phase.id, phase]),
    );
    const transitions = [...fight.phaseTransitions].sort(
        (left, right) => left.startTime - right.startTime,
    );

    const rows: Array<{
        phaseId: number;
        label: string;
        name?: string;
        durationMs: number;
    }> = [];
    let currentPhaseId = 1;
    let currentStart = fight.startTime;

    for (const transition of transitions) {
        const duration = transition.startTime - currentStart;
        const phaseInfo = phaseById.get(currentPhaseId);
        const isIntermission = phaseInfo ? Boolean(phaseInfo.isIntermission) : false;
        if (duration > 0 && !isIntermission) {
            rows.push({
                phaseId: currentPhaseId,
                label: `P${currentPhaseId}`,
                durationMs: duration,
                ...(phaseInfo?.name ? { name: phaseInfo.name } : {}),
            });
        }
        currentPhaseId = transition.id;
        currentStart = transition.startTime;
    }

    const finalDuration = fight.endTime - currentStart;
    const finalInfo = phaseById.get(currentPhaseId);
    const finalIsIntermission = finalInfo ? Boolean(finalInfo.isIntermission) : false;
    if (finalDuration > 0 && !finalIsIntermission) {
        rows.push({
            phaseId: currentPhaseId,
            label: `P${currentPhaseId}`,
            durationMs: finalDuration,
            ...(finalInfo?.name ? { name: finalInfo.name } : {}),
        });
    }

    return rows;
};

const parseEncounterPhaseTimesFromRaw = (
    enriched?: Record<string, unknown>,
): Map<number, Array<{ phaseId: number; label: string; name?: string; durationMs: number }>> => {
    const result = new Map<
        number,
        Array<{ phaseId: number; label: string; name?: string; durationMs: number }>
    >();
    if (!enriched) return result;

    const rows = asArray(enriched.encounterPhaseTimes) ?? [];
    for (const value of rows) {
        const row = asObject(value);
        const encounterId = asNumber(row?.encounterId);
        if (typeof encounterId !== "number") continue;

        const phaseStats =
            asArray(asObject(row?.summary)?.nonIntermissionPhaseStats) ?? [];
        const normalized = phaseStats.flatMap((phaseValue: unknown) => {
            const phase = asObject(phaseValue);
            const phaseId = asNumber(phase?.phaseId);
            const durationMs = asNumber(phase?.fastestDurationMs);
            if (typeof phaseId !== "number" || typeof durationMs !== "number") {
                return [];
            }
            const phaseName = asString(phase?.phaseName);
            return [
                {
                    phaseId,
                    label: `P${phaseId}`,
                    durationMs,
                    ...(phaseName ? { name: phaseName } : {}),
                },
            ];
        });

        if (normalized.length > 0) {
            result.set(encounterId, normalized);
        }
    }

    return result;
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
            const summary: EncounterSummaryRow = {
                encounterID,
                fightId,
                bossName,
                kill: Boolean(row?.kill),
                rankings: row?.rankings,
                tables: asObject(row?.tables) ?? {},
                ...(typeof difficulty === "number" ? { difficulty } : {}),
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
    const topSurvivabilityEntry = topByValue(parsedTables.Survivability);
    const topSurvivability = topSurvivabilityEntry
        ? {
              playerName: topSurvivabilityEntry.playerName ?? "Unknown",
              value: topSurvivabilityEntry.value ?? 0,
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
        ...(topSurvivability ? { topSurvivability } : {}),
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

    private async requestGraphQl(
        query: string,
        variables: Record<string, unknown>,
    ): Promise<unknown> {
        return await this.gqlClient.request<unknown>(query, variables);
    }

    private setAuthorizationHeader(token: string): void {
        this.gqlClient.setHeader("Authorization", `Bearer ${token}`);
    }

    private async getAccessToken(): Promise<string> {
        if (this.token) return this.token;

        const tokenOptions = {
            ...(process.env.WCL_OAUTH_TOKEN
                ? { explicitToken: process.env.WCL_OAUTH_TOKEN }
                : {}),
            ...(this.options.clientId
                ? { clientId: this.options.clientId }
                : {}),
            ...(this.options.clientSecret
                ? { clientSecret: this.options.clientSecret }
                : {}),
            ...(this.options.fetchImpl
                ? { fetchImpl: this.options.fetchImpl }
                : {}),
        };

        const token = await resolveWclAccessToken(tokenOptions);

        this.token = token;
        return token;
    }

    private async fetchEnrichedRawReport(
        code: string,
    ): Promise<EnrichedRawReport> {
        const skippedEnrichments: string[] = [];
        const noteSkippedEnrichment = (message: string): void => {
            skippedEnrichments.push(message);
            logger.warn({ reportCode: code }, message);
        };

        logger.info(
            {
                operation: "BaseReportSummary",
                query: BASE_REPORT_QUERY,
                variables: {
                    code,
                    allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                    includeRateLimitData: true,
                },
            },
            "sending graphql query",
        );

        const base = await this.requestGraphQl(BASE_REPORT_QUERY, {
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
                ...(skippedEnrichments.length > 0
                    ? { skippedEnrichments }
                    : {}),
                encounterSummaries: [],
            };
        }

        let reportRankingsRaw: unknown;
        try {
            reportRankingsRaw = await this.requestGraphQl(
                REPORT_RANKINGS_QUERY,
                {
                    code,
                    allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                },
            );
        } catch (error) {
            noteSkippedEnrichment(
                `Failed report rankings enrichment; continuing without report rankings (${error instanceof Error ? error.message : "unknown error"}).`,
            );
        }
        let playerDetailsRaw: unknown;
        let reportTablesRaw: unknown;
        const reportStartTime = asNumber(baseReport?.startTime);
        const reportEndTime = asNumber(baseReport?.endTime);
        if (
            typeof reportStartTime === "number" &&
            typeof reportEndTime === "number"
        ) {
            try {
                playerDetailsRaw = await this.requestGraphQl(
                    PLAYER_DETAILS_QUERY,
                    {
                        code,
                        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                        startTime: reportStartTime,
                        endTime: reportEndTime,
                    },
                );
            } catch (error) {
                noteSkippedEnrichment(
                    `Failed playerDetails enrichment; continuing without player details (${error instanceof Error ? error.message : "unknown error"}).`,
                );
            }
        } else {
            noteSkippedEnrichment(
                "Skipped playerDetails enrichment due to missing report start/end time bounds.",
            );
        }
        if (ratePressure.level !== "critical") {
            const reportWideTableRange =
                resolveReportWideTableRangeFromFights(baseReport);
            if (reportWideTableRange) {
                try {
                    reportTablesRaw = await this.requestGraphQl(
                        REPORT_WIDE_TABLE_QUERY,
                        {
                            code,
                            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                            startTime: reportWideTableRange.startTime,
                            endTime: reportWideTableRange.endTime,
                        },
                    );
                } catch (error) {
                    noteSkippedEnrichment(
                        `Failed report-wide table enrichment; continuing without report-wide tables (${error instanceof Error ? error.message : "unknown error"}).`,
                    );
                }
            } else {
                noteSkippedEnrichment(
                    "Skipped report-wide tables enrichment due to missing valid fights startTime/endTime bounds.",
                );
            }
        } else {
            noteSkippedEnrichment(
                `Skipped report-wide tables enrichment due to critical rate pressure (${Math.round(ratePressure.usage * 100)}% used).`,
            );
        }
        const rawFights = baseReport ? parseFightSummaries(baseReport) : [];
        const encounterSummaries: EncounterSummaryRow[] = [];
        const fightsByEncounterId = new Map<number, FightSummaryRow[]>();
        for (const fight of rawFights) {
            const encounterID = getBossEncounterId(fight);
            if (typeof encounterID !== "number") continue;
            const existing = fightsByEncounterId.get(encounterID) ?? [];
            existing.push(fight);
            fightsByEncounterId.set(encounterID, existing);
        }

        if (ratePressure.level === "critical" && fightsByEncounterId.size > 0) {
            noteSkippedEnrichment(
                `Skipped encounter enrichments for ${fightsByEncounterId.size} encounters due to critical rate pressure (${Math.round(ratePressure.usage * 100)}% used).`,
            );
        }

        for (const [encounterID, encounterFights] of fightsByEncounterId.entries()) {
            const summaryFight = pickEncounterSummaryFight(encounterFights);
            if (!summaryFight) continue;

            const fightIDs = toFightIDs(summaryFight.id);
            let rankingsPayload: unknown;
            let tableNode: Record<string, unknown> | undefined;

            if (ratePressure.level !== "critical") {
                try {
                    rankingsPayload = await this.requestGraphQl(BOSS_RANKINGS_QUERY, {
                        code,
                        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                        fightIDs,
                    });
                } catch (error) {
                    noteSkippedEnrichment(
                        `Failed boss rankings enrichment for fight ${summaryFight.id} (${summaryFight.name}); continuing without boss rankings (${error instanceof Error ? error.message : "unknown error"}).`,
                    );
                }

                try {
                    const tablesPayload = await this.requestGraphQl(TABLE_QUERY, {
                        code,
                        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                        fightIDs,
                    });
                    tableNode = getReportNode(tablesPayload);
                } catch (error) {
                    noteSkippedEnrichment(
                        `Failed encounter table enrichment for fight ${summaryFight.id} (${summaryFight.name}); continuing without encounter tables (${error instanceof Error ? error.message : "unknown error"}).`,
                    );
                }
            }

            const summary: EncounterSummaryRow = {
                encounterID,
                bossName: summaryFight.name,
                fightId: summaryFight.id,
                kill: summaryFight.kill,
                rankings: getReportNode(rankingsPayload)?.rankings,
                tables: mapReportTablesByType(tableNode),
                ...(typeof summaryFight.difficulty === "number"
                    ? { difficulty: summaryFight.difficulty }
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
            reportTables: mapReportTablesByType(getReportNode(reportTablesRaw)),
            encounterSummaries,
        };
    }

    public async fetchAndNormalizeReport(
        url: string,
    ): Promise<NormalizedReport> {
        const parsed = parseReportUrl(url);
        const cached = await this.options.reportCacheStore?.getByReportCode(
            parsed.reportCode,
        );

        if (
            cached &&
            shouldUseCachedReport({
                rawPayload: cached.rawPayload,
                fetchedAt: cached.fetchedAt,
            })
        ) {
            if (shouldUseCachedNormalizedPayload(cached)) {
                return cached.normalizedPayload;
            }

            const reNormalized = normalizeEnrichedReport(cached.rawPayload, parsed);
            await this.options.reportCacheStore?.upsert({
                reportCode: parsed.reportCode,
                sourceUrl: url,
                gameFamily: parsed.gameFamily,
                rawPayload: cached.rawPayload,
                normalizedPayload: reNormalized,
                normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION,
                fetchedAt: new Date(),
            });
            return reNormalized;
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
            this.setAuthorizationHeader(token);
            rawPayload = await this.fetchEnrichedRawReport(parsed.reportCode);
        }

        const normalized = normalizeEnrichedReport(rawPayload, parsed);

        if (this.options.reportCacheStore) {
            await this.options.reportCacheStore.upsert({
                reportCode: parsed.reportCode,
                sourceUrl: url,
                gameFamily: parsed.gameFamily,
                rawPayload,
                normalizedPayload: normalized,
                normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION,
                fetchedAt: new Date(),
            });
        }

        return normalized;
    }
}

export type {
    ReportCacheRecord,
    ReportCacheStore,
    ReportCacheWriteEntry,
} from "./report-cache-store.js";

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
    const reportContainsDungeonPulls =
        allEncounterFights.some(hasDungeonPullData);
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
        (message, context) => {
            logger.warn(
                {
                    reportCode: parsed.reportCode,
                    section: "report_rankings",
                    context,
                },
                message,
            );
        },
    );

    const encounterSummaries = parseEncounterSummariesFromRaw(enriched);
    const bossLeaderboards = encounterSummaries.flatMap((summary) => {
        const context: { bossName?: string; fightId?: number } = {
            bossName: summary.bossName,
            fightId: summary.fightId,
        };

        return parseBossRankingsPayload(
            summary.rankings,
            context,
            (message, parserContext) => {
                logger.warn(
                    {
                        reportCode: parsed.reportCode,
                        fightId: summary.fightId,
                        section: "boss_rankings",
                        context: parserContext,
                    },
                    message,
                );
            },
        );
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
    const reportTableNode = asObject(enriched?.reportTables);
    const parsedReportTableResults: Partial<
        Record<TableDataType, { entries: ParsedTableEntry[]; isValidEmpty: boolean }>
    > = Object.fromEntries(
        REPORT_TABLE_DATA_TYPES.map((dataType) => [
            dataType,
            parseTablePayloadDetailed(
                reportTableNode?.[dataType],
                dataType,
                (message, context) => {
                    logger.warn(
                        {
                            reportCode: parsed.reportCode,
                            section: `report_table:${dataType}`,
                            context,
                        },
                        message,
                    );
                },
            ),
        ]),
    );
    const mapReportWideRows = (
        entries: ParsedTableEntry[] | undefined,
        limit: number,
    ): Array<{
        playerName: string;
        value: number;
        className?: string;
        specName?: string;
    }> =>
        takeTopEntries(
            (entries ?? []).filter((entry) => {
                if (!entry.playerName) return false;
                return playerByName.has(normalizeName(entry.playerName));
            }),
            limit,
        ).map((entry) => {
            const player = entry.playerName
                ? playerByName.get(normalizeName(entry.playerName))
                : undefined;
            return {
                playerName: entry.playerName ?? "Unknown",
                value: entry.value ?? 0,
                ...(player?.className ? { className: player.className } : {}),
                ...(player?.specName ? { specName: player.specName } : {}),
            };
        });
    const reportWideRecap = {
        topDamageDone: mapReportWideRows(
            parsedReportTableResults.DamageDone?.entries,
            3,
        ),
        topDamageTaken: mapReportWideRows(
            parsedReportTableResults.DamageTaken?.entries,
            3,
        ),
        topHealingDone: mapReportWideRows(
            parsedReportTableResults.Healing?.entries,
            3,
        ),
        topInterrupts: mapReportWideRows(
            parsedReportTableResults.Interrupts?.entries,
            3,
        ),
        topDispels: mapReportWideRows(parsedReportTableResults.Dispels?.entries, 3),
        topSurvivability: mapReportWideRows(
            parsedReportTableResults.Survivability?.entries,
            3,
        ),
        totals: {
            ...(typeof sumTableValues(parsedReportTableResults.Deaths?.entries) ===
            "number"
                ? {
                      deaths: sumTableValues(
                          parsedReportTableResults.Deaths?.entries,
                      ),
                  }
                : {}),
            ...(typeof
                sumTableValues(parsedReportTableResults.DamageTaken?.entries) ===
            "number"
                ? {
                      raidDamageTaken: sumTableValues(
                          parsedReportTableResults.DamageTaken?.entries,
                      ),
                  }
                : {}),
            ...(typeof
                sumTableValues(parsedReportTableResults.Dispels?.entries) ===
            "number"
                ? {
                      dispels: sumTableValues(
                          parsedReportTableResults.Dispels?.entries,
                      ),
                  }
                : {}),
            ...(typeof
                sumTableValues(parsedReportTableResults.Interrupts?.entries) ===
            "number"
                ? {
                      interrupts: sumTableValues(
                          parsedReportTableResults.Interrupts?.entries,
                      ),
                  }
                : {}),
        },
    };

    const phaseMetadataByEncounterId = parseEncounterPhases(report);
    const phaseTimesByEncounterId = parseEncounterPhaseTimesFromRaw(enriched);
    const fightsByEncounterId = new Map<number, FightSummaryRow[]>();

    for (const fight of allEncounterFights) {
        const encounterID = getBossEncounterId(fight);
        if (typeof encounterID !== "number") continue;
        const existing = fightsByEncounterId.get(encounterID) ?? [];
        existing.push(fight);
        fightsByEncounterId.set(encounterID, existing);
    }

    const summariesByEncounterId = new Map<number, EncounterSummaryRow[]>();
    for (const summary of encounterSummaries) {
        const existing = summariesByEncounterId.get(summary.encounterID) ?? [];
        existing.push(summary);
        summariesByEncounterId.set(summary.encounterID, existing);
    }

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

    const encounterIds = new Set<number>([
        ...fightsByEncounterId.keys(),
        ...summariesByEncounterId.keys(),
    ]);

    for (const encounterID of encounterIds) {
        const encounterFights = fightsByEncounterId.get(encounterID) ?? [];
        const encounterSummariesForEncounter =
            summariesByEncounterId.get(encounterID) ?? [];
        const summaryRows: EncounterSummaryRow[] =
            encounterSummariesForEncounter.length > 0
                ? encounterSummariesForEncounter
                : (() => {
                      const fallbackFight = pickEncounterSummaryFight(encounterFights);
                      if (!fallbackFight) return [];
                      return [
                          {
                              encounterID,
                              bossName: fallbackFight.name,
                              fightId: fallbackFight.id,
                              kill: fallbackFight.kill,
                              tables: {},
                              ...(typeof fallbackFight.difficulty === "number"
                                  ? { difficulty: fallbackFight.difficulty }
                                  : {}),
                          } satisfies EncounterSummaryRow,
                      ];
                  })();

        for (const summaryFight of summaryRows) {
        const tableNode = asObject(summaryFight.tables);
        const parsedTableResults: Partial<
            Record<
                TableDataType,
                { entries: ParsedTableEntry[]; isValidEmpty: boolean }
            >
        > = Object.fromEntries(
            REPORT_TABLE_DATA_TYPES.map((dataType) => [
                dataType,
                parseTablePayloadDetailed(
                    tableNode?.[dataType],
                    dataType,
                    (message, context) => {
                        logger.warn(
                            {
                                reportCode: parsed.reportCode,
                                fightId: summaryFight.fightId,
                                section: `table:${dataType}`,
                                context,
                            },
                            message,
                        );
                    },
                ),
            ]),
        );
        const parsedTables: Partial<Record<TableDataType, ParsedTableEntry[]>> =
            Object.fromEntries(
                REPORT_TABLE_DATA_TYPES.map((dataType) => [
                    dataType,
                    parsedTableResults[dataType]?.entries ?? [],
                ]),
            );

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

        const leaderboardByPlayerName = new Map<string, NormalizedLeaderboardEntry>();
        for (const entry of bossEntries) {
            const playerName = getNameFromLeaderboard(entry);
            if (!playerName) continue;
            const key = normalizeName(playerName);
            if (!leaderboardByPlayerName.has(key)) {
                leaderboardByPlayerName.set(key, entry);
            }
        }

        const mapTableRows = (
            entries: ParsedTableEntry[] | undefined,
            limit = 3,
        ) =>
            takeTopEntries(
                (entries ?? []).filter((entry) => {
                    if (!entry.playerName) return false;
                    return playerByName.has(normalizeName(entry.playerName));
                }),
                limit,
            ).map((entry) => {
                const player = entry.playerName
                    ? playerByName.get(normalizeName(entry.playerName))
                    : undefined;
                const leaderboardRow = entry.playerName
                    ? leaderboardByPlayerName.get(normalizeName(entry.playerName))
                    : undefined;
                const className =
                    getClassFromLeaderboard(leaderboardRow) ?? player?.className;
                const specName =
                    getSpecFromLeaderboard(leaderboardRow) ?? player?.specName;

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
        const difficultyName = getDifficultyLabel(
            summaryFight.difficulty,
            report,
        );
        const fightDurationMs = summaryFightRow
            ? summaryFightRow.endTime - summaryFightRow.startTime
            : undefined;
        const fightDate =
            reportStartTime > 0 && summaryFightRow
                ? reportStartTime + summaryFightRow.endTime
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
            bestParses,
            ...((summaryFightRow && hasDungeonPullData(summaryFightRow)) ||
            reportContainsDungeonPulls
                ? {
                      // TODO(dungeon): add dedicated Mythic+/dungeon recap fields derived from dungeonPulls
                      // instead of raid-boss phase/table aggregates.
                  }
                : {
                      ...(() => {
                          const deathsFromTable = sumTableValues(
                              parsedTables.Deaths,
                          );
                          const deaths =
                              typeof deathsFromTable === "number"
                                  ? deathsFromTable
                                  : parsedTableResults.Deaths?.isValidEmpty
                                    ? 0
                                    : getFightDeathsFromRankingsPayload(
                                          summaryFight.rankings,
                                          summaryFight.fightId,
                                      );
                          const raidDamageTaken = sumTableValues(
                              parsedTables.DamageTaken,
                          );
                          const dispelsFromTable = sumTableValues(
                              parsedTables.Dispels,
                          );
                          const dispels =
                              typeof dispelsFromTable === "number"
                                  ? dispelsFromTable
                                  : parsedTableResults.Dispels?.isValidEmpty
                                    ? 0
                                    : undefined;
                          const kicksFromTable = sumTableValues(
                              parsedTables.Interrupts,
                          );
                          const kicks =
                              typeof kicksFromTable === "number"
                                  ? kicksFromTable
                                  : parsedTableResults.Interrupts?.isValidEmpty
                                    ? 0
                                    : undefined;
                      return {
                              ...(typeof deaths === "number" ? { deaths } : {}),
                              ...(typeof raidDamageTaken === "number"
                                  ? { raidDamageTaken }
                                  : {}),
                              ...(typeof dispels === "number"
                                  ? { dispels }
                                  : {}),
                              ...(typeof kicks === "number" ? { kicks } : {}),
                      };
                  })(),
                      fastestPhaseTimes: (() => {
                          const selectedFightPhases = computeSelectedFightPhaseTimes(
                              summaryFightRow,
                              phaseMetadataByEncounterId.get(encounterID) ?? [],
                          );
                          if (selectedFightPhases.length > 0) return selectedFightPhases;
                          return (
                              phaseTimesByEncounterId.get(encounterID) ??
                              computeFastestPhaseTimes(
                                  encounterFights,
                                  phaseMetadataByEncounterId.get(encounterID) ?? [],
                              )
                          );
                      })(),
                      topDamageTaken: mapTableRows(parsedTables.DamageTaken),
                      topHealers: bossEntries
                          .filter(
                              (entry) =>
                                  asString(asObject(entry as unknown)?.role)?.toLowerCase() ===
                                  "healer",
                          )
                          .slice(0, 3)
                          .flatMap((entry) => {
                              const playerName = getNameFromLeaderboard(entry);
                              if (!playerName) return [];
                              const value = getAmountFromLeaderboard(entry);
                              if (typeof value !== "number") return [];

                              const actorId = getActorIdFromLeaderboard(entry);
                              const player =
                                  (typeof actorId === "number"
                                      ? playerByActorId.get(actorId)
                                      : undefined) ??
                                  playerByName.get(normalizeName(playerName));
                              const className =
                                  getClassFromLeaderboard(entry) ?? player?.className;
                              const specName =
                                  getSpecFromLeaderboard(entry) ?? player?.specName;

                              return [
                                  {
                                      playerName,
                                      value,
                                      ...(className ? { className } : {}),
                                      ...(specName ? { specName } : {}),
                                  },
                              ];
                          }),
                  }),
            };

            bossPerformances.push(recap);
        }
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
        reportWideRecap,
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

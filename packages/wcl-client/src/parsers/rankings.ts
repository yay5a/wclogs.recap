import type { NormalizedLeaderboardEntry } from "@wcl/domain";
import {
    asNumber,
    asObject,
    asString,
    defaultDebugWarn,
    normalizeName,
    parseUnknownJson,
} from "./common.js";
import type { DebugWarn } from "./common.js";

const METRIC_KEY_CANDIDATES = [
    "bestPerformanceAverage",
    "performanceAverage",
    "bestPercent",
    "percentile",
    "execution",
    "executionScore",
    "rankPercent",
    // Dungeon-oriented rankings can use playerScore/playerSpeed metrics.
    "playerscore",
    "playerspeed",
] as const;

const readMetric = (
    entry: Record<string, unknown>,
): {
    metric: string;
    value: number;
} | null => {
    // WCL rankings payload keys vary by endpoint/game family; probe known metric keys in priority order.
    for (const key of METRIC_KEY_CANDIDATES) {
        const value = asNumber(entry[key]);
        if (typeof value === "number") {
            return { metric: key, value };
        }
    }

    const amount = asNumber(entry.amount);
    if (typeof amount === "number") {
        return { metric: "amount", value: amount };
    }

    return null;
};

const collectContainers = (root: Record<string, unknown>): unknown[] => [
    ...(Array.isArray(root.data) ? root.data : []),
    ...(Array.isArray(root.rankings) ? root.rankings : []),
    ...(Array.isArray(root.players) ? root.players : []),
    ...(Array.isArray(root.entries) ? root.entries : []),
    root,
];

const toLeaderboardEntry = (
    item: unknown,
    scope: "report" | "boss",
    warn: DebugWarn,
    fallback?: { bossName?: string; fightId?: number },
): NormalizedLeaderboardEntry | undefined => {
    const entry = asObject(item);
    if (!entry) return undefined;

    const metric = readMetric(entry);
    if (!metric) return undefined;

    const player = asObject(entry.player);
    const character = asObject(entry.character);
    const actor = asObject(entry.actor);

    const playerId =
        asNumber(entry.id) ??
        asNumber(entry.playerID) ??
        asNumber(entry.playerId) ??
        asNumber(player?.id) ??
        asNumber(actor?.id);
    const playerName =
        asString(entry.name) ??
        asString(entry.playerName) ??
        asString(player?.name) ??
        asString(character?.name) ??
        asString(actor?.name);

    if (!playerId && !playerName) {
        warn("rankings parser: skipping entry with no player identity", {
            entry,
        });
        return undefined;
    }

    const className =
        asString(entry.className) ??
        asString(player?.class) ??
        asString(actor?.subType);
    const specName =
        asString(entry.specName) ??
        asString(player?.spec) ??
        asString(character?.spec);
    const role = asString(entry.role) ?? asString(player?.role);
    const bossName =
        asString(entry.bossName) ??
        asString(entry.encounterName) ??
        fallback?.bossName;
    const fightId =
        asNumber(entry.fightID) ?? asNumber(entry.fightId) ?? fallback?.fightId;

    const rank = asNumber(entry.rank);

    const result: NormalizedLeaderboardEntry = {
        scope,
        metric: metric.metric,
        selectedMetric: metric.metric,
        value: metric.value,
        ...(typeof rank === "number" ? { rank } : {}),
        ...(typeof playerId === "number" ? { playerId } : {}),
        ...(playerName ? { playerName } : {}),
        ...(className ? { className } : {}),
        ...(specName ? { specName } : {}),
        ...(role ? { role } : {}),
        ...(bossName ? { bossName } : {}),
        ...(typeof fightId === "number" ? { fightId } : {}),
    };
    return result;
};

export const parseReportRankingsPayload = (
    payload: unknown,
    warn: DebugWarn = defaultDebugWarn,
): NormalizedLeaderboardEntry[] => {
    const parsed = parseUnknownJson(payload, warn, "report rankings");
    const root = asObject(parsed);
    if (!root) return [];

    const results: NormalizedLeaderboardEntry[] = [];
    for (const candidate of collectContainers(root)) {
        const normalized = toLeaderboardEntry(candidate, "report", warn);
        if (normalized) results.push(normalized);
    }

    if (results.length === 0) {
        warn("report rankings parser: no leaderboard entries detected", {
            payload: parsed,
        });
    }
    return results;
};

export const parseBossRankingsPayload = (
    payload: unknown,
    context: { bossName?: string; fightId?: number },
    warn: DebugWarn = defaultDebugWarn,
): NormalizedLeaderboardEntry[] => {
    const parsed = parseUnknownJson(payload, warn, "boss rankings");
    const root = asObject(parsed);
    if (!root) return [];

    const results: NormalizedLeaderboardEntry[] = [];
    for (const candidate of collectContainers(root)) {
        const normalized = toLeaderboardEntry(candidate, "boss", warn, context);
        if (normalized) results.push(normalized);
    }

    return results;
};

export const indexLeaderboardByActorAndName = (
    entries: NormalizedLeaderboardEntry[],
): {
    byActorId: Map<number, NormalizedLeaderboardEntry[]>;
    byName: Map<string, NormalizedLeaderboardEntry[]>;
} => {
    const byActorId = new Map<number, NormalizedLeaderboardEntry[]>();
    const byName = new Map<string, NormalizedLeaderboardEntry[]>();

    for (const entry of entries) {
        if (typeof entry.playerId === "number") {
            const existing = byActorId.get(entry.playerId) ?? [];
            existing.push(entry);
            byActorId.set(entry.playerId, existing);
        }

        if (entry.playerName) {
            const key = normalizeName(entry.playerName);
            const existing = byName.get(key) ?? [];
            existing.push(entry);
            byName.set(key, existing);
        }
    }

    return { byActorId, byName };
};

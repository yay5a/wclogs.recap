import type {
    NormalizedBossPerformance,
    NormalizedLeaderboardEntry,
} from "./index.js";

export interface FightPhaseTransition {
    id: number;
    startTime: number;
}

export interface DungeonPullSummaryRow {
    id: number;
    encounterID: number;
    name: string;
    startTime: number;
    endTime: number;
    kill: boolean;
}

export interface FightSummaryRow {
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

const asObject = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;

const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

export const getBossEncounterId = (fight: FightSummaryRow): number | undefined => {
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

export const hasDungeonPullData = (fight: FightSummaryRow): boolean =>
    Array.isArray(fight.dungeonPulls) && fight.dungeonPulls.length > 0;

export const parseFightSummaries = (
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
            if (typeof phaseId !== "number" || typeof transitionStart !== "number") {
                return [];
            }

            return [{ id: phaseId, startTime: transitionStart }];
        });

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

        const difficulty = asNumber(fight.difficulty);
        const bossPercentage = asNumber(fight.bossPercentage);
        const fightPercentage = asNumber(fight.fightPercentage);
        const inProgress =
            typeof fight.inProgress === "boolean" ? fight.inProgress : undefined;
        const originalEncounterIDRaw = asNumber(fight.originalEncounterID);
        const originalEncounterID =
            typeof originalEncounterIDRaw === "number" && originalEncounterIDRaw > 0
                ? originalEncounterIDRaw
                : undefined;

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
                ...(typeof bossPercentage === "number" ? { bossPercentage } : {}),
                ...(typeof fightPercentage === "number" ? { fightPercentage } : {}),
                ...(typeof inProgress === "boolean" ? { inProgress } : {}),
                ...(typeof originalEncounterID === "number"
                    ? { originalEncounterID }
                    : {}),
                ...(dungeonPulls.length > 0 ? { dungeonPulls } : {}),
            },
        ];
    });

export const pickEncounterSummaryFight = (
    fights: FightSummaryRow[],
): FightSummaryRow | undefined => {
    if (fights.length === 0) return undefined;

    let latestKill: FightSummaryRow | undefined;
    for (const fight of fights) {
        if (!fight.kill) continue;
        if (!latestKill || fight.endTime > latestKill.endTime) latestKill = fight;
    }
    if (latestKill) return latestKill;

    const compareWipeCandidate = (left: FightSummaryRow, right: FightSummaryRow): number => {
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
    };

    let bestWipe: FightSummaryRow | undefined;
    for (const fight of fights) {
        if (!bestWipe || compareWipeCandidate(fight, bestWipe) < 0) bestWipe = fight;
    }
    return bestWipe;
};

export interface TableValueEntry {
    value?: number;
    playerName?: string;
}

export const sumTableValues = (
    entries?: readonly TableValueEntry[],
): number | undefined => {
    if (!entries) return undefined;
    return entries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
};

export const summarizeBossTables = (
    bossName: string,
    fightId: number,
    parsedTables: Partial<Record<string, TableValueEntry[]>>,
    parseEntry?: NormalizedLeaderboardEntry,
): NormalizedBossPerformance => {
    const topByValue = (entries?: TableValueEntry[]): TableValueEntry | undefined => {
        let top: TableValueEntry | undefined;
        for (const entry of entries ?? []) {
            if (!top || (entry.value ?? 0) > (top.value ?? 0)) top = entry;
        }
        return top;
    };

    const topDamageEntry = topByValue(parsedTables.DamageDone);
    const topHealingEntry = topByValue(parsedTables.Healing);
    const mostDeathsEntry = topByValue(parsedTables.Deaths);
    const topInterruptsEntry = topByValue(parsedTables.Interrupts);
    const topSurvivabilityEntry = topByValue(parsedTables.Survivability);

    return {
        bossName,
        fightId,
        ...(parseEntry ? { topParse: parseEntry } : {}),
        ...(topDamageEntry
            ? {
                  topDamage: {
                      playerName: topDamageEntry.playerName ?? "Unknown",
                      value: topDamageEntry.value ?? 0,
                  },
              }
            : {}),
        ...(topHealingEntry
            ? {
                  topHealing: {
                      playerName: topHealingEntry.playerName ?? "Unknown",
                      value: topHealingEntry.value ?? 0,
                  },
              }
            : {}),
        ...(mostDeathsEntry
            ? {
                  mostDeaths: {
                      playerName: mostDeathsEntry.playerName ?? "Unknown",
                      value: mostDeathsEntry.value ?? 0,
                  },
              }
            : {}),
        ...(topInterruptsEntry
            ? {
                  topInterrupts: {
                      playerName: topInterruptsEntry.playerName ?? "Unknown",
                      value: topInterruptsEntry.value ?? 0,
                  },
              }
            : {}),
        ...(topSurvivabilityEntry
            ? {
                  topSurvivability: {
                      playerName: topSurvivabilityEntry.playerName ?? "Unknown",
                      value: topSurvivabilityEntry.value ?? 0,
                  },
              }
            : {}),
    };
};

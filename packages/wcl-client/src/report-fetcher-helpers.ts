import { getBossEncounterId, parseFightSummaries } from "@wcl/domain";
import type { RateLimitDataSnapshot } from "./raw-report.js";

export const getKillEncounterFightIds = (
    report: Record<string, unknown> | undefined,
): number[] => {
    if (!report) return [];

    return parseFightSummaries(report).flatMap((fight) => {
        const encounterID = getBossEncounterId(fight);
        if (typeof encounterID !== "number" || !fight.kill) return [];
        return [fight.id];
    });
};

export const getCompletedEncounterFightIds = (
    report: Record<string, unknown> | undefined,
): number[] => {
    if (!report) return [];

    return parseFightSummaries(report).flatMap((fight) => {
        const encounterID = getBossEncounterId(fight);
        if (typeof encounterID !== "number" || fight.inProgress) return [];
        return [fight.id];
    });
};

export const mapWithConcurrency = async <TInput, TOutput>(
    inputs: readonly TInput[],
    concurrency: number,
    mapper: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> => {
    const results = new Array<TOutput>(inputs.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), inputs.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextIndex < inputs.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(
                    inputs[currentIndex] as TInput,
                    currentIndex,
                );
            }
        }),
    );

    return results;
};

export type RatePressureLevel = "normal" | "high" | "critical";

export const getRatePressure = (
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

export const toFightIDs = (
    fightIDs?: number | number[] | null,
): number[] | undefined => {
    if (fightIDs == null) return undefined;
    return Array.isArray(fightIDs) ? fightIDs : [fightIDs];
};

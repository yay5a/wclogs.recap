import { describe, expect, it } from "vitest";
import {
    getCompletedEncounterFightIds,
    getKillEncounterFightIds,
    getRatePressure,
    mapWithConcurrency,
    toFightIDs,
} from "./report-fetcher-helpers.js";

describe("report fetcher helpers", () => {
    describe("getRatePressure", () => {
        it.each([
            {
                label: "missing data",
                input: undefined,
                expected: { level: "normal", usage: 0 },
            },
            {
                label: "invalid limit",
                input: {
                    limitPerHour: 0,
                    pointsSpentThisHour: 100,
                    pointsResetIn: 120,
                },
                expected: { level: "normal", usage: 0 },
            },
            {
                label: "97 percent usage",
                input: {
                    limitPerHour: 1000,
                    pointsSpentThisHour: 970,
                    pointsResetIn: 30,
                },
                expected: { level: "critical", usage: 0.97 },
            },
            {
                label: "90 percent usage with few points and reset not near",
                input: {
                    limitPerHour: 200,
                    pointsSpentThisHour: 180,
                    pointsResetIn: 120,
                },
                expected: { level: "critical", usage: 0.9 },
            },
            {
                label: "90 percent usage with few points and reset near",
                input: {
                    limitPerHour: 200,
                    pointsSpentThisHour: 180,
                    pointsResetIn: 30,
                },
                expected: { level: "high", usage: 0.9 },
            },
            {
                label: "85 percent usage",
                input: {
                    limitPerHour: 1000,
                    pointsSpentThisHour: 850,
                    pointsResetIn: 30,
                },
                expected: { level: "high", usage: 0.85 },
            },
            {
                label: "80 percent usage with reset not near",
                input: {
                    limitPerHour: 100,
                    pointsSpentThisHour: 80,
                    pointsResetIn: 120,
                },
                expected: { level: "high", usage: 0.8 },
            },
            {
                label: "80 percent usage with reset near",
                input: {
                    limitPerHour: 100,
                    pointsSpentThisHour: 80,
                    pointsResetIn: 30,
                },
                expected: { level: "normal", usage: 0.8 },
            },
        ] as const)("returns $expected.level pressure for $label", ({ input, expected }) => {
            expect(getRatePressure(input)).toEqual(expected);
        });
    });

    describe("fight id selection", () => {
        const report = {
            fights: [
                {
                    id: 1,
                    encounterID: 1001,
                    name: "Boss Kill",
                    startTime: 100,
                    endTime: 200,
                    kill: true,
                },
                {
                    id: 2,
                    encounterID: 1001,
                    name: "Boss Wipe",
                    startTime: 220,
                    endTime: 300,
                    kill: false,
                },
                {
                    id: 3,
                    encounterID: 0,
                    originalEncounterID: 1002,
                    name: "Original Encounter Kill",
                    startTime: 320,
                    endTime: 420,
                    kill: true,
                },
                {
                    id: 4,
                    encounterID: 0,
                    name: "Trash",
                    startTime: 440,
                    endTime: 460,
                    kill: true,
                },
                {
                    id: 5,
                    encounterID: 1003,
                    name: "In Progress",
                    startTime: 480,
                    endTime: 520,
                    kill: false,
                    inProgress: true,
                },
                {
                    id: "bad",
                    encounterID: 1004,
                    name: "Malformed",
                    startTime: 540,
                    endTime: 560,
                    kill: true,
                },
            ],
        };

        it("selects only killed encounter fight ids for kill-scoped enrichments", () => {
            expect(getKillEncounterFightIds(report)).toEqual([1, 3]);
        });

        it("selects completed encounter fight ids and excludes in-progress fights", () => {
            expect(getCompletedEncounterFightIds(report)).toEqual([1, 2, 3]);
        });

        it("returns an empty list when the report is absent", () => {
            expect(getKillEncounterFightIds(undefined)).toEqual([]);
            expect(getCompletedEncounterFightIds(undefined)).toEqual([]);
        });
    });

    describe("mapWithConcurrency", () => {
        it("preserves result order while respecting the requested concurrency", async () => {
            let active = 0;
            let maxActive = 0;

            const results = await mapWithConcurrency(
                [30, 10, 20],
                2,
                async (delayMs, index) => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    active -= 1;
                    return `${index}:${delayMs}`;
                },
            );

            expect(results).toEqual(["0:30", "1:10", "2:20"]);
            expect(maxActive).toBe(2);
        });

        it("handles zero or oversized concurrency without dropping work", async () => {
            await expect(
                mapWithConcurrency([1, 2], 0, async (value) => value * 2),
            ).resolves.toEqual([2, 4]);

            let active = 0;
            let maxActive = 0;
            await mapWithConcurrency([1, 2], 10, async (value) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active -= 1;
                return value;
            });

            expect(maxActive).toBe(2);
        });

        it("propagates mapper errors", async () => {
            await expect(
                mapWithConcurrency([1, 2], 2, async (value) => {
                    if (value === 2) throw new Error("boom");
                    return value;
                }),
            ).rejects.toThrow("boom");
        });
    });

    describe("toFightIDs", () => {
        it.each([null, undefined])("keeps %s fight ids absent", (fightIDs) => {
            expect(toFightIDs(fightIDs)).toBeUndefined();
        });

        it("normalizes a single fight id and passes arrays through", () => {
            const fightIds = [1, 2, 3];
            expect(toFightIDs(7)).toEqual([7]);
            expect(toFightIDs(fightIds)).toBe(fightIds);
        });
    });
});

import { describe, expect, it } from "vitest";
import { buildRecapSummary } from "./index.js";

describe("buildRecapSummary", () => {
    it("builds best single-boss parse with bossName and fightId", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.now(),
            endTime: Date.now(),
            gameFamily: "retail",
            fights: [
                { id: 7, name: "Kazz", startTime: 0, endTime: 1, kill: true },
            ],
            players: [{ id: "1", actorId: 1, name: "A" }],
            leaderboards: [
                {
                    scope: "boss",
                    bossName: "Kazz",
                    fightId: 7,
                    playerId: 1,
                    playerName: "A",
                    metric: "bestPercent",
                    value: 98.5,
                },
            ],
            bossPerformances: [
                {
                    bossName: "Kazz",
                    fightId: 7,
                    topDamage: { playerName: "A", value: 12345 },
                },
            ],
        });

        expect(summary.bestSingleBossParse).toMatchObject({
            bossName: "Kazz",
            fightId: 7,
        });
        expect(summary.bossHighlights.length).toBeGreaterThan(0);
    });

    it("composes topOverallParsers and raidSuperlatives", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.now(),
            endTime: Date.now(),
            gameFamily: "retail",
            fights: [
                { id: 1, name: "Boss", startTime: 0, endTime: 1, kill: true },
            ],
            players: [{ id: "1", name: "Alyra", executionScore: 88 }],
            leaderboards: [
                {
                    scope: "report",
                    playerId: 1,
                    playerName: "Alyra",
                    metric: "bestPerformanceAverage",
                    value: 95,
                },
            ],
            bossPerformances: [
                {
                    bossName: "Boss",
                    fightId: 1,
                    mostDeaths: { playerName: "Alyra", value: 3 },
                },
            ],
        });

        expect(summary.topOverallParsers[0]?.playerName).toBe("Alyra");
        expect(summary.raidSuperlatives[0]?.label).toBe("Most deaths");
    });

    it("surfaces most improved player when previous raid data exists", () => {
        const summary = buildRecapSummary(
            {
                reportCode: "abc",
                title: "Raid Night",
                startTime: Date.now(),
                endTime: Date.now(),
                gameFamily: "retail",
                fights: [],
                players: [
                    { id: "1", actorId: 1, name: "Alyra", avgParse: 89 },
                    { id: "2", actorId: 2, name: "Borin", avgParse: 70 },
                ],
            },
            [
                { id: "old-1", actorId: 1, name: "Alyra", avgParse: 82 },
                { id: "old-2", actorId: 2, name: "Borin", avgParse: 69 },
            ],
        );

        expect(summary.mostImprovedPlayer).toEqual({
            playerName: "Alyra",
            delta: 7,
        });
    });

    it("is resilient when ranking/table sections are absent", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.now(),
            endTime: Date.now(),
            gameFamily: "retail",
            fights: [],
            players: [],
        });

        expect(summary.bestSingleBossParse).toBeUndefined();
        expect(summary.topOverallParsers).toEqual([]);
    });
    it("omits optional parse fields when leaderboard linkage is ambiguous", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.now(),
            endTime: Date.now(),
            gameFamily: "retail",
            fights: [
                { id: 10, name: "Boss", startTime: 0, endTime: 1, kill: true },
            ],
            players: [{ id: "1", name: "Alyra", bestParse: 99, avgParse: 97 }],
            leaderboards: [
                {
                    scope: "report",
                    playerName: "Alyra",
                    metric: "bestPerformanceAverage",
                    value: 95,
                },
                {
                    scope: "boss",
                    bossName: "Boss",
                    fightId: 10,
                    playerName: "Alyra",
                    metric: "bestPercent",
                    value: 98.5,
                },
            ],
        });

        expect(summary.bestAverageParse).toBeUndefined();
        expect(summary.bestSingleBossParse).toBeUndefined();
    });
});

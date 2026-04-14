import { describe, expect, it } from "vitest";
import { buildRecapSummary } from "./index.js";

describe("buildRecapSummary report-wide output", () => {
    it("builds report-wide title/date/pull and duration", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            zoneName: "Liberation of Undermine",
            fights: [
                { id: 10, name: "Boss", startTime: 0, endTime: 1, kill: true },
            ],
            players: [],
            bossPerformances: [
                {
                    bossName: "Mug'Zee",
                    fightId: 10,
                    kill: true,
                    guildName: "Pull More",
                    realmName: "Stormrage-US",
                    pullCount: 17,
                    fightDurationMs: 372000,
                    fightDate: Date.UTC(2025, 0, 3),
                },
            ],
        });

        expect(summary.titleLine).toBe("Raid Night - Liberation of Undermine");
        expect(summary.secondaryLine).toBe("Pull More on Stormrage-US");
        expect(summary.killTimeLabel).toBe("01 Hour 00 Min");
        expect(summary.pullCount).toBe(1);
        expect(summary.reportDateLabel).toBe("01/02/2025");
    });

    it("uses report-wide totals/tables + multi-boss leaderboards", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [
                { id: 11, name: "One-Armed Bandit", startTime: 0, endTime: 1, kill: true },
                { id: 12, name: "Gallywix", startTime: 0, endTime: 1, kill: false },
            ],
            players: [],
            leaderboards: [
                {
                    scope: "report",
                    playerName: "Alyra",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "DPS",
                    value: 99.2,
                },
                {
                    scope: "report",
                    playerName: "Healz",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "HPS",
                    value: 95.1,
                },
                {
                    scope: "report",
                    playerName: "Bulwark",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "DTPS",
                    value: 93.3,
                },
                {
                    scope: "boss",
                    bossName: "One-Armed Bandit",
                    fightId: 11,
                    playerName: "Alyra",
                    metric: "bestPercent",
                    selectedMetric: "DPS",
                    value: 99.2,
                },
                {
                    scope: "boss",
                    bossName: "Lei Shen",
                    fightId: 12,
                    playerName: "Emerald",
                    metric: "bestPercent",
                    selectedMetric: "HPS",
                    value: 99.9,
                },
            ],
            reportWideRecap: {
                topDamageDone: [
                    {
                        playerName: "Alyra",
                        value: 250000,
                        className: "Priest",
                        specName: "Shadow",
                    },
                ],
                topHealingDone: [{ playerName: "Healz", value: 67890 }],
                totals: { deaths: 12, dispels: 8, interrupts: 6 },
            },
            bossPerformances: [
                { bossName: "One-Armed Bandit", fightId: 11, kill: true, pullCount: 8 },
                { bossName: "Gallywix", fightId: 12, kill: false, pullCount: 5 },
            ],
        });

        expect(summary.bestPlayerParses[0]).toMatchObject({
            playerName: "Alyra",
            parse: 99.2,
            amount: 250000,
            metricLabel: "DPS",
            classSpecLabel: "Shadow Priest",
        });
        expect(summary.topDamageTaken).toEqual([]);
        expect(summary.topHealers[0]?.playerName).toBe("Healz");
        expect(summary.totals.totalDeaths).toBe(12);
        expect(summary.totals.dispels).toBe(8);
        expect(summary.totals.kicks).toBe(6);
        expect(summary.bestSingleBossParse?.playerName).toBe("Emerald");
        expect(summary.bestSingleBossParse?.metric).toBe("HPS");
        expect(summary.bestAverageParse?.playerName).toBe("Alyra");
        expect(summary.topOverallParsers).toEqual([
            { playerName: "Alyra", value: 99.2, metric: "DPS" },
            { playerName: "Healz", value: 95.1, metric: "HPS" },
            { playerName: "Bulwark", value: 93.3, metric: "DTPS" },
        ]);
        expect(summary.topOverallDamageParsers).toEqual([
            { playerName: "Alyra", value: 99.2, metric: "DPS" },
        ]);
        expect(summary.topOverallHealingParsers).toEqual([
            { playerName: "Healz", value: 95.1, metric: "HPS" },
        ]);
        expect(summary.bossHighlights.length).toBe(2);
    });

    it("omits unsupported report-wide fields instead of fabricating", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
        });

        expect(summary.bestPlayerParses).toEqual([]);
        expect(summary.topDamageTaken).toEqual([]);
        expect(summary.topHealers).toEqual([]);
        expect(summary.topOverallHealingParsers).toEqual([]);
        expect(summary.totals.totalDeaths).toBeUndefined();
        expect(summary.bestExecution).toBeUndefined();
        expect(summary.mostImprovedPlayer).toBeUndefined();
        expect(summary.totals.battleRezzes).toBeUndefined();
    });

    it("dedupes repeated players in report-wide parse sections and keeps strongest row", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
            leaderboards: [
                {
                    scope: "report",
                    playerName: "Tankhem",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "DTPS",
                    value: 96.4,
                },
                {
                    scope: "report",
                    playerName: "Tankhem",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "DTPS",
                    value: 96.4,
                    className: "Warrior",
                    specName: "Protection",
                },
                {
                    scope: "report",
                    playerName: "Alyra",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "DPS",
                    value: 95.7,
                },
            ],
            reportWideRecap: {
                topDamageDone: [{ playerName: "Tankhem", value: 220000 }],
                topHealingDone: [],
                totals: {},
            },
        });

        expect(summary.bestPlayerParses).toEqual([
            {
                playerName: "Tankhem",
                parse: 96.4,
                metricLabel: "DTPS",
                metric: "DTPS",
                amount: 220000,
                className: "Warrior",
                specName: "Protection",
                classSpecLabel: "Protection Warrior",
            },
            {
                playerName: "Alyra",
                parse: 95.7,
                metricLabel: "DPS",
                metric: "DPS",
            },
        ]);
        expect(summary.topOverallParsers).toEqual([
            { playerName: "Tankhem", value: 96.4, metric: "DTPS" },
            { playerName: "Alyra", value: 95.7, metric: "DPS" },
        ]);
        expect(summary.topOverallDamageParsers).toEqual([
            { playerName: "Alyra", value: 95.7, metric: "DPS" },
        ]);
        expect(summary.topOverallHealingParsers).toEqual([]);
    });

    it("builds top overall healing parsers from report leaderboard HPS rows and dedupes players", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
            leaderboards: [
                {
                    scope: "report",
                    playerName: "Emerald",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "HPS",
                    value: 96,
                },
                {
                    scope: "report",
                    playerName: "Emerald",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "HPS",
                    value: 94.2,
                },
                {
                    scope: "report",
                    playerName: "Pearl",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "HPS",
                    value: 95.3,
                },
                {
                    scope: "report",
                    playerName: "Alyra",
                    metric: "bestPerformanceAverage",
                    selectedMetric: "DPS",
                    value: 99.1,
                },
            ],
            reportWideRecap: {
                topDamageDone: [],
                topHealingDone: [{ playerName: "TotalsOnly", value: 689_900_000 }],
                totals: {},
            },
        });

        expect(summary.topOverallHealingParsers).toEqual([
            { playerName: "Emerald", value: 96, metric: "HPS" },
            { playerName: "Pearl", value: 95.3, metric: "HPS" },
        ]);
        expect(summary.topOverallHealingParsers.map((entry) => entry.playerName)).not.toContain(
            "TotalsOnly",
        );
    });

    it("formats raid duration as hour/minute text with singular and plural grammar", () => {
        const threeHoursFive = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 3, 5),
            gameFamily: "retail",
            fights: [],
            players: [],
        });
        const oneHourOne = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
        });
        const fortyFiveMinutes = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 0, 45),
            gameFamily: "retail",
            fights: [],
            players: [],
        });

        expect(threeHoursFive.killTimeLabel).toBe("03 Hours 05 Min");
        expect(oneHourOne.killTimeLabel).toBe("01 Hour 01 Min");
        expect(fortyFiveMinutes.killTimeLabel).toBe("45 Min");
    });
});

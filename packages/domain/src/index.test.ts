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

        expect(summary.titleLine).toBe("Liberation of Undermine");
        expect(summary.secondaryLine).toBe("Pull More on Stormrage-US");
        expect(summary.killTimeLabel).toBe("01 Hour 00 Min");
        expect(summary.pullCount).toBe(1);
        expect(summary.reportDateLabel).toBe("01/02/2025");
    });

    it("uses zone plus difficulty when normalized data includes both", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Throne of Thunder",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            zoneName: "Throne of Thunder",
            fights: [{ id: 10, name: "Lei Shen", startTime: 0, endTime: 1, kill: true }],
            players: [],
            bossPerformances: [
                {
                    bossName: "Lei Shen",
                    fightId: 10,
                    kill: true,
                    zoneName: "Throne of Thunder",
                    difficultyName: "Heroic",
                    fightDate: Date.UTC(2025, 0, 3),
                },
            ],
        });

        expect(summary.titleLine).toBe("Throne of Thunder - Heroic");
    });

    it("falls back to zone-only when difficulty is missing", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Throne of Thunder",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            zoneName: "Throne of Thunder",
            fights: [{ id: 10, name: "Lei Shen", startTime: 0, endTime: 1, kill: true }],
            players: [],
            bossPerformances: [
                {
                    bossName: "Lei Shen",
                    fightId: 10,
                    kill: true,
                    zoneName: "Throne of Thunder",
                    fightDate: Date.UTC(2025, 0, 3),
                },
            ],
        });

        expect(summary.titleLine).toBe("Throne of Thunder");
    });

    it("falls back to report title when zone is missing", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night Crew",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
        });

        expect(summary.titleLine).toBe("Raid Night Crew");
    });

    it("uses numeric difficulty mapping when difficulty name is unavailable", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Throne of Thunder",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            zoneName: "Throne of Thunder",
            fights: [{ id: 10, name: "Lei Shen", startTime: 0, endTime: 1, kill: true }],
            players: [],
            bossPerformances: [
                {
                    bossName: "Lei Shen",
                    fightId: 10,
                    kill: true,
                    zoneName: "Throne of Thunder",
                    difficulty: 5,
                    fightDate: Date.UTC(2025, 0, 3),
                },
            ],
        });

        expect(summary.titleLine).toBe("Throne of Thunder - Mythic");
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
                topDamageTaken: [{ playerName: "Bulwark", value: 120000 }],
                topInterrupts: [{ playerName: "Bulwark", value: 6 }],
                topDispels: [{ playerName: "Healz", value: 8 }],
                topSurvivability: [{ playerName: "Alyra", value: 98.2 }],
                totals: { deaths: 12, dispels: 8, interrupts: 6 },
            },
            bossPerformances: [
                {
                    bossName: "One-Armed Bandit",
                    fightId: 11,
                    kill: true,
                    pullCount: 8,
                    topDamage: { playerName: "Alyra", value: 250000 },
                    topInterrupts: { playerName: "Bulwark", value: 5 },
                },
                { bossName: "Gallywix", fightId: 12, kill: false, pullCount: 5, mostDeaths: { playerName: "Alyra", value: 3 } },
            ],
        });

        expect(summary.topDamageDone).toEqual([
            { playerName: "Alyra", value: 250000, classSpecLabel: "Shadow Priest" },
        ]);
        expect(summary.topHealingDone).toEqual([{ playerName: "Healz", value: 67890 }]);
        expect(summary.topDamageTaken).toEqual([{ playerName: "Bulwark", value: 120000 }]);
        expect(summary.topInterrupts).toEqual([{ playerName: "Bulwark", value: 6 }]);
        expect(summary.topDispels).toEqual([{ playerName: "Healz", value: 8 }]);
        expect(summary.topSurvivability).toEqual([{ playerName: "Alyra", value: 98.2 }]);
        expect(summary.topHealers[0]?.playerName).toBe("Healz");
        expect(summary.totals.totalDeaths).toBe(12);
        expect(summary.totals.dispels).toBe(8);
        expect(summary.totals.kicks).toBe(6);
        expect(summary.highestParses).toEqual([]);
        expect(summary.topDamageAverageParses).toEqual([]);
        expect(summary.topHealingAverageParses).toEqual([]);
        expect(summary.bossHighlights.length).toBe(2);
        expect(summary.bossHighlights[0]?.text).not.toContain("Kill secured.");
        const firstBossParts = (summary.bossHighlights[0]?.text ?? "").split(" · ");
        expect(firstBossParts.length).toBeLessThanOrEqual(3);
        expect(summary.raidSuperlatives.length).toBeGreaterThan(0);
        expect(summary.raidSuperlatives.some((entry) => entry.label.toLowerCase().includes("parse"))).toBe(
            false,
        );
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

        expect(summary.topDamageTaken).toEqual([]);
        expect(summary.topHealers).toEqual([]);
        expect(summary.topDamageDone).toEqual([]);
        expect(summary.topHealingDone).toEqual([]);
        expect(summary.topInterrupts).toEqual([]);
        expect(summary.topDispels).toEqual([]);
        expect(summary.topSurvivability).toEqual([]);
        expect(summary.highestParses).toEqual([]);
        expect(summary.topDamageAverageParses).toEqual([]);
        expect(summary.topHealingAverageParses).toEqual([]);
        expect(summary.totals.totalDeaths).toBeUndefined();
        expect(summary.bestExecution).toBeUndefined();
        expect(summary.mostImprovedPlayer).toBeUndefined();
        expect(summary.totals.battleRezzes).toBeUndefined();
    });

    it("builds highest parse and DPS/HPS parse averages from report-wide combined rankings rankPercent", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
            reportWideRankings: {
                dps: [
                    {
                        scope: "report",
                        playerName: "Kaltsit",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 90,
                        value: 90,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "Kaltsit",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 32,
                        value: 32,
                        bossName: "Megaera",
                        fightId: 8,
                    },
                    {
                        scope: "report",
                        playerName: "Jokerofpain",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 81,
                        value: 81,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "Jokerofpain",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 41,
                        value: 41,
                        bossName: "Megaera",
                        fightId: 8,
                    },
                    {
                        scope: "report",
                        playerName: "Venomblàdez",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 57,
                        value: 57,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "Tankhem",
                        metric: "rankPercent",
                        selectedMetric: "DTPS",
                        role: "tank",
                        rankPercent: 99,
                        value: 99,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "BracketOnlyDps",
                        metric: "bracketPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        bracketPercent: 99,
                        value: 99,
                        bossName: "Horridon",
                        fightId: 4,
                        amount: 999999999,
                    },
                ],
                hps: [
                    {
                        scope: "report",
                        playerName: "Bustinsihder",
                        metric: "rankPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        rankPercent: 89,
                        value: 89,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "Bustinsihder",
                        metric: "rankPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        rankPercent: 51,
                        value: 51,
                        bossName: "Megaera",
                        fightId: 8,
                    },
                    {
                        scope: "report",
                        playerName: "Emerald",
                        metric: "rankPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        rankPercent: 54,
                        value: 54,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "DpsLeak",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 98,
                        value: 98,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "BracketOnlyHps",
                        metric: "bracketPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        bracketPercent: 99,
                        value: 99,
                        bossName: "Horridon",
                        fightId: 4,
                        amount: 999999999,
                    },
                ],
            },
        });

        expect(summary.highestParses).toEqual([
            {
                playerName: "Kaltsit",
                metric: "DPS",
                value: 90,
                bossName: "Horridon",
                fightId: 4,
            },
            {
                playerName: "Bustinsihder",
                metric: "HPS",
                value: 89,
                bossName: "Horridon",
                fightId: 4,
            },
            {
                playerName: "Jokerofpain",
                metric: "DPS",
                value: 81,
                bossName: "Horridon",
                fightId: 4,
            },
        ]);
        expect(summary.topDamageAverageParses).toEqual([
            { playerName: "Kaltsit", value: 61 },
            { playerName: "Jokerofpain", value: 61 },
            { playerName: "Venomblàdez", value: 57 },
        ]);
        expect(summary.topHealingAverageParses).toEqual([
            { playerName: "Bustinsihder", value: 70 },
            { playerName: "Emerald", value: 54 },
        ]);
        expect(summary.highestParses.map((entry) => entry.playerName)).not.toContain("Tankhem");
        expect(summary.highestParses.map((entry) => entry.playerName)).not.toContain("DpsLeak");
        expect(summary.highestParses.map((entry) => entry.playerName)).not.toContain(
            "BracketOnlyDps",
        );
        expect(summary.highestParses.map((entry) => entry.playerName)).not.toContain(
            "BracketOnlyHps",
        );
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
            reportWideRankings: {
                dps: [
                    {
                        scope: "report",
                        playerName: "Tankhem",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 80,
                        value: 80,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "Tankhem",
                        metric: "rankPercent",
                        selectedMetric: "DPS",
                        role: "dps",
                        rankPercent: 80,
                        value: 80,
                        bossName: "Horridon",
                        fightId: 4,
                        className: "DeathKnight",
                        specName: "Blood",
                    },
                ],
                hps: [],
            },
        });

        expect(summary.highestParses).toEqual([
            {
                playerName: "Tankhem",
                metric: "DPS",
                value: 80,
                bossName: "Horridon",
                fightId: 4,
                className: "DeathKnight",
                specName: "Blood",
                classSpecLabel: "Blood Death Knight",
            },
        ]);
        expect(summary.topDamageAverageParses).toEqual([
            {
                playerName: "Tankhem",
                value: 80,
                className: "DeathKnight",
                specName: "Blood",
                classSpecLabel: "Blood Death Knight",
            },
        ]);
        expect(summary.topHealingAverageParses).toEqual([]);
    });

    it("builds top healing parse averages from HPS rankPercent rows and ignores throughput totals", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
            reportWideRankings: {
                dps: [],
                hps: [
                    {
                        scope: "report",
                        playerName: "Emerald",
                        metric: "rankPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        rankPercent: 96,
                        value: 96,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                    {
                        scope: "report",
                        playerName: "Emerald",
                        metric: "rankPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        rankPercent: 94.2,
                        value: 94.2,
                        bossName: "Megaera",
                        fightId: 8,
                    },
                    {
                        scope: "report",
                        playerName: "Pearl",
                        metric: "rankPercent",
                        selectedMetric: "HPS",
                        role: "healer",
                        rankPercent: 95.3,
                        value: 95.3,
                        bossName: "Horridon",
                        fightId: 4,
                    },
                ],
            },
            reportWideRecap: {
                topDamageDone: [],
                topHealingDone: [{ playerName: "TotalsOnly", value: 689_900_000 }],
                totals: {},
            },
        });

        expect(summary.topHealingAverageParses).toHaveLength(2);
        expect(summary.topHealingAverageParses).toContainEqual({
            playerName: "Pearl",
            value: 95,
        });
        expect(summary.topHealingAverageParses).toContainEqual({
            playerName: "Emerald",
            value: 95,
        });
        expect(summary.topHealingAverageParses.map((entry) => entry.playerName)).not.toContain(
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

    it("formats phase timing callouts as minute/second labels", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
            bossPerformances: [
                {
                    bossName: "Ji-Kun",
                    fightId: 1,
                    kill: true,
                    fastestPhaseTimes: [{ phaseId: 1, label: "P1", durationMs: 142_700 }],
                },
            ],
        });

        expect(summary.bossHighlights[0]?.text).toContain("Fast P1 2m 22.7s");
        expect(summary.raidSuperlatives).toContainEqual({
            label: "Fastest phase",
            text: "Ji-Kun P1 2m 22.7s",
        });
    });

    it("sets bestExecution from report players and omits when missing", () => {
        const withExecution = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [
                { id: "1", name: "Alyra", executionScore: 81.2 },
                { id: "2", name: "Pearl", executionScore: 90.1 },
            ],
        });
        const withoutExecution = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [{ id: "1", name: "Alyra" }],
        });

        expect(withExecution.bestExecution).toEqual({ playerName: "Pearl", value: 90.1 });
        expect(withoutExecution.bestExecution).toBeUndefined();
    });

    it("computes mostImprovedPlayer with weighted scoring and actor/name fallback", () => {
        const summary = buildRecapSummary(
            {
                reportCode: "abc",
                title: "Raid Night",
                startTime: Date.UTC(2025, 0, 2),
                endTime: Date.UTC(2025, 0, 2, 1),
                gameFamily: "retail",
                fights: [],
                players: [
                    { id: "1", actorId: 1001, name: "Alyra", avgParse: 80, executionScore: 90 },
                    { id: "2", name: "Pearl", avgParse: 75 },
                ],
            },
            [
                { id: "p1", actorId: 1001, name: "Alyra", avgParse: 70, executionScore: 80 },
                { id: "p2", name: " pearl ", avgParse: 70 },
            ],
        );

        expect(summary.mostImprovedPlayer).toEqual({
            playerName: "Alyra",
            delta: 10,
        });
    });

    it("omits mostImprovedPlayer when no comparable history or below threshold", () => {
        const noComparable = buildRecapSummary(
            {
                reportCode: "abc",
                title: "Raid Night",
                startTime: Date.UTC(2025, 0, 2),
                endTime: Date.UTC(2025, 0, 2, 1),
                gameFamily: "retail",
                fights: [],
                players: [{ id: "1", name: "Alyra", avgParse: 80 }],
            },
            [{ id: "p1", name: "Unknown", avgParse: 70 }],
        );
        const belowNoise = buildRecapSummary(
            {
                reportCode: "abc",
                title: "Raid Night",
                startTime: Date.UTC(2025, 0, 2),
                endTime: Date.UTC(2025, 0, 2, 1),
                gameFamily: "retail",
                fights: [],
                players: [{ id: "1", name: "Alyra", avgParse: 70.5 }],
            },
            [{ id: "p1", name: "Alyra", avgParse: 69 }],
        );

        expect(noComparable.mostImprovedPlayer).toBeUndefined();
        expect(belowNoise.mostImprovedPlayer).toBeUndefined();
    });
});

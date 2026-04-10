import { describe, expect, it } from "vitest";
import { buildRecapSummary } from "./index.js";

describe("buildRecapSummary MVP output", () => {
    it("builds title line, pull count, kill time, and date from structured boss fields", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [
                { id: 10, name: "Boss", startTime: 0, endTime: 1, kill: true },
            ],
            players: [],
            bossPerformances: [
                {
                    bossName: "Mug'Zee",
                    fightId: 10,
                    kill: true,
                    difficultyName: "Mythic",
                    zoneName: "Liberation of Undermine",
                    guildName: "Pull More",
                    realmName: "Stormrage-US",
                    pullCount: 17,
                    fightDurationMs: 372000,
                    fightDate: Date.UTC(2025, 0, 3),
                },
            ],
        });

        expect(summary.titleLine).toBe(
            "Mug'Zee - Mythic - Liberation of Undermine",
        );
        expect(summary.secondaryLine).toBe("Pull More on Stormrage-US");
        expect(summary.killTimeLabel).toBe("06:12");
        expect(summary.pullCount).toBe(17);
        expect(summary.reportDateLabel).toBe("01/03/2025");
    });

    it("includes fastest phase times and top sections with stable winner-first ordering", () => {
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
                    bossName: "One-Armed Bandit",
                    fightId: 11,
                    kill: true,
                    pullCount: 8,
                    fastestPhaseTimes: [
                        { phaseId: 1, label: "P1", durationMs: 120000 },
                        { phaseId: 2, label: "P2", durationMs: 180000 },
                    ],
                    bestParses: [
                        {
                            playerName: "Alyra",
                            parse: 99.2,
                            amount: 250000,
                            metric: "dps",
                            className: "Priest",
                            specName: "Shadow",
                        },
                    ],
                    topDamageTaken: [{ playerName: "Tanky", value: 12345 }],
                    topHealers: [{ playerName: "Healz", value: 67890 }],
                },
            ],
        });

        expect(summary.fastestPhaseTimes).toEqual([
            { label: "P1", durationMs: 120000 },
            { label: "P2", durationMs: 180000 },
        ]);
        expect(summary.bestPlayerParses[0]).toMatchObject({
            playerName: "Alyra",
            metricLabel: "DPS",
            classSpecLabel: "Shadow Priest",
        });
        expect(summary.topDamageTaken[0]?.playerName).toBe("Tanky");
        expect(summary.topHealers[0]?.playerName).toBe("Healz");
    });

    it("computes most wipes line from structured pull grouping", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.UTC(2025, 0, 2),
            endTime: Date.UTC(2025, 0, 2, 1),
            gameFamily: "retail",
            fights: [],
            players: [],
            bossPerformances: [
                { bossName: "Boss A", fightId: 1, pullCount: 4, kill: true },
                { bossName: "Boss B", fightId: 2, pullCount: 7, kill: false },
            ],
        });

        expect(summary.totals.mostWipesBoss).toBe("Boss B");
        expect(summary.totals.mostWipesCount).toBe(7);
    });

    it("gracefully falls back when JSON-derived sections are missing", () => {
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
        expect(summary.totals.totalDeaths).toBeUndefined();
    });
});

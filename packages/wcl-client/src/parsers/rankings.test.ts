import { describe, expect, it, vi } from "vitest";
import {
    parseBossRankingsPayload,
    parseReportRankingsPayloadForRole,
    parseReportRankingsPayload,
} from "./rankings.js";

describe("rankings parsers", () => {
    it("parses report-wide ranking shapes and does not throw", () => {
        const warn = vi.fn();
        const entries = parseReportRankingsPayload(
            JSON.stringify({
                data: [
                    { name: "Alyra", bestPerformanceAverage: 95.4, rank: 1 },
                    { player: { id: 2, name: "Borin", role: "Healer" }, percentile: 90.1 },
                ],
            }),
            warn,
        );

        expect(entries).toHaveLength(2);
        expect(entries[0]?.playerName).toBe("Alyra");
        expect(entries[1]?.playerId).toBe(2);
        expect(entries[0]?.selectedMetric).toBe("DPS");
        expect(entries[1]?.selectedMetric).toBe("HPS");
        expect(entries[0]?.performanceAverage).toBe(95.4);
        expect(warn).not.toHaveBeenCalled();
    });

    it("preserves WCL-provided aggregate performance average fields", () => {
        const entries = parseReportRankingsPayload({
            data: [
                { name: "Raikami", rankPercent: 79.8, bestPerformanceAverage: 82.4 },
                { name: "Sluuti", rankPercent: 87.3, performanceAverage: 81.6 },
                { name: "Banson", rankPercent: 67.7, bestPercent: 75.2 },
            ],
        });

        expect(entries.map((entry) => [entry.playerName, entry.performanceAverage])).toEqual([
            ["Raikami", 82.4],
            ["Sluuti", 81.6],
            ["Banson", 75.2],
        ]);
    });

    it("parses boss-scoped entries with fallback context", () => {
        const entries = parseBossRankingsPayload(
            { rankings: [{ name: "Alyra", bestPercent: 88.8 }] },
            { bossName: "Boss One", fightId: 12 },
        );

        expect(entries[0]?.bossName).toBe("Boss One");
        expect(entries[0]?.fightId).toBe(12);
        expect(entries[0]?.scope).toBe("boss");
    });

    it("parses role-bucket leaderboard data rows", () => {
        const entries = parseBossRankingsPayload(
            {
                data: [
                    {
                        fightID: 44,
                        encounter: { name: "Tortos" },
                        roles: {
                            tanks: {
                                characters: [
                                    {
                                        id: 10,
                                        name: "Tanky",
                                        class: "Warrior",
                                        spec: "Protection",
                                        amount: 123456,
                                        rankPercent: 98.2,
                                    },
                                ],
                            },
                            healers: { characters: [] },
                            dps: { characters: [] },
                        },
                    },
                ],
            },
            { bossName: "Tortos", fightId: 44 },
        );

        expect(entries).toHaveLength(1);
        expect(entries[0]?.playerId).toBe(10);
        expect(entries[0]?.bossName).toBe("Tortos");
        expect(entries[0]?.value).toBe(98.2);
        expect(entries[0]?.role).toBe("tank");
        expect(entries[0]?.selectedMetric).toBe("DPS");
    });

    it("preserves explicit metric identity when present", () => {
        const entries = parseReportRankingsPayload({
            data: [
                {
                    name: "Emerald",
                    rankPercent: 97,
                    selectedMetric: "hps",
                    role: "DPS",
                },
            ],
        });

        expect(entries[0]?.selectedMetric).toBe("HPS");
    });

    it("uses explicit metric identity before role fallback", () => {
        const entries = parseBossRankingsPayload(
            {
                rankings: [
                    {
                        name: "Emerald",
                        rankPercent: 99.5,
                        selectedMetric: "hps",
                        role: "dps",
                    },
                ],
            },
            { bossName: "Lei Shen", fightId: 46 },
        );

        expect(entries[0]?.selectedMetric).toBe("HPS");
    });

    it("falls back to role-based metric only when explicit metric is absent", () => {
        const entries = parseReportRankingsPayload({
            data: [
                { name: "Floorroller", rankPercent: 96.1, role: "Healer" },
                { name: "Bulwark", rankPercent: 94.2, role: "Tank" },
            ],
        });

        expect(entries[0]?.selectedMetric).toBe("HPS");
        expect(entries[1]?.selectedMetric).toBe("DPS");
    });

    it("returns empty arrays and emits warnings for invalid shape", () => {
        const warn = vi.fn();
        expect(() => parseReportRankingsPayload("not-json", warn)).not.toThrow();
        const entries = parseReportRankingsPayload("not-json", warn);
        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it("parses only requested role buckets for report-wide combined payloads", () => {
        const payload = {
            data: [
                {
                    fightID: 44,
                    encounter: { name: "Tortos" },
                    roles: {
                        tanks: {
                            characters: [
                                { id: 10, name: "Tanky", rankPercent: 98.2, amount: 123456 },
                            ],
                        },
                        healers: {
                            characters: [
                                { id: 11, name: "Healz", rankPercent: 90.1, amount: 654321 },
                            ],
                        },
                        dps: {
                            characters: [
                                { id: 12, name: "Dpsy", rankPercent: 88.4, amount: 111111 },
                            ],
                        },
                    },
                },
            ],
        };

        const dpsEntries = parseReportRankingsPayloadForRole(payload, "dps");
        const healerEntries = parseReportRankingsPayloadForRole(payload, "healer");

        expect(dpsEntries.map((entry) => entry.playerName)).toEqual(["Dpsy"]);
        expect(dpsEntries[0]?.selectedMetric).toBe("DPS");
        expect(healerEntries.map((entry) => entry.playerName)).toEqual(["Healz"]);
        expect(healerEntries[0]?.selectedMetric).toBe("HPS");
    });

    it("preserves aggregate performance averages from requested role buckets", () => {
        const payload = {
            data: [
                {
                    fightID: 44,
                    encounter: { name: "Tortos" },
                    roles: {
                        tanks: { characters: [] },
                        healers: { characters: [] },
                        dps: {
                            characters: [
                                {
                                    name: "Raikami",
                                    rankPercent: 79.8,
                                    bestPerformanceAverage: 83.1,
                                },
                            ],
                        },
                    },
                },
            ],
        };

        const entries = parseReportRankingsPayloadForRole(payload, "dps");

        expect(entries[0]?.performanceAverage).toBe(83.1);
        expect(entries[0]?.rankPercent).toBe(79.8);
    });
});

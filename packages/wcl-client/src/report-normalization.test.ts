import { describe, expect, it } from "vitest";
import { normalizeEnrichedReport, normalizeReport } from "./normalize-report.js";

describe("normalize report", () => {
    const parsed = {
        reportCode: "abc",
        gameFamily: "retail" as const,
        rawUrl: "https://www.warcraftlogs.com/reports/abc",
    };

    it("maps leaderboard + boss data into normalized report", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "Raid",
                            startTime: 100,
                            endTime: 200,
                            fights: [
                                {
                                    id: 1,
                                    name: "Boss",
                                    startTime: 100,
                                    endTime: 150,
                                    kill: true,
                                    encounterID: 1001,
                                },
                            ],
                            masterData: {
                                actors: [
                                    {
                                        id: 1,
                                        name: "Alyra",
                                        subType: "Paladin",
                                    },
                                ],
                            },
                        },
                    },
                },
                reportRankings: JSON.stringify({
                    data: [
                        {
                            playerID: 1,
                            name: "Alyra",
                            bestPerformanceAverage: 95.4,
                        },
                    ],
                }),
                bossRankings: [
                    {
                        fightId: 1,
                        encounterID: 1001,
                        bossName: "Boss",
                        payload: { rankings: [{ playerID: 1, name: "Alyra", bestPercent: 97 }] },
                    },
                ],
                bossTables: [
                    {
                        fightId: 1,
                        encounterID: 1001,
                        bossName: "Boss",
                        tables: {
                            DamageDone: { entries: [{ id: 1, name: "Alyra", total: 123 }] },
                        },
                    },
                ],
                playerDetails: { players: { data: [{ name: "Alyra", spec: "Holy", role: "Healer" }] } },
            },
            parsed,
        );

        expect(normalized.players[0]?.bestParse).toBe(95.4);
        expect(normalized.players[0]?.specName).toBe("Holy");
        expect(normalized.leaderboards?.length).toBeGreaterThan(0);
        expect(normalized.bossPerformances?.[0]?.topDamage?.playerName).toBe("Alyra");
    });

    it("keeps backward compatibility for base payload only", () => {
        const normalized = normalizeReport(
            {
                reportData: {
                    report: {
                        title: "Raid",
                        startTime: 100,
                        endTime: 200,
                        fights: [],
                        masterData: {
                            actors: [{ id: 1, name: "Alyra", subType: "Paladin" }],
                        },
                    },
                },
            },
            parsed,
        );

        expect(normalized.players[0]?.name).toBe("Alyra");
    });

});

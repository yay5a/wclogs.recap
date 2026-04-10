import { beforeAll, describe, expect, it, vi } from "vitest";

describe("index contract", () => {
    vi.mock(
        "@wcl/shared",
        () => ({
            createLogger: () => ({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        }),
    );

    let parseReportUrl: typeof import("./index.js").parseReportUrl;
    let normalizeReport: typeof import("./index.js").normalizeReport;
    let normalizeEnrichedReport: typeof import("./index.js").normalizeEnrichedReport;

    beforeAll(async () => {
        ({ parseReportUrl, normalizeReport, normalizeEnrichedReport } = await import(
            "./index.js"
        ));
    });

    describe("parseReportUrl", () => {
        it("parses report code from path", () => {
            const parsed = parseReportUrl(
                "https://www.warcraftlogs.com/reports/abc123xyz4567890",
            );
            expect(parsed.reportCode).toBe("abc123xyz4567890");
        });

        it("detects retail by default", () => {
            const parsed = parseReportUrl(
                "https://www.warcraftlogs.com/reports/abc123?report=abc123",
            );
            expect(parsed.gameFamily).toBe("retail");
        });

        it("parses a valid URL wrapped in angle brackets", () => {
            const parsed = parseReportUrl(
                "<https://www.warcraftlogs.com/reports/abc123?fight=last>",
            );
            expect(parsed.reportCode).toBe("abc123");
        });

        it("ignores leading and trailing whitespace", () => {
            const parsed = parseReportUrl(
                "   https://www.warcraftlogs.com/reports/abc123?fight=last   ",
            );
            expect(parsed.reportCode).toBe("abc123");
        });

        it("detects mop classic from path", () => {
            const parsed = parseReportUrl(
                "https://classic.warcraftlogs.com/reports/abc123?code=abc123",
            );
            expect(parsed.gameFamily).toBe("mop_classic");
        });

        it("fails with a clear error for invalid URL", () => {
            expect(() => parseReportUrl("not-a-url")).toThrow(
                "Invalid Warcraft Logs report URL",
            );
        });

        it("fails with a clear error when report code is missing", () => {
            expect(() =>
                parseReportUrl("https://www.warcraftlogs.com/reports/?fight=last"),
            ).toThrow("Could not find a Warcraft Logs report code in the URL");
        });

        it("fails with a clear error for empty input", () => {
            expect(() => parseReportUrl("   ")).toThrow("Report URL is empty");
        });
    });

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
});

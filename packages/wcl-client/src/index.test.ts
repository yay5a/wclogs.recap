import { describe, expect, it } from "vitest";
import { normalizeReport, parseReportUrl } from "./index.js";

describe("parseReportUrl", () => {
    it("detects retail by default", () => {
        const parsed = parseReportUrl(
            "https://www.warcraftlogs.com/reports/abc123?report=abc123",
        );
        expect(parsed.gameFamily).toBe("retail");
    });

    it("detects mop classic from path", () => {
        const parsed = parseReportUrl(
            "https://classic.warcraftlogs.com/reports/abc123?code=abc123",
        );
        expect(parsed.gameFamily).toBe("mop_classic");
    });
});
describe("normalizeReport", () => {
    it("maps ranking metrics from rankings payload", () => {
        const normalized = normalizeReport(
            {
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
                            },
                        ],
                        rankings: JSON.stringify({
                            data: [
                                {
                                    name: "Alyra",
                                    bestPerformanceAverage: 95.4,
                                    performanceAverage: 88.2,
                                    execution: 92,
                                },
                            ],
                        }),
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
            {
                reportCode: "abc",
                gameFamily: "retail",
                rawUrl: "https://www.warcraftlogs.com/reports/abc",
            },
        );

        expect(normalized.players[0]?.bestParse).toBe(95.4);
        expect(normalized.players[0]?.avgParse).toBe(88.2);
        expect(normalized.players[0]?.executionScore).toBe(92);
    });

    it("omits unavailable ranking metrics", () => {
        const normalized = normalizeReport(
            {
                reportData: {
                    report: {
                        title: "Raid",
                        startTime: 100,
                        endTime: 200,
                        fights: [],
                        rankings: JSON.stringify({
                            data: [
                                { name: "Alyra", bestPerformanceAverage: 95.4 },
                            ],
                        }),
                        masterData: {
                            actors: [
                                { id: 1, name: "Alyra", subType: "Paladin" },
                            ],
                        },
                    },
                },
            },
            {
                reportCode: "abc",
                gameFamily: "retail",
                rawUrl: "https://www.warcraftlogs.com/reports/abc",
            },
        );

        expect(normalized.players[0]?.bestParse).toBe(95.4);
        expect(normalized.players[0]?.avgParse).toBeUndefined();
        expect(normalized.players[0]?.executionScore).toBeUndefined();
    });
});

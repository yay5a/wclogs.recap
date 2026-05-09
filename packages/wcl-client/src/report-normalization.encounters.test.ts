import { describe, expect, it } from "vitest";
import { normalizeEnrichedReport } from "./normalize-report.js";

describe("normalize report encounters", () => {
    const parsed = {
        reportCode: "abc",
        gameFamily: "retail" as const,
        rawUrl: "https://www.warcraftlogs.com/reports/abc",
    };

    it("normalizes multiple boss performances from multi-encounter summaries", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "Multi boss report",
                            startTime: 100,
                            endTime: 1000,
                            fights: [
                                {
                                    id: 10,
                                    name: "Jin'rokh",
                                    startTime: 100,
                                    endTime: 200,
                                    kill: true,
                                    encounterID: 1001,
                                },
                                {
                                    id: 11,
                                    name: "Horridon",
                                    startTime: 210,
                                    endTime: 340,
                                    kill: true,
                                    encounterID: 1002,
                                },
                            ],
                            masterData: {
                                actors: [{ id: 1, name: "Alyra", subType: "Paladin" }],
                            },
                        },
                    },
                },
                encounterSummaries: [
                    {
                        encounterID: 1001,
                        bossName: "Jin'rokh",
                        fightId: 10,
                        kill: true,
                        rankings: { rankings: [{ playerID: 1, name: "Alyra", bestPercent: 95 }] },
                        tables: {},
                    },
                    {
                        encounterID: 1002,
                        bossName: "Horridon",
                        fightId: 11,
                        kill: true,
                        rankings: { rankings: [{ playerID: 1, name: "Alyra", bestPercent: 90 }] },
                        tables: {},
                    },
                ],
            },
            parsed,
        );

        expect(normalized.bossPerformances?.map((boss) => boss.bossName)).toEqual([
            "Jin'rokh",
            "Horridon",
        ]);
    });

    it("preserves all encounter pulls separately while keeping kill-focused fights stable", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "All pulls",
                            startTime: 100,
                            endTime: 1000,
                            zone: { difficulties: [{ id: 4, name: "Heroic" }] },
                            fights: [
                                {
                                    id: 4,
                                    name: "Horridon",
                                    startTime: 100,
                                    endTime: 200,
                                    kill: false,
                                    encounterID: 51575,
                                    difficulty: 4,
                                },
                                {
                                    id: 5,
                                    name: "Horridon",
                                    startTime: 210,
                                    endTime: 360,
                                    kill: true,
                                    encounterID: 51575,
                                    difficulty: 4,
                                },
                            ],
                            masterData: { actors: [] },
                        },
                    },
                },
                encounterSummaries: [],
            },
            parsed,
        );

        expect(normalized.fights).toEqual([
            { id: 5, name: "Horridon", startTime: 210, endTime: 360, kill: true },
        ]);
        expect(normalized.encounterFights).toEqual([
            expect.objectContaining({
                id: 4,
                name: "Horridon",
                kill: false,
                encounterId: 51575,
                difficultyName: "Heroic",
            }),
            expect.objectContaining({
                id: 5,
                name: "Horridon",
                kill: true,
                encounterId: 51575,
                difficultyName: "Heroic",
            }),
        ]);
    });
});

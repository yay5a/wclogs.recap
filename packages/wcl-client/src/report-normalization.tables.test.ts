import { describe, expect, it } from "vitest";
import { normalizeEnrichedReport } from "./normalize-report.js";

describe("normalize report tables", () => {
    const parsed = {
        reportCode: "abc",
        gameFamily: "retail" as const,
        rawUrl: "https://www.warcraftlogs.com/reports/abc",
    };

    it("exposes all-encounter report tables without changing kill-focused report tables", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "Encounter tables",
                            startTime: 100,
                            endTime: 1000,
                            fights: [
                                {
                                    id: 4,
                                    name: "Horridon",
                                    startTime: 100,
                                    endTime: 200,
                                    kill: false,
                                    encounterID: 51575,
                                },
                                {
                                    id: 5,
                                    name: "Horridon",
                                    startTime: 210,
                                    endTime: 360,
                                    kill: true,
                                    encounterID: 51575,
                                },
                            ],
                            masterData: {
                                actors: [
                                    { id: 1, name: "Alyra", subType: "Priest" },
                                    { id: 2, name: "Bulwark", subType: "Warrior" },
                                ],
                            },
                        },
                    },
                },
                reportTables: {
                    DamageDone: { entries: [{ name: "Alyra", total: 1000 }] },
                    Deaths: { entries: [{ name: "Alyra", deaths: 1 }] },
                },
                reportEncounterTables: {
                    DamageDone: {
                        entries: [
                            { name: "Alyra", total: 2500, activeTime: 5000 },
                            { name: "Bulwark", total: 1000, activeTime: 1000 },
                        ],
                    },
                    DamageTaken: { entries: [{ name: "Bulwark", total: 1400 }] },
                    Deaths: { entries: [{ name: "Alyra", deaths: 4 }] },
                    Interrupts: { entries: [{ name: "Bulwark", interrupts: 3 }] },
                    Dispels: { entries: [{ malformed: true }] },
                },
                encounterSummaries: [],
            },
            parsed,
        );

        expect(normalized.reportWideSummary?.topDamageDone).toEqual([
            { playerName: "Alyra", value: 1000, className: "Priest" },
        ]);
        expect(normalized.reportWideSummary?.totals.deaths).toBe(1);
        expect(normalized.reportWideEncounterSummary?.topDamageDone).toEqual([
            { playerName: "Alyra", value: 2500, activeTimeMs: 5000, className: "Priest" },
            {
                playerName: "Bulwark",
                value: 1000,
                activeTimeMs: 1000,
                className: "Warrior",
            },
        ]);
        expect(normalized.reportWideEncounterSummary?.topDamageTaken).toEqual([
            { playerName: "Bulwark", value: 1400, className: "Warrior" },
        ]);
        expect(normalized.reportWideEncounterSummary?.topDeaths).toEqual([
            { playerName: "Alyra", value: 4, className: "Priest" },
        ]);
        expect(normalized.reportWideEncounterSummary?.topInterrupts).toEqual([
            { playerName: "Bulwark", value: 3, className: "Warrior" },
        ]);
        expect(normalized.reportWideEncounterSummary?.topDispels).toEqual([]);
    });

    it("normalizes report-wide tables from both direct and wrapped entries", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "Report-wide tables",
                            startTime: 100,
                            endTime: 1000,
                            fights: [
                                {
                                    id: 46,
                                    name: "Lei Shen",
                                    startTime: 200,
                                    endTime: 500,
                                    kill: true,
                                    encounterID: 51579,
                                },
                            ],
                            masterData: {
                                actors: [
                                    { id: 1, name: "Dpsy", subType: "Hunter" },
                                    { id: 2, name: "Healz", subType: "Priest" },
                                ],
                            },
                        },
                    },
                },
                reportTables: {
                    DamageDone: {
                        data: { entries: [{ id: 1, name: "Dpsy", total: 500000 }] },
                    },
                    Healing: {
                        data: { entries: [{ id: 2, name: "Healz", total: 400000 }] },
                    },
                    DamageTaken: {
                        data: { entries: [{ id: 1, name: "Dpsy", total: 123456 }] },
                    },
                    Deaths: {
                        data: {
                            entries: [
                                { id: 1, name: "Dpsy", deaths: 2 },
                                { id: 2, name: "Healz", deaths: 1 },
                            ],
                        },
                    },
                    Dispels: {
                        data: {
                            entries: [
                                {
                                    entries: [
                                        { id: 2, name: "Healz", dispels: 5 },
                                        { id: 2, name: "Healz", dispels: 2 },
                                    ],
                                },
                            ],
                        },
                    },
                    Interrupts: {
                        data: {
                            entries: [
                                {
                                    entries: [
                                        { id: 1, name: "Dpsy", interrupts: 4 },
                                        { id: 1, name: "Dpsy", interrupts: 3 },
                                    ],
                                },
                            ],
                        },
                    },
                    Survivability: {
                        data: {
                            players: [{ id: 1, name: "Dpsy" }],
                            fights: [{ id: 46 }],
                            actortotals: [{ id: 1, name: "Dpsy", survivability: 98.6 }],
                        },
                    },
                },
                encounterSummaries: [],
            },
            {
                reportCode: "abc123xyz4567890",
                gameFamily: "retail",
                rawUrl: "https://www.warcraftlogs.com/reports/abc123xyz4567890",
            },
        );

        expect(normalized.reportWideSummary?.topDamageDone[0]?.playerName).toBe("Dpsy");
        expect(normalized.reportWideSummary?.topHealingDone[0]?.playerName).toBe("Healz");
        expect(normalized.reportWideSummary?.topDamageTaken?.[0]?.playerName).toBe("Dpsy");
        expect(normalized.reportWideSummary?.topInterrupts?.[0]?.playerName).toBe("Dpsy");
        expect(normalized.reportWideSummary?.topInterrupts?.[0]?.value).toBe(7);
        expect(normalized.reportWideSummary?.topInterrupts).toHaveLength(1);
        expect(normalized.reportWideSummary?.topDispels?.[0]?.playerName).toBe("Healz");
        expect(normalized.reportWideSummary?.topDispels?.[0]?.value).toBe(7);
        expect(normalized.reportWideSummary?.topDispels).toHaveLength(1);
        expect(normalized.reportWideSummary?.topSurvivability?.[0]?.playerName).toBe("Dpsy");
        expect(normalized.reportWideSummary?.totals.deaths).toBe(3);
        expect(normalized.reportWideSummary?.totals.dispels).toBe(7);
        expect(normalized.reportWideSummary?.totals.interrupts).toBe(7);
    });
});

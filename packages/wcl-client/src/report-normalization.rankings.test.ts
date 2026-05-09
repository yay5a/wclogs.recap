import { describe, expect, it } from "vitest";
import { normalizeEnrichedReport } from "./normalize-report.js";

describe("normalize report rankings", () => {
    const parsed = {
        reportCode: "abc",
        gameFamily: "retail" as const,
        rawUrl: "https://www.warcraftlogs.com/reports/abc",
    };

    it("exposes report-wide DPS/HPS/KRSI combined rankings with rankPercent and fight metadata", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "Report-wide combined rankings",
                            startTime: 100,
                            endTime: 1000,
                            fights: [
                                {
                                    id: 4,
                                    name: "Horridon",
                                    startTime: 100,
                                    endTime: 200,
                                    kill: true,
                                    encounterID: 51575,
                                },
                                {
                                    id: 5,
                                    name: "Megaera",
                                    startTime: 210,
                                    endTime: 300,
                                    kill: false,
                                    encounterID: 51578,
                                },
                            ],
                            masterData: { actors: [] },
                        },
                    },
                },
                reportRankingsDpsCombined: {
                    data: [
                        {
                            fightID: 4,
                            encounter: { name: "Horridon" },
                            roles: {
                                tanks: {
                                    characters: [
                                        {
                                            id: 10,
                                            name: "Tankhem",
                                            class: "DeathKnight",
                                            spec: "Blood",
                                            rankPercent: 95,
                                            amount: 222_222,
                                        },
                                    ],
                                },
                                healers: {
                                    characters: [
                                        {
                                            id: 11,
                                            name: "Gilganne",
                                            class: "Druid",
                                            spec: "Restoration",
                                            rankPercent: 64,
                                            amount: 85_890,
                                        },
                                    ],
                                },
                                dps: {
                                    characters: [
                                        {
                                            id: 1,
                                            name: "Kaltsit",
                                            class: "Shaman",
                                            spec: "Elemental",
                                            rankPercent: 90,
                                            amount: 110_500_000,
                                        },
                                    ],
                                },
                            },
                        },
                        {
                            fightID: 5,
                            encounter: { name: "Megaera" },
                            roles: {
                                tanks: { characters: [] },
                                healers: { characters: [] },
                                dps: {
                                    characters: [
                                        {
                                            id: 3,
                                            name: "WipeOnlyDps",
                                            class: "Warrior",
                                            spec: "Fury",
                                            rankPercent: 99,
                                            amount: 99_999_999,
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
                reportRankingsHpsCombined: {
                    data: [
                        {
                            fightID: 4,
                            encounter: { name: "Horridon" },
                            roles: {
                                tanks: { characters: [] },
                                healers: {
                                    characters: [
                                        {
                                            id: 2,
                                            name: "Bustinsihder",
                                            class: "Monk",
                                            spec: "Mistweaver",
                                            rankPercent: 89,
                                            amount: 30_900_000,
                                        },
                                    ],
                                },
                                dps: {
                                    characters: [
                                        {
                                            id: 12,
                                            name: "ShouldNotAppearAsHps",
                                            class: "Mage",
                                            spec: "Arcane",
                                            rankPercent: 97,
                                            amount: 5_000,
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
                reportRankingsKrsiCombined: {
                    data: [
                        {
                            fightID: 4,
                            encounter: { name: "Horridon" },
                            roles: {
                                tanks: {
                                    characters: [
                                        {
                                            id: 10,
                                            name: "Tankhem",
                                            class: "DeathKnight",
                                            spec: "Blood",
                                            rankPercent: 82,
                                            amount: 222_222,
                                        },
                                    ],
                                },
                                healers: { characters: [] },
                                dps: { characters: [] },
                            },
                        },
                    ],
                },
                encounterSummaries: [],
            },
            parsed,
        );

        expect(normalized.reportWideRankings?.dps[0]).toMatchObject({
            playerName: "Kaltsit",
            rankPercent: 90,
            fightId: 4,
            bossName: "Horridon",
            selectedMetric: "DPS",
        });
        expect(normalized.reportWideRankings?.hps[0]).toMatchObject({
            playerName: "Bustinsihder",
            rankPercent: 89,
            fightId: 4,
            bossName: "Horridon",
            selectedMetric: "HPS",
        });
        expect(normalized.reportWideRankings?.krsi?.[0]).toMatchObject({
            playerName: "Tankhem",
            rankPercent: 82,
            fightId: 4,
            bossName: "Horridon",
            selectedMetric: "DTPS",
        });
        expect(normalized.reportWideRankings?.dps).toHaveLength(1);
        expect(normalized.reportWideRankings?.hps).toHaveLength(1);
        expect(normalized.reportWideRankings?.krsi).toHaveLength(1);
    });

    it("drops report-wide combined ranking rows when no kill fights exist", () => {
        const normalized = normalizeEnrichedReport(
            {
                base: {
                    reportData: {
                        report: {
                            title: "Wipes only",
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
                            ],
                            masterData: { actors: [] },
                        },
                    },
                },
                reportRankingsDpsCombined: {
                    data: [
                        {
                            fightID: 4,
                            encounter: { name: "Horridon" },
                            roles: {
                                tanks: { characters: [] },
                                healers: { characters: [] },
                                dps: {
                                    characters: [
                                        {
                                            id: 1,
                                            name: "WipeDps",
                                            class: "Warrior",
                                            spec: "Fury",
                                            rankPercent: 99,
                                            amount: 999_999,
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
                reportRankingsHpsCombined: {
                    data: [
                        {
                            fightID: 4,
                            encounter: { name: "Horridon" },
                            roles: {
                                tanks: { characters: [] },
                                healers: {
                                    characters: [
                                        {
                                            id: 2,
                                            name: "WipeHealer",
                                            class: "Monk",
                                            spec: "Mistweaver",
                                            rankPercent: 95,
                                            amount: 888_888,
                                        },
                                    ],
                                },
                                dps: { characters: [] },
                            },
                        },
                    ],
                },
                reportRankingsKrsiCombined: {
                    data: [
                        {
                            fightID: 4,
                            encounter: { name: "Horridon" },
                            roles: {
                                tanks: {
                                    characters: [
                                        {
                                            id: 3,
                                            name: "WipeTank",
                                            class: "Warrior",
                                            spec: "Protection",
                                            rankPercent: 90,
                                            amount: 777_777,
                                        },
                                    ],
                                },
                                healers: { characters: [] },
                                dps: { characters: [] },
                            },
                        },
                    ],
                },
                encounterSummaries: [],
            },
            parsed,
        );

        expect(normalized.reportWideRankings?.dps).toEqual([]);
        expect(normalized.reportWideRankings?.hps).toEqual([]);
        expect(normalized.reportWideRankings?.krsi).toEqual([]);
    });
});

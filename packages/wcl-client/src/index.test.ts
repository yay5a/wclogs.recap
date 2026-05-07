import { beforeAll, describe, expect, it, vi } from "vitest";
import { extractComparisonSnapshots } from "@wcl/domain";
import { NORMALIZED_PAYLOAD_VERSION, RAW_PAYLOAD_VERSION } from "./cache-policy.js";

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
    let createWclClient: typeof import("./index.js").createWclClient;
    let WclClient: typeof import("./index.js").WclClient;

    beforeAll(async () => {
        ({
            parseReportUrl,
            normalizeReport,
            normalizeEnrichedReport,
            createWclClient,
            WclClient,
        } = await import("./index.js"));
    });

    it("exports a WclClient factory facade", () => {
        expect(
            createWclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://example.com",
            }),
        ).toBeInstanceOf(WclClient);
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

        it("normalizes probe-backed Warcraft Logs participant identity fields", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Raid",
                                startTime: 100,
                                endTime: 200,
                                fights: [],
                                masterData: {
                                    actors: [
                                        {
                                            id: 1,
                                            name: "Yaysa",
                                            subType: "Rogue",
                                            server: "Stormrage",
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    playerDetails: {
                        dps: [
                            {
                                name: "Yaysa",
                                id: 7,
                                guid: 99060818,
                                type: "Rogue",
                                server: "Stormrage",
                                region: "US",
                            },
                        ],
                    },
                },
                parsed,
            );

            expect(normalized.players[0]).toMatchObject({
                id: "1",
                actorId: 1,
                warcraftLogsActorId: 7,
                warcraftLogsGuid: 99060818,
                name: "Yaysa",
                realm: "Stormrage",
                server: "Stormrage",
                region: "US",
            });
            expect(normalized.players[0]).not.toHaveProperty("playerProfileId");

            const extraction = extractComparisonSnapshots({
                guildId: "guild-1",
                report: normalized,
            });
            expect(extraction.issues).toEqual([]);
            expect(extraction.snapshots[0]?.participantKey).toBe(
                "character:us:stormrage:yaysa",
            );
        });

        it("normalizes probe-style role bucket playerDetails identity fields", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Raid",
                                startTime: 100,
                                endTime: 200,
                                fights: [],
                                masterData: {
                                    actors: [
                                        {
                                            id: 6,
                                            name: "Tankhem",
                                            subType: "DeathKnight",
                                            server: "Galakras",
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    playerDetails: {
                        data: {
                            playerDetails: {
                                tanks: [
                                    {
                                        name: "Tankhem",
                                        id: 6,
                                        guid: 99427887,
                                        type: "DeathKnight",
                                        server: "Galakras",
                                        region: "US",
                                        specs: [{ spec: "Blood", count: 26 }],
                                    },
                                ],
                            },
                        },
                    },
                },
                parsed,
            );

            expect(normalized.players[0]).toMatchObject({
                id: "6",
                actorId: 6,
                warcraftLogsActorId: 6,
                warcraftLogsGuid: 99427887,
                name: "Tankhem",
                realm: "Galakras",
                server: "Galakras",
                region: "US",
                className: "DeathKnight",
                role: "tank",
            });

            const extraction = extractComparisonSnapshots({
                guildId: "guild-1",
                report: normalized,
            });
            expect(extraction.issues).toEqual([]);
            expect(extraction.snapshots[0]?.participantKey).toBe(
                "character:us:galakras:tankhem",
            );
        });

        it("falls back to report guild server region when playerDetails is empty", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Raid",
                                startTime: 100,
                                endTime: 200,
                                guild: {
                                    server: {
                                        name: "Stormrage",
                                        region: { compactName: "US" },
                                    },
                                },
                                fights: [],
                                masterData: {
                                    actors: [
                                        {
                                            id: 1,
                                            name: "Yaysa",
                                            subType: "Rogue",
                                            server: "Stormrage",
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    playerDetails: {
                        players: { data: [] },
                    },
                },
                parsed,
            );

            expect(normalized.players[0]).toMatchObject({
                id: "1",
                actorId: 1,
                name: "Yaysa",
                realm: "Stormrage",
                region: "US",
            });
            expect(normalized.players[0]).not.toHaveProperty("server");
            expect(normalized.players[0]).not.toHaveProperty("warcraftLogsGuid");
            expect(normalized.players[0]).not.toHaveProperty("playerProfileId");

            const extraction = extractComparisonSnapshots({
                guildId: "guild-1",
                report: normalized,
            });
            expect(extraction.issues).toEqual([]);
            expect(extraction.snapshots[0]?.participantKey).toBe(
                "character:us:stormrage:yaysa",
            );
            expect(extraction.snapshots[0]).not.toHaveProperty("playerProfileId");
        });

        it("falls back to rankings guild server region when playerDetails and base guild are empty", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Raid",
                                startTime: 100,
                                endTime: 200,
                                fights: [],
                                masterData: {
                                    actors: [
                                        {
                                            id: 1,
                                            name: "Yaysa",
                                            subType: "Rogue",
                                            server: "Galakras",
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    playerDetails: {
                        data: { playerDetails: [] },
                    },
                    reportRankings: {
                        data: [
                            {
                                guild: {
                                    server: {
                                        name: "Galakras",
                                        region: "US",
                                    },
                                },
                                roles: {
                                    dps: {
                                        characters: [
                                            {
                                                id: 100880586,
                                                name: "Yaysa",
                                                server: {
                                                    name: "Galakras",
                                                    region: "US",
                                                },
                                                class: "Rogue",
                                                spec: "Assassination",
                                                rankPercent: 42,
                                            },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                },
                parsed,
            );

            expect(normalized.players[0]).toMatchObject({
                id: "1",
                actorId: 1,
                name: "Yaysa",
                realm: "Galakras",
                region: "US",
            });

            const extraction = extractComparisonSnapshots({
                guildId: "guild-1",
                report: normalized,
            });
            expect(extraction.issues).toEqual([]);
            expect(extraction.snapshots[0]?.participantKey).toBe(
                "character:us:galakras:yaysa",
            );
        });

        it("prefers playerDetails region over report guild server region", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Raid",
                                startTime: 100,
                                endTime: 200,
                                guild: {
                                    server: {
                                        name: "Silvermoon",
                                        region: { compactName: "EU" },
                                    },
                                },
                                fights: [],
                                masterData: {
                                    actors: [
                                        {
                                            id: 1,
                                            name: "Yaysa",
                                            subType: "Rogue",
                                            server: "Stormrage",
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    playerDetails: {
                        dps: [
                            {
                                name: "Yaysa",
                                id: 7,
                                guid: 99060818,
                                type: "Rogue",
                                server: "Stormrage",
                                region: "US",
                            },
                        ],
                    },
                },
                parsed,
            );

            expect(normalized.players[0]).toMatchObject({
                name: "Yaysa",
                realm: "Stormrage",
                server: "Stormrage",
                region: "US",
                warcraftLogsActorId: 7,
                warcraftLogsGuid: 99060818,
            });

            const extraction = extractComparisonSnapshots({
                guildId: "guild-1",
                report: normalized,
            });
            expect(extraction.issues).toEqual([]);
            expect(extraction.snapshots[0]?.participantKey).toBe(
                "character:us:stormrage:yaysa",
            );
        });

        it("keeps probe-backed Warcraft Logs participant identity fields optional", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Raid",
                                startTime: 100,
                                endTime: 200,
                                fights: [],
                                masterData: {
                                    actors: [
                                        {
                                            id: 1,
                                            name: "Yaysa",
                                            subType: "Rogue",
                                            server: "Stormrage",
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    playerDetails: {
                        players: {
                            data: [{ name: "Yaysa" }],
                        },
                    },
                },
                parsed,
            );

            expect(normalized.players[0]).toMatchObject({
                id: "1",
                actorId: 1,
                name: "Yaysa",
                realm: "Stormrage",
            });
            expect(normalized.players[0]).not.toHaveProperty("warcraftLogsActorId");
            expect(normalized.players[0]).not.toHaveProperty("warcraftLogsGuid");
            expect(normalized.players[0]).not.toHaveProperty("server");
            expect(normalized.players[0]).not.toHaveProperty("region");
            expect(normalized.players[0]).not.toHaveProperty("playerProfileId");

            const extraction = extractComparisonSnapshots({
                guildId: "guild-1",
                report: normalized,
            });
            expect(extraction.snapshots).toEqual([]);
            expect(extraction.issues[0]?.code).toBe("missing-participant-identity");
        });

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

        it("preserves normalized metric identity for healer and tank rows", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Metrics",
                                startTime: 100,
                                endTime: 1000,
                                fights: [],
                                masterData: { actors: [] },
                            },
                        },
                    },
                    reportRankings: {
                        data: [
                            {
                                name: "Emerald",
                                rankPercent: 99,
                                selectedMetric: "hps",
                                role: "Healer",
                            },
                            {
                                name: "Bulwark",
                                rankPercent: 95,
                                playerMetric: "dtps",
                                role: "Tank",
                            },
                        ],
                    },
                    encounterSummaries: [],
                },
                parsed,
            );

            const emerald = normalized.leaderboards?.find(
                (entry) => entry.playerName === "Emerald",
            );
            const bulwark = normalized.leaderboards?.find(
                (entry) => entry.playerName === "Bulwark",
            );

            expect(emerald?.selectedMetric).toBe("HPS");
            expect(bulwark?.selectedMetric).toBe("DTPS");
        });

        it("exposes report-wide DPS/HPS combined rankings with rankPercent and fight metadata", () => {
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
            expect(normalized.reportWideRankings?.dps).toHaveLength(1);
            expect(normalized.reportWideRankings?.hps).toHaveLength(1);
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
                    encounterSummaries: [],
                },
                parsed,
            );

            expect(normalized.reportWideRankings?.dps).toEqual([]);
            expect(normalized.reportWideRankings?.hps).toEqual([]);
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

        it("exposes all-encounter report tables without changing kill-focused recap tables", () => {
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
                        DamageDone: { entries: [{ name: "Alyra", total: 2500 }] },
                        DamageTaken: { entries: [{ name: "Bulwark", total: 1400 }] },
                        Deaths: { entries: [{ name: "Alyra", deaths: 4 }] },
                        Interrupts: { entries: [{ name: "Bulwark", interrupts: 3 }] },
                        Dispels: { entries: [{ malformed: true }] },
                    },
                    encounterSummaries: [],
                },
                parsed,
            );

            expect(normalized.reportWideRecap?.topDamageDone).toEqual([
                { playerName: "Alyra", value: 1000, className: "Priest" },
            ]);
            expect(normalized.reportWideRecap?.totals.deaths).toBe(1);
            expect(normalized.reportWideEncounterRecap?.topDamageDone).toEqual([
                { playerName: "Alyra", value: 2500, className: "Priest" },
            ]);
            expect(normalized.reportWideEncounterRecap?.topDamageTaken).toEqual([
                { playerName: "Bulwark", value: 1400, className: "Warrior" },
            ]);
            expect(normalized.reportWideEncounterRecap?.topDeaths).toEqual([
                { playerName: "Alyra", value: 4, className: "Priest" },
            ]);
            expect(normalized.reportWideEncounterRecap?.topInterrupts).toEqual([
                { playerName: "Bulwark", value: 3, className: "Warrior" },
            ]);
            expect(normalized.reportWideEncounterRecap?.topDispels).toEqual([]);
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

            expect(normalized.reportWideRecap?.topDamageDone[0]?.playerName).toBe("Dpsy");
            expect(normalized.reportWideRecap?.topHealingDone[0]?.playerName).toBe("Healz");
            expect(normalized.reportWideRecap?.topDamageTaken?.[0]?.playerName).toBe("Dpsy");
            expect(normalized.reportWideRecap?.topInterrupts?.[0]?.playerName).toBe("Dpsy");
            expect(normalized.reportWideRecap?.topInterrupts?.[0]?.value).toBe(7);
            expect(normalized.reportWideRecap?.topInterrupts).toHaveLength(1);
            expect(normalized.reportWideRecap?.topDispels?.[0]?.playerName).toBe("Healz");
            expect(normalized.reportWideRecap?.topDispels?.[0]?.value).toBe(7);
            expect(normalized.reportWideRecap?.topDispels).toHaveLength(1);
            expect(normalized.reportWideRecap?.topSurvivability?.[0]?.playerName).toBe("Dpsy");
            expect(normalized.reportWideRecap?.totals.deaths).toBe(3);
            expect(normalized.reportWideRecap?.totals.dispels).toBe(7);
            expect(normalized.reportWideRecap?.totals.interrupts).toBe(7);
        });
    });

    describe("fetch cache behavior", () => {
        it("re-normalizes cached raw payload when normalized payload version is stale", async () => {
            const cachedBase = {
                reportData: {
                    report: {
                        title: "Cache Fresh Title",
                        startTime: 1,
                        endTime: 2,
                        zone: { frozen: true },
                        fights: [],
                        masterData: { actors: [] },
                    },
                },
            };
            const store = {
                getByReportCode: vi.fn().mockResolvedValue({
                    reportCode: "abc123xyz4567890",
                    sourceUrl: "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                    gameFamily: "retail",
                    rawPayload: {
                        rawPayloadVersion: RAW_PAYLOAD_VERSION,
                        base: cachedBase,
                        encounterSummaries: [],
                    },
                    normalizedPayload: {
                        reportCode: "abc123xyz4567890",
                        title: "Stale Title",
                        startTime: 1,
                        endTime: 2,
                        gameFamily: "retail",
                        fights: [],
                        players: [],
                        leaderboards: [],
                        bossPerformances: [],
                    },
                    normalizedPayloadVersion: 1,
                    fetchedAt: new Date(),
                }),
                upsert: vi.fn().mockResolvedValue(undefined),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://example.com",
                reportCacheStore: store,
            });

            const normalized = await client.fetchAndNormalizeReport(
                "https://www.warcraftlogs.com/reports/abc123xyz4567890",
            );

            expect(normalized.title).toBe("Cache Fresh Title");
            expect(store.upsert).toHaveBeenCalledTimes(1);
            const upsertArgs = store.upsert.mock.calls[0]?.[0] as
                | { normalizedPayloadVersion?: number }
                | undefined;
            expect(upsertArgs?.normalizedPayloadVersion).toBe(NORMALIZED_PAYLOAD_VERSION);
        });

        it("refetches old raw cache payloads without the current enrichment version", async () => {
            const previousFixtureSetting = process.env.WCL_USE_FIXTURES;
            process.env.WCL_USE_FIXTURES = "true";
            const store = {
                getByReportCode: vi.fn().mockResolvedValue({
                    reportCode: "abc123xyz4567890",
                    sourceUrl: "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                    gameFamily: "retail",
                    rawPayload: { base: { reportData: { report: { title: "Old Raw" } } } },
                    normalizedPayload: {
                        reportCode: "abc123xyz4567890",
                        title: "Old Normalized",
                        startTime: 1,
                        endTime: 2,
                        gameFamily: "retail",
                        fights: [],
                        players: [],
                        leaderboards: [],
                        bossPerformances: [],
                    },
                    normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION - 1,
                    fetchedAt: new Date(),
                }),
                upsert: vi.fn().mockResolvedValue(undefined),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://example.com",
                reportCacheStore: store,
            });

            try {
                await client.fetchAndNormalizeReport(
                    "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                );
            } finally {
                if (previousFixtureSetting === undefined) {
                    delete process.env.WCL_USE_FIXTURES;
                } else {
                    process.env.WCL_USE_FIXTURES = previousFixtureSetting;
                }
            }

            expect(store.upsert).toHaveBeenCalledTimes(1);
            const upsertArgs = store.upsert.mock.calls[0]?.[0] as
                | { rawPayload?: { rawPayloadVersion?: number } }
                | undefined;
            expect(upsertArgs?.rawPayload?.rawPayloadVersion).toBe(RAW_PAYLOAD_VERSION);
        });
    });
});

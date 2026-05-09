import { describe, expect, it } from "vitest";
import { extractComparisonSnapshots } from "@wcl/domain";
import { normalizeEnrichedReport } from "./normalize-report.js";

describe("normalize report identity", () => {
    const parsed = {
        reportCode: "abc",
        gameFamily: "retail" as const,
        rawUrl: "https://www.warcraftlogs.com/reports/abc",
    };

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
});

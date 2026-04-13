import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loadPublicProbeFixture = (name: string): unknown =>
    JSON.parse(
        readFileSync(
            join(
                process.cwd(),
                "src",
                "fixtures",
                "probes",
                `${name}.v4apgdkyWQmrZ3q8.fight-46.json`,
            ),
            "utf8",
        ),
    ) as unknown;

const loadEncounterProbeFixture = (name: string): unknown =>
    JSON.parse(
        readFileSync(
            join(
                process.cwd(),
                "src",
                "fixtures",
                "probes",
                `${name}.v4apgdkyWQmrZ3q8.encounter-51579.json`,
            ),
            "utf8",
        ),
    ) as unknown;

const loadBaseReportFixture = (): unknown =>
    JSON.parse(
        readFileSync(
            join(
                process.cwd(),
                "src",
                "fixtures",
                "probes",
                "base-report.v4apgdkyWQmrZ3q8.json",
            ),
            "utf8",
        ),
    ) as unknown;

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
    let WclClient: typeof import("./index.js").WclClient;

    beforeAll(async () => {
        ({ parseReportUrl, normalizeReport, normalizeEnrichedReport, WclClient } = await import(
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

        it("normalizes selected Lei Shen fight from public probe fixtures", () => {
            const base = loadBaseReportFixture();
            const deaths = loadPublicProbeFixture("deaths");
            const dispels = loadPublicProbeFixture("dispels");
            const interrupts = loadPublicProbeFixture("interrupts");
            const damageTaken = loadPublicProbeFixture("damage-taken");
            const healing = loadPublicProbeFixture("healing");
            const survivability = loadPublicProbeFixture("survivability");
            const bossRankings = loadPublicProbeFixture("boss-rankings");
            const encounterPhaseTimes = loadEncounterProbeFixture("encounter-phase-times");

            const resurrectEvents = loadPublicProbeFixture("resurrect-events") as {
                pages?: Array<{ data?: unknown }>;
            };
            const resurrectCount = (resurrectEvents.pages ?? []).reduce(
                (total, page) => {
                    const events = Array.isArray(page.data) ? page.data : [];
                    return total + events.length;
                },
                0,
            );

            const normalized = normalizeEnrichedReport(
                {
                    base: { reportData: { report: base } },
                    encounterPhaseTimes: [encounterPhaseTimes],
                    encounterSummaries: [
                        {
                            encounterID: 51579,
                            bossName: "Lei Shen",
                            fightId: 46,
                            kill: true,
                            difficulty: 3,
                            resurrects: resurrectCount,
                            rankings: bossRankings,
                            tables: {
                                DamageTaken: damageTaken,
                                Healing: healing,
                                Deaths: deaths,
                                Dispels: dispels,
                                Interrupts: interrupts,
                                Survivability: survivability,
                            },
                        },
                    ],
                },
                {
                    reportCode: "v4apgdkyWQmrZ3q8",
                    gameFamily: "mop_classic",
                    rawUrl: "https://classic.warcraftlogs.com/reports/v4apgdkyWQmrZ3q8",
                },
            );

            const recap = normalized.bossPerformances?.[0];
            expect(recap?.bossName).toBe("Lei Shen");
            expect(recap?.pullCount).toBe(1);
            expect(recap?.fightDurationMs).toBe(440287);
            expect(recap?.deaths).toBe(4);
            expect(recap?.dispels).toBe(1);
            expect(recap?.kicks).toBe(3);
            expect(recap?.battleRezzes).toBe(1);
            expect(recap?.fastestPhaseTimes?.map((phase) => phase.label)).toEqual([
                "P1",
                "P3",
                "P5",
            ]);
            expect(
                recap?.bestParses?.map((entry) => ({
                    player: entry.playerName,
                    parse: entry.parse,
                    amount: Math.round(entry.amount ?? 0),
                    className: entry.className,
                    specName: entry.specName,
                })),
            ).toEqual([
                {
                    player: "Raikami",
                    parse: 99,
                    amount: 169858,
                    className: "Hunter",
                    specName: "Survival",
                },
                {
                    player: "Arakinak",
                    parse: 79,
                    amount: 94429,
                    className: "Druid",
                    specName: "Guardian",
                },
                {
                    player: "Floorroller",
                    parse: 43,
                    amount: 48423,
                    className: "Monk",
                    specName: "Mistweaver",
                },
            ]);
            expect(recap?.topHealers?.map((entry) => entry.playerName)).toEqual([
                "Floorroller",
                "Pearl",
            ]);
            expect(recap?.topHealers?.some((entry) => entry.playerName === "Arakinak")).toBe(
                false,
            );
        });

        it("sources top healers from boss rankings healer-role rows, not healing totals", () => {
            const normalized = normalizeEnrichedReport(
                {
                    base: {
                        reportData: {
                            report: {
                                title: "Top Healer Source",
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
                                        { id: 1, name: "TankOffheal", subType: "Druid" },
                                        { id: 2, name: "Floorroller", subType: "Monk" },
                                        { id: 3, name: "Pearl", subType: "Priest" },
                                    ],
                                },
                            },
                        },
                    },
                    encounterSummaries: [
                        {
                            encounterID: 51579,
                            bossName: "Lei Shen",
                            fightId: 46,
                            kill: true,
                            rankings: {
                                rankings: [
                                    {
                                        playerID: 1,
                                        name: "TankOffheal",
                                        amount: 999999,
                                        rankPercent: 98,
                                        role: "Tank",
                                        className: "Druid",
                                        spec: "Guardian",
                                    },
                                    {
                                        playerID: 2,
                                        name: "Floorroller",
                                        amount: 50000,
                                        rankPercent: 80,
                                        role: "Healer",
                                        className: "Monk",
                                        spec: "Mistweaver",
                                    },
                                    {
                                        playerID: 3,
                                        name: "Pearl",
                                        amount: 40000,
                                        rankPercent: 75,
                                        role: "Healer",
                                        className: "Priest",
                                        spec: "Holy",
                                    },
                                ],
                            },
                            tables: {
                                Healing: {
                                    data: {
                                        entries: [
                                            { id: 1, name: "TankOffheal", total: 999999 },
                                            { id: 2, name: "Floorroller", total: 50000 },
                                            { id: 3, name: "Pearl", total: 40000 },
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
                {
                    reportCode: "abc123xyz4567890",
                    gameFamily: "mop_classic",
                    rawUrl: "https://classic.warcraftlogs.com/reports/abc123xyz4567890",
                },
            );

            expect(
                normalized.bossPerformances?.[0]?.topHealers?.map((entry) => entry.playerName),
            ).toEqual(["Floorroller", "Pearl"]);
            expect(
                normalized.bossPerformances?.[0]?.topHealers?.map((entry) => entry.specName),
            ).toEqual(["Mistweaver", "Holy"]);
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
                    rawPayload: { base: cachedBase, encounterSummaries: [] },
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
            expect(upsertArgs?.normalizedPayloadVersion).toBe(2);
        });
    });
});

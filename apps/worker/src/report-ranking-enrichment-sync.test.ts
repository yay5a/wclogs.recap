import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncReportRankingEnrichment } from "./report-ranking-enrichment-sync.js";

const scope = {
    guildName: "Shenanigans",
    guildServerSlug: "Galakras",
    guildServerRegion: "US",
    gameFamily: "mop_classic" as const,
};

const makeWclClient = () => ({
    fetchReportIndex: vi.fn().mockResolvedValue({
        reportCode: "ABC123",
        sourceUrl: "https://classic.warcraftlogs.com/reports/ABC123",
        gameFamily: "mop_classic",
        title: "Raid Night",
        startTime: 1_700_000_000_000,
        endTime: 1_700_003_600_000,
        completedBossFights: [
            {
                id: 11,
                encounterId: 101,
                name: "Boss",
                startTime: 1_700_000_000_000,
                endTime: 1_700_000_300_000,
                kill: true,
                difficulty: 5,
                size: 25,
            },
        ],
        killBossFights: [],
        allBossFights: [],
        zoneDifficulties: [],
    }),
    fetchReportRankingEnrichment: vi.fn().mockResolvedValue({
        rawPayloads: [
            {
                reportCode: "ABC123",
                fetchedAt: new Date("2026-05-15T12:00:00.000Z"),
                queryVarsHash: "hash",
                payloadJson: { data: [] },
                timeframe: "today",
                compareMode: "rankings",
            },
        ],
        facts: [
            {
                reportCode: "ABC123",
                reportStartTime: 1_700_000_000_000,
                fightId: 11,
                encounterId: 101,
                difficulty: 5,
                size: 25,
                timeframe: "today",
                compareMode: "rankings",
                speedPercentile: 91.2,
                executionPercentile: 82.4,
                kill: true,
                sourceFetchedAt: new Date("2026-05-15T12:00:00.000Z"),
            },
        ],
        contexts: [{ timeframe: "today", compareMode: "rankings" }],
    }),
});

const makeStore = () => ({
    getRawStates: vi.fn().mockResolvedValue([]),
    saveRawPayloads: vi.fn().mockResolvedValue({
        processedRows: 1,
        insertedRows: 1,
    }),
    replaceFactsForReport: vi.fn().mockResolvedValue({
        deletedRows: 0,
        insertedRows: 1,
    }),
    recomputeWeeklyTrends: vi.fn().mockResolvedValue({
        factRowsRead: 1,
        trendRowsWritten: 1,
        trendRowsDeleted: 0,
    }),
});

describe("syncReportRankingEnrichment", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("enriches reports without fresh raw payloads and recomputes touched trends", async () => {
        const wclClient = makeWclClient();
        const store = makeStore();
        const logger = { info: vi.fn() };

        const result = await syncReportRankingEnrichment({
            wclClient,
            store,
            scope,
            reports: [{ reportCode: "ABC123", startTime: 1_700_000_000_000 }],
            timeframes: ["today"],
            compareModes: ["rankings"],
            logger,
        });

        expect(store.getRawStates).toHaveBeenCalledWith(["ABC123"]);
        expect(wclClient.fetchReportIndex).toHaveBeenCalledWith({
            reportCode: "ABC123",
            sourceUrl: "https://classic.warcraftlogs.com/reports/ABC123",
            gameFamily: "mop_classic",
        });
        expect(wclClient.fetchReportRankingEnrichment).toHaveBeenCalledWith({
            reportCode: "ABC123",
            gameFamily: "mop_classic",
            reportStartTime: 1_700_000_000_000,
            fights: [
                {
                    fightId: 11,
                    encounterId: 101,
                    difficulty: 5,
                    size: 25,
                    kill: true,
                },
            ],
            timeframes: ["today"],
            compareModes: ["rankings"],
        });
        expect(store.replaceFactsForReport).toHaveBeenCalledWith({
            reportCode: "ABC123",
            facts: [
                expect.objectContaining({
                    ...scope,
                    reportCode: "ABC123",
                    fightId: 11,
                    speedPercentile: 91.2,
                    executionPercentile: 82.4,
                }),
            ],
            contexts: [{ timeframe: "today", compareMode: "rankings" }],
        });
        expect(store.recomputeWeeklyTrends).toHaveBeenCalledWith({
            scope,
            encounterIds: [101],
            weekStarts: [new Date("2023-11-14T00:00:00.000Z")],
        });
        expect(result).toEqual({
            candidateReports: 1,
            skippedFreshReports: 0,
            processedReports: 1,
            failedReports: 0,
            rawPayloadsWritten: 1,
            factsInserted: 1,
            factsDeleted: 0,
            trendRowsWritten: 1,
            trendRowsDeleted: 0,
        });
        expect(logger.info).toHaveBeenCalledWith(
            expect.objectContaining({ processedReports: 1 }),
            "report_ranking_enrichment_sync",
        );
    });

    it("skips reports with complete fresh raw payload coverage", async () => {
        const wclClient = makeWclClient();
        const store = makeStore();
        store.getRawStates.mockResolvedValue([
            {
                reportCode: "ABC123",
                latestFetchedAt: new Date("2026-05-15T12:00:00.000Z"),
                payloadCount: 2,
            },
        ]);
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-15T13:00:00.000Z"));

        const result = await syncReportRankingEnrichment({
            wclClient,
            store,
            scope,
            reports: [{ reportCode: "ABC123", startTime: 1_700_000_000_000 }],
            timeframes: ["today", "historical"],
            compareModes: ["rankings"],
            staleAfterMs: 6 * 60 * 60 * 1000,
        });

        expect(wclClient.fetchReportIndex).not.toHaveBeenCalled();
        expect(store.recomputeWeeklyTrends).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            candidateReports: 0,
            skippedFreshReports: 1,
            processedReports: 0,
        });
    });
});

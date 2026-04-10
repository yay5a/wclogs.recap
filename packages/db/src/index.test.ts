import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecapSummary } from "@wcl/domain";
import {
    GuildSettingsModel,
    MongoGuildConfigStore,
    MongoRecapPreviewStateStore,
    RecapPreviewStateModel,
    MongoTrendTrackingService,
    PlayerRaidSummaryModel,
    TrendSnapshotModel,
} from "./index.js";

const makeRecapSummary = (): RecapSummary => ({
    reportTitle: "Raid Night",
    reportDateISO: new Date(0).toISOString(),
    gameFamily: "retail",
    bossesKilled: 1,
    compareModeUsed: "mixed",
    accountabilityVisibility: "officers-only",
    coachingShareability: "shareable",
    recapPostMode: "preview-and-post",
    topOverallParsers: [],
    bossHighlights: [],
    raidSuperlatives: [],
    teamNote: "Team note",
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("MongoGuildConfigStore", () => {
    it("returns defaults when config does not exist", async () => {
        vi.spyOn(GuildSettingsModel, "findOne").mockReturnValue({
            lean: vi.fn().mockResolvedValue(null),
        } as never);

        const store = new MongoGuildConfigStore();
        const config = await store.getGuildConfig("guild-1");

        expect(config.guildId).toBe("guild-1");
        expect(config.compareModeDefault).toBe("character");
        expect(config.accountabilityVisibility).toBe("off");
    });

    it("persists configured values via upsert", async () => {
        const lean = vi.fn().mockResolvedValue({
            guildId: "guild-1",
            defaultGameFamily: "mop_classic",
            compareModeDefault: "mixed",
            accountabilityVisibility: "shareable",
            coachingShareabilityDefault: "shareable",
            recapPostModeDefault: "preview-only",
        });
        vi.spyOn(GuildSettingsModel, "findOneAndUpdate").mockReturnValue({
            lean,
        } as never);

        const store = new MongoGuildConfigStore();
        const saved = await store.saveGuildConfig("guild-1", {
            defaultGameFamily: "mop_classic",
            compareModeDefault: "mixed",
            accountabilityVisibility: "shareable",
            coachingShareabilityDefault: "shareable",
            recapPostModeDefault: "preview-only",
        });

        expect(saved.defaultGameFamily).toBe("mop_classic");
        expect(saved.compareModeDefault).toBe("mixed");
        expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledOnce();
    });
});

describe("MongoRecapPreviewStateStore", () => {
    it("persists and retrieves valid preview state", async () => {
        const now = new Date("2026-04-09T00:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const savedState = {
            guildId: "guild-1",
            channelId: "channel-1",
            reportCode: "ABC123",
            sourceUrl: "https://www.warcraftlogs.com/reports/ABC123",
            summaryPayload: makeRecapSummary(),
            createdByUserId: "user-1",
            createdAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
        };

        const updateLean = vi.fn().mockResolvedValue(savedState);
        vi.spyOn(RecapPreviewStateModel, "findOneAndUpdate").mockReturnValue({
            lean: updateLean,
        } as never);
        const findLean = vi.fn().mockResolvedValue(savedState);
        vi.spyOn(RecapPreviewStateModel, "findOne").mockReturnValue({
            lean: findLean,
        } as never);

        const store = new MongoRecapPreviewStateStore();
        await store.savePreviewState(savedState);
        await store.getValidPreviewState({
            reportCode: "ABC123",
            guildId: "guild-1",
        });

        expect(RecapPreviewStateModel.findOne).toHaveBeenCalledWith({
            reportCode: "ABC123",
            guildId: "guild-1",
            expiresAt: { $gt: now },
        });
    });

    it("returns null when preview state is missing or expired", async () => {
        const findLean = vi.fn().mockResolvedValue(null);
        vi.spyOn(RecapPreviewStateModel, "findOne").mockReturnValue({
            lean: findLean,
        } as never);

        const store = new MongoRecapPreviewStateStore();
        const result = await store.getValidPreviewState({
            reportCode: "ABC123",
            guildId: "guild-1",
        });

        expect(result).toBeNull();
    });

    it("deletes preview state by lookup key", async () => {
        const deleteSpy = vi
            .spyOn(RecapPreviewStateModel, "deleteOne")
            .mockResolvedValue({
                acknowledged: true,
                deletedCount: 1,
            } as never);

        const store = new MongoRecapPreviewStateStore();
        await store.deletePreviewState({
            reportCode: "ABC123",
            guildId: "guild-1",
        });

        expect(deleteSpy).toHaveBeenCalledWith({
            reportCode: "ABC123",
            guildId: "guild-1",
        });
    });

    it("consumes preview state atomically for valid entries", async () => {
        const now = new Date("2026-04-09T00:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const savedState = {
            guildId: "guild-1",
            channelId: "channel-1",
            reportCode: "ABC123",
            sourceUrl: "https://www.warcraftlogs.com/reports/ABC123",
            summaryPayload: makeRecapSummary(),
            createdByUserId: "user-1",
            createdAt: now,
            expiresAt: new Date(now.getTime() + 60_000),
        };
        const consumeLean = vi.fn().mockResolvedValue(savedState);
        const consumeSpy = vi
            .spyOn(RecapPreviewStateModel, "findOneAndDelete")
            .mockReturnValue({
                lean: consumeLean,
            } as never);

        const store = new MongoRecapPreviewStateStore();
        await store.consumeValidPreviewState({
            reportCode: "ABC123",
            guildId: "guild-1",
        });

        expect(consumeSpy).toHaveBeenCalledWith({
            reportCode: "ABC123",
            guildId: "guild-1",
            expiresAt: { $gt: now },
        });
    });
});
describe("MongoTrendTrackingService", () => {
    it("upserts deterministically across reruns", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-09T00:00:00.000Z"));

        const summaries = [
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 40,
                executionScore: 50,
                capturedAt: new Date("2026-04-01T00:00:00.000Z"),
                reportCode: "r1",
            },
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 60,
                executionScore: 70,
                capturedAt: new Date("2026-04-02T00:00:00.000Z"),
                reportCode: "r2",
            },
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 80,
                executionScore: 90,
                capturedAt: new Date("2026-04-03T00:00:00.000Z"),
                reportCode: "r3",
            },
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 75,
                executionScore: 95,
                capturedAt: new Date("2026-04-04T00:00:00.000Z"),
                reportCode: "r4",
            },
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 55,
                executionScore: 65,
                capturedAt: new Date("2026-04-05T00:00:00.000Z"),
                reportCode: "r5",
            },
        ];

        vi.spyOn(PlayerRaidSummaryModel, "find").mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(summaries),
            }),
        } as never);
        const bulkWrite = vi
            .spyOn(TrendSnapshotModel, "bulkWrite")
            .mockResolvedValue({} as never);

        const service = new MongoTrendTrackingService();
        await service.recomputeTrendsForGuild("guild-1");
        await service.recomputeTrendsForGuild("guild-1");

        expect(bulkWrite).toHaveBeenCalledTimes(2);

        const firstOps = bulkWrite.mock.calls[0]?.[0];
        const secondOps = bulkWrite.mock.calls[1]?.[0];

        expect(firstOps).toBeDefined();
        expect(secondOps).toBeDefined();
        expect(firstOps!).toEqual(secondOps!);
    });

    it("skips windows that do not have enough history", async () => {
        const summaries = [
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 40,
                executionScore: 50,
                capturedAt: new Date("2026-04-01T00:00:00.000Z"),
                reportCode: "r1",
            },
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 60,
                executionScore: 70,
                capturedAt: new Date("2026-04-02T00:00:00.000Z"),
                reportCode: "r2",
            },
            {
                guildId: "guild-1",
                characterName: "Alyra",
                averageParse: 80,
                executionScore: 90,
                capturedAt: new Date("2026-04-03T00:00:00.000Z"),
                reportCode: "r3",
            },
        ];

        vi.spyOn(PlayerRaidSummaryModel, "find").mockReturnValue({
            sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(summaries),
            }),
        } as never);
        const bulkWrite = vi
            .spyOn(TrendSnapshotModel, "bulkWrite")
            .mockResolvedValue({} as never);

        const service = new MongoTrendTrackingService();
        await service.recomputeTrendsForGuild("guild-1");

        expect(bulkWrite).toHaveBeenCalledOnce();

        const rawOperations = bulkWrite.mock.calls[0]?.[0] ?? [];

        expect(rawOperations).toHaveLength(3);

        const filters = rawOperations.map((op) => {
            if (!("updateOne" in op)) {
                throw new Error("Expected updateOne bulk operation");
            }

            const filter = op.updateOne.filter as {
                metric?: string;
                window?: string;
            };

            if (
                typeof filter.metric !== "string" ||
                typeof filter.window !== "string"
            ) {
                throw new Error("Expected metric/window filter values");
            }

            return filter as {
                metric: string;
                window: string;
            };
        });

        expect(
            filters.every((filter) => filter.window === "last_3_raids"),
        ).toBe(true);
        expect(filters.map((filter) => filter.metric).sort()).toEqual([
            "attendance_count",
            "execution_average",
            "parse_average",
        ]);
    });
});

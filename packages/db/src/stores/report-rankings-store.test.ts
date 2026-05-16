import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GuildEncounterTrendWeeklyModel,
  ReportRankingsFactModel,
  ReportRankingsRawModel,
} from '../models/report-rankings-model.js';
import {
  migrateReportRankingsPartitionIndexes,
  MongoReportRankingsStore,
} from './report-rankings-store.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const scope = {
  guildName: 'Shenanigans',
  guildServerSlug: 'Galakras',
  guildServerRegion: 'US',
  gameFamily: 'mop_classic' as const,
};

describe('MongoReportRankingsStore', () => {
  it('reads weekly trend rows for a normalized guild scope', async () => {
    const lean = vi.fn().mockResolvedValue([
      {
        ...scope,
        guildName: 'shenanigans',
        guildServerSlug: 'galakras',
        guildServerRegion: 'us',
        encounterId: 101,
        difficulty: 5,
        size: 25,
        weekStart: new Date('2023-11-21T00:00:00.000Z'),
        timeframe: 'today',
        compareMode: 'rankings',
        sampleCount: 2,
        speedMedian: 95,
        speedP90: 100,
        speedMedianDelta: 15,
        executionMedian: 55,
        executionP90: 60,
        executionMedianDelta: -15,
      },
    ]);
    const sort = vi.fn().mockReturnValue({ lean });
    const find = vi.spyOn(GuildEncounterTrendWeeklyModel, 'find').mockReturnValue({ sort } as never);
    const store = new MongoReportRankingsStore();

    await expect(store.listWeeklyTrends({ scope })).resolves.toEqual([
      {
        encounterId: 101,
        difficulty: 5,
        size: 25,
        weekStart: new Date('2023-11-21T00:00:00.000Z'),
        timeframe: 'today',
        compareMode: 'rankings',
        sampleCount: 2,
        speedMedian: 95,
        speedP90: 100,
        speedMedianDelta: 15,
        executionMedian: 55,
        executionP90: 60,
        executionMedianDelta: -15,
      },
    ]);

    expect(find).toHaveBeenCalledWith({
      guildName: 'shenanigans',
      guildServerSlug: 'galakras',
      guildServerRegion: 'us',
      gameFamily: 'mop_classic',
    });
    expect(sort).toHaveBeenCalledWith({
      encounterId: 1,
      difficulty: 1,
      size: 1,
      partition: 1,
      weekStart: 1,
      timeframe: 1,
      compareMode: 1,
    });
  });

  it('migrates legacy ranking indexes to include partition', async () => {
    vi.spyOn(ReportRankingsFactModel.collection, 'indexes').mockResolvedValue([
      {
        name: 'reportCode_1_fightId_1_timeframe_1_compareMode_1',
        unique: true,
        key: { reportCode: 1, fightId: 1, timeframe: 1, compareMode: 1 },
      },
    ] as never);
    vi.spyOn(GuildEncounterTrendWeeklyModel.collection, 'indexes').mockResolvedValue([
      {
        name: 'legacy_trend_unique',
        unique: true,
        key: {
          guildName: 1,
          guildServerSlug: 1,
          guildServerRegion: 1,
          gameFamily: 1,
          encounterId: 1,
          difficulty: 1,
          size: 1,
          weekStart: 1,
          timeframe: 1,
          compareMode: 1,
        },
      },
    ] as never);
    const dropFactIndex = vi
      .spyOn(ReportRankingsFactModel.collection, 'dropIndex')
      .mockResolvedValue('dropped' as never);
    const dropTrendIndex = vi
      .spyOn(GuildEncounterTrendWeeklyModel.collection, 'dropIndex')
      .mockResolvedValue('dropped' as never);
    const createFactIndex = vi
      .spyOn(ReportRankingsFactModel.collection, 'createIndex')
      .mockResolvedValue('created' as never);
    const createTrendIndex = vi
      .spyOn(GuildEncounterTrendWeeklyModel.collection, 'createIndex')
      .mockResolvedValue('created' as never);

    await expect(migrateReportRankingsPartitionIndexes()).resolves.toEqual({
      droppedLegacyIndexNames: [
        'reportCode_1_fightId_1_timeframe_1_compareMode_1',
        'legacy_trend_unique',
      ],
    });

    expect(dropFactIndex).toHaveBeenCalledWith(
      'reportCode_1_fightId_1_timeframe_1_compareMode_1',
    );
    expect(dropTrendIndex).toHaveBeenCalledWith('legacy_trend_unique');
    expect(createFactIndex).toHaveBeenCalledWith(
      { reportCode: 1, fightId: 1, partition: 1, timeframe: 1, compareMode: 1 },
      { unique: true },
    );
    expect(createTrendIndex).toHaveBeenCalledWith(
      {
        guildName: 1,
        guildServerSlug: 1,
        guildServerRegion: 1,
        gameFamily: 1,
        encounterId: 1,
        difficulty: 1,
        size: 1,
        partition: 1,
        weekStart: 1,
        timeframe: 1,
        compareMode: 1,
      },
      { unique: true },
    );
  });

  it('counts distinct raw query hashes when checking report coverage', async () => {
    const aggregate = vi.spyOn(ReportRankingsRawModel, 'aggregate').mockResolvedValue([
      {
        _id: 'ABC123',
        payloads: [
          {
            queryVarsHash: 'hash-a',
            latestFetchedAt: new Date('2026-05-15T12:00:00.000Z'),
          },
          {
            queryVarsHash: 'hash-b',
            latestFetchedAt: new Date('2026-05-15T12:05:00.000Z'),
          },
        ],
      },
    ] as never);
    const store = new MongoReportRankingsStore();

    await expect(store.getRawStates(['ABC123'])).resolves.toEqual([
      {
        reportCode: 'ABC123',
        payloads: [
          {
            queryVarsHash: 'hash-a',
            latestFetchedAt: new Date('2026-05-15T12:00:00.000Z'),
          },
          {
            queryVarsHash: 'hash-b',
            latestFetchedAt: new Date('2026-05-15T12:05:00.000Z'),
          },
        ],
      },
    ]);
    expect(aggregate).toHaveBeenCalledWith([
      { $match: { reportCode: { $in: ['ABC123'] } } },
      {
        $group: {
          _id: {
            reportCode: '$reportCode',
            queryVarsHash: '$queryVarsHash',
          },
          latestFetchedAt: { $max: '$fetchedAt' },
        },
      },
      {
        $group: {
          _id: '$_id.reportCode',
          payloads: {
            $push: {
              queryVarsHash: '$_id.queryVarsHash',
              latestFetchedAt: '$latestFetchedAt',
            },
          },
        },
      },
    ]);
  });

  it('appends raw ranking payloads for audit/debug reads', async () => {
    const insertMany = vi
      .spyOn(ReportRankingsRawModel, 'insertMany')
      .mockResolvedValue([{ reportCode: 'ABC123' }] as never);
    const store = new MongoReportRankingsStore();
    const fetchedAt = new Date('2026-05-15T12:00:00.000Z');

    await expect(
      store.saveRawPayloads([
        {
          reportCode: 'ABC123',
          fetchedAt,
          queryVarsHash: 'hash',
          payloadJson: { data: [] },
          timeframe: 'today',
          compareMode: 'rankings',
        },
      ]),
    ).resolves.toEqual({
      processedRows: 1,
      insertedRows: 1,
    });

    expect(insertMany).toHaveBeenCalledWith(
      [
        {
          reportCode: 'ABC123',
          fetchedAt,
          queryVarsHash: 'hash',
          payloadJson: { data: [] },
          timeframe: 'today',
          compareMode: 'rankings',
        },
      ],
      { ordered: false },
    );
  });

  it('replaces fact rows for fetched report ranking contexts', async () => {
    const deleteMany = vi.spyOn(ReportRankingsFactModel, 'deleteMany').mockResolvedValue({
      deletedCount: 2,
    } as never);
    const insertMany = vi
      .spyOn(ReportRankingsFactModel, 'insertMany')
      .mockResolvedValue([] as never);
    const store = new MongoReportRankingsStore();
    const sourceFetchedAt = new Date('2026-05-15T12:00:00.000Z');

    await expect(
      store.replaceFactsForReport({
        reportCode: 'ABC123',
        contexts: [{ timeframe: 'today', compareMode: 'rankings' }],
        facts: [
          {
            ...scope,
            reportCode: 'ABC123',
            reportStartTime: 1_700_000_000_000,
            fightId: 11,
            encounterId: 101,
            difficulty: 5,
            size: 25,
            timeframe: 'today',
            compareMode: 'rankings',
            speedPercentile: 95,
            rank: 12,
            kill: true,
            sourceFetchedAt,
          },
        ],
      }),
    ).resolves.toEqual({ deletedRows: 2, insertedRows: 1 });

    expect(deleteMany).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      $or: [{ timeframe: 'today', compareMode: 'rankings' }],
    });
    expect(insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          guildName: 'shenanigans',
          guildServerSlug: 'galakras',
          guildServerRegion: 'us',
          reportCode: 'ABC123',
          speedPercentile: 95,
        }),
      ],
      { ordered: false },
    );
  });

  it('materializes weekly trend medians, p90s, and prior-week deltas', async () => {
    vi.spyOn(ReportRankingsFactModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          ...scope,
          guildName: 'shenanigans',
          guildServerSlug: 'galakras',
          guildServerRegion: 'us',
          reportCode: 'PREV',
          reportStartTime: Date.parse('2023-11-14T12:00:00.000Z'),
          fightId: 1,
          encounterId: 101,
          difficulty: 5,
          size: 25,
          timeframe: 'today',
          compareMode: 'rankings',
          speedPercentile: 80,
          executionPercentile: 70,
          kill: true,
          sourceFetchedAt: new Date('2026-05-15T12:00:00.000Z'),
        },
        {
          ...scope,
          guildName: 'shenanigans',
          guildServerSlug: 'galakras',
          guildServerRegion: 'us',
          reportCode: 'CUR-A',
          reportStartTime: Date.parse('2023-11-21T12:00:00.000Z'),
          fightId: 2,
          encounterId: 101,
          difficulty: 5,
          size: 25,
          timeframe: 'today',
          compareMode: 'rankings',
          speedPercentile: 90,
          executionPercentile: 50,
          kill: true,
          sourceFetchedAt: new Date('2026-05-15T12:00:00.000Z'),
        },
        {
          ...scope,
          guildName: 'shenanigans',
          guildServerSlug: 'galakras',
          guildServerRegion: 'us',
          reportCode: 'CUR-B',
          reportStartTime: Date.parse('2023-11-21T13:00:00.000Z'),
          fightId: 3,
          encounterId: 101,
          difficulty: 5,
          size: 25,
          timeframe: 'today',
          compareMode: 'rankings',
          speedPercentile: 100,
          executionPercentile: 60,
          kill: true,
          sourceFetchedAt: new Date('2026-05-15T12:00:00.000Z'),
        },
      ]),
    } as never);
    const deleteMany = vi.spyOn(GuildEncounterTrendWeeklyModel, 'deleteMany').mockResolvedValue({
      deletedCount: 1,
    } as never);
    const bulkWrite = vi
      .spyOn(GuildEncounterTrendWeeklyModel, 'bulkWrite')
      .mockResolvedValue({} as never);
    const store = new MongoReportRankingsStore();
    const computedAt = new Date('2026-05-15T13:00:00.000Z');

    await expect(
      store.recomputeWeeklyTrends({
        scope,
        encounterIds: [101],
        weekStarts: [new Date('2023-11-21T00:00:00.000Z')],
        computedAt,
      }),
    ).resolves.toEqual({
      factRowsRead: 3,
      trendRowsWritten: 1,
      trendRowsDeleted: 1,
    });

    expect(ReportRankingsFactModel.find).toHaveBeenCalledWith({
      guildName: 'shenanigans',
      guildServerSlug: 'galakras',
      guildServerRegion: 'us',
      gameFamily: 'mop_classic',
      encounterId: { $in: [101] },
      reportStartTime: {
        $gte: Date.parse('2023-11-14T00:00:00.000Z'),
        $lt: Date.parse('2023-11-28T00:00:00.000Z'),
      },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      guildName: 'shenanigans',
      guildServerSlug: 'galakras',
      guildServerRegion: 'us',
      gameFamily: 'mop_classic',
      encounterId: { $in: [101] },
      weekStart: { $in: [new Date('2023-11-21T00:00:00.000Z')] },
    });
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: expect.objectContaining({
            update: {
              $set: expect.objectContaining({
                sampleCount: 2,
                speedMedian: 95,
                speedP90: 100,
                speedMedianDelta: 15,
                executionMedian: 55,
                executionP90: 60,
                executionMedianDelta: -15,
                computedAt,
              }),
            },
          }),
        },
      ],
      { ordered: false },
    );
  });

  it('materializes separate weekly trends and deltas per partition', async () => {
    const fact = (input: {
      reportCode: string;
      reportStartTime: string;
      fightId: number;
      partition: number;
      speedPercentile: number;
      executionPercentile: number;
    }) => ({
      ...scope,
      guildName: 'shenanigans',
      guildServerSlug: 'galakras',
      guildServerRegion: 'us',
      reportCode: input.reportCode,
      reportStartTime: Date.parse(input.reportStartTime),
      fightId: input.fightId,
      encounterId: 101,
      difficulty: 5,
      size: 25,
      partition: input.partition,
      timeframe: 'today',
      compareMode: 'rankings',
      speedPercentile: input.speedPercentile,
      executionPercentile: input.executionPercentile,
      kill: true,
      sourceFetchedAt: new Date('2026-05-15T12:00:00.000Z'),
    });

    vi.spyOn(ReportRankingsFactModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        fact({
          reportCode: 'PREV-P4',
          reportStartTime: '2023-11-14T12:00:00.000Z',
          fightId: 1,
          partition: 4,
          speedPercentile: 50,
          executionPercentile: 40,
        }),
        fact({
          reportCode: 'CUR-P4',
          reportStartTime: '2023-11-21T12:00:00.000Z',
          fightId: 2,
          partition: 4,
          speedPercentile: 60,
          executionPercentile: 45,
        }),
        fact({
          reportCode: 'CUR-P5',
          reportStartTime: '2023-11-21T13:00:00.000Z',
          fightId: 3,
          partition: 5,
          speedPercentile: 100,
          executionPercentile: 90,
        }),
      ]),
    } as never);
    const deleteMany = vi.spyOn(GuildEncounterTrendWeeklyModel, 'deleteMany').mockResolvedValue({
      deletedCount: 2,
    } as never);
    const bulkWrite = vi
      .spyOn(GuildEncounterTrendWeeklyModel, 'bulkWrite')
      .mockResolvedValue({} as never);
    const store = new MongoReportRankingsStore();

    await expect(
      store.recomputeWeeklyTrends({
        scope,
        encounterIds: [101],
        weekStarts: [new Date('2023-11-21T00:00:00.000Z')],
      }),
    ).resolves.toEqual({
      factRowsRead: 3,
      trendRowsWritten: 2,
      trendRowsDeleted: 2,
    });

    const deleteFilter = deleteMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(deleteFilter).not.toHaveProperty('partition');

    const writes = bulkWrite.mock.calls[0]?.[0] as Array<{
      updateOne: {
        filter: { partition?: number };
        update: { $set: { partition?: number; speedMedianDelta?: number } };
      };
    }>;
    const writesByPartition = new Map(
      writes.map((write) => [write.updateOne.filter.partition, write.updateOne.update.$set]),
    );

    expect(writesByPartition.get(4)).toMatchObject({
      partition: 4,
      speedMedianDelta: 10,
    });
    expect(writesByPartition.get(5)).toMatchObject({
      partition: 5,
    });
    expect(writesByPartition.get(5)).not.toHaveProperty('speedMedianDelta');
  });
});

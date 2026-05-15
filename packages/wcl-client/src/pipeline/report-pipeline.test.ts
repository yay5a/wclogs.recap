import type { ReportIndexData, ReportSummary } from '@wcl/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportIndexCacheReadResult, ReportIndexCacheStore } from '../report-index-cache.js';

const collectReportIndex = vi.hoisted(() => vi.fn());
const collectMasterData = vi.hoisted(() => vi.fn());
const collectPlayerDetails = vi.hoisted(() => vi.fn());
const collectReportRankings = vi.hoisted(() => vi.fn());
const collectTableMetrics = vi.hoisted(() => vi.fn());
const normalizeReportRenderModel = vi.hoisted(() => vi.fn());
const loggerInfo = vi.hoisted(() => vi.fn());
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock('@wcl/shared', () => ({
  createLogger: () => ({
    info: loggerInfo,
    warn: loggerWarn,
  }),
  serializeError: (error: unknown) => ({ message: String(error) }),
}));

vi.mock('../collectors/report-index-collector.js', () => ({
  collectReportIndex,
}));

vi.mock('../collectors/master-data-collector.js', () => ({
  collectMasterData,
}));

vi.mock('../collectors/player-details-collector.js', () => ({
  collectPlayerDetails,
}));

vi.mock('../collectors/report-rankings-collector.js', () => ({
  collectReportRankings,
}));

vi.mock('../collectors/table-collector.js', () => ({
  collectTableMetrics,
}));

vi.mock('../normalizers/report-render-model-normalizer.js', () => ({
  normalizeReportRenderModel,
}));

import { getReportIndexCacheExpiresAt } from '../report-index-cache.js';
import { collectReportSummaryData } from './report-pipeline.js';

const reportSummary = { reportCode: 'ABC123' } as ReportSummary;

const reportIndexFixture = (overrides: Partial<ReportIndexData> = {}): ReportIndexData => ({
  reportCode: 'ABC123',
  sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
  gameFamily: 'retail',
  title: 'Vault',
  zoneName: 'Vault of the Incarnates',
  zoneId: 31,
  startTime: 1_700_000_000_000,
  endTime: 1_700_003_600_000,
  completedBossFights: [
    {
      id: 11,
      encounterId: 100,
      name: 'Boss',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_300_000,
      kill: true,
    },
  ],
  killBossFights: [
    {
      id: 11,
      encounterId: 100,
      name: 'Boss',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_300_000,
      kill: true,
    },
  ],
  allBossFights: [
    {
      id: 11,
      encounterId: 100,
      name: 'Boss',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_300_000,
      kill: true,
    },
  ],
  zoneDifficulties: [{ id: 4, name: 'Heroic' }],
  ...overrides,
});

const makeCacheStore = (result: ReportIndexCacheReadResult): ReportIndexCacheStore => ({
  getReportIndex: vi.fn().mockResolvedValue(result),
  saveReportIndex: vi.fn().mockResolvedValue(undefined),
});

describe('collectReportSummaryData report index cache', () => {
  beforeEach(() => {
    vi.useRealTimers();
    collectReportIndex.mockReset();
    collectMasterData.mockReset().mockResolvedValue({ actors: [] });
    collectPlayerDetails.mockReset().mockResolvedValue([]);
    collectReportRankings.mockReset().mockResolvedValue({ dps: [], hps: [], tankDps: [] });
    collectTableMetrics.mockReset().mockResolvedValue({
      topDamageDone: [],
      topHealingDone: [],
      topDamageTaken: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: {},
      encounterTopDamageDoneByEncounterId: {},
      encounterTopHealingDoneByEncounterId: {},
      encounterTopDamageTakenByEncounterId: {},
    });
    normalizeReportRenderModel.mockReset().mockReturnValue(reportSummary);
    loggerInfo.mockReset();
    loggerWarn.mockReset();
  });

  it('uses a cached report index without fetching it again', async () => {
    const index = reportIndexFixture();
    const cacheStore = makeCacheStore({ status: 'hit', data: index });

    await expect(
      collectReportSummaryData(
        {} as never,
        {
          sourceUrl: index.sourceUrl,
          reportCode: index.reportCode,
          gameFamily: index.gameFamily,
        },
        { reportIndexCacheStore: cacheStore },
      ),
    ).resolves.toBe(reportSummary);

    expect(cacheStore.getReportIndex).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      gameFamily: 'retail',
    });
    expect(loggerInfo).toHaveBeenCalledWith(
      { reportCode: 'ABC123', gameFamily: 'retail' },
      'report_index_cache_hit',
    );
    expect(collectReportIndex).not.toHaveBeenCalled();
    expect(cacheStore.saveReportIndex).not.toHaveBeenCalled();
    expect(collectPlayerDetails).toHaveBeenCalledWith({} as never, {
      reportCode: 'ABC123',
      completedFightIds: [11],
    });
  });

  it('fetches and saves the report index when the cache misses', async () => {
    vi.setSystemTime(new Date('2026-05-15T00:00:00.000Z'));
    const index = reportIndexFixture();
    const cacheStore = makeCacheStore({ status: 'miss' });
    collectReportIndex.mockResolvedValue(index);

    await collectReportSummaryData(
      {} as never,
      {
        sourceUrl: index.sourceUrl,
        reportCode: index.reportCode,
        gameFamily: index.gameFamily,
      },
      { reportIndexCacheStore: cacheStore },
    );

    expect(collectReportIndex).toHaveBeenCalledWith({} as never, {
      sourceUrl: index.sourceUrl,
      reportCode: 'ABC123',
      gameFamily: 'retail',
    });
    expect(cacheStore.saveReportIndex).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      gameFamily: 'retail',
      data: index,
    });
    expect(loggerInfo).toHaveBeenCalledWith(
      { reportCode: 'ABC123', gameFamily: 'retail' },
      'report_index_cache_miss',
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      { reportCode: 'ABC123', gameFamily: 'retail' },
      'report_index_cache_write',
    );
  });

  it('saves recently ended report indexes with a short expiration', async () => {
    vi.setSystemTime(new Date('2026-05-15T00:00:00.000Z'));
    const index = reportIndexFixture({
      endTime: new Date('2026-05-14T23:30:00.000Z').getTime(),
    });
    const cacheStore = makeCacheStore({ status: 'miss' });
    collectReportIndex.mockResolvedValue(index);

    await collectReportSummaryData(
      {} as never,
      {
        sourceUrl: index.sourceUrl,
        reportCode: index.reportCode,
        gameFamily: index.gameFamily,
      },
      { reportIndexCacheStore: cacheStore },
    );

    expect(cacheStore.saveReportIndex).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      gameFamily: 'retail',
      data: index,
      expiresAt: new Date('2026-05-15T00:10:00.000Z'),
    });
    expect(loggerInfo).toHaveBeenCalledWith(
      {
        reportCode: 'ABC123',
        gameFamily: 'retail',
        expiresAt: '2026-05-15T00:10:00.000Z',
      },
      'report_index_cache_write',
    );
  });

  it('fetches fresh data when the cached report index is stale', async () => {
    const index = reportIndexFixture();
    const expiresAt = new Date('2026-05-14T23:59:00.000Z');
    const cacheStore = makeCacheStore({ status: 'stale', expiresAt });
    collectReportIndex.mockResolvedValue(index);

    await collectReportSummaryData(
      {} as never,
      {
        sourceUrl: index.sourceUrl,
        reportCode: index.reportCode,
        gameFamily: index.gameFamily,
      },
      { reportIndexCacheStore: cacheStore },
    );

    expect(collectReportIndex).toHaveBeenCalled();
    expect(loggerInfo).toHaveBeenCalledWith(
      {
        reportCode: 'ABC123',
        gameFamily: 'retail',
        expiresAt: '2026-05-14T23:59:00.000Z',
      },
      'report_index_cache_stale',
    );
  });

  it('uses the dominant difficulty and size for mixed-mode report summaries', async () => {
    const heroicKill = {
      id: 11,
      encounterId: 100,
      name: 'Jinrokh',
      startTime: 100,
      endTime: 200,
      kill: true,
      difficulty: 4,
      size: 10,
    };
    const heroicWipe = {
      id: 12,
      encounterId: 101,
      name: 'Council',
      startTime: 300,
      endTime: 400,
      kill: false,
      difficulty: 4,
      size: 10,
    };
    const normalKill = {
      id: 13,
      encounterId: 101,
      name: 'Council',
      startTime: 500,
      endTime: 600,
      kill: true,
      difficulty: 3,
      size: 10,
    };
    const index = reportIndexFixture({
      completedBossFights: [heroicKill, heroicWipe, normalKill],
      killBossFights: [heroicKill, normalKill],
      allBossFights: [heroicKill, heroicWipe, normalKill],
    });
    collectReportIndex.mockResolvedValue(index);

    await collectReportSummaryData({} as never, {
      sourceUrl: index.sourceUrl,
      reportCode: index.reportCode,
      gameFamily: index.gameFamily,
    });

    expect(collectPlayerDetails).toHaveBeenCalledWith({} as never, {
      reportCode: 'ABC123',
      completedFightIds: [11, 12],
    });
    expect(collectReportRankings).toHaveBeenCalledWith({} as never, {
      reportCode: 'ABC123',
      killFightIds: [11],
    });
    expect(collectTableMetrics).toHaveBeenCalledWith({} as never, {
      reportCode: 'ABC123',
      completedFightIds: [11, 12],
      completedBossFights: [heroicKill, heroicWipe],
    });
    const renderBundle = normalizeReportRenderModel.mock.calls[0]?.[0] as
      | { index: ReportIndexData }
      | undefined;
    expect(renderBundle?.index.completedBossFights).toEqual([heroicKill, heroicWipe]);
    expect(renderBundle?.index.killBossFights).toEqual([heroicKill]);
    expect(renderBundle?.index.allBossFights).toEqual([heroicKill, heroicWipe]);
  });

  it('uses a short expiration for in-progress report indexes', () => {
    const now = new Date('2026-05-15T00:00:00.000Z');
    const index = reportIndexFixture({
      allBossFights: [
        {
          id: 11,
          encounterId: 100,
          name: 'Boss',
          startTime: 1_700_000_000_000,
          endTime: 1_700_000_300_000,
          kill: false,
          inProgress: true,
        },
      ],
    });

    expect(getReportIndexCacheExpiresAt(index, now)).toEqual(
      new Date('2026-05-15T00:10:00.000Z'),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncGuildReportMetadataIndex } from './guild-report-metadata-sync.js';

const scope = {
  guildName: 'Shenanigans',
  guildServerSlug: 'Galakras',
  guildServerRegion: 'US',
  gameFamily: 'mop_classic' as const,
};

const makeWclClient = () => ({
  fetchGuildReportIndex: vi.fn().mockResolvedValue({
    rows: [],
    windowsQueried: 1,
    complexity: { apiCalls: 'O(W)', parseAndDedupe: 'O(N)', memory: 'O(U)' },
  }),
});

const makeStore = () => ({
  upsertReports: vi.fn().mockResolvedValue({
    processedRows: 0,
    upsertedRows: 0,
    matchedRows: 0,
    modifiedRows: 0,
  }),
  saveCursor: vi.fn().mockResolvedValue({
    ...scope,
    lastSeenStartTime: 0,
    lastIndexedAt: new Date(0),
  }),
});

describe('syncGuildReportMetadataIndex', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes fetched report metadata and advances the cursor', async () => {
    const indexedAt = new Date('2026-05-15T12:00:00.000Z');
    const wclClient = makeWclClient();
    wclClient.fetchGuildReportIndex.mockResolvedValue({
      rows: [
        {
          code: 'ABC123',
          title: 'Raid Night',
          owner: 'Logger',
          zoneId: 1046,
          startTime: 100,
          endTime: 200,
        },
        { code: 'DEF456', startTime: 300 },
      ],
      windowsQueried: 1,
      complexity: { apiCalls: 'O(W)', parseAndDedupe: 'O(N)', memory: 'O(U)' },
    });
    const store = makeStore();
    store.upsertReports.mockResolvedValue({
      processedRows: 2,
      upsertedRows: 2,
      matchedRows: 0,
      modifiedRows: 0,
    });
    const logger = { info: vi.fn() };

    const result = await syncGuildReportMetadataIndex({
      wclClient,
      store,
      ...scope,
      startTimeMs: 0,
      endTimeMs: 999,
      indexedAt,
      logger,
    });

    expect(wclClient.fetchGuildReportIndex).toHaveBeenCalledWith({
      ...scope,
      startTimeMs: 0,
      endTimeMs: 999,
    });
    expect(store.upsertReports).toHaveBeenCalledWith({
      scope,
      indexedAt,
      reports: [
        {
          reportCode: 'ABC123',
          title: 'Raid Night',
          owner: 'Logger',
          zoneId: 1046,
          startTime: 100,
          endTime: 200,
        },
        { reportCode: 'DEF456', startTime: 300 },
      ],
    });
    expect(store.saveCursor).toHaveBeenCalledWith({
      scope,
      lastSeenStartTime: 300,
      lastIndexedAt: indexedAt,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchedRows: 2,
        indexedRows: 2,
        upsertedRows: 2,
        cursorAdvanced: true,
        lastSeenStartTime: 300,
      }),
      'guild_report_metadata_index_sync',
    );
    expect(result).toEqual({
      fetchedRows: 2,
      indexedRows: 2,
      skippedRows: 0,
      upsertedRows: 2,
      matchedRows: 0,
      modifiedRows: 0,
      windowsQueried: 1,
      cursorAdvanced: true,
      lastSeenStartTime: 300,
    });
  });

  it('does not move the cursor when no reports are fetched', async () => {
    const wclClient = makeWclClient();
    const store = makeStore();

    const result = await syncGuildReportMetadataIndex({
      wclClient,
      store,
      ...scope,
      startTimeMs: 0,
      endTimeMs: 999,
    });

    expect(store.upsertReports).not.toHaveBeenCalled();
    expect(store.saveCursor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      fetchedRows: 0,
      indexedRows: 0,
      cursorAdvanced: false,
    });
  });

  it('honors maxReports and only advances the cursor over indexed rows', async () => {
    const wclClient = makeWclClient();
    wclClient.fetchGuildReportIndex.mockResolvedValue({
      rows: [
        { code: 'FIRST', startTime: 100 },
        { code: 'SECOND', startTime: 200 },
        { code: 'THIRD', startTime: 300 },
      ],
      windowsQueried: 1,
      complexity: { apiCalls: 'O(W)', parseAndDedupe: 'O(N)', memory: 'O(U)' },
    });
    const store = makeStore();
    store.upsertReports.mockResolvedValue({
      processedRows: 2,
      upsertedRows: 1,
      matchedRows: 1,
      modifiedRows: 0,
    });

    const result = await syncGuildReportMetadataIndex({
      wclClient,
      store,
      ...scope,
      startTimeMs: 0,
      endTimeMs: 999,
      maxReports: 2,
    });

    expect(store.upsertReports).toHaveBeenCalledWith(
      expect.objectContaining({
        reports: [
          { reportCode: 'FIRST', startTime: 100 },
          { reportCode: 'SECOND', startTime: 200 },
        ],
      }),
    );
    expect(store.saveCursor).toHaveBeenCalledWith(
      expect.objectContaining({ lastSeenStartTime: 200 }),
    );
    expect(result).toMatchObject({
      fetchedRows: 3,
      indexedRows: 2,
      skippedRows: 1,
      cursorAdvanced: true,
      lastSeenStartTime: 200,
    });
  });

  it('rejects invalid per-run caps', async () => {
    await expect(
      syncGuildReportMetadataIndex({
        wclClient: makeWclClient(),
        store: makeStore(),
        ...scope,
        startTimeMs: 0,
        endTimeMs: 999,
        maxReports: 0,
      }),
    ).rejects.toThrow(/maxReports/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  selectGuildRankCandidateReports,
  type GuildRankLiveReportIndexFetcher,
  type GuildRankReportMetadataReader,
  type GuildRankReportMetadataRow,
} from './guildrank-candidate-selector.js';

const windows = {
  previousWindowStartMs: 1_000,
  previousWindowEndMs: 1_999,
  currentWindowStartMs: 2_000,
  currentWindowEndMs: 2_999,
};

const baseInput = {
  guildName: 'Shenanigans',
  guildServerSlug: 'galakras',
  guildServerRegion: 'us',
  gameFamily: 'mop_classic' as const,
  zoneId: 1046,
  ...windows,
};

const metadataReaderFor = (rows: GuildRankReportMetadataRow[]): GuildRankReportMetadataReader => ({
  summarizeReports: vi.fn(async () => rows),
});

const liveFetcherFor = (rows: GuildRankReportMetadataRow[]): GuildRankLiveReportIndexFetcher =>
  vi.fn(async () => rows);

describe('guildrank candidate selector', () => {
  it('prefers metadata when both windows have coverage', async () => {
    const metadataReader = metadataReaderFor([
      { reportCode: 'CUR', zoneId: 1046, startTime: 2_100, endTime: 2_200 },
      { reportCode: 'PREV', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);
    const liveReportIndexFetcher = liveFetcherFor([
      { reportCode: 'LIVE', zoneId: 1046, startTime: 2_300, endTime: 2_400 },
    ]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      metadataReader,
      liveReportIndexFetcher,
    });

    expect(result.map((row) => row.reportCode)).toEqual(['CUR', 'PREV']);
    expect(result.every((row) => row.source === 'mongo-index')).toBe(true);
    expect(liveReportIndexFetcher).not.toHaveBeenCalled();
  });

  it('falls back to live WCL when metadata is absent', async () => {
    const liveReportIndexFetcher = liveFetcherFor([
      { reportCode: 'CUR', zoneId: 1046, startTime: 2_100, endTime: 2_200 },
      { reportCode: 'PREV', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      liveReportIndexFetcher,
    });

    expect(result.map((row) => row.reportCode)).toEqual(['CUR', 'PREV']);
    expect(result.every((row) => row.source === 'live-wcl')).toBe(true);
    expect(liveReportIndexFetcher).toHaveBeenCalledWith({
      guildName: 'Shenanigans',
      guildServerSlug: 'galakras',
      guildServerRegion: 'us',
      gameFamily: 'mop_classic',
      startTimeMs: 1_000,
      endTimeMs: 2_999,
      limit: 30,
    });
  });

  it('falls back to live WCL when metadata lacks one window', async () => {
    const metadataReader = metadataReaderFor([
      { reportCode: 'CUR_ONLY', zoneId: 1046, startTime: 2_100, endTime: 2_200 },
    ]);
    const liveReportIndexFetcher = liveFetcherFor([
      { reportCode: 'CUR', zoneId: 1046, startTime: 2_100, endTime: 2_200 },
      { reportCode: 'PREV', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      metadataReader,
      liveReportIndexFetcher,
    });

    expect(result.map((row) => row.reportCode)).toEqual(['CUR', 'PREV']);
    expect(result.every((row) => row.source === 'live-wcl')).toBe(true);
  });

  it('keeps unknown-zone metadata rows and removes known non-matching zones', async () => {
    const metadataReader = metadataReaderFor([
      { reportCode: 'UNKNOWN_ZONE', startTime: 2_100, endTime: 2_200 },
      { reportCode: 'WRONG_ZONE', zoneId: 9999, startTime: 2_300, endTime: 2_400 },
      { reportCode: 'PREV', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);
    const liveReportIndexFetcher = liveFetcherFor([]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      metadataReader,
      liveReportIndexFetcher,
    });

    expect(result.map((row) => row.reportCode)).toEqual(['UNKNOWN_ZONE', 'PREV']);
    expect(liveReportIndexFetcher).not.toHaveBeenCalled();
  });

  it('collapses duplicates after selector-owned zone filtering', async () => {
    const metadataReader = metadataReaderFor([
      {
        reportCode: 'WRONG_LATEST',
        zoneId: 9999,
        startTime: 2_100,
        endTime: 2_500,
        raidNightKey: 'night-a',
      },
      {
        reportCode: 'RIGHT_EARLIER',
        zoneId: 1046,
        startTime: 2_100,
        endTime: 2_200,
        raidNightKey: 'night-a',
      },
      { reportCode: 'PREV', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);
    const liveReportIndexFetcher = liveFetcherFor([]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      metadataReader,
      liveReportIndexFetcher,
    });

    expect(result.map((row) => row.reportCode)).toEqual(['RIGHT_EARLIER', 'PREV']);
  });

  it('checks metadata coverage before applying maxReports', async () => {
    const metadataReader = metadataReaderFor([
      { reportCode: 'CUR', zoneId: 1046, startTime: 2_100, endTime: 2_200 },
      { reportCode: 'PREV', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);
    const liveReportIndexFetcher = liveFetcherFor([
      { reportCode: 'LIVE', zoneId: 1046, startTime: 2_300, endTime: 2_400 },
    ]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      metadataReader,
      liveReportIndexFetcher,
      maxReports: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('mongo-index');
    expect(liveReportIndexFetcher).not.toHaveBeenCalled();
  });

  it('applies maxReports after selecting a source', async () => {
    const liveReportIndexFetcher = liveFetcherFor([
      { reportCode: 'CUR_A', zoneId: 1046, startTime: 2_300, endTime: 2_400 },
      { reportCode: 'CUR_B', zoneId: 1046, startTime: 2_100, endTime: 2_200 },
      { reportCode: 'PREV_A', zoneId: 1046, startTime: 1_300, endTime: 1_400 },
      { reportCode: 'PREV_B', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
    ]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      liveReportIndexFetcher,
      maxReports: 2,
    });

    expect(result.map((row) => row.reportCode)).toEqual(['CUR_A', 'PREV_A']);
  });

  it('zone-filters and duplicate-collapses live fallback rows too', async () => {
    const liveReportIndexFetcher = liveFetcherFor([
      {
        reportCode: 'LIVE_WRONG_LATEST',
        zoneId: 9999,
        startTime: 2_100,
        endTime: 2_500,
        raidNightKey: 'night-a',
      },
      {
        reportCode: 'LIVE_RIGHT_EARLIER',
        zoneId: 1046,
        startTime: 2_100,
        endTime: 2_200,
        raidNightKey: 'night-a',
      },
      { reportCode: 'PREV_OLD', zoneId: 1046, startTime: 1_100, endTime: 1_200 },
      { reportCode: 'PREV_NEW', zoneId: 1046, startTime: 1_100, endTime: 1_300 },
    ]);

    const result = await selectGuildRankCandidateReports({
      ...baseInput,
      liveReportIndexFetcher,
    });

    expect(result.map((row) => row.reportCode)).toEqual([
      'LIVE_RIGHT_EARLIER',
      'PREV_NEW',
    ]);
    expect(result.every((row) => row.source === 'live-wcl')).toBe(true);
  });
});

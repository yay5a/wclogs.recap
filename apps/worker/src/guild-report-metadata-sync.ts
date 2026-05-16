import type {
  GuildReportMetadataInputRow,
  GuildReportMetadataScope,
  GuildReportMetadataStore,
  GuildReportMetadataUpsertResult,
} from '@wcl/db';
import type { GameFamily } from '@wcl/domain';
import type { GuildReportIndexInput, GuildReportIndexResult } from '@wcl/wcl-client';

export interface GuildReportMetadataIndexClient {
  fetchGuildReportIndex(input: GuildReportIndexInput): Promise<GuildReportIndexResult>;
}

export interface GuildReportMetadataSyncLogger {
  info(context: Record<string, unknown>, message: string): void;
}

export interface GuildReportMetadataSyncInput {
  wclClient: GuildReportMetadataIndexClient;
  store: Pick<GuildReportMetadataStore, 'upsertReports' | 'saveCursor'>;
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily?: GameFamily;
  startTimeMs: number;
  endTimeMs: number;
  windowSizeMs?: number;
  maxReports?: number;
  indexedAt?: Date;
  logger?: GuildReportMetadataSyncLogger;
}

export interface GuildReportMetadataSyncResult {
  fetchedRows: number;
  indexedRows: number;
  skippedRows: number;
  upsertedRows: number;
  matchedRows: number;
  modifiedRows: number;
  windowsQueried: number;
  cursorAdvanced: boolean;
  lastSeenStartTime?: number;
}

const DEFAULT_MAX_REPORTS = 100;

const toScope = (input: {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily?: GameFamily;
}): GuildReportMetadataScope => ({
  guildName: input.guildName.trim(),
  guildServerSlug: input.guildServerSlug,
  guildServerRegion: input.guildServerRegion,
  gameFamily: input.gameFamily ?? 'retail',
});

const toReportMetadataRow = (
  row: GuildReportIndexResult['rows'][number],
): GuildReportMetadataInputRow => ({
  reportCode: row.code,
  ...(row.title ? { title: row.title } : {}),
  ...(row.owner ? { owner: row.owner } : {}),
  ...(typeof row.zoneId === 'number' ? { zoneId: row.zoneId } : {}),
  startTime: row.startTime,
  ...(typeof row.endTime === 'number' ? { endTime: row.endTime } : {}),
});

const getMaxReports = (value: number | undefined): number => {
  const maxReports = value ?? DEFAULT_MAX_REPORTS;
  if (!Number.isSafeInteger(maxReports) || maxReports < 1) {
    throw new Error('maxReports must be a positive integer');
  }
  return maxReports;
};

const toSyncResult = (
  index: GuildReportIndexResult,
  upsert: GuildReportMetadataUpsertResult,
  indexedRows: GuildReportMetadataInputRow[],
): GuildReportMetadataSyncResult => {
  const lastSeenStartTime =
    indexedRows.length > 0 ? Math.max(...indexedRows.map((row) => row.startTime)) : undefined;
  return {
    fetchedRows: index.rows.length,
    indexedRows: indexedRows.length,
    skippedRows: Math.max(index.rows.length - indexedRows.length, 0),
    upsertedRows: upsert.upsertedRows,
    matchedRows: upsert.matchedRows,
    modifiedRows: upsert.modifiedRows,
    windowsQueried: index.windowsQueried,
    cursorAdvanced: typeof lastSeenStartTime === 'number',
    ...(typeof lastSeenStartTime === 'number' ? { lastSeenStartTime } : {}),
  };
};

export const syncGuildReportMetadataIndex = async (
  input: GuildReportMetadataSyncInput,
): Promise<GuildReportMetadataSyncResult> => {
  const scope = toScope(input);
  const maxReports = getMaxReports(input.maxReports);
  const indexedAt = input.indexedAt ?? new Date();
  const index = await input.wclClient.fetchGuildReportIndex({
    guildName: scope.guildName,
    guildServerSlug: scope.guildServerSlug,
    guildServerRegion: scope.guildServerRegion,
    gameFamily: scope.gameFamily,
    startTimeMs: input.startTimeMs,
    endTimeMs: input.endTimeMs,
    ...(input.windowSizeMs !== undefined ? { windowSizeMs: input.windowSizeMs } : {}),
  });
  const reports = index.rows.slice(0, maxReports).map((row) => toReportMetadataRow(row));
  const upsert =
    reports.length > 0
      ? await input.store.upsertReports({ scope, reports, indexedAt })
      : { processedRows: 0, upsertedRows: 0, matchedRows: 0, modifiedRows: 0 };
  const result = toSyncResult(index, upsert, reports);

  if (typeof result.lastSeenStartTime === 'number') {
    await input.store.saveCursor({
      scope,
      lastSeenStartTime: result.lastSeenStartTime,
      lastIndexedAt: indexedAt,
    });
  }

  input.logger?.info(
    {
      ...scope,
      startTimeMs: input.startTimeMs,
      endTimeMs: input.endTimeMs,
      ...result,
    },
    'guild_report_metadata_index_sync',
  );

  return result;
};

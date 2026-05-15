import type { GameFamily } from '@wcl/domain';
import { createLogger } from '@wcl/shared';

const DEFAULT_MAX_REPORTS = 30;
const logger = createLogger('wcl-client');

export type GuildRankReportCandidateSource = 'mongo-index' | 'live-wcl';

export interface GuildRankReportCandidate {
  reportCode: string;
  title?: string;
  owner?: string;
  zoneId?: number;
  zoneName?: string;
  startTime: number;
  endTime?: number;
  raidNightKey?: string;
  duplicateOf?: string;
  source: GuildRankReportCandidateSource;
}

export interface GuildRankReportMetadataRow {
  reportCode: string;
  title?: string;
  owner?: string;
  zoneId?: number;
  zoneName?: string;
  startTime: number;
  endTime?: number;
  raidNightKey?: string;
  duplicateOf?: string;
}

export interface GuildRankReportMetadataReader {
  summarizeReports(input: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    gameFamily: GameFamily;
    startTimeMs: number;
    endTimeMs: number;
    limit?: number;
  }): Promise<GuildRankReportMetadataRow[]>;
}

export type GuildRankLiveReportIndexFetcher = (input: {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
  startTimeMs: number;
  endTimeMs: number;
  limit: number;
}) => Promise<GuildRankReportMetadataRow[]>;

export interface SelectGuildRankCandidateReportsInput {
  gameFamily?: GameFamily;
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  zoneId?: number;
  currentWindowStartMs: number;
  currentWindowEndMs: number;
  previousWindowStartMs: number;
  previousWindowEndMs: number;
  maxReports?: number;
  metadataReader?: GuildRankReportMetadataReader;
  liveReportIndexFetcher: GuildRankLiveReportIndexFetcher;
}

type GuildRankCandidateFallbackReason =
  | 'metadata-reader-missing'
  | 'current-window-missing'
  | 'previous-window-missing';

const toMaxReports = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_REPORTS;
  return Math.max(1, Math.trunc(value));
};

export const matchesRequestedZone = (row: GuildRankReportMetadataRow, zoneId?: number): boolean => {
  if (zoneId == null) return true;
  if (row.zoneId == null) return true;
  return row.zoneId === zoneId;
};

export const reportSortEndTime = (row: GuildRankReportMetadataRow): number =>
  typeof row.endTime === 'number' && Number.isFinite(row.endTime) ? row.endTime : row.startTime;

const getRaidNightKey = (row: GuildRankReportMetadataRow): string => {
  const key = row.raidNightKey?.trim();
  return key ? key : String(row.startTime);
};

const isSelectableRow = (row: GuildRankReportMetadataRow): boolean =>
  row.reportCode.trim().length > 0 && Number.isFinite(row.startTime);

export const collapseDuplicateReports = (
  rows: GuildRankReportMetadataRow[],
): GuildRankReportMetadataRow[] => {
  const rowsByRaidNight = new Map<string, GuildRankReportMetadataRow[]>();
  for (const row of rows) {
    if (!isSelectableRow(row)) continue;
    const key = getRaidNightKey(row);
    rowsByRaidNight.set(key, [...(rowsByRaidNight.get(key) ?? []), row]);
  }

  return [...rowsByRaidNight.values()]
    .flatMap((group) => {
      const canonical = [...group].sort(
        (left, right) =>
          reportSortEndTime(right) - reportSortEndTime(left) ||
          left.reportCode.localeCompare(right.reportCode),
      )[0];
      return canonical ? [canonical] : [];
    })
    .sort(
      (left, right) =>
        right.startTime - left.startTime ||
        reportSortEndTime(right) - reportSortEndTime(left) ||
        left.reportCode.localeCompare(right.reportCode),
    );
};

const toCandidate = (
  row: GuildRankReportMetadataRow,
  source: GuildRankReportCandidateSource,
): GuildRankReportCandidate => ({
  reportCode: row.reportCode.trim(),
  ...(row.title ? { title: row.title } : {}),
  ...(row.owner ? { owner: row.owner } : {}),
  ...(typeof row.zoneId === 'number' ? { zoneId: row.zoneId } : {}),
  ...(row.zoneName ? { zoneName: row.zoneName } : {}),
  startTime: row.startTime,
  ...(typeof row.endTime === 'number' ? { endTime: row.endTime } : {}),
  ...(row.raidNightKey ? { raidNightKey: row.raidNightKey } : {}),
  ...(row.duplicateOf ? { duplicateOf: row.duplicateOf } : {}),
  source,
});

export const toCanonicalCandidates = (input: {
  rows: GuildRankReportMetadataRow[];
  source: GuildRankReportCandidateSource;
  zoneId?: number;
}): GuildRankReportCandidate[] =>
  collapseDuplicateReports(input.rows.filter((row) => matchesRequestedZone(row, input.zoneId))).map(
    (row) => toCandidate(row, input.source),
  );

const isInCurrentWindow = (
  candidate: GuildRankReportCandidate,
  input: Pick<SelectGuildRankCandidateReportsInput, 'currentWindowStartMs' | 'currentWindowEndMs'>,
): boolean =>
  candidate.startTime >= input.currentWindowStartMs &&
  candidate.startTime <= input.currentWindowEndMs;

const isInPreviousWindow = (
  candidate: GuildRankReportCandidate,
  input: Pick<
    SelectGuildRankCandidateReportsInput,
    'previousWindowStartMs' | 'previousWindowEndMs' | 'currentWindowStartMs'
  >,
): boolean =>
  candidate.startTime >= input.previousWindowStartMs &&
  candidate.startTime <= input.previousWindowEndMs &&
  candidate.startTime < input.currentWindowStartMs;

export const hasWindowCoverage = (
  candidates: GuildRankReportCandidate[],
  input: SelectGuildRankCandidateReportsInput,
): boolean =>
  candidates.some((candidate) => isInCurrentWindow(candidate, input)) &&
  candidates.some((candidate) => isInPreviousWindow(candidate, input));

const getFallbackReason = (input: {
  hasMetadataReader: boolean;
  currentCandidateCount: number;
}): GuildRankCandidateFallbackReason => {
  if (!input.hasMetadataReader) return 'metadata-reader-missing';
  if (input.currentCandidateCount === 0) return 'current-window-missing';
  return 'previous-window-missing';
};

const sortCandidates = (candidates: GuildRankReportCandidate[]): GuildRankReportCandidate[] =>
  [...candidates].sort(
    (left, right) =>
      right.startTime - left.startTime ||
      (right.endTime ?? right.startTime) - (left.endTime ?? left.startTime) ||
      left.reportCode.localeCompare(right.reportCode),
  );

export const balanceCandidatesAcrossWindows = (
  candidates: GuildRankReportCandidate[],
  input: SelectGuildRankCandidateReportsInput,
  maxReports: number,
): GuildRankReportCandidate[] => {
  const current = sortCandidates(
    candidates.filter((candidate) => isInCurrentWindow(candidate, input)),
  );
  const previous = sortCandidates(
    candidates.filter((candidate) => isInPreviousWindow(candidate, input)),
  );
  const currentQuota = Math.ceil(maxReports / 2);
  const previousQuota = Math.floor(maxReports / 2);
  const selected = [...current.slice(0, currentQuota), ...previous.slice(0, previousQuota)];

  if (selected.length >= maxReports) return selected.slice(0, maxReports);

  const selectedCodes = new Set(selected.map((candidate) => candidate.reportCode));
  const remainder = sortCandidates([...current, ...previous]).filter(
    (candidate) => !selectedCodes.has(candidate.reportCode),
  );

  return [...selected, ...remainder].slice(0, maxReports);
};

export async function selectGuildRankCandidateReports(
  input: SelectGuildRankCandidateReportsInput,
): Promise<GuildRankReportCandidate[]> {
  const gameFamily = input.gameFamily ?? 'retail';
  const maxReports = toMaxReports(input.maxReports);

  const metadataRows = input.metadataReader
    ? await input.metadataReader.summarizeReports({
        guildName: input.guildName,
        guildServerSlug: input.guildServerSlug,
        guildServerRegion: input.guildServerRegion,
        gameFamily,
        startTimeMs: input.previousWindowStartMs,
        endTimeMs: input.currentWindowEndMs,
      })
    : [];

  const canonicalMetadataCandidates = toCanonicalCandidates({
    rows: metadataRows,
    source: 'mongo-index',
    ...(typeof input.zoneId === 'number' ? { zoneId: input.zoneId } : {}),
  });

  if (hasWindowCoverage(canonicalMetadataCandidates, input)) {
    return balanceCandidatesAcrossWindows(canonicalMetadataCandidates, input, maxReports);
  }

  const currentCandidateCount = canonicalMetadataCandidates.filter((candidate) =>
    isInCurrentWindow(candidate, input),
  ).length;
  const previousCandidateCount = canonicalMetadataCandidates.filter((candidate) =>
    isInPreviousWindow(candidate, input),
  ).length;
  const hasMetadataReader = Boolean(input.metadataReader);
  const fallbackReason = getFallbackReason({ hasMetadataReader, currentCandidateCount });

  logger.info(
    {
      guildName: input.guildName,
      guildServerSlug: input.guildServerSlug,
      guildServerRegion: input.guildServerRegion,
      gameFamily,
      currentCandidateCount,
      previousCandidateCount,
      metadataCandidateCount: canonicalMetadataCandidates.length,
      hasMetadataReader,
      fallbackReason,
    },
    'guildrank candidate selector fallback to live WCL',
  );

  const liveRows = await input.liveReportIndexFetcher({
    guildName: input.guildName,
    guildServerSlug: input.guildServerSlug,
    guildServerRegion: input.guildServerRegion,
    gameFamily,
    startTimeMs: input.previousWindowStartMs,
    endTimeMs: input.currentWindowEndMs,
    limit: maxReports,
  });

  const canonicalLiveCandidates = toCanonicalCandidates({
    rows: liveRows,
    source: 'live-wcl',
    ...(typeof input.zoneId === 'number' ? { zoneId: input.zoneId } : {}),
  });

  return balanceCandidatesAcrossWindows(canonicalLiveCandidates, input, maxReports);
}

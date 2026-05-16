import type { GameFamily } from '@wcl/domain';
import {
  GuildReportMetadataCursorModel,
  GuildReportMetadataModel,
} from '../models/guild-report-metadata-model.js';

export interface GuildReportMetadataScope {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
}

export interface GuildReportMetadataInputRow {
  reportCode: string;
  title?: string;
  owner?: string;
  zoneId?: number;
  startTime: number;
  endTime?: number;
}

export type GuildReportMetadataRecord = GuildReportMetadataScope &
  GuildReportMetadataInputRow & {
    indexedAt: Date;
  };

export type GuildReportMetadataCursor = GuildReportMetadataScope & {
  lastSeenStartTime: number;
  lastIndexedAt: Date;
};

export interface GuildReportMetadataSummaryReport {
  reportCode: string;
  title?: string;
  owner?: string;
  zoneId?: number;
  startTime: number;
  endTime?: number;
}

export interface GuildReportMetadataDuplicateWindow {
  startTime: number;
  endTime?: number;
  reportCount: number;
  reports: GuildReportMetadataSummaryReport[];
}

export interface GuildReportMetadataRaidNight {
  startTime: number;
  endTime?: number;
  reportCount: number;
  canonicalReport: GuildReportMetadataSummaryReport;
  reports: GuildReportMetadataSummaryReport[];
}

export interface GuildReportMetadataSummary {
  reportsIndexed: number;
  summarizedRows: number;
  latestReport?: GuildReportMetadataSummaryReport;
  raidNights: GuildReportMetadataRaidNight[];
  zonesSeen: Array<{ zoneId: number; reportCount: number }>;
  unknownZoneReportCount: number;
  likelyDuplicateWindows: GuildReportMetadataDuplicateWindow[];
}

export interface GuildReportMetadataUpsertResult {
  processedRows: number;
  upsertedRows: number;
  matchedRows: number;
  modifiedRows: number;
}

export interface GuildReportMetadataStore {
  upsertReports(input: {
    scope: GuildReportMetadataScope;
    reports: GuildReportMetadataInputRow[];
    indexedAt?: Date;
  }): Promise<GuildReportMetadataUpsertResult>;
  saveCursor(input: {
    scope: GuildReportMetadataScope;
    lastSeenStartTime: number;
    lastIndexedAt?: Date;
  }): Promise<GuildReportMetadataCursor>;
}

const normalizeServerSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '-');

const normalizeGuildName = (value: string): string => value.trim().toLowerCase();

const normalizeRegion = (value: string): string => value.trim().toLowerCase();

const normalizeScope = (scope: GuildReportMetadataScope): GuildReportMetadataScope => ({
  guildName: normalizeGuildName(scope.guildName),
  guildServerSlug: normalizeServerSlug(scope.guildServerSlug),
  guildServerRegion: normalizeRegion(scope.guildServerRegion),
  gameFamily: scope.gameFamily,
});

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const parseMetadataRecord = (value: unknown): GuildReportMetadataRecord | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const startTime = asFiniteNumber(raw.startTime);
  const zoneId = asFiniteNumber(raw.zoneId);
  const endTime = asFiniteNumber(raw.endTime);
  if (
    typeof raw.guildName !== 'string' ||
    typeof raw.guildServerSlug !== 'string' ||
    typeof raw.guildServerRegion !== 'string' ||
    (raw.gameFamily !== 'retail' && raw.gameFamily !== 'mop_classic') ||
    typeof raw.reportCode !== 'string' ||
    typeof startTime !== 'number' ||
    !(raw.indexedAt instanceof Date)
  ) {
    return null;
  }

  return {
    guildName: raw.guildName,
    guildServerSlug: raw.guildServerSlug,
    guildServerRegion: raw.guildServerRegion,
    gameFamily: raw.gameFamily,
    reportCode: raw.reportCode,
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.owner === 'string' ? { owner: raw.owner } : {}),
    ...(typeof zoneId === 'number' ? { zoneId } : {}),
    startTime,
    ...(typeof endTime === 'number' ? { endTime } : {}),
    indexedAt: raw.indexedAt,
  };
};

const parseCursor = (value: unknown): GuildReportMetadataCursor | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const lastSeenStartTime = asFiniteNumber(raw.lastSeenStartTime);
  if (
    typeof raw.guildName !== 'string' ||
    typeof raw.guildServerSlug !== 'string' ||
    typeof raw.guildServerRegion !== 'string' ||
    (raw.gameFamily !== 'retail' && raw.gameFamily !== 'mop_classic') ||
    typeof lastSeenStartTime !== 'number' ||
    !(raw.lastIndexedAt instanceof Date)
  ) {
    return null;
  }

  return {
    guildName: raw.guildName,
    guildServerSlug: raw.guildServerSlug,
    guildServerRegion: raw.guildServerRegion,
    gameFamily: raw.gameFamily,
    lastSeenStartTime,
    lastIndexedAt: raw.lastIndexedAt,
  };
};

const dedupeRows = (rows: GuildReportMetadataInputRow[]): GuildReportMetadataInputRow[] => {
  const rowsByCode = new Map<string, GuildReportMetadataInputRow>();
  for (const row of rows) {
    const reportCode = row.reportCode.trim();
    if (!reportCode || !Number.isFinite(row.startTime)) continue;
    rowsByCode.set(reportCode, { ...row, reportCode });
  }
  return [...rowsByCode.values()];
};

const toSummaryReport = (record: GuildReportMetadataRecord): GuildReportMetadataSummaryReport => ({
  reportCode: record.reportCode,
  ...(record.title ? { title: record.title } : {}),
  ...(record.owner ? { owner: record.owner } : {}),
  ...(typeof record.zoneId === 'number' ? { zoneId: record.zoneId } : {}),
  startTime: record.startTime,
  ...(typeof record.endTime === 'number' ? { endTime: record.endTime } : {}),
});

const summarizeZones = (
  reports: GuildReportMetadataSummaryReport[],
): {
  zonesSeen: Array<{ zoneId: number; reportCount: number }>;
  unknownZoneReportCount: number;
} => {
  let unknownZoneReportCount = 0;
  const countsByZone = new Map<number, number>();
  for (const report of reports) {
    if (typeof report.zoneId !== 'number') {
      unknownZoneReportCount += 1;
      continue;
    }
    countsByZone.set(report.zoneId, (countsByZone.get(report.zoneId) ?? 0) + 1);
  }

  return {
    zonesSeen: [...countsByZone.entries()]
      .map(([zoneId, reportCount]) => ({ zoneId, reportCount }))
      .sort((left, right) => right.reportCount - left.reportCount || left.zoneId - right.zoneId),
    unknownZoneReportCount,
  };
};

const summarizeDuplicateWindows = (
  raidNights: GuildReportMetadataRaidNight[],
): GuildReportMetadataDuplicateWindow[] => {
  return raidNights
    .filter((raidNight) => raidNight.reportCount > 1)
    .map((raidNight) => ({
      startTime: raidNight.startTime,
      ...(typeof raidNight.endTime === 'number' ? { endTime: raidNight.endTime } : {}),
      reportCount: raidNight.reportCount,
      reports: raidNight.reports,
    }));
};

const toReportEndTime = (report: GuildReportMetadataSummaryReport): number =>
  report.endTime ?? report.startTime;

const sortReportsByCanonicalOrder = (
  reports: GuildReportMetadataSummaryReport[],
): GuildReportMetadataSummaryReport[] =>
  [...reports].sort(
    (left, right) =>
      toReportEndTime(right) - toReportEndTime(left) ||
      left.reportCode.localeCompare(right.reportCode),
  );

const summarizeRaidNights = (
  reports: GuildReportMetadataSummaryReport[],
): GuildReportMetadataRaidNight[] => {
  const reportsByStartTime = new Map<number, GuildReportMetadataSummaryReport[]>();
  for (const report of reports) {
    const existing = reportsByStartTime.get(report.startTime) ?? [];
    existing.push(report);
    reportsByStartTime.set(report.startTime, existing);
  }

  return [...reportsByStartTime.entries()]
    .flatMap(([startTime, windowReports]) => {
      const sortedReports = sortReportsByCanonicalOrder(windowReports);
      const canonicalReport = sortedReports[0];
      if (!canonicalReport) return [];
      const endTimes = sortedReports
        .map((report) => report.endTime)
        .filter((value): value is number => typeof value === 'number');
      return [
        {
          startTime,
          ...(endTimes.length > 0 ? { endTime: Math.max(...endTimes) } : {}),
          reportCount: sortedReports.length,
          canonicalReport,
          reports: sortedReports,
        },
      ];
    })
    .sort((left, right) => right.startTime - left.startTime);
};

const toSummaryLimit = (value: number | undefined): number =>
  Math.min(Math.max(value ?? 500, 1), 500);

export class MongoGuildReportMetadataStore implements GuildReportMetadataStore {
  public async upsertReports(input: {
    scope: GuildReportMetadataScope;
    reports: GuildReportMetadataInputRow[];
    indexedAt?: Date;
  }): Promise<GuildReportMetadataUpsertResult> {
    const scope = normalizeScope(input.scope);
    const indexedAt = input.indexedAt ?? new Date();
    const reports = dedupeRows(input.reports);
    if (reports.length === 0) {
      return { processedRows: 0, upsertedRows: 0, matchedRows: 0, modifiedRows: 0 };
    }

    const result = await GuildReportMetadataModel.bulkWrite(
      reports.map((report) => ({
        updateOne: {
          filter: { ...scope, reportCode: report.reportCode },
          update: {
            $set: {
              ...scope,
              reportCode: report.reportCode,
              startTime: report.startTime,
              indexedAt,
              ...(report.title ? { title: report.title } : {}),
              ...(report.owner ? { owner: report.owner } : {}),
              ...(typeof report.zoneId === 'number' ? { zoneId: report.zoneId } : {}),
              ...(typeof report.endTime === 'number' ? { endTime: report.endTime } : {}),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    return {
      processedRows: reports.length,
      upsertedRows: result.upsertedCount,
      matchedRows: result.matchedCount,
      modifiedRows: result.modifiedCount,
    };
  }

  public async getCursor(
    scope: GuildReportMetadataScope,
  ): Promise<GuildReportMetadataCursor | null> {
    const found = await GuildReportMetadataCursorModel.findOne(normalizeScope(scope)).lean();
    return parseCursor(found);
  }

  public async saveCursor(input: {
    scope: GuildReportMetadataScope;
    lastSeenStartTime: number;
    lastIndexedAt?: Date;
  }): Promise<GuildReportMetadataCursor> {
    const scope = normalizeScope(input.scope);
    const saved = await GuildReportMetadataCursorModel.findOneAndUpdate(
      scope,
      {
        $set: {
          ...scope,
          lastSeenStartTime: input.lastSeenStartTime,
          lastIndexedAt: input.lastIndexedAt ?? new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    const parsed = parseCursor(saved);
    if (!parsed) throw new Error('Failed to persist guild report metadata cursor.');
    return parsed;
  }

  public async listReports(input: {
    scope: GuildReportMetadataScope;
    limit?: number;
  }): Promise<GuildReportMetadataRecord[]> {
    const found = await GuildReportMetadataModel.find(normalizeScope(input.scope))
      .sort({ startTime: -1 })
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
      .lean();
    return Array.isArray(found)
      ? found
          .map((doc) => parseMetadataRecord(doc))
          .filter((doc): doc is GuildReportMetadataRecord => doc !== null)
      : [];
  }

  public async summarizeReports(input: {
    scope: GuildReportMetadataScope;
    startTimeMs: number;
    endTimeMs: number;
    limit?: number;
  }): Promise<GuildReportMetadataSummary> {
    const scope = normalizeScope(input.scope);
    const filter = {
      ...scope,
      startTime: { $gte: Math.trunc(input.startTimeMs), $lte: Math.trunc(input.endTimeMs) },
    };
    const limit = toSummaryLimit(input.limit);
    const [reportsIndexed, found] = await Promise.all([
      GuildReportMetadataModel.countDocuments(filter),
      GuildReportMetadataModel.find(filter).sort({ startTime: -1 }).limit(limit).lean(),
    ]);
    const reports = Array.isArray(found)
      ? found
          .map((doc) => parseMetadataRecord(doc))
          .filter((doc): doc is GuildReportMetadataRecord => doc !== null)
          .map((doc) => toSummaryReport(doc))
      : [];
    const { zonesSeen, unknownZoneReportCount } = summarizeZones(reports);
    const raidNights = summarizeRaidNights(reports);

    return {
      reportsIndexed,
      summarizedRows: reports.length,
      ...(raidNights[0] ? { latestReport: raidNights[0].canonicalReport } : {}),
      raidNights,
      zonesSeen,
      unknownZoneReportCount,
      likelyDuplicateWindows: summarizeDuplicateWindows(raidNights),
    };
  }
}

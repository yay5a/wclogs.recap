import { parseFightSummaries } from '@wcl/domain';
import { asNumber, asObject } from './parsers/index.js';
import { getArchiveStatus, getReportNode } from './raw-report.js';

const SHORT_LIVED_REPORT_TTL_MS = 10 * 60 * 1000;
const IN_PROGRESS_REPORT_TTL_MS = 2 * 60 * 1000;
const INACCESSIBLE_REPORT_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_REPORT_WINDOW_MS = 6 * 60 * 60 * 1000;
export const RAW_PAYLOAD_VERSION = 5;
export const NORMALIZED_PAYLOAD_VERSION = 6;
type ReportCacheState = 'in_progress' | 'recent' | 'completed' | 'inaccessible';

const isWithinTtl = (fetchedAt: unknown, ttlMs: number): boolean => {
  if (!(fetchedAt instanceof Date)) return false;
  return Date.now() - fetchedAt.getTime() <= ttlMs;
};

const getReportCacheState = (rawPayload: unknown): ReportCacheState => {
  const enriched = asObject(rawPayload);
  const base = enriched?.base ?? rawPayload;
  const report = getReportNode(base);

  if (!report) {
    return 'inaccessible';
  }

  const zone = asObject(report.zone);
  if (zone && 'frozen' in zone && Boolean(zone.frozen)) {
    return 'completed';
  }

  const archiveStatus = getArchiveStatus(report);
  if (archiveStatus.isArchived && !archiveStatus.isAccessible) {
    return 'inaccessible';
  }

  const fights = parseFightSummaries(report);
  if (fights.some((fight) => fight.inProgress)) {
    return 'in_progress';
  }

  const endTime = asNumber(report.endTime);
  if (typeof endTime === 'number' && Date.now() - endTime <= RECENT_REPORT_WINDOW_MS) {
    return 'recent';
  }

  return 'completed';
};

export const shouldUseCachedReport = (cached: {
  rawPayload: unknown;
  fetchedAt?: Date;
}): boolean => {
  const enriched = asObject(cached.rawPayload);
  if (asNumber(enriched?.rawPayloadVersion) !== RAW_PAYLOAD_VERSION) {
    return false;
  }

  const state = getReportCacheState(cached.rawPayload);

  if (state === 'completed') {
    // Completed includes frozen zones; these are stable and safe to cache forever.
    return true;
  }

  if (state === 'in_progress') {
    return isWithinTtl(cached.fetchedAt, IN_PROGRESS_REPORT_TTL_MS);
  }

  if (state === 'recent') {
    return isWithinTtl(cached.fetchedAt, SHORT_LIVED_REPORT_TTL_MS);
  }

  return isWithinTtl(cached.fetchedAt, INACCESSIBLE_REPORT_TTL_MS);
};

export const shouldUseCachedNormalizedPayload = (cached: {
  normalizedPayloadVersion?: number;
}): boolean =>
  cached.normalizedPayloadVersion === NORMALIZED_PAYLOAD_VERSION &&
  process.env.WCL_BYPASS_CACHE !== 'true';

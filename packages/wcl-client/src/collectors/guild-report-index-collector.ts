import type { GameFamily } from '@wcl/domain';
import { asArray, asNumber, asObject, asString } from '../parsers/common.js';

const DEFAULT_WINDOW_SIZE_MS = 30 * 24 * 60 * 60 * 1000;

export interface GuildReportIndexInput {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily?: GameFamily;
  startTimeMs: number;
  endTimeMs: number;
  windowSizeMs?: number;
}

export interface GuildReportIndexCollectorInput extends GuildReportIndexInput {
  v1ClientKey: string;
  fetchImpl?: typeof fetch;
}

export interface GuildReportIndexRow {
  code: string;
  title?: string;
  owner?: string;
  zoneId?: number;
  startTime: number;
  endTime?: number;
}

export interface GuildReportIndexResult {
  rows: GuildReportIndexRow[];
  windowsQueried: number;
  complexity: {
    apiCalls: 'O(W)';
    parseAndDedupe: 'O(N)';
    memory: 'O(U)';
  };
}

const normalizeServerSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '-');

const normalizeRegion = (value: string): string => value.trim().toLowerCase();

const resolveV1Origin = (gameFamily?: GameFamily): string =>
  gameFamily === 'mop_classic'
    ? 'https://classic.warcraftlogs.com'
    : 'https://www.warcraftlogs.com';

const validateTimeWindow = (input: GuildReportIndexInput): void => {
  if (!Number.isFinite(input.startTimeMs) || !Number.isFinite(input.endTimeMs)) {
    throw new Error('Guild report index requires finite startTimeMs and endTimeMs values');
  }

  if (input.startTimeMs > input.endTimeMs) {
    throw new Error('Guild report index startTimeMs must be before endTimeMs');
  }

  if (
    input.windowSizeMs !== undefined &&
    (!Number.isFinite(input.windowSizeMs) || input.windowSizeMs < 1)
  ) {
    throw new Error('Guild report index windowSizeMs must be a positive number');
  }
};

const toWindows = (
  startTimeMs: number,
  endTimeMs: number,
  windowSizeMs: number,
): Array<{ startTimeMs: number; endTimeMs: number }> => {
  const windows: Array<{ startTimeMs: number; endTimeMs: number }> = [];
  let windowStart = Math.trunc(startTimeMs);
  const finalEnd = Math.trunc(endTimeMs);
  const size = Math.trunc(windowSizeMs);

  while (windowStart <= finalEnd) {
    const windowEnd = Math.min(windowStart + size - 1, finalEnd);
    windows.push({ startTimeMs: windowStart, endTimeMs: windowEnd });
    windowStart = windowEnd + 1;
  }

  return windows;
};

const buildGuildReportIndexUrl = (
  input: GuildReportIndexCollectorInput,
  window: { startTimeMs: number; endTimeMs: number },
): URL => {
  const url = new URL(
    `/v1/reports/guild/${encodeURIComponent(input.guildName)}/${encodeURIComponent(
      normalizeServerSlug(input.guildServerSlug),
    )}/${encodeURIComponent(normalizeRegion(input.guildServerRegion))}`,
    resolveV1Origin(input.gameFamily),
  );
  url.searchParams.set('start', String(window.startTimeMs));
  url.searchParams.set('end', String(window.endTimeMs));
  url.searchParams.set('api_key', input.v1ClientKey);
  return url;
};

const redactApiKey = (url: URL): string => {
  const redacted = new URL(url.toString());
  if (redacted.searchParams.has('api_key')) {
    redacted.searchParams.set('api_key', '[redacted]');
  }
  return redacted.toString();
};

const parseRows = (payload: unknown): GuildReportIndexRow[] =>
  (asArray(payload) ?? []).flatMap((value) => {
    const row = asObject(value);
    const code = asString(row?.id ?? row?.code);
    const startTime = asNumber(row?.start ?? row?.startTime);
    if (!code || typeof startTime !== 'number') return [];

    const title = asString(row?.title);
    const owner = asString(row?.owner);
    const zoneId = asNumber(row?.zone ?? row?.zoneId);
    const endTime = asNumber(row?.end ?? row?.endTime);

    return [
      {
        code,
        ...(title ? { title } : {}),
        ...(owner ? { owner } : {}),
        ...(typeof zoneId === 'number' ? { zoneId } : {}),
        startTime,
        ...(typeof endTime === 'number' ? { endTime } : {}),
      },
    ];
  });

const isInsideWindow = (
  row: GuildReportIndexRow,
  input: GuildReportIndexInput,
): boolean => row.startTime >= input.startTimeMs && row.startTime <= input.endTimeMs;

export const collectGuildReportIndex = async (
  input: GuildReportIndexCollectorInput,
): Promise<GuildReportIndexResult> => {
  validateTimeWindow(input);

  if (!input.v1ClientKey.trim()) {
    throw new Error('Guild report index requires WCL_V1_CLIENT_KEY');
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('Guild report index requires a fetch implementation');
  }

  const windows = toWindows(
    input.startTimeMs,
    input.endTimeMs,
    input.windowSizeMs ?? DEFAULT_WINDOW_SIZE_MS,
  );
  const rowsByCode = new Map<string, GuildReportIndexRow>();

  for (const window of windows) {
    const url = buildGuildReportIndexUrl(input, window);
    let response: Response;
    try {
      response = await fetchImpl(url.toString());
    } catch {
      throw new Error(`WCL v1 guild report index request failed for ${redactApiKey(url)}`);
    }

    if (!response.ok) {
      throw new Error(
        `WCL v1 guild report index request failed with ${response.status} ${response.statusText} for ${redactApiKey(url)}`,
      );
    }

    const payload: unknown = await response.json();
    for (const row of parseRows(payload)) {
      if (!isInsideWindow(row, input) || rowsByCode.has(row.code)) continue;
      rowsByCode.set(row.code, row);
    }
  }

  return {
    rows: [...rowsByCode.values()],
    windowsQueried: windows.length,
    complexity: {
      apiCalls: 'O(W)',
      parseAndDedupe: 'O(N)',
      memory: 'O(U)',
    },
  };
};

import type { WclGraphqlClient } from '../graphql-client.js';
import { createLogger, serializeError } from '@wcl/shared';
import { asArray, asNumber, asObject, asString } from '../parsers/common.js';
import type { GuildReportDiscoveryRow } from '../pipeline/types.js';

const logger = createLogger('wcl-client');

const GUILD_REPORT_DISCOVERY_QUERY = `
query GuildReportDiscovery(
  $guildName: String!
  $guildServerSlug: String!
  $guildServerRegion: String!
  $startTime: Float!
  $endTime: Float!
  $zoneID: Int!
  $limit: Int!
  $page: Int!
) {
  reportData {
    reports(
      guildName: $guildName
      guildServerSlug: $guildServerSlug
      guildServerRegion: $guildServerRegion
      startTime: $startTime
      endTime: $endTime
      zoneID: $zoneID
      limit: $limit
      page: $page
    ) {
      has_more_pages
      data {
        code
        startTime
        endTime
        zone {
          id
          name
        }
      }
    }
  }
}`;

const normalizeEndpointRegion = (value: string): string => value.trim().toUpperCase();

const parseV2Rows = (payload: unknown): GuildReportDiscoveryRow[] => {
  const data = asObject((payload as { data?: unknown })?.data);
  const reports = asObject(asObject(data?.reportData)?.reports);
  return (asArray(reports?.data) ?? []).flatMap((value) => {
    const row = asObject(value);
    const code = asString(row?.code);
    const startTime = asNumber(row?.startTime);
    if (!code || typeof startTime !== 'number') return [];
    const endTime = asNumber(row?.endTime);
    const zone = asObject(row?.zone);
    const zoneId = asNumber(zone?.id);
    const zoneName = asString(zone?.name);
    return [
      {
        code,
        startTime,
        ...(typeof endTime === 'number' ? { endTime } : {}),
        ...(typeof zoneId === 'number' ? { zoneId } : {}),
        ...(zoneName ? { zoneName } : {}),
      },
    ];
  });
};

const parseV1Rows = (payload: unknown): GuildReportDiscoveryRow[] => {
  const rows = asArray(payload);
  if (!rows) return [];
  return rows.flatMap((value) => {
    const row = asObject(value);
    const code = asString(row?.id ?? row?.code);
    const startTime = asNumber(row?.start ?? row?.startTime);
    if (!code || typeof startTime !== 'number') return [];
    const endTime = asNumber(row?.end ?? row?.endTime);
    const zoneId = asNumber(row?.zone);
    const zoneName = asString(row?.zoneName);
    return [
      {
        code,
        startTime,
        ...(typeof endTime === 'number' ? { endTime } : {}),
        ...(typeof zoneId === 'number' ? { zoneId } : {}),
        ...(zoneName ? { zoneName } : {}),
      },
    ];
  });
};

const filterRowsToWindow = (
  rows: GuildReportDiscoveryRow[],
  input: { startTimeMs: number; endTimeMs: number },
): GuildReportDiscoveryRow[] =>
  rows.filter((row) => row.startTime >= input.startTimeMs && row.startTime <= input.endTimeMs);

const toDebugRows = (rows: GuildReportDiscoveryRow[]) =>
  rows.map((row) => ({
    reportCode: row.code,
    startTime: row.startTime,
    ...(typeof row.endTime === 'number' ? { endTime: row.endTime } : {}),
    ...(typeof row.zoneId === 'number' ? { zoneId: row.zoneId } : {}),
    ...(row.zoneName ? { zoneName: row.zoneName } : {}),
  }));

export const collectGuildReportDiscovery = async (
  client: WclGraphqlClient,
  input: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    zoneId: number;
    startTimeMs: number;
    endTimeMs: number;
    fetchImpl?: typeof fetch;
  },
): Promise<{ rows: GuildReportDiscoveryRow[]; source: 'v2' | 'v1' | 'none' }> => {
  const guildServerSlug = input.guildServerSlug;
  const guildServerRegion = normalizeEndpointRegion(input.guildServerRegion);
  const debugBase = {
    guildName: input.guildName,
    configuredServerName: input.guildServerSlug,
    guildServerSlug,
    configuredRegion: input.guildServerRegion,
    guildServerRegion,
    zoneId: input.zoneId,
    startTimeMs: input.startTimeMs,
    endTimeMs: input.endTimeMs,
  };
  try {
    const queryVariables = {
      guildName: input.guildName,
      guildServerSlug,
      guildServerRegion,
      startTime: input.startTimeMs,
      endTime: input.endTimeMs,
      zoneID: input.zoneId,
      limit: 100,
      page: 1,
    };
    const payload = await client.request<Record<string, unknown>>(GUILD_REPORT_DISCOVERY_QUERY, queryVariables);
    const rawRows = parseV2Rows(payload);
    const rows = filterRowsToWindow(rawRows, input);
    logger.info(
      {
        ...debugBase,
        source: 'v2',
        rawDiscoveryQueryParameters: queryVariables,
        rawDiscoveredReportCount: rawRows.length,
        rawDiscoveredReports: toDebugRows(rawRows),
        timeWindowMatchedReportCount: rows.length,
      },
      'guildrank report discovery stage',
    );
    if (rows.length > 0) {
      return { rows, source: 'v2' };
    }
  } catch (error) {
    logger.info(
      { ...debugBase, source: 'v2', error: serializeError(error) },
      'guildrank report discovery stage failed',
    );
    // fall through to v1
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { rows: [], source: 'none' };

  try {
    const url = new URL(
      `https://www.warcraftlogs.com/v1/reports/guild/${encodeURIComponent(
        input.guildName,
      )}/${encodeURIComponent(guildServerSlug)}/${encodeURIComponent(guildServerRegion)}`,
    );
    url.searchParams.set('start', String(Math.trunc(input.startTimeMs)));
    url.searchParams.set('end', String(Math.trunc(input.endTimeMs)));
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      logger.info(
        {
          ...debugBase,
          source: 'v1',
          rawDiscoveryQueryParameters: {
            url: url.toString(),
            start: Math.trunc(input.startTimeMs),
            end: Math.trunc(input.endTimeMs),
          },
          status: response.status,
          statusText: response.statusText,
        },
        'guildrank report discovery stage failed',
      );
      return { rows: [], source: 'none' };
    }
    const payload = await response.json();
    const rawRows = parseV1Rows(payload);
    const rows = filterRowsToWindow(rawRows, input);
    logger.info(
      {
        ...debugBase,
        source: 'v1',
        rawDiscoveryQueryParameters: {
          url: url.toString(),
          start: Math.trunc(input.startTimeMs),
          end: Math.trunc(input.endTimeMs),
        },
        rawDiscoveredReportCount: rawRows.length,
        rawDiscoveredReports: toDebugRows(rawRows),
        timeWindowMatchedReportCount: rows.length,
      },
      'guildrank report discovery stage',
    );
    return { rows, source: 'v1' };
  } catch (error) {
    logger.info(
      { ...debugBase, source: 'v1', error: serializeError(error) },
      'guildrank report discovery stage failed',
    );
    return { rows: [], source: 'none' };
  }
};

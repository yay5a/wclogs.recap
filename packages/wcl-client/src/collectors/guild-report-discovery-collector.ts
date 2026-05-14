import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject, asString } from '../parsers/common.js';
import type { GuildReportDiscoveryRow } from '../pipeline/types.js';

const GUILD_REPORT_DISCOVERY_QUERY = `
query GuildReportDiscovery(
  $guildName: String!
  $guildServerSlug: String!
  $guildServerRegion: String!
  $startTime: Float!
  $endTime: Float!
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

const normalizeServerSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

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
  const guildServerSlug = normalizeServerSlug(input.guildServerSlug);
  const guildServerRegion = input.guildServerRegion.trim().toLowerCase();
  try {
    const payload = await client.request<Record<string, unknown>>(GUILD_REPORT_DISCOVERY_QUERY, {
      guildName: input.guildName,
      guildServerSlug,
      guildServerRegion,
      startTime: input.startTimeMs,
      endTime: input.endTimeMs,
      limit: 100,
      page: 1,
    });
    const rows = parseV2Rows(payload);
    if (rows.length > 0) {
      return { rows, source: 'v2' };
    }
  } catch {
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
    if (!response.ok) return { rows: [], source: 'none' };
    const payload = await response.json();
    return { rows: parseV1Rows(payload), source: 'v1' };
  } catch {
    return { rows: [], source: 'none' };
  }
};

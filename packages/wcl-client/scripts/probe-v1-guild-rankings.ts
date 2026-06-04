type JsonObject = Record<string, unknown>;

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...valueParts] = arg.slice(2).split('=');
      return [key, valueParts.join('=')];
    }),
);

const getArg = (name: string, fallback: string): string => args.get(name) || fallback;
const toInt = (value: string, name: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
};

const apiKey = process.env.WCL_V1_CLIENT_KEY;
const clientName = process.env.WCL_V1_CLIENT_NAME;
if (!apiKey || !clientName) {
  console.error('Missing WCL_V1_CLIENT_NAME or WCL_V1_CLIENT_KEY');
  process.exit(1);
}

const target = {
  guildId: toInt(getArg('guild-id', '802772'), 'guild-id'),
  guildName: getArg('guild-name', 'Shenanigans'),
  serverSlug: getArg('server', 'galakras'),
  region: getArg('region', 'US').toUpperCase(),
  zoneId: toInt(getArg('zone-id', '1046'), 'zone-id'),
  completeRaidZoneId: toInt(getArg('complete-zone-id', '1523'), 'complete-zone-id'),
  difficulty: getArg('difficulty', '4'),
  size: getArg('size', '10'),
  partition: getArg('partition', '4'),
  maxPages: toInt(getArg('max-pages', '20'), 'max-pages'),
};

const baseUrl = 'https://classic.warcraftlogs.com';

const asObject = (value: unknown): JsonObject | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const redactUrl = (url: URL): string => {
  const redacted = new URL(url);
  if (redacted.searchParams.has('api_key')) redacted.searchParams.set('api_key', 'REDACTED');
  return redacted.toString();
};

const getJson = async (path: string, params: Record<string, string> = {}) => {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep the text preview for non-JSON failures.
  }

  return {
    url: redactUrl(url),
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'unknown',
    payload,
  };
};

const findZone = (zones: unknown[], zoneId: number) =>
  zones.map(asObject).find((zone) => zone && zone.id === zoneId);

const encounterRows = (payload: unknown): JsonObject[] =>
  asArray(asObject(payload)?.rankings)
    .map(asObject)
    .filter((row): row is JsonObject => Boolean(row));

const rowMatchesGuild = (row: JsonObject): boolean =>
  row.guildID === target.guildId ||
  (typeof row.guildName === 'string' &&
    row.guildName.toLowerCase() === target.guildName.toLowerCase());

const publicRankFromPage = (page: number, rowIndex: number): number =>
  (page - 1) * 50 + rowIndex + 1;

const findGuildRanking = async (
  encounterId: number,
  metric: 'speed' | 'execution',
  scope: 'world' | 'region' | 'realm',
) => {
  const params: Record<string, string> = {
    metric,
    size: target.size,
    difficulty: target.difficulty,
    partition: target.partition,
  };
  if (scope === 'region' || scope === 'realm') params.region = target.region;
  if (scope === 'realm') params.server = target.serverSlug;

  let lastContentType = 'unknown';
  for (let page = 1; page <= target.maxPages; page += 1) {
    const result = await getJson(`/v1/rankings/encounter/${encounterId}`, {
      ...params,
      page: String(page),
    });
    lastContentType = result.contentType;
    const payload = asObject(result.payload);
    const rows = encounterRows(result.payload);
    const rowIndex = rows.findIndex(rowMatchesGuild);
    if (rowIndex >= 0) {
      const row = rows[rowIndex];
      return {
        endpoint: '/v1/rankings/encounter/{encounterID}',
        url: result.url,
        status: result.status,
        contentType: result.contentType,
        page,
        rowIndex,
        rankPosition: publicRankFromPage(page, rowIndex),
        hasMorePages: payload?.hasMorePages,
        rowKeys: Object.keys(row),
        row,
      };
    }
    if (payload?.hasMorePages !== true) {
      return {
        endpoint: '/v1/rankings/encounter/{encounterID}',
        url: result.url,
        status: result.status,
        contentType: result.contentType,
        notFound: true,
        pagesChecked: page,
      };
    }
  }

  return {
    endpoint: '/v1/rankings/encounter/{encounterID}',
    contentType: lastContentType,
    notFound: true,
    pagesChecked: target.maxPages,
  };
};

const probeUndocumentedGuildRoute = async (metric: 'speed' | 'execution') => {
  const result = await getJson(
    `/v1/rankings/guild-rankings-for-zone/${target.guildId}/${target.zoneId}`,
    {
      metric,
      size: target.size,
      difficulty: target.difficulty,
      partition: target.partition,
      timeframe: 'historical',
    },
  );
  const payload = asObject(result.payload);
  return {
    url: result.url,
    status: result.status,
    contentType: result.contentType,
    keys: payload ? Object.keys(payload) : undefined,
    message: typeof payload?.message === 'string' ? payload.message : undefined,
  };
};

const hasAggregatePercentFields = (value: unknown): boolean => {
  const text = JSON.stringify(value).toLowerCase();
  return (
    text.includes('bestperformanceaverage') ||
    text.includes('medianperformanceaverage') ||
    text.includes('allstars') ||
    text.includes('best avg') ||
    text.includes('median avg')
  );
};

const docs = await getJson('/v1/docsjson');
const spec = asObject(docs.payload);
const paths = asObject(spec?.paths);
const rankingPaths = paths
  ? Object.keys(paths).filter((path) => /ranking|parse|zone|guild/i.test(path))
  : [];

const zonesResult = await getJson('/v1/zones');
const zones = asArray(zonesResult.payload);
const zone = findZone(zones, target.zoneId);
const completeRaidZone = findZone(zones, target.completeRaidZoneId);
const encounters = asArray(asObject(zone)?.encounters)
  .map(asObject)
  .filter((row): row is JsonObject => Boolean(row));
const completeRaidEncounters = asArray(asObject(completeRaidZone)?.encounters)
  .map(asObject)
  .filter((row): row is JsonObject => Boolean(row));
const firstEncounterId = typeof encounters[0]?.id === 'number' ? encounters[0].id : undefined;
const completeRaidEncounterId =
  typeof completeRaidEncounters[0]?.id === 'number' ? completeRaidEncounters[0].id : undefined;

if (!firstEncounterId || !completeRaidEncounterId) {
  throw new Error('Could not resolve required encounter IDs from /v1/zones');
}

const speedComplete = {
  world: await findGuildRanking(completeRaidEncounterId, 'speed', 'world'),
  region: await findGuildRanking(completeRaidEncounterId, 'speed', 'region'),
  realm: await findGuildRanking(completeRaidEncounterId, 'speed', 'realm'),
};
const executionComplete = {
  world: await findGuildRanking(completeRaidEncounterId, 'execution', 'world'),
  region: await findGuildRanking(completeRaidEncounterId, 'execution', 'region'),
  realm: await findGuildRanking(completeRaidEncounterId, 'execution', 'realm'),
};
const speedFirstEncounter = {
  world: await findGuildRanking(firstEncounterId, 'speed', 'world'),
  region: await findGuildRanking(firstEncounterId, 'speed', 'region'),
  realm: await findGuildRanking(firstEncounterId, 'speed', 'realm'),
};
const executionFirstEncounter = {
  world: await findGuildRanking(firstEncounterId, 'execution', 'world'),
  region: await findGuildRanking(firstEncounterId, 'execution', 'region'),
  realm: await findGuildRanking(firstEncounterId, 'execution', 'realm'),
};

const output = {
  auth: {
    type: 'v1 api_key query parameter',
    clientName,
  },
  docs: {
    url: docs.url,
    status: docs.status,
    contentType: docs.contentType,
    swagger: spec?.swagger,
    host: spec?.host,
    basePath: spec?.basePath,
    rankingPaths,
  },
  target,
  zones: {
    zone: zone
      ? {
          id: zone.id,
          name: zone.name,
          encounters: encounters.map((encounter) => ({ id: encounter.id, name: encounter.name })),
        }
      : null,
    completeRaidZone: completeRaidZone
      ? {
          id: completeRaidZone.id,
          name: completeRaidZone.name,
          encounters: completeRaidEncounters.map((encounter) => ({
            id: encounter.id,
            name: encounter.name,
          })),
        }
      : null,
  },
  undocumentedGuildRouteCandidates: {
    speed: await probeUndocumentedGuildRoute('speed'),
    execution: await probeUndocumentedGuildRoute('execution'),
  },
  officialEncounterRankingRows: {
    completeRaid: {
      encounterId: completeRaidEncounterId,
      speed: speedComplete,
      execution: executionComplete,
    },
    firstEncounter: {
      encounterId: firstEncounterId,
      speed: speedFirstEncounter,
      execution: executionFirstEncounter,
    },
  },
  aggregatePercentFieldsFound: {
    speed:
      hasAggregatePercentFields(speedComplete) || hasAggregatePercentFields(speedFirstEncounter),
    execution:
      hasAggregatePercentFields(executionComplete) ||
      hasAggregatePercentFields(executionFirstEncounter),
    checkedFor: ['bestPerformanceAverage', 'medianPerformanceAverage', 'allStars'],
  },
  screenshotTargets: {
    speed: { bestAvgPercent: 52.0, medianAvgPercent: 36.4, allStars: 771 },
    execution: { bestAvgPercent: 69.4, medianAvgPercent: 24.1, allStars: 1222 },
  },
};

console.log(JSON.stringify(output, null, 2));

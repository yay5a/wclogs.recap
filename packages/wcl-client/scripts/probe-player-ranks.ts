import type { GameFamily } from '@wcl/domain';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WclGraphqlClient } from '../src/graphql-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';
import { parseReportUrl } from '../src/report-code.js';
import { collectReportIndex } from '../src/collectors/report-index-collector.js';
import { collectMasterData } from '../src/collectors/master-data-collector.js';
import { asNumber, asObject, asString } from '../src/parsers/common.js';

type JsonObject = Record<string, unknown>;

type ProbeMetric = 'dps' | 'hps';

type ProbeMetricSelection = ProbeMetric | 'both';

type ProbeTarget = {
  reportInput: string;
  metrics: ProbeMetric[];
  region: string;
  fallbackServer?: string;
  zoneIdOverride?: number;
  encounterId?: number;
  maxPlayers: number;
};

type PlayerCandidate = {
  actorId?: number;
  characterName: string;
  serverName: string;
  serverRegion: string;
  className?: string;
};

type PlayerRankProbeResult = {
  player: PlayerCandidate;
  requests: {
    endpoint: string;
    url: string;
    metric: ProbeMetric;
    zoneId?: number;
    encounterId?: number;
  };
  response: {
    status: number;
    contentType: string;
    rowCount: number;
    currentReportRowCount: number;
    baselineRowCount: number;
    // rowKeys: string[];
    baselineRows: unknown[];
    specCounts: Record<string, number>;
    // sampleRows: unknown[];
    currentReportRows: unknown[];
  };
};

type PlayerComparisonCoverageRow = {
  characterName: string;
  className?: string;
  metric: ProbeMetric;
  rowCount: number;
  currentReportRowCount: number;
  baselineRowCount: number;
};

type PlayerComparisonCoverage = {
  actorCount: number;
  playerCandidateCount: number;
  requestCount: number;
  nonEmptyResultCount: number;
  comparableCurrentRowCount: number;
  unmatchedCurrentRowCount: number;
  rows: PlayerComparisonCoverageRow[];
};

type PlayerComparisonRow = {
  characterName: string;
  className?: string;
  metric: ProbeMetric;
  encounterID?: number;
  encounterName?: string;
  difficulty?: number;
  spec?: string;
  currentPercentile?: number;
  matchedBaselineCount: number;
  comparable: boolean;
  baselineAveragePercentile?: number;
  delta?: number;
  unmatchedReason?: string;
};

type ComparablePlayerComparisonRow = PlayerComparisonRow & {
  delta: number;
};

type PlayerDeltaConfidence = 'high' | 'medium' | 'low';

type PlayerDeltaSummaryRow = {
  characterName: string;
  className?: string;
  metric: ProbeMetric;
  averageDelta: number;
  comparedRows: number;
  confidence: PlayerDeltaConfidence;
};

type PlayerComparisonSummary = {
  reportCode: string;
  zoneId: number | null;
  metric: ProbeMetricSelection;
  coverage: PlayerComparisonCoverage;
  playerDeltaSummary: PlayerDeltaSummaryRow[];
  topImprovementRows: ComparablePlayerComparisonRow[];
  topRegressionRows: ComparablePlayerComparisonRow[];
};

type BuildPlayerComparisonSummaryInput = {
  reportCode: string;
  zoneId: number | null;
  metric: ProbeMetricSelection;
  actorCount: number;
  playerCandidateCount: number;
  rankResults: PlayerRankProbeResult[];
};

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const args = new Map<string, string>(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg): [string, string] => {
      const [key = '', ...valueParts] = arg.slice(2).split('=');
      return [key, valueParts.join('=')];
    }),
);

// const getArg = (name: string, fallback: string): string => args.get(name) || fallback;
const toInt = (value: string, name: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
};

const [reportInput] = process.argv.slice(2);

if (!reportInput) {
  console.error(
    'Usage: pnpm --filter @wcl/wcl-client exec tsx scripts/probe-report-brez-events.ts <reportUrl>',
  );
  process.exit(1);
}

const trimmedReportInput = reportInput.trim();

const parsed = /^[A-Za-z0-9]+$/.test(trimmedReportInput)
  ? { reportCode: trimmedReportInput, gameFamily: 'retail' as const, rawUrl: trimmedReportInput }
  : parseReportUrl(trimmedReportInput);

const isProbeMetric = (value: string): value is ProbeMetric => value === 'dps' || value === 'hps';

const parseMetrics = (value: string | undefined): ProbeMetric[] => {
  const raw = value?.trim().toLowerCase();

  if (!raw || raw === 'both') {
    return ['dps', 'hps'];
  }

  const metrics = raw
    .split(',')
    .map((metric) => metric.trim())
    .filter((metric) => metric.length > 0);

  const parsedMetrics: ProbeMetric[] = [];

  for (const metric of metrics) {
    if (!isProbeMetric(metric)) {
      throw new Error('--metric must by dps, hps, or both');
    }
    parsedMetrics.push(metric);
  }

  return [...new Set(parsedMetrics)];
};

const buildTarget = (args: Map<string, string>, reportInput: string): ProbeTarget => {
  const region = (args.get('region') ?? 'us').trim().toLowerCase();
  const fallbackServer = args.get('server')?.trim();
  const zoneIdRaw = args.get('zone-id')?.trim();
  const encounterIdRaw = args.get('encounter-id')?.trim();
  const maxPlayers = toInt(args.get('max-players') ?? '10', 'max-players');

  if (maxPlayers < 1) {
    throw new Error('--max-players must be at least 1');
  }

  return {
    reportInput,
    metrics: parseMetrics(args.get('metric')),
    region,
    maxPlayers,
    ...(fallbackServer ? { fallbackServer } : {}),
    ...(zoneIdRaw ? { zoneId: toInt(zoneIdRaw, 'zone-id') } : {}),
    ...(encounterIdRaw ? { encounterId: toInt(encounterIdRaw, 'encounter-id') } : {}),
  };
};

const target = buildTarget(args, reportInput);

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const clientToken = process.env.WCL_OAUTH_CLIENT_TOKEN;

const toProbeApiBaseUrl = (apiBaseUrl: string, gameFamily: GameFamily): string => {
  if (gameFamily !== 'mop_classic') return apiBaseUrl;

  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname === 'www.warcraftlogs.com') {
      url.hostname = 'classic.warcraftlogs.com';
      return url.toString();
    }
  } catch {
    return apiBaseUrl;
  }

  return apiBaseUrl;
};

const defaultApiUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';
const apiBaseUrl = toProbeApiBaseUrl(defaultApiUrl, parsed.gameFamily);

let publicClientAuth;
try {
  publicClientAuth = resolveWclPublicClientAuth({ clientId, clientSecret, clientToken });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Missing WCL public client auth');
  process.exit(1);
}

const apiKey = process.env.WCL_V1_CLIENT_KEY;
const clientName = process.env.WCL_V1_CLIENT_NAME;
if (!apiKey || !clientName) {
  console.error('Missing WCL_V1_CLIENT_NAME or WCL_V1_CLIENT_KEY');
  process.exit(1);
}

const baseUrl = 'https://classic.warcraftlogs.com';

const redactUrl = (url: URL): string => {
  const redacted = new URL(url);
  if (redacted.searchParams.has('api_key')) {
    redacted.searchParams.set('api_key', 'REDACTED');
  }
  return redacted.toString();
};

const getJson = async (path: string, params: Record<string, string> = {}) => {
  const url = new URL(path, baseUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();

  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep raw text when WCL returns non-JSON
  }

  return {
    url: redactUrl(url),
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'unknown',
    payload,
  };
};

const client = new WclGraphqlClient({
  publicClientAuth,
  apiBaseUrl,
});

const index = await collectReportIndex(client, {
  sourceUrl: parsed.rawUrl,
  reportCode: parsed.reportCode,
  gameFamily: parsed.gameFamily,
});

const effectiveZoneId = target.zoneIdOverride ?? index.zoneId;

const masterData = await collectMasterData(client, {
  reportCode: parsed.reportCode,
});

const normalizeServerSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '-');

const buildPlayerCandidates = (
  masterData: { actors: Array<{ id?: number; name: string; className?: string; server?: string }> },
  target: ProbeTarget,
): PlayerCandidate[] => {
  const seen = new Set<string>();
  const candidates: PlayerCandidate[] = [];

  for (const actor of masterData.actors) {
    const characterName = actor.name.trim();
    const rawServerName = actor.server?.trim() || target.fallbackServer?.trim();
    const serverRegion = target.region.trim().toLowerCase();

    if (!characterName) continue;
    if (!rawServerName) continue;

    //   if (!serverName) continue;
    const serverName = normalizeServerSlug(rawServerName);
    const dedupekey = `${characterName.toLowerCase()}:${serverName.toLowerCase()}:${serverRegion}`;

    if (seen.has(dedupekey)) continue;
    seen.add(dedupekey);

    candidates.push({
      ...(typeof actor.id === 'number' ? { actorId: actor.id } : {}),
      characterName,
      serverName,
      serverRegion,
      ...(actor.className ? { className: actor.className } : {}),
    });
  }
  return candidates
    .sort((left, right) => left.characterName.localeCompare(right.characterName))
    .slice(0, target.maxPlayers);
};

const sampleKey = (row: JsonObject, metric: ProbeMetric): string | undefined => {
  const characterID = asNumber(row.characterID);
  const encounterID = asNumber(row.encounterID);
  const spec = asString(row.spec);
  const difficulty = asNumber(row.difficulty);
  const size = asNumber(row.size);

  if (
    typeof characterID !== 'number' ||
    typeof encounterID !== 'number' ||
    !spec ||
    typeof difficulty !== 'number' ||
    typeof size !== 'number'
  ) {
    return undefined;
  }

  return [characterID, metric, encounterID, spec, difficulty, size].join(':');
};

const getPlayerDeltaConfidence = (comparedRows: number): PlayerDeltaConfidence => {
  if (comparedRows >= 8) return 'high';
  if (comparedRows >= 4) return 'medium';
  return 'low';
};

const getRequestedMetric = (metrics: ProbeMetric[]): ProbeMetricSelection =>
  metrics.length === 1 ? metrics[0] : 'both';

const summarizeRankingRow = (value: unknown): JsonObject | undefined => {
  const row = asObject(value);
  if (!row) return undefined;

  return {
    ...(typeof asNumber(row.encounterID) === 'number'
      ? { encounterID: asNumber(row.encounterID) }
      : {}),
    ...(asString(row.encounterName) ? { encounterName: asString(row.encounterName) } : {}),
    ...(asString(row.class) ? { class: asString(row.class) } : {}),
    ...(asString(row.spec) ? { spec: asString(row.spec) } : {}),
    ...(typeof asNumber(row.rank) === 'number' ? { rank: asNumber(row.rank) } : {}),
    ...(typeof asNumber(row.outOf) === 'number' ? { outOf: asNumber(row.outOf) } : {}),
    ...(typeof asNumber(row.duration) === 'number' ? { duration: asNumber(row.duration) } : {}),
    ...(typeof asNumber(row.startTime) === 'number' ? { startTime: asNumber(row.startTime) } : {}),
    ...(asString(row.reportID) ? { reportID: asString(row.reportID) } : {}),
    ...(typeof asNumber(row.fightID) === 'number' ? { fightID: asNumber(row.fightID) } : {}),
    ...(typeof asNumber(row.difficulty) === 'number'
      ? { difficulty: asNumber(row.difficulty) }
      : {}),
    ...(typeof asNumber(row.size) === 'number' ? { size: asNumber(row.size) } : {}),
    ...(typeof asNumber(row.characterID) === 'number'
      ? { characterID: asNumber(row.characterID) }
      : {}),
    ...(asString(row.characterName) ? { characterName: asString(row.characterName) } : {}),
    ...(asString(row.server) ? { server: asString(row.server) } : {}),
    ...(typeof asNumber(row.percentile) === 'number'
      ? { percentile: asNumber(row.percentile) }
      : {}),
    ...(typeof asNumber(row.ilvlKeyOrPatch) === 'number'
      ? { ilvlKeyOrPatch: asNumber(row.ilvlKeyOrPatch) }
      : {}),
    ...(typeof asNumber(row.total) === 'number' ? { total: asNumber(row.total) } : {}),
    ...(typeof row.estimated === 'boolean' ? { estimated: row.estimated } : {}),
  };
};

const fetchPlayerRankings = async (
  player: PlayerCandidate,
  metric: ProbeMetric,
  target: ProbeTarget,
  effectiveZoneId: number | undefined,
  currentReportCode: string,
): Promise<PlayerRankProbeResult> => {
  const path = `/v1/parses/character/${encodeURIComponent(
    player.characterName,
  )}/${encodeURIComponent(player.serverName)}/${encodeURIComponent(player.serverRegion)}`;

  const params: Record<string, string> = {
    metric,
    timeframe: 'historical',
    includeCombatantInfo: 'false',
  };

  if (typeof effectiveZoneId === 'number') {
    params.zone = String(effectiveZoneId);
  }

  if (typeof target.encounterId === 'number') {
    params.encounter = String(target.encounterId);
  }

  const result = await getJson(path, params);
  const rows = Array.isArray(result.payload) ? result.payload : [];
  // const firstRow = asObject(rows[0]);

  const currentReportRows = rows.flatMap((value) => {
    const row = asObject(value);
    if (!row) return [];

    const reportID = asString(row.reportID);
    if (reportID !== currentReportCode) return [];

    const summary = summarizeRankingRow(row);
    return summary ? [summary] : [];
  });

  const baselineRows = rows.flatMap((value) => {
    const row = asObject(value);
    if (!row) return [];

    const reportID = asString(row.reportID);
    if (reportID === currentReportCode) return [];

    const summary = summarizeRankingRow(row);
    return summary ? [summary] : [];
  });

  const specCounts = rows.reduce<Record<string, number>>((counts, value) => {
    const row = asObject(value);
    const spec = asString(row?.spec) ?? 'unknown';

    counts[spec] = (counts[spec] ?? 0) + 1;
    return counts;
  }, {});

  return {
    player,
    requests: {
      endpoint: '/v1/parses/character/{characterName}/{serverName}/{serverRegion}',
      url: result.url,
      metric,
      ...(typeof effectiveZoneId === 'number' ? { zoneId: effectiveZoneId } : {}),
      ...(typeof target.encounterId === 'number' ? { encounterId: target.encounterId } : {}),
    },
    response: {
      status: result.status,
      contentType: result.contentType,
      rowCount: rows.length,
      baselineRowCount: baselineRows.length,
      currentReportRowCount: currentReportRows.length,
      currentReportRows,
      baselineRows,
      //  rowKeys: firstRow ? Object.keys(firstRow) : [],
      specCounts,
      // sampleRows: rows.slice(0, 5).flatMap((row) => {
      // const summary = summarizeRankingRow(row);
      // return summary ? [summary] : [];
      //}),
    },
  };
};

const buildPlayerComparisonSummary = ({
  reportCode,
  zoneId,
  metric,
  actorCount,
  playerCandidateCount,
  rankResults,
}: BuildPlayerComparisonSummaryInput): PlayerComparisonSummary => {
  const coverageRows = rankResults.map((result) => ({
    characterName: result.player.characterName,
    ...(result.player.className ? { className: result.player.className } : {}),
    metric: result.requests.metric,
    rowCount: result.response.rowCount,
    currentReportRowCount: result.response.currentReportRowCount,
    baselineRowCount: result.response.baselineRowCount,
  }));

  const comparisonRows = rankResults.flatMap((result) =>
    result.response.currentReportRows.flatMap((value): PlayerComparisonRow[] => {
      const currentRow = asObject(value);
      if (!currentRow) return [];

      const currentKey = sampleKey(currentRow, result.requests.metric);

      const matchedBaselineRows =
        currentKey === undefined
          ? []
          : result.response.baselineRows.flatMap((baselineValue) => {
              const baselineRow = asObject(baselineValue);
              if (!baselineRow) return [];

              const baselineKey = sampleKey(baselineRow, result.requests.metric);
              return baselineKey === currentKey ? [baselineRow] : [];
            });

      const baselineAveragePercentile =
        matchedBaselineRows.length > 0
          ? matchedBaselineRows.reduce((sum, baselineRow) => {
              const percentile = asNumber(baselineRow.percentile) ?? 0;
              return sum + percentile;
            }, 0) / matchedBaselineRows.length
          : undefined;

      const currentPercentile = asNumber(currentRow.percentile);
      const encounterID = asNumber(currentRow.encounterID);
      const encounterName = asString(currentRow.encounterName);
      const difficulty = asNumber(currentRow.difficulty);
      const spec = asString(currentRow.spec);

      return [
        {
          characterName: result.player.characterName,
          ...(result.player.className ? { className: result.player.className } : {}),
          metric: result.requests.metric,

          ...(typeof encounterID === 'number' ? { encounterID } : {}),
          ...(encounterName ? { encounterName } : {}),
          ...(typeof difficulty === 'number' ? { difficulty } : {}),
          ...(spec ? { spec } : {}),
          ...(typeof currentPercentile === 'number' ? { currentPercentile } : {}),

          matchedBaselineCount: matchedBaselineRows.length,
          comparable: matchedBaselineRows.length > 0,

          ...(typeof baselineAveragePercentile === 'number' ? { baselineAveragePercentile } : {}),
          ...(typeof baselineAveragePercentile === 'number' && typeof currentPercentile === 'number'
            ? { delta: currentPercentile - baselineAveragePercentile }
            : {}),
          ...(matchedBaselineRows.length === 0 ? { unmatchedReason: 'no exact baseline' } : {}),
        },
      ];
    }),
  );

  const comparableRows = comparisonRows.flatMap((row): ComparablePlayerComparisonRow[] => {
    if (!row.comparable) return [];
    if (typeof row.delta !== 'number') return [];

    return [{ ...row, delta: row.delta }];
  });

  const topImprovementRows = [...comparableRows]
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 10);

  const topRegressionRows = [...comparableRows]
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 10);

  const averageDeltaByPlayer = new Map<
    string,
    {
      characterName: string;
      className?: string;
      metric: ProbeMetric;
      totalDelta: number;
      rowCount: number;
    }
  >();

  for (const row of comparableRows) {
    const key = `${row.characterName}:${row.metric}`;
    const existing = averageDeltaByPlayer.get(key);

    if (existing) {
      existing.totalDelta += row.delta;
      existing.rowCount += 1;
    } else {
      averageDeltaByPlayer.set(key, {
        characterName: row.characterName,
        ...(row.className ? { className: row.className } : {}),
        metric: row.metric,
        totalDelta: row.delta,
        rowCount: 1,
      });
    }
  }

  const playerDeltaSummary = [...averageDeltaByPlayer.values()]
    .map((row) => ({
      characterName: row.characterName,
      ...(row.className ? { className: row.className } : {}),
      metric: row.metric,
      averageDelta: row.totalDelta / row.rowCount,
      comparedRows: row.rowCount,
      confidence: getPlayerDeltaConfidence(row.rowCount),
    }))
    .sort((left, right) => right.averageDelta - left.averageDelta);

  return {
    reportCode,
    zoneId,
    metric,
    coverage: {
      actorCount,
      playerCandidateCount,
      requestCount: rankResults.length,
      nonEmptyResultCount: rankResults.filter((result) => result.response.rowCount > 0).length,
      comparableCurrentRowCount: comparisonRows.filter((row) => row.comparable).length,
      unmatchedCurrentRowCount: comparisonRows.filter((row) => !row.comparable).length,
      rows: coverageRows,
    },
    playerDeltaSummary,
    topImprovementRows,
    topRegressionRows,
  };
};

const playerCandidates = buildPlayerCandidates(masterData, target);

const rankResults: PlayerRankProbeResult[] = [];

/*
const rankResultSummary = rankResults.map((result) => ({
  characterName: result.player.characterName,
  className: result.player.className,
  metric: result.requests.metric,
  status: result.response.status,
  rowCount: result.response.rowCount,
  specCounts: result.response.specCounts,
}));
*/

for (const player of playerCandidates) {
  for (const metric of target.metrics) {
    rankResults.push(
      await fetchPlayerRankings(player, metric, target, effectiveZoneId, parsed.reportCode),
    );
  }
}

const comparisonSummary = buildPlayerComparisonSummary({
  reportCode: parsed.reportCode,
  zoneId: effectiveZoneId ?? null,
  metric: getRequestedMetric(target.metrics),
  actorCount: masterData.actors.length,
  playerCandidateCount: playerCandidates.length,
  rankResults,
});

console.log(JSON.stringify(comparisonSummary, null, 2));

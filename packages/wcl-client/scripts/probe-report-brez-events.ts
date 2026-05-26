import type { GameFamily } from '@wcl/domain';
import { WclGraphqlClient } from '../src/graphql-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';
import { parseReportUrl } from '../src/report-code.js';
import { collectReportIndex } from '../src/collectors/report-index-collector.js';
import { collectMasterData } from '../src/collectors/master-data-collector.js';
import { asArray, asNumber, asObject, asString } from '../src/parsers/common.js';
import { parseBrezSummary } from '../src/parsers/brez-parser.js';

// Battle-Rez Events schema
const REPORT_BREZ_EVENTS_QUERY = `
query ReportBrezEventsPage(
  $code: String!
  $allowUnlisted: Boolean!
  $fightIDs: [Int]
  $limit: Int
  $filterExpression: String
) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      events(
        fightIDs: $fightIDs
        limit: $limit
        dataType: All
        filterExpression: $filterExpression
        translate: false
        useActorIDs: true
        useAbilityIDs: true
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}
`;

const REPORT_ABILITY_MASTER_DATA_QUERY = `
query ReportAbilityMasterData($code: String!, $allowUnlisted: Boolean!) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      masterData {
        abilities {
          gameID
          name 
          type
        }
      }
    }
  }
}
`;

// Battle-Rez filter
const BREZ_FILTER_EXPRESSION = `
(
  type = "death"
  AND target.type = "player"
  AND feign != true
)
OR
(
  source.type = "player"
  AND type IN ("cast", "resurrect")
  AND ability.name IN ("Rebirth", "Raise Ally", "Soulstone")
)
`;

const formatReportTimestamp = (timestampMs: number): string => {
  const totalSeconds = Math.floor(timestampMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
};

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

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const clientToken = process.env.WCL_OAUTH_CLIENT_TOKEN;
const defaultApiUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';
const apiBaseUrl = toProbeApiBaseUrl(defaultApiUrl, parsed.gameFamily);

let publicClientAuth;
try {
  publicClientAuth = resolveWclPublicClientAuth({ clientId, clientSecret, clientToken });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Missing WCL public client auth');
  process.exit(1);
}

// Helper to parse abilities
const getAbilityRows = (payload: unknown): unknown[] => {
  const root = asObject(payload);
  const data = asObject(root?.data);
  const reportData = asObject(data?.reportData ?? root?.reportData);
  const report = asObject(reportData?.report);
  const masterData = asObject(report?.masterData);
  return asArray(masterData?.abilities) ?? [];
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

const masterData = await collectMasterData(client, {
  reportCode: parsed.reportCode,
});

// Variables object shape
const variables = {
  code: parsed.reportCode,
  allowUnlisted: true,
  fightIDs: index.completedBossFights.map((fight) => fight.id),
  limit: 1000,
  filterExpression: BREZ_FILTER_EXPRESSION,
};

// Helpers to parse event payload
const getEventNode = (payload: unknown): Record<string, unknown> | undefined => {
  const root = asObject(payload);
  const data = asObject(root?.data);
  const reportData = asObject(data?.reportData ?? root?.reportData);
  const report = asObject(reportData?.report);
  return asObject(report?.events);
};

const getEventRows = (eventsNode: unknown): unknown[] => {
  const node = asObject(eventsNode);
  return asArray(node?.data) ?? [];
};

const payload = await client.request<Record<string, unknown>>(REPORT_BREZ_EVENTS_QUERY, variables);
const abilityPayload = await client.request<Record<string, unknown>>(
  REPORT_ABILITY_MASTER_DATA_QUERY,
  {
    code: parsed.reportCode,
    allowUnlisted: true,
  },
);

const eventsNode = getEventNode(payload);
const rows = getEventRows(eventsNode);
const firstRow = asObject(rows[0]);
const nextPageTimestamp = asNumber(asObject(eventsNode)?.nextPageTimestamp);

const brezSummary = parseBrezSummary(rows, masterData.actors);

const summarizeEvent = (event: unknown): Record<string, unknown> | undefined => {
  const row = asObject(event);
  if (!row) return undefined;

  const ability = asObject(row.ability);

  return {
    type: asString(row.type),
    timestamp: asNumber(row.timestamp),
    sourceID: asNumber(row.sourceID),
    targetID: asNumber(row.targetID),
    abilityName: asString(ability?.name),
  };
};

type ProbeMatchEvent = {
  type: string;
  timestamp: number;
  fight: number;
  targetID: number;
  sourceID?: number;
  abilityGameID?: number;
};

const toMatchEvent = (event: unknown): ProbeMatchEvent | undefined => {
  const row = asObject(event);
  if (!row) return undefined;

  const type = asString(row.type);
  const timestamp = asNumber(row.timestamp);
  const fight = asNumber(row.fight);
  const targetID = asNumber(row.targetID);

  if (
    !type ||
    typeof timestamp !== 'number' ||
    typeof fight !== 'number' ||
    typeof targetID !== 'number'
  ) {
    return undefined;
  }

  const sourceID = asNumber(row.sourceID);
  const abilityGameID = asNumber(row.abilityGameID);

  return {
    type,
    timestamp,
    fight,
    targetID,
    ...(typeof sourceID === 'number' ? { sourceID } : {}),
    ...(typeof abilityGameID === 'number' ? { abilityGameID } : {}),
  };
};

const matchEvents = rows.flatMap((event) => {
  const parsedEvent = toMatchEvent(event);
  return parsedEvent ? [parsedEvent] : [];
});
const deathRows = matchEvents.filter((event) => event.type === 'death');
const resurrectRows = matchEvents.filter((event) => event.type === 'resurrect');

const deathKey = (event: Pick<ProbeMatchEvent, 'fight' | 'targetID'>): string =>
  `${event.fight}:${event.targetID}`;

const deathsByFightAndTarget = new Map<string, ProbeMatchEvent[]>();

for (const death of deathRows) {
  const key = deathKey(death);
  const deaths = deathsByFightAndTarget.get(key);

  if (deaths) {
    deaths.push(death);
  } else {
    deathsByFightAndTarget.set(key, [death]);
  }
}

const playerNameById = new Map<number, string>();
for (const actor of masterData.actors) {
  if (typeof actor.id === 'number') {
    playerNameById.set(actor.id, actor.name);
  }
}

const getPlayerName = (actorId: number | undefined): string | undefined =>
  typeof actorId === 'number' ? playerNameById.get(actorId) : undefined;

const abilityNameByGameId = new Map<number, string>();
for (const ability of getAbilityRows(abilityPayload)) {
  const row = asObject(ability);
  const gameID = asNumber(row?.gameID);
  const name = asString(row?.name);

  if (typeof gameID === 'number' && name) {
    abilityNameByGameId.set(gameID, name);
  }
}

const getAbilityName = (abilityGameID: number | undefined): string | undefined =>
  typeof abilityGameID === 'number' ? abilityNameByGameId.get(abilityGameID) : undefined;

const soulstoneRows = rows.filter((event) => {
  const row = asObject(event);
  return asNumber(row?.abilityGameID) === 20707;
});

const soulstoneSamples = soulstoneRows.map((event) => {
  const row = asObject(event);
  const sourceID = asNumber(row?.sourceID);
  const targetID = asNumber(row?.targetID);
  const abilityGameID = asNumber(row?.abilityGameID);

  return {
    timestamp: asNumber(row?.timestamp),
    type: asString(row?.type),
    fight: asNumber(row?.fight),
    sourceID,
    sourceName: getPlayerName(sourceID),
    targetID,
    targetName: getPlayerName(targetID),
    abilityGameID,
    abilityName: getAbilityName(abilityGameID),
  };
});

const candidateMatches = resurrectRows.flatMap((resurrect) => {
  const abilityName = getAbilityName(resurrect.abilityGameID);
  const deaths = deathsByFightAndTarget.get(deathKey(resurrect)) ?? [];
  let latestDeath: ProbeMatchEvent | undefined;
  const targetName = getPlayerName(resurrect.targetID);
  const casterName = getPlayerName(resurrect.sourceID);

  for (const death of deaths) {
    if (death.timestamp >= resurrect.timestamp) continue;
    if (!latestDeath || death.timestamp > latestDeath.timestamp) {
      latestDeath = death;
    }
  }
  if (!latestDeath) return [];
  const responseMs = resurrect.timestamp - latestDeath.timestamp;

  return [
    {
      fight: resurrect.fight,
      targetID: resurrect.targetID,
      ...(targetName ? { targetName } : {}),
      deathTime: formatReportTimestamp(latestDeath.timestamp),
      resurrectTime: formatReportTimestamp(resurrect.timestamp),
      responseSec: responseMs / 1000,
      sourceID: resurrect.sourceID,
      ...(casterName ? { casterName } : {}),
      abilityGameID: resurrect.abilityGameID,
      ...(abilityName ? { abilityName } : {}),
    },
  ];
});

const eventTypeCounts = rows.reduce<Record<string, number>>((counts, event) => {
  const row = asObject(event);
  const type = asString(row?.type) ?? 'unknown';
  counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}, {});

const nonDeathRows = rows.filter((event) => {
  const row = asObject(event);
  return asString(row?.type) !== 'death';
});

const nonDeathSamples = nonDeathRows.slice(0, 20);

const brezAbilityCounts = nonDeathRows.reduce<Record<string, number>>((counts, event) => {
  const row = asObject(event);
  const abilityGameID = asNumber(row?.abilityGameID);
  const type = asString(row?.type) ?? 'unknown';

  if (typeof abilityGameID !== 'number') return counts;

  const key = `${abilityGameID}:${type}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});

console.log(
  JSON.stringify(
    {
      reportCode: parsed.reportCode,
      gameFamily: parsed.gameFamily,
      apiBaseUrl,
      completedBossFightCount: index.completedBossFights.length,
      completedBossFightIds: index.completedBossFights.map((fight) => fight.id),
      eventsPayloadKeys: eventsNode ? Object.keys(eventsNode) : [],
      eventRowCount: rows.length,
      firstEventRowKeys: firstRow ? Object.keys(firstRow) : [],
      eventTypeCounts,
      brezAbilityCounts,
      nonDeathRowCount: nonDeathRows.length,
      nonDeathSamples,
      hasNextPage: typeof nextPageTimestamp === 'number',
      nextPageTimestamp,
      soulstoneSamples,
      samples: rows.slice(0, 5).map(summarizeEvent),
      rawSamples: rows.slice(0, 5),
      resurrectRowCount: resurrectRows.length,
      candidateMatchCount: candidateMatches.length,
      candidateMatches,
      brezSummary,
    },
    null,
    2,
  ),
);

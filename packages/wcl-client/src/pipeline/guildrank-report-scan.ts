import type { GameFamily } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { collectReportIndex } from '../collectors/report-index-collector.js';
import { collectTableMetrics } from '../collectors/table-collector.js';
import type { GuildRankReportCandidate } from './guildrank-candidate-selector.js';
import type { GuildRankWindows } from './types.js';

export interface EncounterMetricsByReport {
  speedByEncounter: Map<string, number>;
  executionByEncounter: Map<string, number>;
  pulls: number;
  wipes: number;
  clearedEncounters: Set<string>;
  matchesZone: boolean;
  hasDifficultySizeFights: boolean;
}

const normalizeNameKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const reportMatchesZone = (
  report: { zoneId?: number; zoneName?: string },
  target: { zoneId: number; zoneName: string },
): boolean => {
  if (typeof report.zoneId === 'number') {
    return report.zoneId === target.zoneId;
  }
  if (report.zoneName) {
    return normalizeNameKey(report.zoneName) === normalizeNameKey(target.zoneName);
  }
  return false;
};

export const collectEncounterMetricsFromReport = async (
  client: WclGraphqlClient,
  reportCode: string,
  zone: { zoneId: number; zoneName: string },
  difficultyId: number,
  sizeValue: number,
  gameFamily: GameFamily,
): Promise<EncounterMetricsByReport> => {
  const index = await collectReportIndex(client, {
    reportCode,
    sourceUrl: `https://www.warcraftlogs.com/reports/${reportCode}`,
    gameFamily,
  });

  const matchesZone = reportMatchesZone(
    {
      ...(typeof index.zoneId === 'number' ? { zoneId: index.zoneId } : {}),
      ...(index.zoneName ? { zoneName: index.zoneName } : {}),
    },
    zone,
  );
  if (!matchesZone) {
    return {
      speedByEncounter: new Map<string, number>(),
      executionByEncounter: new Map<string, number>(),
      pulls: 0,
      wipes: 0,
      clearedEncounters: new Set<string>(),
      matchesZone: false,
      hasDifficultySizeFights: false,
    };
  }

  const filteredFights = index.completedBossFights.filter(
    (fight) => fight.difficulty === difficultyId && fight.size === sizeValue,
  );

  const tableMetrics = await collectTableMetrics(client, {
    reportCode,
    completedFightIds: filteredFights.map((fight) => fight.id),
  });

  const byEncounter = new Map<string, typeof filteredFights>();
  for (const fight of filteredFights) {
    const fights = byEncounter.get(fight.name);
    if (fights) {
      fights.push(fight);
    } else {
      byEncounter.set(fight.name, [fight]);
    }
  }

  const speedByEncounter = new Map<string, number>();
  const executionByEncounter = new Map<string, number>();
  const clearedEncounters = new Set<string>();
  let wipes = 0;

  for (const [encounterName, fights] of byEncounter.entries()) {
    let hasKill = false;
    let fastestDuration: number | undefined;
    let lowestDeaths: number | undefined;
    for (const fight of fights) {
      if (!fight.kill) {
        wipes += 1;
        continue;
      }
      hasKill = true;
      const durationMs = Math.max(0, fight.endTime - fight.startTime);
      if (typeof fastestDuration !== 'number' || durationMs < fastestDuration) {
        fastestDuration = durationMs;
      }
      const deaths = tableMetrics.deathsByFightId[fight.id] ?? 0;
      if (typeof lowestDeaths !== 'number' || deaths < lowestDeaths) {
        lowestDeaths = deaths;
      }
    }

    if (!hasKill) continue;

    clearedEncounters.add(encounterName);

    if (typeof fastestDuration === 'number') {
      speedByEncounter.set(encounterName, fastestDuration);
    }

    if (typeof lowestDeaths === 'number') {
      executionByEncounter.set(encounterName, lowestDeaths);
    }
  }

  return {
    speedByEncounter,
    executionByEncounter,
    pulls: filteredFights.length,
    wipes,
    clearedEncounters,
    matchesZone: true,
    hasDifficultySizeFights: filteredFights.length > 0,
  };
};

export const isInCurrentWindow = (
  candidate: GuildRankReportCandidate,
  windows: GuildRankWindows,
): boolean =>
  candidate.startTime >= windows.currentStartMs && candidate.startTime <= windows.currentEndMs;

export const isInBaselineWindow = (
  candidate: GuildRankReportCandidate,
  windows: GuildRankWindows,
): boolean =>
  candidate.startTime >= windows.baselineStartMs &&
  candidate.startTime <= windows.baselineEndMs &&
  candidate.startTime < windows.currentStartMs;

export const toDiscoveryRows = (candidates: GuildRankReportCandidate[]) =>
  candidates.map((candidate) => ({
    code: candidate.reportCode,
    startTime: candidate.startTime,
    ...(typeof candidate.endTime === 'number' ? { endTime: candidate.endTime } : {}),
    ...(typeof candidate.zoneId === 'number' ? { zoneId: candidate.zoneId } : {}),
    ...(candidate.zoneName ? { zoneName: candidate.zoneName } : {}),
  }));

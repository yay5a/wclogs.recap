import type {
  NormalizedEncounterFight,
  NormalizedFight,
  NormalizedLeaderboardEntry,
  NormalizedReport,
} from '../index.js';
import type {
  ReportEncounterSummary,
  ReportMetricRow,
  ReportParseRow,
  ReportSummary,
} from './types.js';

const REPORT_TOP_LIMIT = 3;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizePlayerKey = (name: string): string => name.trim().toLowerCase();

const normalizeEncounterNameKey = (name: string): string => name.trim().toLowerCase();

const getEncounterId = (fight: NormalizedFight | NormalizedEncounterFight): number | undefined =>
  isFiniteNumber((fight as NormalizedEncounterFight).encounterId)
    ? (fight as NormalizedEncounterFight).encounterId
    : undefined;

const getDifficultyName = (
  fight: NormalizedFight | NormalizedEncounterFight,
): string | undefined => {
  const difficultyName = (fight as NormalizedEncounterFight).difficultyName;
  return typeof difficultyName === 'string' && difficultyName.trim().length > 0
    ? difficultyName.trim()
    : undefined;
};

const getDurationMs = (fight: NormalizedFight): number =>
  Math.max(0, fight.endTime - fight.startTime);

const compareString = (left: string, right: string): number => left.localeCompare(right);

const topRows = (
  rows: readonly ReportMetricRow[] | undefined,
  limit = REPORT_TOP_LIMIT,
): ReportMetricRow[] =>
  [...(rows ?? [])]
    .filter((row) => row.playerName.trim().length > 0 && isFiniteNumber(row.value))
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return compareString(left.playerName, right.playerName);
    })
    .slice(0, limit)
    .map((row) => ({
      playerName: row.playerName,
      value: row.value,
      ...(row.className ? { className: row.className } : {}),
      ...(row.specName ? { specName: row.specName } : {}),
    }));

const rateRows = (
  rows: readonly ReportMetricRow[] | undefined,
  durationMs: number,
): ReportMetricRow[] => {
  return topRows(
    (rows ?? []).flatMap((row) => {
      const rowDurationMs =
        isFiniteNumber(row.activeTimeMs) && row.activeTimeMs > 0 ? row.activeTimeMs : durationMs;
      if (rowDurationMs <= 0) return [];
      const durationSeconds = rowDurationMs / 1000;
      return [
        {
          playerName: row.playerName,
          value: row.value / durationSeconds,
          ...(row.className ? { className: row.className } : {}),
          ...(row.specName ? { specName: row.specName } : {}),
        },
      ];
    }),
  );
};

const metricRowFromRanking = (
  entry: NormalizedLeaderboardEntry,
  metric: ReportParseRow['metric'],
  sourceMetric?: ReportParseRow['sourceMetric'],
): ReportParseRow | undefined => {
  if (!entry.playerName || !isFiniteNumber(entry.rankPercent)) return undefined;
  return {
    playerName: entry.playerName,
    value: entry.rankPercent,
    metric,
    ...(sourceMetric ? { sourceMetric } : {}),
    ...(entry.className ? { className: entry.className } : {}),
    ...(entry.specName ? { specName: entry.specName } : {}),
    ...(entry.bossName ? { bossName: entry.bossName } : {}),
    ...(isFiniteNumber(entry.fightId) ? { fightId: entry.fightId } : {}),
  };
};

const bestParseForMetric = (
  entries: readonly NormalizedLeaderboardEntry[] | undefined,
  metric: ReportParseRow['metric'],
  sourceMetric?: ReportParseRow['sourceMetric'],
): ReportParseRow | undefined =>
  (entries ?? [])
    .flatMap((entry) => {
      const row = metricRowFromRanking(entry, metric, sourceMetric);
      return row ? [row] : [];
    })
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return compareString(left.playerName, right.playerName);
    })[0];

const averageParseRows = (report: NormalizedReport): ReportMetricRow[] => {
  const byPlayer = new Map<
    string,
    {
      playerName: string;
      sum: number;
      count: number;
      className?: string;
      specName?: string;
    }
  >();

  for (const entry of [
    ...(report.reportWideRankings?.dps ?? []),
    ...(report.reportWideRankings?.hps ?? []),
  ]) {
    if (!entry.playerName || !isFiniteNumber(entry.rankPercent)) continue;
    const key = normalizePlayerKey(entry.playerName);
    const current = byPlayer.get(key);
    if (!current) {
      byPlayer.set(key, {
        playerName: entry.playerName,
        sum: entry.rankPercent,
        count: 1,
        ...(entry.className ? { className: entry.className } : {}),
        ...(entry.specName ? { specName: entry.specName } : {}),
      });
      continue;
    }
    current.sum += entry.rankPercent;
    current.count += 1;
    if (!current.className && entry.className) current.className = entry.className;
    if (!current.specName && entry.specName) current.specName = entry.specName;
  }

  return topRows(
    [...byPlayer.values()].map((entry) => ({
      playerName: entry.playerName,
      value: entry.sum / entry.count,
      ...(entry.className ? { className: entry.className } : {}),
      ...(entry.specName ? { specName: entry.specName } : {}),
    })),
  );
};

const getEncounterFights = (
  report: NormalizedReport,
): Array<NormalizedFight | NormalizedEncounterFight> => {
  const allEncounterFights = (report.encounterFights ?? []).filter(
    (fight) => fight.inProgress !== true,
  );
  return allEncounterFights.length > 0 ? allEncounterFights : report.fights;
};

const buildEncounterSummaries = (report: NormalizedReport): ReportEncounterSummary[] => {
  const groups = new Map<string, Array<NormalizedFight | NormalizedEncounterFight>>();
  for (const fight of getEncounterFights(report)) {
    const encounterId = getEncounterId(fight);
    const key =
      typeof encounterId === 'number'
        ? `encounter:${encounterId}`
        : `name:${normalizeEncounterNameKey(fight.name)}`;
    groups.set(key, [...(groups.get(key) ?? []), fight]);
  }

  return [...groups.values()]
    .map((fights): ReportEncounterSummary => {
      const sortedFights = [...fights].sort((left, right) => left.startTime - right.startTime);
      const firstFight = sortedFights[0] as NormalizedFight | NormalizedEncounterFight;
      const durations = sortedFights.map(getDurationMs).filter((duration) => duration > 0);
      const kills = sortedFights.filter((fight) => fight.kill).length;
      const encounterId = getEncounterId(firstFight);
      const difficultyName =
        sortedFights.map(getDifficultyName).find((value): value is string => Boolean(value)) ??
        report.bossPerformances?.find(
          (boss) =>
            (typeof encounterId === 'number' && boss.encounterId === encounterId) ||
            normalizeEncounterNameKey(boss.bossName) === normalizeEncounterNameKey(firstFight.name),
        )?.difficultyName;

      return {
        bossName: firstFight.name,
        ...(typeof encounterId === 'number' ? { encounterId } : {}),
        ...(difficultyName ? { difficultyName } : {}),
        pulls: sortedFights.length,
        kills,
        wipes: sortedFights.length - kills,
        totalDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
        ...(durations.length > 0 ? { longestPullMs: Math.max(...durations) } : {}),
        ...(durations.length > 0 ? { shortestPullMs: Math.min(...durations) } : {}),
        dtpsParseAvailable: false,
      };
    })
    .sort((left, right) => {
      if ((left.encounterId ?? 0) !== (right.encounterId ?? 0)) {
        return (left.encounterId ?? 0) - (right.encounterId ?? 0);
      }
      return compareString(left.bossName, right.bossName);
    });
};

const selectBestExecutionEncounter = (
  encounters: readonly ReportEncounterSummary[],
): ReportEncounterSummary | undefined =>
  [...encounters]
    .filter((encounter) => encounter.kills > 0)
    .sort((left, right) => {
      if (left.wipes !== right.wipes) return left.wipes - right.wipes;
      if (left.pulls !== right.pulls) return left.pulls - right.pulls;
      if (left.totalDurationMs !== right.totalDurationMs) {
        return left.totalDurationMs - right.totalDurationMs;
      }
      return compareString(left.bossName, right.bossName);
    })[0] ??
  [...encounters].sort((left, right) => {
    if (left.wipes !== right.wipes) return left.wipes - right.wipes;
    if (left.pulls !== right.pulls) return left.pulls - right.pulls;
    return compareString(left.bossName, right.bossName);
  })[0];

const selectBiggestTroubleEncounter = (
  encounters: readonly ReportEncounterSummary[],
): ReportEncounterSummary | undefined =>
  [...encounters].sort((left, right) => {
    if (right.wipes !== left.wipes) return right.wipes - left.wipes;
    if (right.pulls !== left.pulls) return right.pulls - left.pulls;
    if ((right.longestPullMs ?? 0) !== (left.longestPullMs ?? 0)) {
      return (right.longestPullMs ?? 0) - (left.longestPullMs ?? 0);
    }
    return compareString(left.bossName, right.bossName);
  })[0];

const getRepresentativeDifficultyName = (
  encounters: readonly ReportEncounterSummary[],
): string | undefined => {
  const counts = new Map<string, number>();
  for (const encounter of encounters) {
    if (!encounter.difficultyName) continue;
    counts.set(encounter.difficultyName, (counts.get(encounter.difficultyName) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return compareString(left[0], right[0]);
  })[0]?.[0];
};

export const buildReportSummary = (report: NormalizedReport): ReportSummary => {
  const encounters = buildEncounterSummaries(report);
  const reportWideRows = report.reportWideEncounterSummary ?? report.reportWideSummary;
  const encounterDurationMs = encounters.reduce(
    (sum, encounter) => sum + encounter.totalDurationMs,
    0,
  );
  const durationMs = Math.max(0, report.endTime - report.startTime);
  const bestDpsParse = bestParseForMetric(report.reportWideRankings?.dps, 'DPS');
  const bestHpsParse = bestParseForMetric(report.reportWideRankings?.hps, 'HPS');
  const bestDtpsParse =
    bestParseForMetric(report.reportWideRankings?.krsi, 'DTPS', 'krsi') ??
    bestParseForMetric(report.reportWideRankings?.dps, 'DTPS', 'dps-fallback');
  const representativeDifficultyName = getRepresentativeDifficultyName(encounters);
  const bestExecutionEncounter = selectBestExecutionEncounter(encounters);
  const biggestTroubleEncounter = selectBiggestTroubleEncounter(encounters);
  const partialDataNotes: string[] = [];

  if (!report.reportWideEncounterSummary && report.reportWideSummary) {
    partialDataNotes.push(
      'All-pull report tables were unavailable; some player totals use existing kill-focused table data.',
    );
  }
  if (!report.reportWideEncounterSummary && !report.reportWideSummary) {
    partialDataNotes.push('Report table data was unavailable for player totals.');
  }
  if (bestDtpsParse?.sourceMetric === 'krsi') {
    partialDataNotes.push(
      'WCL does not expose a direct DTPS parse ranking; DTPS parse uses KRSI where available.',
    );
  } else if (bestDtpsParse?.sourceMetric === 'dps-fallback') {
    partialDataNotes.push(
      'WCL does not expose a direct DTPS parse ranking; DTPS parse falls back to DPS rankings because KRSI is unavailable.',
    );
  } else {
    partialDataNotes.push(
      'WCL does not expose a direct DTPS parse ranking, and KRSI/DPS fallback ranking data was unavailable.',
    );
  }

  return {
    reportCode: report.reportCode,
    reportTitle: report.title,
    ...(report.zoneName ? { raidName: report.zoneName } : {}),
    ...(representativeDifficultyName ? { difficultyName: representativeDifficultyName } : {}),
    reportLink: `https://www.warcraftlogs.com/reports/${report.reportCode}`,
    dateISO: new Date(report.startTime).toISOString(),
    startTimeISO: new Date(report.startTime).toISOString(),
    endTimeISO: new Date(report.endTime).toISOString(),
    durationMs,
    bossPulls: encounters.reduce((sum, encounter) => sum + encounter.pulls, 0),
    totalKills: encounters.reduce((sum, encounter) => sum + encounter.kills, 0),
    totalWipes: encounters.reduce((sum, encounter) => sum + encounter.wipes, 0),
    ...(isFiniteNumber(reportWideRows?.totals.deaths)
      ? { totalDeaths: reportWideRows.totals.deaths }
      : {}),
    encounters,
    ...(bestExecutionEncounter ? { bestExecutionEncounter } : {}),
    ...(biggestTroubleEncounter ? { biggestTroubleEncounter } : {}),
    highestParses: {
      ...(bestDpsParse ? { dps: bestDpsParse } : {}),
      ...(bestHpsParse ? { hps: bestHpsParse } : {}),
      ...(bestDtpsParse ? { dtps: bestDtpsParse } : {}),
      dtpsAvailable: Boolean(bestDtpsParse),
    },
    topPlayers: {
      highestAverageParse: averageParseRows(report),
      highestTotalDamage: topRows(reportWideRows?.topDamageDone),
      highestTotalHealing: topRows(reportWideRows?.topHealingDone),
      highestTotalDamageTaken: topRows(reportWideRows?.topDamageTaken),
      highestTotalDps: rateRows(reportWideRows?.topDamageDone, encounterDurationMs),
      highestHps: rateRows(reportWideRows?.topHealingDone, encounterDurationMs),
      highestDamageTakenRate: rateRows(reportWideRows?.topDamageTaken, encounterDurationMs),
      mostDeaths: topRows(reportWideRows?.topDeaths),
      mostInterrupts: topRows(reportWideRows?.topInterrupts),
      mostDispels: topRows(reportWideRows?.topDispels),
    },
    partialDataNotes,
  };
};

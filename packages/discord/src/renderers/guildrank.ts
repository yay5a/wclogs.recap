import type { GuildRankSummary } from '@wcl/domain';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

const formatDelta = (value?: number): string =>
  typeof value === 'number' ? `${value >= 0 ? '+' : ''}${decimalFormatter.format(value)}` : 'n/a';

const formatMetric = (
  best?: number,
  median?: number,
  bestScoreDelta?: number,
  medianScoreDelta?: number,
): string =>
  [
    `Best Avg Score: ${typeof best === 'number' ? decimalFormatter.format(best) : 'n/a'} (${formatDelta(bestScoreDelta)})`,
    `Median Avg Score: ${typeof median === 'number' ? decimalFormatter.format(median) : 'n/a'} (${formatDelta(medianScoreDelta)})`,
  ].join('\n');

const formatScoreLine = (label: string, value?: number, delta?: number): string =>
  `${label}: ${typeof value === 'number' ? decimalFormatter.format(value) : 'n/a'} (${formatDelta(delta)})`;

const formatRanks = (ranks: { world?: number; region?: number; realm?: number }): string =>
  [
    `World ${typeof ranks.world === 'number' ? `#${ranks.world}` : 'unavailable'}`,
    `Region ${typeof ranks.region === 'number' ? `#${ranks.region}` : 'unavailable'}`,
    `Realm ${typeof ranks.realm === 'number' ? `#${ranks.realm}` : 'unavailable'}`,
  ].join(' / ');

const formatEncounterRankings = (
  encounters: Array<{
    encounterName: string;
    speed: { bestScore?: number; bestScoreDelta?: number; medianScore?: number; medianScoreDelta?: number };
    execution: { bestScore?: number; bestScoreDelta?: number; medianScore?: number; medianScoreDelta?: number };
  }>,
  metric: 'speed' | 'execution',
): string => {
  const rows = encounters.slice(0, 6).map((encounter) => {
    const values = encounter[metric];
    return [
      encounter.encounterName,
      formatScoreLine('Best Score', values.bestScore, values.bestScoreDelta),
      formatScoreLine('Median Score', values.medianScore, values.medianScoreDelta),
    ].join('\n');
  });
  return rows.length > 0 ? rows.join('\n\n') : 'unavailable';
};

export const buildGuildRankResponseBody = (summary: GuildRankSummary) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  fields.push({
    name: 'Progress',
    value: [
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
    ].join('\n'),
  });

  fields.push({
    name: 'Guild Rankings',
    value: `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
  });

  fields.push({
    name: 'Speed',
    value: [
      `Source: ${summary.speed.sourceLabel}`,
      ...(summary.speed.ranks ? [`All-Star Ranks: ${formatRanks(summary.speed.ranks)}`] : []),
      ...(summary.speed.completeRaidRanks
        ? [`Complete Raid Ranks: ${formatRanks(summary.speed.completeRaidRanks)}`]
        : []),
      formatMetric(
        summary.speed.overall.bestScore,
        summary.speed.overall.medianScore,
        summary.speed.overall.bestScoreDelta,
        summary.speed.overall.medianScoreDelta,
      ),
      summary.speed.bestEncounterGain
        ? `Best Encounter Gain: ${summary.speed.bestEncounterGain.encounterName} ${formatDelta(summary.speed.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ].join('\n'),
  });

  fields.push({
    name: 'Speed - Per Encounter',
    value: formatEncounterRankings(summary.speed.encounters, 'speed'),
  });

  fields.push({
    name: 'Execution',
    value: [
      `Source: ${summary.execution.sourceLabel}`,
      formatMetric(
        summary.execution.overall.bestScore,
        summary.execution.overall.medianScore,
        summary.execution.overall.bestScoreDelta,
        summary.execution.overall.medianScoreDelta,
      ),
      summary.execution.bestEncounterGain
        ? `Best Encounter Gain: ${summary.execution.bestEncounterGain.encounterName} ${formatDelta(summary.execution.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ].join('\n'),
  });

  fields.push({
    name: 'Execution - Per Encounter',
    value: formatEncounterRankings(summary.execution.encounters, 'execution'),
  });

  fields.push({
    name: 'Window',
    value: [
      `Current: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
      `Baseline: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
      ...summary.notes.map((note) => `Note: ${note}`),
    ].join('\n'),
  });

  return {
    embeds: [
      {
        title: `Guild Rank - ${summary.guildName}`,
        description: `${summary.zoneName} (${summary.difficultyLabel}, ${summary.sizeLabel})`,
        color: 0x2f7a47,
        fields,
      },
    ],
  };
};

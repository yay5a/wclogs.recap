import type { GuildRankSummary } from '@wcl/domain';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const SECTION_SEPARATOR = '='.repeat(32);

const formatDelta = (value?: number): string =>
  typeof value === 'number' ? `${value >= 0 ? '+' : ''}${decimalFormatter.format(value)}` : 'n/a';

const formatPreviousAndDelta = (current?: number, delta?: number): string => {
  if (typeof current === 'number' && typeof delta === 'number') {
    return `prev ${decimalFormatter.format(current - delta)}, ${formatDelta(delta)}`;
  }
  return `prev n/a, ${formatDelta(delta)}`;
};

const formatMetric = (
  best?: number,
  median?: number,
  bestScoreDelta?: number,
  medianScoreDelta?: number,
): string =>
  [
    `Best Avg Score: ${typeof best === 'number' ? decimalFormatter.format(best) : 'n/a'} (${formatPreviousAndDelta(best, bestScoreDelta)})`,
    `Median Avg Score: ${typeof median === 'number' ? decimalFormatter.format(median) : 'n/a'} (${formatPreviousAndDelta(median, medianScoreDelta)})`,
  ].join('\n');

const formatScoreLine = (label: string, value?: number, delta?: number): string =>
  `${label}: ${typeof value === 'number' ? decimalFormatter.format(value) : 'n/a'} (${formatPreviousAndDelta(value, delta)})`;

const formatRanks = (ranks: { world?: number; region?: number; realm?: number }): string =>
  [
    `\nWorld 🌍 ${typeof ranks.world === 'number' ? `#${ranks.world} \n` : 'unavailable'}`,
    `Region 🗾 ${typeof ranks.region === 'number' ? `#${ranks.region} \n` : 'unavailable'}`,
    `Realm 🪐 ${typeof ranks.realm === 'number' ? `#${ranks.realm} \n` : 'unavailable'}`,
  ].join(' / ');

const formatSection = (lines: string[]): string => [SECTION_SEPARATOR, '', ...lines].join('\n');

const formatEncounterRankings = (
  encounters: Array<{
    encounterName: string;
    speed: {
      bestScore?: number;
      bestScoreDelta?: number;
      medianScore?: number;
      medianScoreDelta?: number;
    };
    execution: {
      bestScore?: number;
      bestScoreDelta?: number;
      medianScore?: number;
      medianScoreDelta?: number;
    };
  }>,
  metric: 'speed' | 'execution',
): string => {
  const rows = encounters.slice(0, 6).map((encounter) => {
    const values = encounter[metric];
    return [
      `• ${encounter.encounterName}`,
      `  ${formatScoreLine('Best Score', values.bestScore, values.bestScoreDelta)}`,
      `  ${formatScoreLine('Median Score', values.medianScore, values.medianScoreDelta)}`,
    ].join('\n');
  });
  return rows.length > 0
    ? [SECTION_SEPARATOR, '', rows.join('\n\n')].join('\n')
    : formatSection(['unavailable']);
};

export const buildGuildRankResponseBody = (summary: GuildRankSummary) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  fields.push({
    name: 'Progress',
    value: formatSection([
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
    ]),
  });

  fields.push({
    name: 'Guild Rankings',
    value: formatSection([
      `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
    ]),
  });

  fields.push({
    name: 'Speed',
    value: formatSection([
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
    ]),
  });

  fields.push({
    name: 'Speed - Per Encounter',
    value: formatEncounterRankings(summary.speed.encounters, 'speed'),
  });

  fields.push({
    name: 'Execution',
    value: formatSection([
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
    ]),
  });

  fields.push({
    name: 'Execution - Per Encounter',
    value: formatEncounterRankings(summary.execution.encounters, 'execution'),
  });

  fields.push({
    name: 'Window',
    value: formatSection([
      `Current: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
      `Baseline: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
      ...summary.notes.map((note) => `Note: ${note}`),
    ]),
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

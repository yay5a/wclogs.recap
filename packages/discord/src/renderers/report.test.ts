import { describe, expect, it } from 'vitest';
import type { ReportSummary } from '@wcl/domain';
import { buildReportResponseBody } from './report.js';

const ENCOUNTER_HIGHLIGHTS_LABEL = 'Encounter Highlights 🗿';
const TOP_PLAYERS_LABEL = 'Top Players 🏋️‍♂️';
const BIGGEST_TROUBLE_FIELD = 'Biggest Trouble 🙎‍♂️';

const baseSummary = (): ReportSummary => ({
  reportCode: 'ABC123',
  reportTitle: 'Raid Night',
  raidName: 'Throne of Thunder',
  difficultyName: 'Heroic',
  sizeLabel: '10man',
  reportLink: 'https://www.warcraftlogs.com/reports/ABC123',
  dateISO: new Date(Date.UTC(2026, 4, 1, 1)).toISOString(),
  startTimeISO: new Date(Date.UTC(2026, 4, 1, 1)).toISOString(),
  endTimeISO: new Date(Date.UTC(2026, 4, 1, 3)).toISOString(),
  durationMs: 2 * 60 * 60 * 1000,
  bossPulls: 4,
  totalKills: 1,
  totalWipes: 3,
  totalDeaths: 8,
  encounters: [],
  bestExecutionEncounter: {
    bossName: 'Jinrokh',
    encounterId: 1001,
    difficultyName: 'Heroic',
    pulls: 2,
    kills: 1,
    wipes: 1,
    totalDurationMs: 180_000,
    shortestPullMs: 100_000,
    deaths: 3,
    highestTotalDps: { playerName: 'Alyra', value: 40_000 },
    highestHps: { playerName: 'Alyra', value: 12_000 },
    highestDamageTakenRate: { playerName: 'Bulwark', value: 18_000 },
    highestParseDps: { metric: 'DPS', playerName: 'Alyra', value: 95 },
    highestParseHps: { metric: 'HPS', playerName: 'Alyra', value: 82 },
    dtpsParseAvailable: false,
  },
  biggestTroubleEncounter: {
    bossName: 'Council',
    encounterId: 1002,
    difficultyName: 'Heroic',
    pulls: 2,
    kills: 0,
    wipes: 2,
    totalDurationMs: 280_000,
    longestPullMs: 200_000,
    shortestPullMs: 130_000,
    deaths: 5,
    highestTotalDps: { playerName: 'Bulwark', value: 27_000 },
    highestHps: { playerName: 'Alyra', value: 15_500 },
    highestDamageTakenRate: { playerName: 'Bulwark', value: 22_000 },
    dtpsParseAvailable: false,
  },
  highestParses: {
    dps: { metric: 'DPS', playerName: 'Alyra', value: 85 },
    hps: { metric: 'HPS', playerName: 'Alyra', value: 80 },
    dtps: { metric: 'DTPS', playerName: 'Bulwark', value: 77 },
    dtpsAvailable: true,
  },
  topPlayers: {
    highestAverageParse: [{ playerName: 'Alyra', value: 88 }],
    highestTotalDamage: [{ playerName: 'Damagey', value: 9_900_000 }],
    highestTotalHealing: [{ playerName: 'Healz', value: 8_800_000 }],
    highestTotalDamageTaken: [{ playerName: 'Tanky', value: 7_700_000 }],
    highestTotalDps: [
      { playerName: 'Alyra', value: 40_000, className: 'Priest', specName: 'Discipline' },
    ],
    highestHps: [{ playerName: 'Alyra', value: 12_000, className: 'Druid' }],
    highestDamageTakenRate: [{ playerName: 'Bulwark', value: 18_000 }],
    mostDeaths: [{ playerName: 'Floorroller', value: 5, className: 'Paladin' }],
    mostInterrupts: [{ playerName: 'Kickbot', value: 7 }],
    mostDispels: [{ playerName: 'Cleanse', value: 4 }],
  },
  partialDataNotes: [],
});

const getFieldNames = (response: ReturnType<typeof buildReportResponseBody>): string[] =>
  response.embeds[0]?.fields?.map((field) => field.name) ?? [];

const getSectionIndex = (
  fields: Array<{ name?: string; value?: string }>,
  label: string,
): number =>
  fields.findIndex(
    (field) => field.name?.trim() === label || field.value?.trim() === label,
  );

const getFieldValue = (
  response: ReturnType<typeof buildReportResponseBody>,
  fieldName: string,
): string => {
  const value = response.embeds[0]?.fields?.find((field) => field.name === fieldName)?.value;
  if (!value) throw new Error(`Missing field: ${fieldName}`);
  return value;
};

describe('/report renderer architecture', () => {
  it('renders Encounter Highlights before Top Players and nests best/trouble blocks under highlights', () => {
    const response = buildReportResponseBody(baseSummary());
    const fieldNames = getFieldNames(response);
    const fields = response.embeds[0]?.fields ?? [];
    const highlightsIndex = getSectionIndex(fields, ENCOUNTER_HIGHLIGHTS_LABEL);
    const bestExecutionIndex = fieldNames.indexOf('Best Execution ⚔️');
    const biggestTroubleIndex = fieldNames.indexOf(BIGGEST_TROUBLE_FIELD);
    const topPlayersIndex = getSectionIndex(fields, TOP_PLAYERS_LABEL);

    expect(highlightsIndex).toBeGreaterThan(-1);
    expect(bestExecutionIndex).toBeGreaterThan(highlightsIndex);
    expect(biggestTroubleIndex).toBeGreaterThan(bestExecutionIndex);
    expect(topPlayersIndex).toBeGreaterThan(biggestTroubleIndex);

    const bestExecutionField = response.embeds[0]?.fields?.find(
      (field) => field.name === 'Best Execution ⚔️',
    );
    const biggestTroubleField = response.embeds[0]?.fields?.find(
      (field) => field.name === BIGGEST_TROUBLE_FIELD,
    );
    expect(bestExecutionField?.inline).toBe(true);
    expect(biggestTroubleField?.inline).toBe(true);
  });

  it('renders best execution highest-parse lines and biggest trouble pull-duration lines', () => {
    const response = buildReportResponseBody(baseSummary());
    const bestExecution = getFieldValue(response, 'Best Execution ⚔️');
    const biggestTrouble = getFieldValue(response, BIGGEST_TROUBLE_FIELD);

    expect(bestExecution).toContain('Highest Parse 🏅:');
    expect(bestExecution).toContain('Pulls: 2\n\nKill/Wipes: 1/1');
    expect(bestExecution).toContain('Kill/Wipes: 1/1\n\nDeaths: 3');
    expect(bestExecution).toContain('Deaths: 3\n\nHighest Parse 🏅:');
    expect(bestExecution).toContain('DPS: Alyra ⇨ 95\n\n  HPS: Alyra ⇨ 82');
    expect(bestExecution).toContain('DTPS: Bulwark ⇨ 77');
    expect(bestExecution).toContain(
      'Highest Total DPS ⚔️: Alyra ⇨ 40K/s\n\nHighest Total HPS 🍃: Alyra ⇨ 12K/s',
    );
    expect(bestExecution).toContain('Highest Total DTPS 🛡️: Bulwark ⇨ 18K/s');

    expect(biggestTrouble).toContain('Pulls: 2\n\nKill/Wipes: 0/2');
    expect(biggestTrouble).toContain('Kill/Wipes: 0/2\n\nDeaths: 5');
    expect(biggestTrouble).toContain('Deaths: 5\n\nLongest Pull: 3:20');
    expect(biggestTrouble).toContain('Longest Pull: 3:20\n\nShortest Pull: 2:10');
    expect(biggestTrouble).toContain('Shortest Pull: 2:10');
    expect(biggestTrouble).toContain(
      'Highest Total DPS ⚔️: Bulwark ⇨ 27K/s\n\nHighest Total HPS 🍃: Alyra ⇨ 15.5K/s',
    );
    expect(biggestTrouble).toContain('Highest Total DTPS 🛡️: Bulwark ⇨ 22K/s');
  });

  it('renders only approved Top Players blocks in architecture order', () => {
    const response = buildReportResponseBody(baseSummary());
    const fields = response.embeds[0]?.fields ?? [];
    const topPlayersIndex = getSectionIndex(fields, TOP_PLAYERS_LABEL);
    const topPlayerFields = fields.slice(topPlayersIndex + 1, -1);
    const topPlayerFieldNames = topPlayerFields.map((field) => field.name);
    const topPlayerText = topPlayerFields.map((field) => field.value).join('\n');

    expect(topPlayerFieldNames).toEqual([
      'Highest Avg Parse 🏆',
      'Highest Total DPS ⚔️',
      'Highest HPS 🍃',
      'Highest DTPS 🛡️',
      'Most Deaths 😵',
      'Most Interrupts 🙅‍♂️',
      'Most Dispels 🪄',
    ]);

    const fieldNames = getFieldNames(response);
    expect(fieldNames).not.toContain('Highest Total Healing');
    expect(fieldNames).not.toContain('Highest Damage Taken');
    expect(fieldNames).not.toContain('Highest DPS');
    expect(fieldNames).not.toContain('Highest Parses');
    expect(getFieldValue(response, 'Highest Total DPS ⚔️')).toBe('1. Alyra ⇨ 40K/s');
    expect(topPlayerText).not.toContain('(Discipline Priest)');
    expect(topPlayerText).not.toContain('(Druid)');
    expect(topPlayerText).not.toContain('(Paladin)');
  });

  it('renders unavailable lines for missing highlight values and missing top-player blocks', () => {
    const summary = baseSummary();
    if (summary.bestExecutionEncounter) {
      delete summary.bestExecutionEncounter.highestParseDps;
      delete summary.bestExecutionEncounter.highestParseHps;
      delete summary.bestExecutionEncounter.highestHps;
      delete summary.bestExecutionEncounter.highestDamageTakenRate;
    }
    summary.highestParses = { dtpsAvailable: false };
    summary.topPlayers = {
      highestAverageParse: [],
      highestTotalDamage: [],
      highestTotalHealing: [],
      highestTotalDamageTaken: [],
      highestTotalDps: [],
      highestHps: [],
      highestDamageTakenRate: [],
      mostDeaths: [],
      mostInterrupts: [],
      mostDispels: [],
    };

    const response = buildReportResponseBody(summary);
    const bestExecution = getFieldValue(response, 'Best Execution ⚔️');

    expect(bestExecution).toContain('DPS: unavailable');
    expect(bestExecution).toContain('HPS: unavailable');
    expect(bestExecution).toContain('DTPS: unavailable');
    expect(bestExecution).toContain('Highest Total HPS 🍃: unavailable');
    expect(bestExecution).toContain('Highest Total DTPS 🛡️: unavailable');

    expect(getFieldValue(response, 'Highest Total DPS ⚔️')).toBe('unavailable');
    expect(getFieldValue(response, 'Highest HPS 🍃')).toBe('unavailable');
    expect(getFieldValue(response, 'Highest DTPS 🛡️')).toBe('unavailable');
    expect(getFieldValue(response, 'Most Interrupts 🙅‍♂️')).toBe('unavailable');
  });
});

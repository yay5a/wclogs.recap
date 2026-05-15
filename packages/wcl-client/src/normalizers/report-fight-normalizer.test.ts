import { describe, expect, it } from 'vitest';
import { normalizeReportFights } from './report-fight-normalizer.js';
import type { ReportIndexData, ReportTableMetrics } from '../pipeline/types.js';

describe('report fight normalizer', () => {
  it('infers difficulty and size from completed boss fights', () => {
    const index: ReportIndexData = {
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      gameFamily: 'retail',
      title: 'Raid',
      zoneName: 'Throne',
      startTime: 0,
      endTime: 1,
      completedBossFights: [
        { id: 1, encounterId: 1001, name: 'Boss A', startTime: 0, endTime: 100, kill: true, difficulty: 4, size: 10 },
        { id: 2, encounterId: 1001, name: 'Boss A', startTime: 120, endTime: 240, kill: false, difficulty: 4, size: 10 },
        { id: 3, encounterId: 1002, name: 'Boss B', startTime: 250, endTime: 500, kill: true, difficulty: 3, size: 25 },
      ],
      killBossFights: [
        { id: 1, encounterId: 1001, name: 'Boss A', startTime: 0, endTime: 100, kill: true, difficulty: 4, size: 10 },
        { id: 3, encounterId: 1002, name: 'Boss B', startTime: 250, endTime: 500, kill: true, difficulty: 3, size: 25 },
      ],
      allBossFights: [],
      zoneDifficulties: [
        { id: 3, name: 'Normal', sizes: [10, 25] },
        { id: 4, name: 'Heroic', sizes: [10, 25] },
      ],
    };

    const tableMetrics: ReportTableMetrics = {
      topDamageDone: [],
      topHealingDone: [],
      topDamageTaken: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: { 1: 2, 2: 4, 3: 1 },
      encounterTopDamageDoneByEncounterId: {},
      encounterTopHealingDoneByEncounterId: {},
      encounterTopDamageTakenByEncounterId: {},
    };

    const result = normalizeReportFights(index, tableMetrics);

    expect(result.inferredDifficultyName).toBe('Heroic');
    expect(result.inferredSizeLabel).toBe('10man');
  });

  it('preserves tie and ordering behavior while summarizing encounters', () => {
    const index: ReportIndexData = {
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      gameFamily: 'retail',
      title: 'Raid',
      zoneName: 'Throne',
      startTime: 0,
      endTime: 1,
      completedBossFights: [
        { id: 1, encounterId: 2002, name: 'Second', startTime: 300, endTime: 400, kill: false, difficulty: 4, size: 25 },
        { id: 2, encounterId: 1001, name: 'Late Name', startTime: 100, endTime: 200, kill: false, difficulty: 4, size: 25 },
        { id: 3, encounterId: 1001, name: 'Early Name', startTime: 0, endTime: 100, kill: true, difficulty: 3, size: 10 },
        { id: 4, encounterId: 1001, name: 'Tie Kill', startTime: 220, endTime: 320, kill: true, difficulty: 3, size: 10 },
      ],
      killBossFights: [],
      allBossFights: [],
      zoneDifficulties: [
        { id: 3, name: 'Normal', sizes: [10, 25] },
        { id: 4, name: 'Heroic', sizes: [10, 25] },
      ],
    };
    const tableMetrics: ReportTableMetrics = {
      topDamageDone: [],
      topHealingDone: [],
      topDamageTaken: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: { 1: 0, 2: 3, 3: 1, 4: 2 },
      encounterTopDamageDoneByEncounterId: {
        1001: [
          { dataType: 'DamageDone', playerName: 'First', value: 30, activeTimeMs: 1000 },
          { dataType: 'DamageDone', playerName: 'Second', value: 30, activeTimeMs: 2000 },
        ],
      },
      encounterTopHealingDoneByEncounterId: {},
      encounterTopDamageTakenByEncounterId: {},
    };

    const result = normalizeReportFights(index, tableMetrics);

    expect(result.inferredDifficultyName).toBe('Normal');
    expect(result.inferredSizeLabel).toBe('10man');
    expect(result.encounters.map((encounter) => encounter.encounterId)).toEqual([1001, 2002]);
    expect(result.encounters[0]).toMatchObject({
      bossName: 'Early Name',
      pulls: 3,
      kills: 2,
      wipes: 1,
      totalDurationMs: 300,
      longestPullMs: 100,
      shortestPullMs: 100,
      shortestKillDurationMs: 100,
      deaths: 6,
      highestTotalDps: { playerName: 'First', value: 100 },
    });
  });

  it('computes shortest and longest pull from valid durations only', () => {
    const index: ReportIndexData = {
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      gameFamily: 'retail',
      title: 'Raid',
      zoneName: 'Throne',
      startTime: 0,
      endTime: 1,
      completedBossFights: [
        { id: 1, encounterId: 1001, name: 'Boss A', startTime: 0, endTime: 0, kill: false },
        { id: 2, encounterId: 1001, name: 'Boss A', startTime: 100, endTime: 50, kill: false },
        {
          id: 3,
          encounterId: 1001,
          name: 'Boss A',
          startTime: 100,
          endTime: null as unknown as number,
          kill: false,
        },
        {
          id: 4,
          encounterId: 1001,
          name: 'Boss A',
          startTime: 100,
          endTime: undefined as unknown as number,
          kill: false,
        },
        {
          id: 5,
          encounterId: 1001,
          name: 'Boss A',
          startTime: 100,
          endTime: Number.NaN,
          kill: false,
        },
        {
          id: 6,
          encounterId: 1001,
          name: 'Boss A',
          startTime: 1_000,
          endTime: 61_000,
          kill: false,
        },
        {
          id: 7,
          encounterId: 1001,
          name: 'Boss A',
          startTime: 200_000,
          endTime: 350_000,
          kill: true,
        },
      ],
      killBossFights: [],
      allBossFights: [],
      zoneDifficulties: [],
    };
    const tableMetrics: ReportTableMetrics = {
      topDamageDone: [],
      topHealingDone: [],
      topDamageTaken: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
      encounterTopDamageDoneByEncounterId: {},
      encounterTopHealingDoneByEncounterId: {},
      encounterTopDamageTakenByEncounterId: {},
    };

    const result = normalizeReportFights(index, tableMetrics);

    expect(result.encounters[0]).toMatchObject({
      pulls: 7,
      kills: 1,
      wipes: 6,
      totalDurationMs: 210_000,
      shortestPullMs: 60_000,
      longestPullMs: 150_000,
      shortestKillDurationMs: 150_000,
      deaths: 7,
    });
  });
});

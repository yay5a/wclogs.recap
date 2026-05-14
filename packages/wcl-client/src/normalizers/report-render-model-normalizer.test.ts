import { describe, expect, it } from 'vitest';
import { normalizeReportRenderModel } from './report-render-model-normalizer.js';
import type { ReportCollectorBundle } from '../pipeline/types.js';

const baseBundle = (): ReportCollectorBundle => ({
  index: {
    reportCode: 'ABC123',
    sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
    gameFamily: 'retail',
    title: 'Raid Night',
    zoneName: 'Throne',
    startTime: Date.UTC(2026, 4, 1, 1),
    endTime: Date.UTC(2026, 4, 1, 3),
    completedBossFights: [
      {
        id: 1,
        encounterId: 1001,
        name: 'Jinrokh',
        startTime: 0,
        endTime: 100_000,
        kill: true,
        difficulty: 4,
        size: 10,
      },
      {
        id: 2,
        encounterId: 1001,
        name: 'Jinrokh',
        startTime: 120_000,
        endTime: 200_000,
        kill: false,
        difficulty: 4,
        size: 10,
      },
      {
        id: 3,
        encounterId: 1002,
        name: 'Council',
        startTime: 210_000,
        endTime: 340_000,
        kill: false,
        difficulty: 4,
        size: 10,
      },
      {
        id: 4,
        encounterId: 1002,
        name: 'Council',
        startTime: 350_000,
        endTime: 500_000,
        kill: false,
        difficulty: 4,
        size: 10,
      },
    ],
    killBossFights: [
      {
        id: 1,
        encounterId: 1001,
        name: 'Jinrokh',
        startTime: 0,
        endTime: 100_000,
        kill: true,
        difficulty: 4,
        size: 10,
      },
    ],
    allBossFights: [],
    zoneDifficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
  },
  masterData: {
    actors: [
      { id: 1, name: 'Alyra', className: 'Priest' },
      { id: 2, name: 'Bulwark', className: 'Warrior' },
    ],
  },
  playerDetails: [],
  rankings: {
    dps: [
      {
        scope: 'report',
        metric: 'rankPercent',
        selectedMetric: 'DPS',
        playerName: 'Alyra',
        value: 80,
        rankPercent: 80,
        fightId: 1,
      },
    ],
    hps: [
      {
        scope: 'report',
        metric: 'rankPercent',
        selectedMetric: 'HPS',
        playerName: 'Alyra',
        value: 70,
        rankPercent: 70,
        fightId: 1,
      },
    ],
    tankDps: [],
  },
  tableMetrics: {
    topDamageDone: [{ dataType: 'DamageDone', playerName: 'Alyra', value: 10_000_000 }],
    topHealingDone: [{ dataType: 'Healing', playerName: 'Alyra', value: 5_000_000 }],
    topDamageTaken: [{ dataType: 'DamageTaken', playerName: 'Bulwark', value: 3_000_000 }],
    topDeaths: [{ dataType: 'Deaths', playerName: 'Alyra', value: 3 }],
    topInterrupts: [{ dataType: 'Interrupts', playerName: 'Alyra', value: 4 }],
    topDispels: [{ dataType: 'Dispels', playerName: 'Alyra', value: 2 }],
    totals: { deaths: 8 },
    deathsByFightId: { 1: 1, 2: 2, 3: 4, 4: 1 },
    encounterTopDamageDoneByEncounterId: {
      1001: [{ dataType: 'DamageDone', playerName: 'Alyra', value: 4_000_000 }],
      1002: [{ dataType: 'DamageDone', playerName: 'Bulwark', value: 7_500_000 }],
    },
    encounterTopHealingDoneByEncounterId: {
      1001: [{ dataType: 'Healing', playerName: 'Alyra', value: 1_200_000 }],
      1002: [{ dataType: 'Healing', playerName: 'Alyra', value: 2_100_000 }],
    },
    encounterTopDamageTakenByEncounterId: {
      1001: [{ dataType: 'DamageTaken', playerName: 'Bulwark', value: 1_800_000 }],
      1002: [{ dataType: 'DamageTaken', playerName: 'Bulwark', value: 4_500_000 }],
    },
  },
});

describe('report render-model normalizer', () => {
  it('selects best execution by fewest deaths then shortest kill and biggest trouble by wipes then deaths', () => {
    const summary = normalizeReportRenderModel(baseBundle());

    expect(summary.bossPulls).toBe(4);
    expect(summary.totalKills).toBe(1);
    expect(summary.totalWipes).toBe(3);
    expect(summary.difficultyName).toBe('Heroic');
    expect(summary.sizeLabel).toBe('10man');
    expect(summary.bestExecutionEncounter?.bossName).toBe('Jinrokh');
    expect(summary.bestExecutionEncounter?.deaths).toBe(3);
    expect(summary.bestExecutionEncounter?.highestTotalDps?.playerName).toBe('Alyra');
    expect(summary.bestExecutionEncounter?.highestHps?.playerName).toBe('Alyra');
    expect(summary.bestExecutionEncounter?.highestDamageTakenRate?.playerName).toBe('Bulwark');
    expect(summary.biggestTroubleEncounter?.bossName).toBe('Council');
    expect(summary.biggestTroubleEncounter?.wipes).toBe(2);
    expect(summary.biggestTroubleEncounter?.deaths).toBe(5);
    expect(summary.biggestTroubleEncounter?.highestTotalDps?.playerName).toBe('Bulwark');
    expect(summary.biggestTroubleEncounter?.highestHps?.playerName).toBe('Alyra');
    expect(summary.biggestTroubleEncounter?.highestDamageTakenRate?.playerName).toBe('Bulwark');
  });
});

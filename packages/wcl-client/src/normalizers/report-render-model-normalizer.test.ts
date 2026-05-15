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
  },
  tableMetrics: {
    topDamageDone: [
      { dataType: 'DamageDone', playerName: 'Alyra', value: 10_000_000, activeTimeMs: 250_000 },
    ],
    topHealingDone: [
      { dataType: 'Healing', playerName: 'Alyra', value: 5_000_000, activeTimeMs: 250_000 },
    ],
    topDeaths: [{ dataType: 'Deaths', playerName: 'Alyra', value: 3 }],
    topInterrupts: [{ dataType: 'Interrupts', playerName: 'Alyra', value: 4 }],
    topDispels: [{ dataType: 'Dispels', playerName: 'Alyra', value: 2 }],
    totals: { deaths: 8 },
    deathsByFightId: { 1: 1, 2: 2, 3: 4, 4: 1 },
    encounterTopDamageDoneByEncounterId: {
      1001: [
        { dataType: 'DamageDone', playerName: 'Alyra', value: 4_000_000, activeTimeMs: 100_000 },
      ],
      1002: [
        {
          dataType: 'DamageDone',
          playerName: 'Bulwark',
          value: 7_500_000,
          activeTimeMs: 250_000,
        },
      ],
    },
    encounterTopHealingDoneByEncounterId: {
      1001: [
        { dataType: 'Healing', playerName: 'Alyra', value: 1_200_000, activeTimeMs: 100_000 },
      ],
      1002: [
        { dataType: 'Healing', playerName: 'Alyra', value: 2_100_000, activeTimeMs: 250_000 },
      ],
    },
  },
});

describe('report render-model normalizer', () => {
  it('selects best execution by fewest deaths then shortest kill and biggest trouble by wipes then deaths', () => {
    const summary = normalizeReportRenderModel(baseBundle());

    expect(summary.reportLink).toBe('https://www.warcraftlogs.com/reports/ABC123');
    expect(summary.bossPulls).toBe(4);
    expect(summary.totalKills).toBe(1);
    expect(summary.totalWipes).toBe(3);
    expect(summary.difficultyName).toBe('Heroic');
    expect(summary.sizeLabel).toBe('10man');
    expect(summary.bestExecutionEncounter?.bossName).toBe('Jinrokh');
    expect(summary.bestExecutionEncounter?.deaths).toBe(3);
    expect(summary.bestExecutionEncounter?.highestTotalDps?.playerName).toBe('Alyra');
    expect(summary.bestExecutionEncounter?.highestHps?.playerName).toBe('Alyra');
    expect(summary.biggestTroubleEncounter?.bossName).toBe('Council');
    expect(summary.biggestTroubleEncounter?.wipes).toBe(2);
    expect(summary.biggestTroubleEncounter?.deaths).toBe(5);
    expect(summary.biggestTroubleEncounter?.longestPullMs).toBe(150_000);
    expect(summary.biggestTroubleEncounter?.shortestPullMs).toBe(130_000);
    expect(summary.biggestTroubleEncounter?.highestTotalDps?.playerName).toBe('Bulwark');
    expect(summary.biggestTroubleEncounter?.highestHps?.playerName).toBe('Alyra');
  });

  it('keeps the source report URL for the rendered data source', () => {
    const bundle = baseBundle();
    bundle.index.sourceUrl = 'https://classic.warcraftlogs.com/reports/ABC123';

    const summary = normalizeReportRenderModel(bundle);

    expect(summary.reportLink).toBe('https://classic.warcraftlogs.com/reports/ABC123');
  });

  it('uses selected completed-fight duration for report-wide rates and ignores active time', () => {
    const summary = normalizeReportRenderModel(baseBundle());

    expect(summary.topPlayers.highestTotalDps[0]).toMatchObject({
      playerName: 'Alyra',
      className: 'Priest',
    });
    expect(summary.topPlayers.highestTotalDps[0]?.value).toBeCloseTo(10_000_000 / 460);
    expect(summary.topPlayers.highestHps[0]?.value).toBeCloseTo(5_000_000 / 460);
  });

  it('aggregates player leaderboards and filters non-player actors before ranking', () => {
    const bundle = baseBundle();
    bundle.masterData.actors = [
      ...bundle.masterData.actors,
      { id: 11, name: 'Deesilverone', className: 'Paladin' },
      { id: 12, name: 'Karnivore', className: 'Hunter' },
      { id: 13, name: 'Banson', className: 'Priest' },
      { id: 14, name: 'Kickbot', className: 'Shaman' },
    ];
    bundle.playerDetails = [
      {
        name: 'Deesilverone',
        warcraftLogsActorId: 11,
        className: 'Paladin',
        specName: 'Holy',
      },
    ];
    bundle.tableMetrics.topDamageDone = [
      {
        dataType: 'DamageDone',
        playerName: 'Stormlash Totem',
        actorType: 'Pet',
        value: 999_000_000,
      },
      {
        dataType: 'DamageDone',
        playerId: 1,
        playerName: 'Alyra',
        value: 10_000_000,
        activeTimeMs: 200_000,
      },
      {
        dataType: 'DamageDone',
        playerId: 1,
        playerName: 'Alyra',
        value: 1_000_000,
        activeTimeMs: 20_000,
      },
    ];
    bundle.tableMetrics.topHealingDone = [
      { dataType: 'Healing', playerName: 'Skull Banner', actorType: 'Object', value: 999_000_000 },
      {
        dataType: 'Healing',
        playerId: 1,
        playerName: 'Alyra',
        value: 5_000_000,
        activeTimeMs: 200_000,
      },
    ];
    bundle.tableMetrics.topDeaths = [
      { dataType: 'Deaths', playerId: 11, playerName: 'Deesilverone', value: 1 },
      { dataType: 'Deaths', playerId: 12, playerName: 'Karnivore', value: 1 },
      { dataType: 'Deaths', playerId: 11, playerName: 'Deesilverone', value: 1 },
      { dataType: 'Deaths', playerName: 'Deesilverone', value: 1 },
    ];
    bundle.tableMetrics.topDispels = [
      { dataType: 'Dispels', playerId: 13, playerName: 'Banson', value: 16 },
      { dataType: 'Dispels', playerId: 13, playerName: 'Banson', value: 8 },
      { dataType: 'Dispels', playerId: 13, playerName: 'Banson', value: 7 },
    ];
    bundle.tableMetrics.topInterrupts = [
      { dataType: 'Interrupts', playerId: 14, playerName: 'Kickbot', value: 2 },
      { dataType: 'Interrupts', playerId: 14, playerName: 'Kickbot', value: 3 },
      { dataType: 'Interrupts', playerId: 1, playerName: 'Alyra', value: 4 },
    ];
    bundle.tableMetrics.totals = { deaths: 136, interrupts: 9, dispels: 31 };
    bundle.tableMetrics.encounterTopDamageDoneByEncounterId = {
      1001: [
        {
          dataType: 'DamageDone',
          playerName: 'Stormlash Totem',
          actorType: 'Pet',
          value: 999_000_000,
        },
        {
          dataType: 'DamageDone',
          playerId: 1,
          playerName: 'Alyra',
          value: 4_000_000,
          activeTimeMs: 100_000,
        },
      ],
      1002: [
        {
          dataType: 'DamageDone',
          playerName: 'Skull Banner',
          actorType: 'Object',
          value: 999_000_000,
        },
        {
          dataType: 'DamageDone',
          playerId: 2,
          playerName: 'Bulwark',
          value: 7_500_000,
          activeTimeMs: 250_000,
        },
      ],
    };
    bundle.tableMetrics.encounterTopHealingDoneByEncounterId = {
      1001: [
        {
          dataType: 'Healing',
          playerName: 'Skull Banner',
          actorType: 'Object',
          value: 999_000_000,
        },
        {
          dataType: 'Healing',
          playerId: 1,
          playerName: 'Alyra',
          value: 1_200_000,
          activeTimeMs: 100_000,
        },
      ],
      1002: [
        {
          dataType: 'Healing',
          playerName: 'Stormlash Totem',
          actorType: 'Guardian',
          value: 999_000_000,
        },
        {
          dataType: 'Healing',
          playerId: 1,
          playerName: 'Alyra',
          value: 2_100_000,
          activeTimeMs: 250_000,
        },
      ],
    };
    const summary = normalizeReportRenderModel(bundle);

    expect(summary.totalDeaths).toBe(136);
    expect(summary.bossPulls).toBe(4);
    expect(summary.totalKills).toBe(1);
    expect(summary.totalWipes).toBe(3);
    expect(summary.topPlayers.mostDeaths).toEqual([
      {
        playerName: 'Deesilverone',
        value: 3,
        className: 'Paladin',
        specName: 'Holy',
      },
      { playerName: 'Karnivore', value: 1, className: 'Hunter' },
    ]);
    expect(summary.topPlayers.mostDispels).toEqual([
      { playerName: 'Banson', value: 31, className: 'Priest' },
    ]);
    expect(summary.topPlayers.mostInterrupts).toEqual([
      { playerName: 'Kickbot', value: 5, className: 'Shaman' },
      { playerName: 'Alyra', value: 4, className: 'Priest' },
    ]);
    expect(new Set(summary.topPlayers.mostDeaths.map((row) => row.playerName)).size).toBe(
      summary.topPlayers.mostDeaths.length,
    );
    expect(new Set(summary.topPlayers.mostDispels.map((row) => row.playerName)).size).toBe(
      summary.topPlayers.mostDispels.length,
    );
    expect(new Set(summary.topPlayers.mostInterrupts.map((row) => row.playerName)).size).toBe(
      summary.topPlayers.mostInterrupts.length,
    );
    expect(summary.topPlayers.highestTotalDamage.map((row) => row.playerName)).not.toContain(
      'Stormlash Totem',
    );
    expect(summary.topPlayers.highestTotalHealing.map((row) => row.playerName)).not.toContain(
      'Skull Banner',
    );
    expect(summary.topPlayers.highestTotalDps.map((row) => row.playerName)).toEqual(['Alyra']);
    expect(summary.topPlayers.highestHps.map((row) => row.playerName)).toEqual(['Alyra']);
    expect(summary.bestExecutionEncounter?.highestTotalDps?.playerName).toBe('Alyra');
    expect(summary.bestExecutionEncounter?.highestHps?.playerName).toBe('Alyra');
    expect(summary.biggestTroubleEncounter?.highestTotalDps?.playerName).toBe('Bulwark');
    expect(summary.biggestTroubleEncounter?.highestHps?.playerName).toBe('Alyra');
  });
});

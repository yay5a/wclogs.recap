import { describe, expect, it } from 'vitest';
import { buildReportSummary, type NormalizedReport } from '../index.js';

const baseReport = (overrides: Partial<NormalizedReport> = {}): NormalizedReport => ({
  reportCode: 'ABC123',
  title: 'Raid Night',
  startTime: Date.UTC(2026, 4, 1, 1),
  endTime: Date.UTC(2026, 4, 1, 3),
  gameFamily: 'retail',
  zoneName: 'Throne of Thunder',
  fights: [{ id: 3, name: 'Council of Elders', startTime: 0, endTime: 120000, kill: true }],
  players: [],
  ...overrides,
});

describe('buildReportSummary', () => {
  it('counts all boss pulls and separates kills from wipes', () => {
    const summary = buildReportSummary(
      baseReport({
        encounterFights: [
          {
            id: 1,
            encounterId: 101,
            name: 'Jinrokh',
            startTime: 0,
            endTime: 100000,
            kill: false,
            difficultyName: 'Heroic',
          },
          {
            id: 2,
            encounterId: 101,
            name: 'Jinrokh',
            startTime: 110000,
            endTime: 260000,
            kill: true,
            difficultyName: 'Heroic',
          },
          {
            id: 3,
            encounterId: 102,
            name: 'Council of Elders',
            startTime: 280000,
            endTime: 360000,
            kill: false,
            difficultyName: 'Heroic',
          },
        ],
      }),
    );

    expect(summary.bossPulls).toBe(3);
    expect(summary.totalKills).toBe(1);
    expect(summary.totalWipes).toBe(2);
    expect(summary.encounters).toEqual([
      expect.objectContaining({ bossName: 'Jinrokh', pulls: 2, kills: 1, wipes: 1 }),
      expect.objectContaining({ bossName: 'Council of Elders', pulls: 1, kills: 0, wipes: 1 }),
    ]);
  });

  it('totals deaths across all boss pulls from encounter-wide report tables', () => {
    const summary = buildReportSummary(
      baseReport({
        reportWideEncounterSummary: {
          topDamageDone: [],
          topHealingDone: [],
          topDeaths: [{ playerName: 'Alyra', value: 4 }],
          totals: { deaths: 11 },
        },
      }),
    );

    expect(summary.totalDeaths).toBe(11);
    expect(summary.topPlayers.mostDeaths).toEqual([{ playerName: 'Alyra', value: 4 }]);
  });

  it('selects biggest trouble deterministically from metadata-derived encounter stats', () => {
    const summary = buildReportSummary(
      baseReport({
        encounterFights: [
          { id: 1, encounterId: 1, name: 'Alpha', startTime: 0, endTime: 100000, kill: false },
          { id: 2, encounterId: 1, name: 'Alpha', startTime: 110000, endTime: 210000, kill: false },
          { id: 3, encounterId: 2, name: 'Beta', startTime: 220000, endTime: 330000, kill: false },
          { id: 4, encounterId: 2, name: 'Beta', startTime: 340000, endTime: 450000, kill: false },
          { id: 5, encounterId: 3, name: 'Gamma', startTime: 460000, endTime: 700000, kill: true },
        ],
      }),
    );

    expect(summary.biggestTroubleEncounter?.bossName).toBe('Beta');
    expect(summary.biggestTroubleEncounter?.longestPullMs).toBe(110000);
    expect(summary.bestExecutionEncounter?.bossName).toBe('Gamma');
  });

  it('computes top totals and report-long rates without treating damage taken rate as a parse', () => {
    const summary = buildReportSummary(
      baseReport({
        encounterFights: [
          { id: 1, encounterId: 1, name: 'Boss', startTime: 0, endTime: 120000, kill: true },
        ],
        reportWideEncounterSummary: {
          topDamageDone: [{ playerName: 'Dps', value: 24_000_000 }],
          topHealingDone: [{ playerName: 'Healer', value: 12_000_000 }],
          topDamageTaken: [{ playerName: 'Tank', value: 6_000_000 }],
          topInterrupts: [{ playerName: 'Rogue', value: 9 }],
          topDispels: [{ playerName: 'Priest', value: 7 }],
          totals: { deaths: 2, interrupts: 9, dispels: 7, raidDamageTaken: 6_000_000 },
        },
      }),
    );

    expect(summary.topPlayers.highestTotalDamage[0]).toEqual({ playerName: 'Dps', value: 24_000_000 });
    expect(summary.topPlayers.highestTotalDps[0]).toEqual({ playerName: 'Dps', value: 200_000 });
    expect(summary.topPlayers.highestHps[0]).toEqual({ playerName: 'Healer', value: 100_000 });
    expect(summary.topPlayers.highestDamageTakenRate[0]).toEqual({ playerName: 'Tank', value: 50_000 });
    expect(summary.topPlayers.mostInterrupts[0]).toEqual({ playerName: 'Rogue', value: 9 });
    expect(summary.topPlayers.mostDispels[0]).toEqual({ playerName: 'Priest', value: 7 });
    expect(summary.highestParses.dtpsAvailable).toBe(false);
  });

  it('uses KRSI rankPercent as the DTPS parse fallback when available', () => {
    const summary = buildReportSummary(
      baseReport({
        reportWideRankings: {
          dps: [],
          hps: [],
          krsi: [
            {
              scope: 'report',
              metric: 'rankPercent',
              selectedMetric: 'DTPS',
              playerName: 'Bulwark',
              value: 55,
              rankPercent: 92,
              amount: 12_345_678,
            },
            {
              scope: 'report',
              metric: 'rankPercent',
              selectedMetric: 'DTPS',
              playerName: 'Aegis',
              value: 88,
              rankPercent: 88,
              amount: 99_999_999,
            },
          ],
        },
      }),
    );

    expect(summary.highestParses.dtpsAvailable).toBe(true);
    expect(summary.highestParses.dtps).toMatchObject({
      playerName: 'Bulwark',
      value: 92,
      metric: 'DTPS',
      sourceMetric: 'krsi',
    });
    expect(summary.partialDataNotes).toContain(
      'WCL does not expose a direct DTPS parse ranking; DTPS parse uses KRSI where available.',
    );
  });

  it('falls back to DPS rankPercent for DTPS parse when KRSI is unavailable', () => {
    const summary = buildReportSummary(
      baseReport({
        reportWideRankings: {
          dps: [
            {
              scope: 'report',
              metric: 'rankPercent',
              selectedMetric: 'DPS',
              playerName: 'Alyra',
              value: 99,
              rankPercent: 74,
              amount: 999_999_999,
            },
          ],
          hps: [],
        },
      }),
    );

    expect(summary.highestParses.dtpsAvailable).toBe(true);
    expect(summary.highestParses.dtps).toMatchObject({
      playerName: 'Alyra',
      value: 74,
      metric: 'DTPS',
      sourceMetric: 'dps-fallback',
    });
    expect(summary.partialDataNotes).toContain(
      'WCL does not expose a direct DTPS parse ranking; DTPS parse falls back to DPS rankings because KRSI is unavailable.',
    );
  });

  it('uses WCL active time when ranking total DPS, HPS, and damage taken rate', () => {
    const summary = buildReportSummary(
      baseReport({
        encounterFights: [
          { id: 1, encounterId: 1, name: 'Boss', startTime: 0, endTime: 120000, kill: true },
        ],
        reportWideEncounterSummary: {
          topDamageDone: [
            { playerName: 'Steady', value: 30_000_000, activeTimeMs: 300_000 },
            { playerName: 'Burst', value: 20_000_000, activeTimeMs: 100_000 },
          ],
          topHealingDone: [
            { playerName: 'Longcast', value: 15_000_000, activeTimeMs: 300_000 },
            { playerName: 'Quickheal', value: 9_000_000, activeTimeMs: 60_000 },
          ],
          topDamageTaken: [
            { playerName: 'Shield', value: 6_000_000, activeTimeMs: 120_000 },
            { playerName: 'Sponge', value: 5_000_000, activeTimeMs: 50_000 },
          ],
          totals: { deaths: 0 },
        },
      }),
    );

    expect(summary.topPlayers.highestTotalDps[0]).toEqual({ playerName: 'Burst', value: 200_000 });
    expect(summary.topPlayers.highestHps[0]).toEqual({ playerName: 'Quickheal', value: 150_000 });
    expect(summary.topPlayers.highestDamageTakenRate[0]).toEqual({
      playerName: 'Sponge',
      value: 100_000,
    });
  });

  it('builds highest average parse from WCL rankPercent and never from amount', () => {
    const summary = buildReportSummary(
      baseReport({
        reportWideRankings: {
          dps: [
            {
              scope: 'report',
              metric: 'rankPercent',
              selectedMetric: 'DPS',
              playerName: 'Alyra',
              value: 99,
              rankPercent: 80,
              amount: 999_999_999,
            },
            {
              scope: 'report',
              metric: 'rankPercent',
              selectedMetric: 'DPS',
              playerName: 'Alyra',
              value: 70,
              rankPercent: 70,
            },
          ],
          hps: [
            {
              scope: 'report',
              metric: 'rankPercent',
              selectedMetric: 'HPS',
              playerName: 'Healz',
              value: 95,
              rankPercent: 95,
            },
          ],
        },
      }),
    );

    expect(summary.highestParses.dps).toMatchObject({ playerName: 'Alyra', value: 80 });
    expect(summary.highestParses.hps).toMatchObject({ playerName: 'Healz', value: 95 });
    expect(summary.topPlayers.highestAverageParse).toEqual([
      { playerName: 'Healz', value: 95 },
      { playerName: 'Alyra', value: 75 },
    ]);
  });

  it('falls back safely for older normalized reports without report-only fields', () => {
    const summary = buildReportSummary(
      baseReport({
        reportWideSummary: {
          topDamageDone: [{ playerName: 'Alyra', value: 1000 }],
          topHealingDone: [],
          totals: { deaths: 3 },
        },
      }),
    );

    expect(summary.bossPulls).toBe(1);
    expect(summary.totalDeaths).toBe(3);
    expect(summary.topPlayers.highestTotalDamage).toEqual([{ playerName: 'Alyra', value: 1000 }]);
    expect(summary.partialDataNotes).toContain(
      'All-pull report tables were unavailable; some player totals use existing kill-focused table data.',
    );
  });
});

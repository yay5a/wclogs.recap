import { describe, expect, it, vi } from 'vitest';
import { parseBossRankingsPayload, parseReportRankingsPayload } from '../parsers/rankings.js';
import { deriveEncounterPhaseTimes, summarizeRankingsPayload } from './phase-timings.js';

describe('deriveEncounterPhaseTimes', () => {
  it('derives per-attempt phase windows and summary stats', () => {
    const fixture = deriveEncounterPhaseTimes({
      encounterId: 3001,
      metadata: [
        { id: 1, name: 'Phase One' },
        { id: 2, name: 'Intermission', isIntermission: true },
        { id: 3, name: 'Phase Two' },
      ],
      fights: [
        {
          id: 11,
          encounterID: 3001,
          startTime: 1000,
          endTime: 10000,
          kill: false,
          phaseTransitions: [
            { id: 2, startTime: 4000 },
            { id: 3, startTime: 6000 },
          ],
        },
        {
          id: 12,
          encounterID: 3001,
          startTime: 12000,
          endTime: 18000,
          kill: true,
          phaseTransitions: [{ id: 3, startTime: 15000 }],
        },
      ],
    });

    expect(fixture.attempts).toHaveLength(2);
    expect(fixture.attempts[0]?.phaseWindows).toEqual([
      {
        phaseId: 1,
        phaseName: 'Phase One',
        phaseStartTime: 1000,
        phaseEndTime: 4000,
        durationMs: 3000,
      },
      {
        phaseId: 2,
        phaseName: 'Intermission',
        isIntermission: true,
        phaseStartTime: 4000,
        phaseEndTime: 6000,
        durationMs: 2000,
      },
      {
        phaseId: 3,
        phaseName: 'Phase Two',
        phaseStartTime: 6000,
        phaseEndTime: 10000,
        durationMs: 4000,
      },
    ]);
    expect(fixture.attempts[1]?.phaseWindows[1]?.phaseEndTime).toBe(18000);
    expect(fixture.summary.totalAttempts).toBe(2);
    expect(fixture.summary.killCount).toBe(1);
    expect(fixture.summary.wipeCount).toBe(1);
    expect(fixture.summary.latestKillFightId).toBe(12);
    expect(fixture.summary.latestPullFightId).toBe(12);

    expect(fixture.summary.nonIntermissionPhaseStats).toEqual([
      {
        phaseId: 1,
        phaseName: 'Phase One',
        averageDurationMs: 3000,
        medianDurationMs: 3000,
        fastestDurationMs: 3000,
        slowestDurationMs: 3000,
      },
      {
        phaseId: 3,
        phaseName: 'Phase Two',
        averageDurationMs: 3500,
        medianDurationMs: 3500,
        fastestDurationMs: 3000,
        slowestDurationMs: 4000,
      },
    ]);
  });
});

describe('rankings probe summaries', () => {
  it('summarizes supported role-bucket shape', () => {
    const payload = {
      data: [
        {
          fightID: 81,
          encounter: { name: 'Malkorok' },
          difficulty: 5,
          roles: {
            tanks: { characters: [{ id: 1 }, { id: 2 }] },
            healers: { characters: [{ id: 3 }] },
            dps: { characters: [{ id: 4 }, { id: 5 }, { id: 6 }] },
          },
        },
      ],
    };

    const summary = summarizeRankingsPayload(payload);
    expect(summary.logLine).toContain('type=object');
    expect(summary.logLine).toContain('dataLength=1');
    expect(summary.logLine).toContain('roles:[tanks|healers|dps]');
    expect(summary.logLine).toContain('characters={tanks:2,healers:1,dps:3}');
  });

  it('accepts supported rankings fixtures without parser warnings', () => {
    const warn = vi.fn();
    const reportEntries = parseReportRankingsPayload(
      {
        data: [
          {
            fightID: 81,
            encounter: { name: 'Malkorok' },
            difficulty: 5,
            roles: {
              tanks: {
                characters: [
                  {
                    id: 7,
                    name: 'Alyra',
                    rankPercent: 96.2,
                  },
                ],
              },
              healers: { characters: [] },
              dps: { characters: [] },
            },
          },
        ],
      },
      warn,
    );
    const bossEntries = parseBossRankingsPayload(
      {
        rankings: [{ id: 7, name: 'Alyra', bestPercent: 99.1 }],
      },
      { bossName: 'Malkorok', fightId: 81 },
      warn,
    );

    expect(reportEntries.length).toBeGreaterThan(0);
    expect(bossEntries.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import type { NormalizedPlayer, NormalizedReport } from '../index.js';
import { buildParticipantKey, extractComparisonSnapshots } from '../index.js';

type SnapshotFixturePlayer = NormalizedPlayer & {
  warcraftLogsGuid?: number;
  server?: string;
  region?: string;
  deaths?: number;
  interrupts?: number;
  dispels?: number;
};

const makeReport = (players: SnapshotFixturePlayer[]): NormalizedReport => ({
  reportCode: 'ABC123',
  title: 'Test Report',
  startTime: Date.parse('2026-04-09T00:00:00.000Z'),
  endTime: Date.parse('2026-04-09T03:00:00.000Z'),
  gameFamily: 'retail',
  fights: [],
  players,
});

describe('comparison snapshot extraction', () => {
  it('extracts required snapshot fields from a minimal normalized report fixture', () => {
    const report = makeReport([
      {
        id: '7',
        actorId: 7,
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.issues).toEqual([]);
    expect(result.snapshots).toEqual([
      {
        guildId: 'guild-1',
        reportCode: 'ABC123',
        reportStartedAt: new Date('2026-04-09T00:00:00.000Z'),
        participantKey: 'character:us:stormrage:yaysa',
        warcraftLogsActorId: 7,
        characterName: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
      },
    ]);
  });

  it('uses participantKey from identity helpers', () => {
    const report = makeReport([
      {
        id: '7',
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
      },
    ]);
    const expectedParticipantKey = buildParticipantKey({
      characterName: 'Yaysa',
      server: 'Stormrage',
      region: 'US',
    });

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]?.participantKey).toBe(expectedParticipantKey);
  });

  it('includes warcraftLogsGuid when available', () => {
    const report = makeReport([
      {
        id: '7',
        actorId: 7,
        warcraftLogsGuid: 99060818,
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({
      warcraftLogsActorId: 7,
      warcraftLogsGuid: 99060818,
    });
  });

  it('includes characterName, server, region, and realm when available', () => {
    const report = makeReport([
      {
        id: '7',
        name: 'Yaysa',
        server: 'Stormrage',
        realm: 'Stormrage',
        region: 'US',
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({
      characterName: 'Yaysa',
      server: 'Stormrage',
      region: 'US',
      realm: 'Stormrage',
    });
  });

  it('includes rankPercent when available from normalized report-wide rankings', () => {
    const report: NormalizedReport = {
      ...makeReport([
        {
          id: '7',
          actorId: 7,
          name: 'Yaysa',
          server: 'Stormrage',
          region: 'US',
        },
      ]),
      reportWideRankings: {
        dps: [
          {
            scope: 'report',
            playerId: 7,
            playerName: 'Yaysa',
            metric: 'rankPercent',
            value: 82,
            rankPercent: 82,
          },
        ],
        hps: [],
      },
    };

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({ rankPercent: 82 });
  });

  it('includes damageTotal and healingTotal when available from normalized report summary rows', () => {
    const report: NormalizedReport = {
      ...makeReport([
        {
          id: '7',
          name: 'Yaysa',
          server: 'Stormrage',
          region: 'US',
        },
      ]),
      reportWideSummary: {
        topDamageDone: [{ playerName: 'Yaysa', value: 1234 }],
        topHealingDone: [{ playerName: 'Yaysa', value: 5678 }],
        totals: {},
      },
    };

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({
      damageTotal: 1234,
      healingTotal: 5678,
    });
  });

  it('includes deaths when available on normalized participant data', () => {
    const report = makeReport([
      {
        id: '7',
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
        deaths: 2,
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({ deaths: 2 });
  });

  it('includes interrupts and dispels when available from normalized report summary rows', () => {
    const report: NormalizedReport = {
      ...makeReport([
        {
          id: '7',
          name: 'Yaysa',
          server: 'Stormrage',
          region: 'US',
        },
      ]),
      reportWideSummary: {
        topDamageDone: [],
        topHealingDone: [],
        topInterrupts: [{ playerName: 'Yaysa', value: 5 }],
        topDispels: [{ playerName: 'Yaysa', value: 1 }],
        totals: {},
      },
    };

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({
      interrupts: 5,
      dispels: 1,
    });
  });

  it('omits missing metrics instead of zeroing them', () => {
    const report = makeReport([
      {
        id: '7',
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).not.toHaveProperty('rankPercent');
    expect(result.snapshots[0]).not.toHaveProperty('damageTotal');
    expect(result.snapshots[0]).not.toHaveProperty('healingTotal');
    expect(result.snapshots[0]).not.toHaveProperty('deaths');
    expect(result.snapshots[0]).not.toHaveProperty('interrupts');
    expect(result.snapshots[0]).not.toHaveProperty('dispels');
  });

  it('preserves real zero values', () => {
    const report: NormalizedReport = {
      ...makeReport([
        {
          id: '7',
          name: 'Yaysa',
          server: 'Stormrage',
          region: 'US',
          deaths: 0,
        },
      ]),
      reportWideSummary: {
        topDamageDone: [{ playerName: 'Yaysa', value: 0 }],
        topHealingDone: [{ playerName: 'Yaysa', value: 0 }],
        topInterrupts: [{ playerName: 'Yaysa', value: 0 }],
        topDispels: [{ playerName: 'Yaysa', value: 0 }],
        totals: {},
      },
      reportWideRankings: {
        dps: [
          {
            scope: 'report',
            playerId: 7,
            playerName: 'Yaysa',
            metric: 'rankPercent',
            value: 0,
            rankPercent: 0,
          },
        ],
        hps: [],
      },
    };

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).toMatchObject({
      rankPercent: 0,
      damageTotal: 0,
      healingTotal: 0,
      deaths: 0,
      interrupts: 0,
      dispels: 0,
    });
  });

  it('skips and reports participants missing identity fields', () => {
    const report = makeReport([
      {
        id: '7',
        actorId: 7,
        name: 'Yaysa',
        server: 'Stormrage',
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: 'missing-participant-identity',
        reportCode: 'ABC123',
        characterName: 'Yaysa',
        server: 'Stormrage',
        warcraftLogsActorId: 7,
        reason: 'Character comparison requires a character ID or region, realm/server, and character name.',
      },
    ]);
  });

  it('does not include playerProfileId, payloads, display-only fields, or boss fields', () => {
    const report = makeReport([
      {
        id: '7',
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
        className: 'Rogue',
        specName: 'Subtlety',
        role: 'dps',
        playerProfileId: 'profile-1',
        rawPayload: { raw: true },
        normalizedPayload: { normalized: true },
        icon: 'Rogue-Subtlety',
      } as SnapshotFixturePlayer & {
        playerProfileId: string;
        rawPayload: unknown;
        normalizedPayload: unknown;
        icon: string;
      },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });
    const snapshot = result.snapshots[0];

    expect(snapshot).not.toHaveProperty('playerProfileId');
    expect(snapshot).not.toHaveProperty('rawPayload');
    expect(snapshot).not.toHaveProperty('normalizedPayload');
    expect(snapshot).not.toHaveProperty('className');
    expect(snapshot).not.toHaveProperty('specName');
    expect(snapshot).not.toHaveProperty('role');
    expect(snapshot).not.toHaveProperty('icon');
    expect(snapshot).not.toHaveProperty('bossName');
    expect(snapshot).not.toHaveProperty('bestBossName');
    expect(snapshot).not.toHaveProperty('lowestBossName');
  });

  it('does not infer mixed identity from participant fields', () => {
    const report = makeReport([
      {
        id: '7',
        warcraftLogsGuid: 99060818,
        name: 'Yaysa',
        server: 'Stormrage',
        region: 'US',
        playerProfileId: 'profile-1',
      } as SnapshotFixturePlayer & { playerProfileId: string },
    ]);

    const result = extractComparisonSnapshots({ guildId: 'guild-1', report });

    expect(result.snapshots[0]).not.toHaveProperty('playerProfileId');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportSummary } from '@wcl/domain';
import {
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import {
  buildReportArtifact,
  processReportInteraction,
} from './report.js';

vi.mock('../infrastructure/discord-api.js', () => ({
  editOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
  safeEditOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
}));

const summaryFixture = (): ReportSummary => ({
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
    highestTotalDps: [{ playerName: 'Alyra', value: 40_000 }],
    highestHps: [{ playerName: 'Alyra', value: 12_000 }],
    highestDamageTakenRate: [{ playerName: 'Bulwark', value: 18_000 }],
    mostDeaths: [{ playerName: 'Floorroller', value: 5 }],
    mostInterrupts: [{ playerName: 'Kickbot', value: 7 }],
    mostDispels: [{ playerName: 'Cleanse', value: 4 }],
  },
  partialDataNotes: [],
});

const flattenReportBody = (body: Record<string, unknown>): {
  fieldNames: string[];
  text: string;
} => {
  const embeds = body.embeds as Array<{ fields?: Array<{ name?: string; value?: string }> }>;
  const fields = embeds[0]?.fields ?? [];
  return {
    fieldNames: fields.map((field) => field.name ?? ''),
    text: fields.map((field) => `${field.name ?? ''}\n${field.value ?? ''}`).join('\n'),
  };
};

const expectNoReportDebugOutput = (body: Record<string, unknown>): void => {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('render-fingerprint');
  expect(serialized).not.toContain('report-runtime-canary');
  expect(serialized).not.toContain('report-path:');
};

describe('/report command render path', () => {
  beforeEach(() => {
    vi.mocked(editOriginalInteractionResponse).mockClear();
    vi.mocked(safeEditOriginalInteractionResponse).mockClear();
  });

  it('builds final embed payload with architecture sections and without removed legacy blocks', async () => {
    const wclClient = {
      fetchReportSummary: vi.fn().mockResolvedValue(summaryFixture()),
    } as never;

    const artifact = await buildReportArtifact({
      options: {
        wclClient,
      } as never,
      reportPath: 'slash-command',
      url: 'https://www.warcraftlogs.com/reports/ABC123',
    });

    const fields = artifact.responseBody.embeds[0]?.fields ?? [];
    const fieldNames = fields.map((field) => field.name);
    const flattenedValues = fields.map((field) => field.value).join('\n');
    const hasTopPlayersSection = fields.some(
      (field) => field.name === '🏋️‍♂️ Top Players' || field.value === '🏋️‍♂️ Top Players',
    );

    expect(flattenedValues).toContain('🗿 Encounter Highlights');
    expect(hasTopPlayersSection).toBe(true);
    expect(fieldNames).toContain('Best Execution ⚔️');
    expect(fieldNames).toContain('Biggest Trouble 👨‍🦼');
    expect(fieldNames).not.toContain('Highest Total Healing');
    expect(fieldNames).not.toContain('Highest Damage Taken');
    expect(fieldNames).not.toContain('Highest DPS');
    expectNoReportDebugOutput(artifact.responseBody as Record<string, unknown>);
    expect(flattenedValues).toContain('Highest Total DPS: Alyra - 40K/s');
    expect(flattenedValues).toContain('Highest Total HPS: Alyra - 12K/s');
    expect(flattenedValues).toContain('Highest Total DTPS: Bulwark - 18K/s');
    expect(flattenedValues).not.toContain('Highest Total HPS: unavailable');
    expect(flattenedValues).not.toContain('Highest Total DTPS: unavailable');
  });

  it('edits slash-command success with the public report body', async () => {
    const wclClient = {
      fetchReportSummary: vi.fn().mockResolvedValue(summaryFixture()),
    } as never;

    await processReportInteraction(
      {
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' } },
      },
      { wclClient } as never,
      'https://www.warcraftlogs.com/reports/ABC123',
    );

    expect(editOriginalInteractionResponse).toHaveBeenCalledTimes(1);
    const body = vi.mocked(editOriginalInteractionResponse).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('flags');

    const { fieldNames, text } = flattenReportBody(body);
    expect(text).toContain('🗿 Encounter Highlights');
    expect(text).toContain('🏋️‍♂️ Top Players');
    expectNoReportDebugOutput(body);
    expect(fieldNames).toContain('Best Execution ⚔️');
    expect(fieldNames).toContain('Biggest Trouble 👨‍🦼');
    expect(fieldNames).not.toContain('Highest Total Healing');
    expect(fieldNames).not.toContain('Highest Damage Taken');
    expect(fieldNames).not.toContain('Highest DPS');
  });

  it('keeps slash-command failure messages ephemeral', async () => {
    const wclClient = {
      fetchReportSummary: vi.fn().mockRejectedValue(new Error('failed')),
    } as never;

    await processReportInteraction(
      {
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' } },
      },
      { wclClient } as never,
      'https://www.warcraftlogs.com/reports/ABC123',
    );

    expect(editOriginalInteractionResponse).not.toHaveBeenCalled();
    expect(safeEditOriginalInteractionResponse).toHaveBeenCalledWith(
      'app-1',
      'token-1',
      expect.objectContaining({
        flags: 64,
        content: expect.stringContaining('Could not build a report summary'),
      }),
    );
  });
});

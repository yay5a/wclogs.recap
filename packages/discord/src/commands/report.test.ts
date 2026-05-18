import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportSummary } from '@wcl/domain';
import {
  editOriginalInteractionResponse,
  safeEditOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import { buildReportArtifact, processReportInteraction } from './report.js';

vi.mock('../infrastructure/discord-api.js', () => ({
  editOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
  safeEditOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../renderers/report.js', () => ({
  buildReportMessageFlags: vi.fn(
    (options: { ephemeral?: boolean }): number => 4 | (options.ephemeral ? 64 : 0),
  ),
  buildReportResponseBody: vi.fn(
    async (
      summary: ReportSummary,
      options: { ephemeral?: boolean } = {},
    ): Promise<Record<string, unknown>> => ({
      content: summary.reportLink,
      flags: 4 | ((options.ephemeral ?? true) ? 64 : 0),
      allowed_mentions: { parse: [] },
      files: [
        {
          name: 'report-summary.png',
          attachment: new Uint8Array([137, 80, 78, 71]),
          contentType: 'image/png',
          description: 'Raid report summary',
        },
      ],
    }),
  ),
}));

const SUPPRESS_EMBEDS_MESSAGE_FLAG = 1 << 2;
const EPHEMERAL_MESSAGE_FLAG = 1 << 6;

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
    highestParseDps: { metric: 'DPS', playerName: 'Alyra', value: 95 },
    highestParseHps: { metric: 'HPS', playerName: 'Alyra', value: 82 },
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
  },
  highestParses: {
    dps: { metric: 'DPS', playerName: 'Alyra', value: 85 },
    hps: { metric: 'HPS', playerName: 'Alyra', value: 80 },
  },
  topPlayers: {
    highestAverageParse: [{ playerName: 'Alyra', value: 88 }],
    highestTotalDamage: [{ playerName: 'Damagey', value: 9_900_000 }],
    highestTotalHealing: [{ playerName: 'Healz', value: 8_800_000 }],
    highestTotalDps: [{ playerName: 'Alyra', value: 40_000 }],
    highestHps: [{ playerName: 'Alyra', value: 12_000 }],
    mostDeaths: [{ playerName: 'Floorroller', value: 5 }],
    mostInterrupts: [{ playerName: 'Kickbot', value: 7 }],
    mostDispels: [{ playerName: 'Cleanse', value: 4 }],
  },
  partialDataNotes: [],
});

const expectReportImageBody = (body: Record<string, unknown>, ephemeral: boolean): void => {
  const files = body.files as Array<{
    name?: string;
    attachment?: unknown;
    contentType?: string;
    description?: string;
  }>;
  const flags = body.flags as number;

  expect(body.content).toBe('https://www.warcraftlogs.com/reports/ABC123');
  expect(body).not.toHaveProperty('embeds');
  expect(body).not.toHaveProperty('components');
  expect(flags & EPHEMERAL_MESSAGE_FLAG).toBe(ephemeral ? EPHEMERAL_MESSAGE_FLAG : 0);
  expect(flags & SUPPRESS_EMBEDS_MESSAGE_FLAG).toBe(SUPPRESS_EMBEDS_MESSAGE_FLAG);
  expect(body.allowed_mentions).toEqual({ parse: [] });
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    name: 'report-summary.png',
    contentType: 'image/png',
    description: 'Raid report summary',
  });
  expect(files[0]?.attachment).toBeInstanceOf(Uint8Array);
  expect(Array.from((files[0]?.attachment as Uint8Array).slice(0, 4))).toEqual([137, 80, 78, 71]);
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

  it('builds private and public PNG report payloads without debug output', async () => {
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

    expectReportImageBody(artifact.responseBody as Record<string, unknown>, true);
    expectReportImageBody(artifact.publicBody as Record<string, unknown>, false);
    expectNoReportDebugOutput(artifact.responseBody as Record<string, unknown>);
    expectNoReportDebugOutput(artifact.publicBody as Record<string, unknown>);
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
    expectReportImageBody(
      vi.mocked(editOriginalInteractionResponse).mock.calls[0]?.[2] as Record<string, unknown>,
      false,
    );
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

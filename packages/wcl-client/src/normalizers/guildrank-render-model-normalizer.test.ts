import { describe, expect, it } from 'vitest';
import { normalizeGuildRankRenderModel } from './guildrank-render-model-normalizer.js';
import type { GuildRankCollectorBundle } from '../pipeline/types.js';

const baseBundle = (): GuildRankCollectorBundle => ({
  input: {
    guildName: 'Guild',
    guildServerSlug: 'stormrage',
    guildServerRegion: 'us',
    zoneId: 100,
    difficulty: 'heroic',
    size: '10man',
  },
  windows: {
    currentStartMs: 0,
    currentEndMs: 1,
    baselineStartMs: 2,
    baselineEndMs: 3,
  },
  officialRanks: {
    progress: {},
    speed: {},
    completeRaidSpeed: {},
    source: 'unavailable',
    progressSource: 'unavailable',
  },
  currentReports: [],
  baselineReports: [],
  currentSpeed: {
    perEncounter: [
      { encounterName: 'Jinrokh', bestScore: 80 },
      { encounterName: 'Council', bestScore: 70 },
    ],
  },
  baselineSpeed: {
    perEncounter: [
      { encounterName: 'Jinrokh', bestScore: 70 },
      { encounterName: 'Council', bestScore: 60 },
    ],
  },
  currentExecution: { perEncounter: [] },
  baselineExecution: { perEncounter: [] },
  progressPulls: { pulls: 0, wipes: 0, clearedEncounters: 0, totalEncounters: 0 },
  currentWindowDiscovery: {
    candidateReports: 0,
    zoneMatchedReports: 0,
    difficultySizeMatchedReports: 0,
  },
  zoneName: 'Throne',
  difficultyLabel: 'Heroic',
  sizeLabel: '10man',
});

describe('guildrank render-model normalizer', () => {
  it('keeps the first sorted encounter when best-gain deltas tie', () => {
    const summary = normalizeGuildRankRenderModel(baseBundle());

    expect(summary.speed.bestEncounterGain).toEqual({ encounterName: 'Council', delta: 10 });
  });

  it('maps official speed rank positions separately from derived scores', () => {
    const bundle = baseBundle();
    bundle.officialRanks.speed = { world: 1273, region: 489, realm: 296 };
    bundle.officialRanks.completeRaidSpeed = { world: 389, region: 136, realm: 120 };

    const summary = normalizeGuildRankRenderModel(bundle);

    expect(summary.speed.ranks).toEqual({ world: 1273, region: 489, realm: 296 });
    expect(summary.speed.completeRaidRanks).toEqual({ world: 389, region: 136, realm: 120 });
    expect(summary.speed.overall.bestScore).toBe(75);
  });
});

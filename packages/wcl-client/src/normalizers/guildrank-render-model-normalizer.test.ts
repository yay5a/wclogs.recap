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
    source: 'unavailable',
    progressSource: 'unavailable',
  },
  currentReports: [],
  baselineReports: [],
  currentSpeed: {
    perEncounter: [
      { encounterName: 'Jinrokh', bestPercentile: 80 },
      { encounterName: 'Council', bestPercentile: 70 },
    ],
  },
  baselineSpeed: {
    perEncounter: [
      { encounterName: 'Jinrokh', bestPercentile: 70 },
      { encounterName: 'Council', bestPercentile: 60 },
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
});

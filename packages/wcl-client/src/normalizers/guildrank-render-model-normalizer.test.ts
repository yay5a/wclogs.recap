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
      { encounterName: 'Jinrokh', bestDerivedPercentile: 80 },
      { encounterName: 'Council', bestDerivedPercentile: 70 },
    ],
  },
  baselineSpeed: {
    perEncounter: [
      { encounterName: 'Jinrokh', bestDerivedPercentile: 70 },
      { encounterName: 'Council', bestDerivedPercentile: 60 },
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

  it('maps official speed rank positions separately from derived percentiles', () => {
    const bundle = baseBundle();
    bundle.officialRanks.speed = { world: 1273, region: 489, realm: 296 };
    bundle.officialRanks.completeRaidSpeed = { world: 389, region: 136, realm: 120 };

    const summary = normalizeGuildRankRenderModel(bundle);

    expect(summary.speed.ranks).toEqual({ world: 1273, region: 489, realm: 296 });
    expect(summary.speed.completeRaidRanks).toEqual({ world: 389, region: 136, realm: 120 });
    expect(summary.speed.overall.bestDerivedPercentile).toBe(75);
  });

  it('keeps speed and execution derived percentiles on separate encounter fields', () => {
    const bundle = baseBundle();
    bundle.currentExecution = {
      perEncounter: [{ encounterName: 'Jinrokh', bestDerivedPercentile: 40 }],
    };
    bundle.baselineExecution = {
      perEncounter: [{ encounterName: 'Jinrokh', bestDerivedPercentile: 30 }],
    };

    const summary = normalizeGuildRankRenderModel(bundle);

    expect(summary.speed.encounters.find((row) => row.encounterName === 'Jinrokh')).toMatchObject({
      speed: { bestDerivedPercentile: 80 },
      execution: {},
    });
    expect(
      summary.execution.encounters.find((row) => row.encounterName === 'Jinrokh'),
    ).toMatchObject({
      speed: {},
      execution: { bestDerivedPercentile: 40 },
    });
  });
});

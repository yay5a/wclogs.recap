import { describe, expect, it } from 'vitest';
import {
  COMPARE_MODES,
  DEFAULT_COMPARE_MODE,
  countNearDelta,
  defaultGuildConfigFor,
  historyLimit,
  isCompareMode,
  outputNearPercent,
  parseCompareMode,
  parseNearPercentilePoints,
  trustedSampleSize,
} from '../index.js';

describe('compare-mode contracts', () => {
  it('exposes the supported compare mode values', () => {
    expect(COMPARE_MODES).toEqual(['character', 'mixed']);
    expect(DEFAULT_COMPARE_MODE).toBe('character');
  });

  it('accepts valid compare mode strings', () => {
    expect(isCompareMode('character')).toBe(true);
    expect(isCompareMode('mixed')).toBe(true);
    expect(parseCompareMode('character')).toBe('character');
    expect(parseCompareMode('mixed')).toBe('mixed');
  });

  it('rejects invalid compare mode values', () => {
    expect(isCompareMode('Character')).toBe(false);
    expect(isCompareMode('alt')).toBe(false);
    expect(isCompareMode(undefined)).toBe(false);
    expect(parseCompareMode('Character')).toBeUndefined();
    expect(parseCompareMode('alt')).toBeUndefined();
    expect(parseCompareMode(undefined)).toBeUndefined();
  });

  it('defaults only where defaulting is explicitly chosen', () => {
    expect(parseCompareMode('alt') ?? DEFAULT_COMPARE_MODE).toBe('character');
    expect(defaultGuildConfigFor('guild-1').compareModeDefault).toBe('character');
  });
});

describe('comparison thresholds', () => {
  it('exports the MVP baseline constants', () => {
    expect(trustedSampleSize).toBe(3);
    expect(historyLimit).toBe(5);
    expect(parseNearPercentilePoints).toBe(5);
    expect(outputNearPercent).toBe(10);
    expect(countNearDelta).toBe(1);
  });
});

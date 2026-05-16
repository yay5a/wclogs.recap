import { describe, expect, it } from 'vitest';
import { GAME_FAMILIES, parseGameFamily } from './index.js';

describe('game families', () => {
  it('parses supported game families', () => {
    expect(GAME_FAMILIES).toEqual(['retail', 'mop_classic']);
    expect(parseGameFamily('retail')).toBe('retail');
    expect(parseGameFamily('mop_classic')).toBe('mop_classic');
    expect(parseGameFamily('classic')).toBeUndefined();
  });
});

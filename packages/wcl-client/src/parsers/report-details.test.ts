import { describe, expect, it, vi } from 'vitest';
import { parsePlayerDetailsPayload } from './report-details.js';

describe('playerDetails parser', () => {
  it('extracts class/spec/role from playerDetails payload', () => {
    const entries = parsePlayerDetailsPayload({
      players: {
        data: [
          {
            name: 'Alyra',
            class: 'Paladin',
            spec: 'Holy',
            role: 'Healer',
          },
        ],
      },
    });

    expect(entries[0]).toMatchObject({
      name: 'Alyra',
      className: 'Paladin',
      specName: 'Holy',
      role: 'Healer',
    });
  });

  it('extracts probe-backed Warcraft Logs participant identity fields', () => {
    const entries = parsePlayerDetailsPayload({
      data: {
        playerDetails: {
          dps: [
            {
              name: 'Yaysa',
              id: 7,
              guid: 99060818,
              type: 'Rogue',
              server: 'Stormrage',
              region: 'US',
            },
          ],
        },
      },
    });

    expect(entries[0]).toMatchObject({
      name: 'Yaysa',
      warcraftLogsActorId: 7,
      warcraftLogsGuid: 99060818,
      server: 'Stormrage',
      region: 'US',
      className: 'Rogue',
      role: 'dps',
    });
    expect(entries[0]).not.toHaveProperty('playerProfileId');
  });

  it('keeps missing probe-backed participant identity fields optional', () => {
    const entries = parsePlayerDetailsPayload({
      players: {
        data: [{ name: 'Alyra' }],
      },
    });

    expect(entries[0]).toEqual({ name: 'Alyra' });
  });

  it('does not throw on absent fields and logs warning', () => {
    const warn = vi.fn();
    expect(() => parsePlayerDetailsPayload({}, warn)).not.toThrow();
    const entries = parsePlayerDetailsPayload({}, warn);
    expect(entries).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns empty details silently for explicit empty playerDetails payload', () => {
    const warn = vi.fn();
    const entries = parsePlayerDetailsPayload({ data: { playerDetails: [] } }, warn);
    expect(entries).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns empty details silently when optional enrichment is absent', () => {
    const warn = vi.fn();
    expect(parsePlayerDetailsPayload(undefined, warn)).toEqual([]);
    expect(parsePlayerDetailsPayload(null, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

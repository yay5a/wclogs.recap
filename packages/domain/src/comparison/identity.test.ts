import { describe, expect, it } from 'vitest';
import {
  buildParticipantKey,
  normalizeIdentityPart,
  resolveCharacterComparisonIdentity,
  resolveComparisonIdentity,
  resolveMixedComparisonIdentity,
} from '../index.js';

describe('comparison identity normalization', () => {
  it('trims and lowercases identity parts', () => {
    expect(normalizeIdentityPart('  StormRage  ')).toBe('stormrage');
    expect(normalizeIdentityPart('   ')).toBeUndefined();
    expect(normalizeIdentityPart(null)).toBeUndefined();
  });
});

describe('participant keys', () => {
  it('uses a stable character ID when available', () => {
    expect(buildParticipantKey({ characterId: '  Character-123  ' })).toBe(
      'character-id:character-123',
    );
  });

  it('prefers stable character ID over fallback character fields', () => {
    expect(
      buildParticipantKey({
        characterId: '123',
        region: 'US',
        realm: 'Stormrage',
        characterName: 'Yaysa',
      }),
    ).toBe('character-id:123');
  });

  it('builds a fallback key from region, realm, and character name', () => {
    expect(
      buildParticipantKey({
        region: 'US',
        realm: 'Stormrage',
        characterName: 'Yaysa',
      }),
    ).toBe('character:us:stormrage:yaysa');
  });

  it('uses server as the realm fallback', () => {
    expect(
      buildParticipantKey({
        region: 'EU',
        server: 'Silvermoon',
        characterName: 'Altrogue',
      }),
    ).toBe('character:eu:silvermoon:altrogue');
  });

  it('trims and normalizes fallback key casing', () => {
    expect(
      buildParticipantKey({
        region: '  US ',
        realm: ' StormRage ',
        characterName: ' YAYSA ',
      }),
    ).toBe('character:us:stormrage:yaysa');
  });
});

describe('character comparison identity', () => {
  it('resolves exact character identity when participant key fields are available', () => {
    expect(
      resolveCharacterComparisonIdentity({
        region: 'US',
        realm: 'Stormrage',
        characterName: 'Yaysa',
      }),
    ).toEqual({
      status: 'ready',
      kind: 'character',
      participantKey: 'character:us:stormrage:yaysa',
    });
  });

  it('returns not-comparable when character name is missing without a stable character ID', () => {
    expect(resolveCharacterComparisonIdentity({ region: 'US', realm: 'Stormrage' })).toMatchObject({
      status: 'not-comparable',
    });
  });

  it('returns not-comparable when realm and server are missing without a stable character ID', () => {
    expect(
      resolveCharacterComparisonIdentity({ region: 'US', characterName: 'Yaysa' }),
    ).toMatchObject({
      status: 'not-comparable',
    });
  });

  it('returns not-comparable when region is missing without a stable character ID', () => {
    expect(
      resolveCharacterComparisonIdentity({ realm: 'Stormrage', characterName: 'Yaysa' }),
    ).toMatchObject({
      status: 'not-comparable',
    });
  });
});

describe('mixed comparison identity', () => {
  it('resolves player identity from explicit playerProfileId mapping', () => {
    expect(resolveMixedComparisonIdentity({ playerProfileId: '  Player-123  ' })).toEqual({
      status: 'ready',
      kind: 'player',
      playerProfileId: 'player-123',
    });
  });

  it('returns missing-player-mapping without playerProfileId', () => {
    expect(resolveMixedComparisonIdentity({})).toMatchObject({
      status: 'missing-player-mapping',
    });
  });

  it('does not return character-name-derived identity in mixed mode', () => {
    expect(
      resolveMixedComparisonIdentity({
        region: 'US',
        realm: 'Stormrage',
        characterName: 'Yaysa',
      }),
    ).toEqual({
      status: 'missing-player-mapping',
      reason: 'Mixed comparison requires an explicit playerProfileId mapping.',
    });
  });

  it('does not accept display name as player mapping', () => {
    expect(
      resolveMixedComparisonIdentity({
        characterName: 'Discord Display Name',
      }),
    ).toMatchObject({
      status: 'missing-player-mapping',
    });
  });

  it('does not fuzzy match character-like fields into a player identity', () => {
    expect(
      resolveMixedComparisonIdentity({
        region: 'US',
        realm: 'Stormrage',
        characterName: 'Yaysaalt',
      }),
    ).toMatchObject({
      status: 'missing-player-mapping',
    });
  });
});

describe('comparison identity routing', () => {
  it('routes character mode to participant key identity', () => {
    expect(
      resolveComparisonIdentity('character', {
        region: 'US',
        realm: 'Stormrage',
        characterName: 'Yaysa',
      }),
    ).toEqual({
      status: 'ready',
      kind: 'character',
      participantKey: 'character:us:stormrage:yaysa',
    });
  });

  it('routes mixed mode to explicit player identity only', () => {
    expect(resolveComparisonIdentity('mixed', { playerProfileId: 'player-1' })).toEqual({
      status: 'ready',
      kind: 'player',
      playerProfileId: 'player-1',
    });
  });
});

import type { CompareMode } from './compare-mode.js';

export type ComparisonIdentityStatus = 'ready' | 'not-comparable' | 'missing-player-mapping';

export type ComparisonIdentityKind = 'character' | 'player';

export interface ComparisonIdentityInput {
  characterId?: string | null;
  characterName?: string | null;
  realm?: string | null;
  server?: string | null;
  region?: string | null;
  playerProfileId?: string | null;
}

export interface ReadyCharacterComparisonIdentity {
  status: 'ready';
  kind: 'character';
  participantKey: string;
}

export interface ReadyPlayerComparisonIdentity {
  status: 'ready';
  kind: 'player';
  playerProfileId: string;
}

export interface NotComparableComparisonIdentity {
  status: 'not-comparable';
  reason: string;
}

export interface MissingPlayerMappingComparisonIdentity {
  status: 'missing-player-mapping';
  reason: string;
}

export type ComparisonIdentity =
  | ReadyCharacterComparisonIdentity
  | ReadyPlayerComparisonIdentity
  | NotComparableComparisonIdentity
  | MissingPlayerMappingComparisonIdentity;

const CHARACTER_ID_PREFIX = 'character-id';
const CHARACTER_KEY_PREFIX = 'character';

export const normalizeIdentityPart = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
};

export const buildParticipantKey = (input: ComparisonIdentityInput): string | undefined => {
  const characterId = normalizeIdentityPart(input.characterId);
  if (characterId) {
    return `${CHARACTER_ID_PREFIX}:${characterId}`;
  }

  const region = normalizeIdentityPart(input.region);
  const realm = normalizeIdentityPart(input.realm) ?? normalizeIdentityPart(input.server);
  const characterName = normalizeIdentityPart(input.characterName);

  if (!region || !realm || !characterName) {
    return undefined;
  }

  return `${CHARACTER_KEY_PREFIX}:${region}:${realm}:${characterName}`;
};

export const resolveCharacterComparisonIdentity = (
  input: ComparisonIdentityInput,
): ComparisonIdentity => {
  const participantKey = buildParticipantKey(input);

  if (!participantKey) {
    return {
      status: 'not-comparable',
      reason: 'Character comparison requires a character ID or region, realm/server, and character name.',
    };
  }

  return {
    status: 'ready',
    kind: 'character',
    participantKey,
  };
};

export const resolveMixedComparisonIdentity = (
  input: ComparisonIdentityInput,
): ComparisonIdentity => {
  const playerProfileId = normalizeIdentityPart(input.playerProfileId);

  if (!playerProfileId) {
    return {
      status: 'missing-player-mapping',
      reason: 'Mixed comparison requires an explicit playerProfileId mapping.',
    };
  }

  return {
    status: 'ready',
    kind: 'player',
    playerProfileId,
  };
};

export const resolveComparisonIdentity = (
  compareMode: CompareMode,
  input: ComparisonIdentityInput,
): ComparisonIdentity => {
  switch (compareMode) {
    case 'character':
      return resolveCharacterComparisonIdentity(input);
    case 'mixed':
      return resolveMixedComparisonIdentity(input);
  }
};

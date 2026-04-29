export const COMPARE_ACCESS_MODES = [
  'officer_only',
  'owner_or_officer',
  'owner_opt_in_or_officer',
] as const;

export type CompareAccessMode = (typeof COMPARE_ACCESS_MODES)[number];

export const DEFAULT_COMPARE_ACCESS_MODE: CompareAccessMode = 'officer_only';

export const isCompareAccessMode = (value: unknown): value is CompareAccessMode =>
  typeof value === 'string' &&
  (COMPARE_ACCESS_MODES as readonly string[]).includes(value);

export const parseCompareAccessMode = (value: unknown): CompareAccessMode | undefined =>
  isCompareAccessMode(value) ? value : undefined;

export const COMPARE_VISIBILITIES = ['private', 'public'] as const;

export type CompareVisibility = (typeof COMPARE_VISIBILITIES)[number];

export const DEFAULT_COMPARE_VISIBILITY: CompareVisibility = 'private';

export const isCompareVisibility = (value: unknown): value is CompareVisibility =>
  typeof value === 'string' &&
  (COMPARE_VISIBILITIES as readonly string[]).includes(value);

export const parseCompareVisibility = (value: unknown): CompareVisibility | undefined =>
  isCompareVisibility(value) ? value : undefined;

export const CHARACTER_CLAIM_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'revoked',
] as const;

export type CharacterClaimStatus = (typeof CHARACTER_CLAIM_STATUSES)[number];

export const isCharacterClaimStatus = (value: unknown): value is CharacterClaimStatus =>
  typeof value === 'string' &&
  (CHARACTER_CLAIM_STATUSES as readonly string[]).includes(value);

export type CompareAuthorizationReason =
  | 'officer'
  | 'owner'
  | 'target-opted-in'
  | 'guild-open'
  | 'public-post-owner'
  | 'public-post-target-opted-in'
  | 'not-authorized'
  | 'missing-approved-claim'
  | 'public-post-disabled'
  | 'target-public-post-not-enabled';

export interface CompareAuthorizationGuildSettings {
  compareAccessMode: CompareAccessMode;
  compareOfficerRoleIds: readonly string[];
  comparePublicPostingEnabled: boolean;
}

export interface CompareRequesterContext {
  requesterDiscordUserId: string;
  requesterRoleIds?: readonly string[];
  requesterPermissions?: string | number | bigint | null | undefined;
}

export interface CompareApprovedCharacterClaim {
  discordUserId: string;
  participantKey: string;
  peerCompareOptIn: boolean;
  publicPostOptIn: boolean;
}

export interface CompareAuthorizationInput extends CompareRequesterContext {
  targetParticipantKey: string;
  requestedVisibility: CompareVisibility;
  guildSettings: CompareAuthorizationGuildSettings;
  requesterApprovedClaim?: CompareApprovedCharacterClaim | null;
  targetApprovedClaims?: readonly CompareApprovedCharacterClaim[];
}

export interface CompareAuthorizationDecision {
  allowed: boolean;
  reason: CompareAuthorizationReason;
  requestedVisibility: CompareVisibility;
  isOfficer: boolean;
  isOwner: boolean;
}

const ADMINISTRATOR_PERMISSION = 0x8n;
const MANAGE_GUILD_PERMISSION = 0x20n;

const parsePermissions = (value: string | number | bigint | null | undefined): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
};

export const hasDiscordPermission = (
  permissions: string | number | bigint | null | undefined,
  permission: 'administrator' | 'manage-guild',
): boolean => {
  const parsed = parsePermissions(permissions);
  const bit = permission === 'administrator' ? ADMINISTRATOR_PERMISSION : MANAGE_GUILD_PERMISSION;
  return (parsed & bit) === bit;
};

export const isCompareOfficer = ({
  requesterRoleIds = [],
  requesterPermissions,
  guildSettings,
}: CompareRequesterContext & {
  guildSettings: Pick<CompareAuthorizationGuildSettings, 'compareOfficerRoleIds'>;
}): boolean => {
  if (hasDiscordPermission(requesterPermissions, 'administrator')) return true;
  if (hasDiscordPermission(requesterPermissions, 'manage-guild')) return true;

  const requesterRoles = new Set(requesterRoleIds);
  return guildSettings.compareOfficerRoleIds.some((roleId) => requesterRoles.has(roleId));
};

const isApprovedClaimForRequester = (
  claim: CompareApprovedCharacterClaim | null | undefined,
  requesterDiscordUserId: string,
  targetParticipantKey: string,
): boolean =>
  claim?.discordUserId === requesterDiscordUserId &&
  claim.participantKey === targetParticipantKey;

const hasTargetPeerOptIn = (claims: readonly CompareApprovedCharacterClaim[]): boolean =>
  claims.some((claim) => claim.peerCompareOptIn);

const hasTargetPublicPostOptIn = (claims: readonly CompareApprovedCharacterClaim[]): boolean =>
  claims.some((claim) => claim.publicPostOptIn);

export const authorizeCompareRequest = ({
  requesterDiscordUserId,
  requesterRoleIds = [],
  requesterPermissions,
  targetParticipantKey,
  requestedVisibility,
  guildSettings,
  requesterApprovedClaim,
  targetApprovedClaims = [],
}: CompareAuthorizationInput): CompareAuthorizationDecision => {
  const isOfficer = isCompareOfficer({
    requesterDiscordUserId,
    requesterRoleIds,
    requesterPermissions,
    guildSettings,
  });
  const isOwner = isApprovedClaimForRequester(
    requesterApprovedClaim,
    requesterDiscordUserId,
    targetParticipantKey,
  );

  let privateReason: CompareAuthorizationReason | undefined;
  if (isOfficer) {
    privateReason = 'officer';
  } else if (guildSettings.compareAccessMode !== 'officer_only' && isOwner) {
    privateReason = 'owner';
  } else if (
    guildSettings.compareAccessMode === 'owner_opt_in_or_officer' &&
    hasTargetPeerOptIn(targetApprovedClaims)
  ) {
    privateReason = 'target-opted-in';
  }

  if (!privateReason) {
    return {
      allowed: false,
      reason: requesterApprovedClaim ? 'not-authorized' : 'missing-approved-claim',
      requestedVisibility,
      isOfficer,
      isOwner,
    };
  }

  if (requestedVisibility === 'private') {
    return {
      allowed: true,
      reason: privateReason,
      requestedVisibility,
      isOfficer,
      isOwner,
    };
  }

  if (!guildSettings.comparePublicPostingEnabled) {
    return {
      allowed: false,
      reason: 'public-post-disabled',
      requestedVisibility,
      isOfficer,
      isOwner,
    };
  }

  if (isOwner) {
    return {
      allowed: true,
      reason: 'public-post-owner',
      requestedVisibility,
      isOfficer,
      isOwner,
    };
  }

  if (isOfficer && hasTargetPublicPostOptIn(targetApprovedClaims)) {
    return {
      allowed: true,
      reason: 'public-post-target-opted-in',
      requestedVisibility,
      isOfficer,
      isOwner,
    };
  }

  return {
    allowed: false,
    reason: 'target-public-post-not-enabled',
    requestedVisibility,
    isOfficer,
    isOwner,
  };
};

export const getCompareAuthorizationDenialMessage = (
  decision: CompareAuthorizationDecision,
): string => {
  if (decision.allowed) return '';
  if (decision.reason === 'public-post-disabled') {
    return 'Public compare posting is not enabled for this server.';
  }
  if (decision.reason === 'target-public-post-not-enabled') {
    return 'This comparison can be viewed privately, but it cannot be posted publicly.';
  }
  return 'This comparison is limited to the character owner or authorized raid roles.';
};

import { describe, expect, it } from 'vitest';
import {
  authorizeCompareRequest,
  DEFAULT_COMPARE_ACCESS_MODE,
  DEFAULT_COMPARE_VISIBILITY,
  defaultGuildConfigFor,
  getCompareAuthorizationDenialMessage,
  hasDiscordPermission,
  isCompareOfficer,
  parseCompareAccessMode,
  parseCompareVisibility,
  type CompareAccessMode,
  type CompareApprovedCharacterClaim,
  type CompareVisibility,
} from '../index.js';

const participantKey = 'character:us:stormrage:alyra';

const makeGuildSettings = (
  overrides: Partial<{
    compareAccessMode: CompareAccessMode;
    compareOfficerUserIds: string[];
    comparePublicPostingEnabled: boolean;
  }> = {},
) => ({
  compareAccessMode: 'owner_or_officer' as const,
  compareOfficerUserIds: [],
  comparePublicPostingEnabled: false,
  ...overrides,
});

const ownerClaim: CompareApprovedCharacterClaim = {
  discordUserId: 'owner-1',
  participantKey,
  peerCompareOptIn: false,
  publicPostOptIn: false,
};

const authorize = (overrides: Partial<Parameters<typeof authorizeCompareRequest>[0]> = {}) =>
  authorizeCompareRequest({
    requesterDiscordUserId: 'peer-1',
    requesterPermissions: '0',
    targetParticipantKey: participantKey,
    requestedVisibility: 'private',
    guildSettings: makeGuildSettings(),
    requesterHasAnyApprovedClaim: false,
    requesterApprovedClaim: null,
    targetApprovedClaims: [ownerClaim],
    ...overrides,
  });

describe('compare privacy contracts', () => {
  it('exports safe defaults', () => {
    expect(DEFAULT_COMPARE_ACCESS_MODE).toBe('officer_only');
    expect(DEFAULT_COMPARE_VISIBILITY).toBe('private');
    expect(defaultGuildConfigFor('guild-1')).toMatchObject({
      compareAccessMode: 'officer_only',
      compareOfficerUserIds: [],
      comparePublicPostingEnabled: false,
    });
  });

  it('parses known access mode and visibility values only', () => {
    expect(parseCompareAccessMode('owner_or_officer')).toBe('owner_or_officer');
    expect(parseCompareAccessMode('owner_only')).toBe('owner_only');
    expect(parseCompareAccessMode('everyone')).toBeUndefined();
    expect(parseCompareVisibility('public')).toBe('public');
    expect(parseCompareVisibility('channel')).toBeUndefined();
  });
});

describe('compare officer detection', () => {
  it('accepts Administrator permission', () => {
    expect(hasDiscordPermission('8', 'administrator')).toBe(true);
    expect(
      isCompareOfficer({
        requesterDiscordUserId: 'user-1',
        requesterPermissions: '8',
        guildSettings: makeGuildSettings(),
      }),
    ).toBe(true);
  });

  it('accepts Manage Guild permission', () => {
    expect(hasDiscordPermission('32', 'manage-guild')).toBe(true);
    expect(
      isCompareOfficer({
        requesterDiscordUserId: 'user-1',
        requesterPermissions: '32',
        guildSettings: makeGuildSettings(),
      }),
    ).toBe(true);
  });

  it('accepts configured compare officer users', () => {
    expect(
      isCompareOfficer({
        requesterDiscordUserId: 'officer-1',
        requesterPermissions: '0',
        guildSettings: makeGuildSettings({ compareOfficerUserIds: ['officer-1', 'officer-2'] }),
      }),
    ).toBe(true);
  });

  it('rejects unlisted users without Discord permissions', () => {
    expect(
      isCompareOfficer({
        requesterDiscordUserId: 'user-1',
        requesterPermissions: '0',
        guildSettings: makeGuildSettings({ compareOfficerUserIds: ['officer-1'] }),
      }),
    ).toBe(false);
  });

  it('does not accept unlisted users as officer authorization', () => {
    expect(
      isCompareOfficer({
        requesterDiscordUserId: 'user-1',
        requesterPermissions: '0',
        guildSettings: makeGuildSettings({
          compareOfficerUserIds: [],
        }),
      }),
    ).toBe(false);
  });
});

describe('compare authorization', () => {
  it('requires any approved claim before officer/admin privileges can authorize compare', () => {
    expect(
      authorize({
        requesterPermissions: '8',
        guildSettings: makeGuildSettings({ compareAccessMode: 'officer_only' }),
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'missing-approved-claim',
      isOfficer: true,
    });
  });

  it('allows officers with an approved claim to privately view any exact-character target', () => {
    expect(
      authorize({
        requesterPermissions: '8',
        guildSettings: makeGuildSettings({ compareAccessMode: 'officer_only' }),
        requesterHasAnyApprovedClaim: true,
      }),
    ).toMatchObject({
      allowed: true,
      reason: 'officer',
      isOfficer: true,
    });
  });

  it('allows approved owners when guild mode permits owners', () => {
    expect(
      authorize({
        requesterDiscordUserId: 'owner-1',
        requesterApprovedClaim: ownerClaim,
        requesterHasAnyApprovedClaim: true,
        guildSettings: makeGuildSettings({ compareAccessMode: 'owner_or_officer' }),
      }),
    ).toMatchObject({
      allowed: true,
      reason: 'owner',
      isOwner: true,
    });
  });

  it('denies owners when guild mode is officer-only', () => {
    expect(
      authorize({
        requesterDiscordUserId: 'owner-1',
        requesterApprovedClaim: ownerClaim,
        requesterHasAnyApprovedClaim: true,
        guildSettings: makeGuildSettings({ compareAccessMode: 'officer_only' }),
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'not-authorized',
      isOwner: true,
    });
  });

  it('denies peers when the target has not opted in', () => {
    const decision = authorize();

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'missing-approved-claim',
    });
    expect(getCompareAuthorizationDenialMessage(decision)).toBe(
      'You need an approved character claim before using /compare.',
    );
  });

  it('denies claimed peers when the target has not opted in', () => {
    const decision = authorize({
      requesterHasAnyApprovedClaim: true,
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'not-authorized',
    });
    expect(getCompareAuthorizationDenialMessage(decision)).toBe(
      'This comparison is limited to the character owner or authorized officers.',
    );
  });

  it('allows peers only when target opted in and guild mode allows it', () => {
    expect(
      authorize({
        guildSettings: makeGuildSettings({ compareAccessMode: 'owner_opt_in_or_officer' }),
        requesterHasAnyApprovedClaim: true,
        targetApprovedClaims: [{ ...ownerClaim, peerCompareOptIn: true }],
      }),
    ).toMatchObject({
      allowed: true,
      reason: 'target-opted-in',
    });
  });

  it('denies public post when public posting is disabled', () => {
    const decision = authorize({
      requesterDiscordUserId: 'owner-1',
      requesterApprovedClaim: ownerClaim,
      requesterHasAnyApprovedClaim: true,
      requestedVisibility: 'public',
      guildSettings: makeGuildSettings({
        compareAccessMode: 'owner_or_officer',
        comparePublicPostingEnabled: false,
      }),
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'public-post-disabled',
    });
    expect(getCompareAuthorizationDenialMessage(decision)).toBe(
      'Public compare posting is not enabled for this server.',
    );
  });

  it('allows owners to publicly post own comparison when guild posting is enabled', () => {
    expect(
      authorize({
        requesterDiscordUserId: 'owner-1',
        requesterApprovedClaim: ownerClaim,
        requesterHasAnyApprovedClaim: true,
        requestedVisibility: 'public',
        guildSettings: makeGuildSettings({
          compareAccessMode: 'owner_or_officer',
          comparePublicPostingEnabled: true,
        }),
      }),
    ).toMatchObject({
      allowed: true,
      reason: 'public-post-owner',
    });
  });

  it('requires target public-post opt-in for officer public posting', () => {
    const denied = authorize({
      requesterDiscordUserId: 'officer-1',
      requesterPermissions: '8',
      requesterHasAnyApprovedClaim: true,
      requestedVisibility: 'public',
      guildSettings: makeGuildSettings({
        compareAccessMode: 'officer_only',
        comparePublicPostingEnabled: true,
      }),
      targetApprovedClaims: [ownerClaim],
    });
    const allowed = authorize({
      requesterDiscordUserId: 'officer-1',
      requesterPermissions: '8',
      requesterHasAnyApprovedClaim: true,
      requestedVisibility: 'public',
      guildSettings: makeGuildSettings({
        compareAccessMode: 'officer_only',
        comparePublicPostingEnabled: true,
      }),
      targetApprovedClaims: [{ ...ownerClaim, publicPostOptIn: true }],
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: 'target-public-post-not-enabled',
    });
    expect(getCompareAuthorizationDenialMessage(denied)).toBe(
      'This comparison can be viewed privately, but it cannot be posted publicly.',
    );
    expect(allowed).toMatchObject({
      allowed: true,
      reason: 'public-post-target-opted-in',
    });
  });

  it('allows only the target owner in owner-only mode', () => {
    const owner = authorize({
      requesterDiscordUserId: 'owner-1',
      requesterApprovedClaim: ownerClaim,
      requesterHasAnyApprovedClaim: true,
      guildSettings: makeGuildSettings({ compareAccessMode: 'owner_only' }),
    });
    const officer = authorize({
      requesterDiscordUserId: 'officer-1',
      requesterPermissions: '8',
      requesterHasAnyApprovedClaim: true,
      guildSettings: makeGuildSettings({ compareAccessMode: 'owner_only' }),
    });
    const optedInPeer = authorize({
      requesterHasAnyApprovedClaim: true,
      guildSettings: makeGuildSettings({ compareAccessMode: 'owner_only' }),
      targetApprovedClaims: [{ ...ownerClaim, peerCompareOptIn: true }],
    });

    expect(owner).toMatchObject({
      allowed: true,
      reason: 'owner',
    });
    expect(officer).toMatchObject({
      allowed: false,
      reason: 'owner-only',
      isOfficer: true,
    });
    expect(optedInPeer).toMatchObject({
      allowed: false,
      reason: 'owner-only',
    });
    expect(getCompareAuthorizationDenialMessage(officer)).toBe(
      'This comparison is limited to the approved character owner.',
    );
  });

  it('keeps denial messages privacy-safe', () => {
    const deniedPeer = authorize({
      requesterHasAnyApprovedClaim: true,
      targetApprovedClaims: [{ ...ownerClaim, peerCompareOptIn: false, publicPostOptIn: false }],
    });
    const deniedPublic = authorize({
      requesterDiscordUserId: 'officer-1',
      requesterPermissions: '8',
      requesterHasAnyApprovedClaim: true,
      requestedVisibility: 'public' as CompareVisibility,
      guildSettings: makeGuildSettings({
        compareAccessMode: 'officer_only',
        comparePublicPostingEnabled: true,
      }),
      targetApprovedClaims: [{ ...ownerClaim, publicPostOptIn: false }],
    });

    expect(getCompareAuthorizationDenialMessage(deniedPeer)).not.toMatch(/opted|privacy setting/i);
    expect(getCompareAuthorizationDenialMessage(deniedPublic)).not.toMatch(
      /opted|privacy setting/i,
    );
  });
});

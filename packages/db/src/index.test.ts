import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COMPARE_ACCESS_MODE,
  DEFAULT_COMPARE_MODE,
  defaultGuildConfigFor,
  historyLimit,
  type RecapSummary,
} from '@wcl/domain';
import {
  CharacterClaimModel,
  COMPARISON_SNAPSHOT_HISTORY_PROJECTION,
  ComparisonSnapshotModel,
  GuildSettingsModel,
  migrateCharacterClaimIdentityFields,
  migrateRecapPreviewStateIndexes,
  MongoAutoRecapDuplicateTrackingStore,
  MongoAutoRecapPromptStateStore,
  MongoCharacterClaimStore,
  MongoComparisonHistoryStore,
  MongoGuildConfigStore,
  MongoRecapPreviewStateStore,
  AutoRecapDuplicateTrackingModel,
  AutoRecapPromptStateModel,
  RecapPreviewStateModel,
  MongoTrendTrackingService,
  PlayerRaidSummaryModel,
  ReportCacheModel,
  TrendSnapshotModel,
} from './index.js';

const makeRecapSummary = (): RecapSummary => ({
  reportTitle: 'Boss - Mythic - Zone',
  titleLine: 'Boss - Mythic - Zone',
  secondaryLine: 'Guild on Realm-US',
  reportDateISO: new Date(0).toISOString(),
  reportDateLabel: '01/01/1970',
  killTimeLabel: '45 Min',
  pullCount: 9,
  reportLink: 'https://www.warcraftlogs.com/reports/ABC123',
  gameFamily: 'retail',
  bossesKilled: 1,
  compareModeUsed: 'mixed',
  accountabilityVisibility: 'officers-only',
  coachingShareability: 'shareable',
  recapPostMode: 'preview-and-post',
  fastestPhaseTimes: [],
  topDamageDone: [],
  topHealingDone: [],
  topDamageTaken: [],
  topInterrupts: [],
  topDispels: [],
  topSurvivability: [],
  topHealers: [],
  totals: {
    totalDeaths: 0,
    raidDamageTaken: 0,
    dispels: 0,
    battleRezzes: 0,
    kicks: 0,
  },
  highestParses: [],
  topDamageAverageParses: [],
  topHealingAverageParses: [],
  bossHighlights: [],
  raidSuperlatives: [],
  teamNote: 'Team note',
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MongoGuildConfigStore', () => {
  it('returns defaults when config does not exist', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.guildId).toBe('guild-1');
    expect(config.compareModeDefault).toBe(DEFAULT_COMPARE_MODE);
    expect(config.compareAccessMode).toBe(DEFAULT_COMPARE_ACCESS_MODE);
    expect(config.compareOfficerUserIds).toEqual([]);
    expect(config.comparePublicPostingEnabled).toBe(false);
    expect(config.accountabilityVisibility).toBe('off');
    expect(config.autoRecapMode).toBe('prompt');
    expect(config.autoRecapChannelIds).toEqual([]);
  });

  it('defaults compare mode when persisted config is missing compareModeDefault', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.compareModeDefault).toBe(DEFAULT_COMPARE_MODE);
  });

  it('defaults compare mode when persisted config contains an invalid value', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'alts',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.compareModeDefault).toBe(DEFAULT_COMPARE_MODE);
  });

  it('defaults compare privacy config when persisted values are missing or invalid', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        compareAccessMode: 'guild_open',
        compareOfficerUserIds: ['user-1', 42, 'user-2', 'user-1'],
        comparePublicPostingEnabled: 'yes',
        autoRecapMode: 'always',
        autoRecapChannelIds: ['channel-1', 42, 'channel-1', 'channel-2'],
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.compareAccessMode).toBe(DEFAULT_COMPARE_ACCESS_MODE);
    expect(config.compareOfficerUserIds).toEqual(['user-1', 'user-2']);
    expect(config.comparePublicPostingEnabled).toBe(false);
    expect(config.autoRecapMode).toBe('prompt');
    expect(config.autoRecapChannelIds).toEqual(['channel-1', 'channel-2']);
  });

  it('persists configured values via upsert', async () => {
    const lean = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
      recapPostModeDefault: 'preview-only',
      compareAccessMode: 'owner_only',
      compareOfficerUserIds: ['user-1'],
      comparePublicPostingEnabled: true,
      autoRecapMode: 'auto_preview',
      autoRecapChannelIds: ['channel-1'],
    });
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean,
    } as never);

    const store = new MongoGuildConfigStore();
    const saved = await store.saveGuildConfig('guild-1', {
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
      recapPostModeDefault: 'preview-only',
      compareAccessMode: 'owner_only',
      compareOfficerUserIds: ['user-1'],
      comparePublicPostingEnabled: true,
      autoRecapMode: 'auto_preview',
      autoRecapChannelIds: ['channel-1'],
    });

    expect(saved.defaultGameFamily).toBe('mop_classic');
    expect(saved.compareModeDefault).toBe('mixed');
    expect(saved.compareAccessMode).toBe('owner_only');
    expect(saved.compareOfficerUserIds).toEqual(['user-1']);
    expect(saved.comparePublicPostingEnabled).toBe(true);
    expect(saved.autoRecapMode).toBe('auto_preview');
    expect(saved.autoRecapChannelIds).toEqual(['channel-1']);
    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledOnce();
  });

  it('adds compare officer users atomically', async () => {
    const lean = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      compareOfficerUserIds: ['user-1'],
    });
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean,
    } as never);

    const store = new MongoGuildConfigStore();
    const saved = await store.addCompareOfficerUser('guild-1', ' user-1 ');

    expect(saved.compareOfficerUserIds).toEqual(['user-1']);
    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: 'guild-1' }),
      expect.objectContaining({
        $setOnInsert: { guildId: 'guild-1' },
        $addToSet: { compareOfficerUserIds: 'user-1' },
        $unset: { dashboardDeconfiguredAt: '' },
      }),
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  });

  it('removes compare officer users atomically', async () => {
    const lean = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      compareOfficerUserIds: [],
    });
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean,
    } as never);

    const store = new MongoGuildConfigStore();
    const saved = await store.removeCompareOfficerUser('guild-1', 'user-1');

    expect(saved.compareOfficerUserIds).toEqual([]);
    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'guild-1' },
      expect.objectContaining({
        $setOnInsert: { guildId: 'guild-1' },
        $pull: { compareOfficerUserIds: 'user-1' },
        $unset: { dashboardDeconfiguredAt: '' },
      }),
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  });

  it('lists dashboard guild config summaries without exposing officer IDs', async () => {
    const updatedAt = new Date('2026-04-20T00:00:00.000Z');
    vi.spyOn(GuildSettingsModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          guildId: '223456789012345678',
          compareOfficerUserIds: ['user-1', 'user-2'],
          autoRecapChannelIds: ['channel-1'],
          updatedAt,
        },
        {
          guildId: '123456789012345678',
          defaultGameFamily: 'mop_classic',
        },
      ]),
    } as never);

    const store = new MongoGuildConfigStore();
    const summaries = await store.listGuildConfigSummaries();

    expect(summaries).toEqual([
      expect.objectContaining({
        guildId: '123456789012345678',
        defaultGameFamily: 'mop_classic',
        compareOfficerUserCount: 0,
        autoRecapChannelCount: 0,
      }),
      expect.objectContaining({
        guildId: '223456789012345678',
        compareOfficerUserCount: 2,
        autoRecapChannelCount: 1,
        updatedAt: updatedAt.toISOString(),
      }),
    ]);
    expect(summaries[1]).not.toHaveProperty('compareOfficerUserIds');
  });

  it('lists dashboard guild config summaries for an explicit guild allow-list', async () => {
    const find = vi.spyOn(GuildSettingsModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          guildId: '223456789012345678',
          compareOfficerUserIds: ['user-1'],
        },
      ]),
    } as never);

    const store = new MongoGuildConfigStore();
    const summaries = await store.listGuildConfigSummariesForGuilds([
      '223456789012345678',
      '223456789012345678',
      '  ',
    ]);

    expect(summaries).toEqual([
      expect.objectContaining({
        guildId: '223456789012345678',
        compareOfficerUserCount: 1,
      }),
    ]);
    expect(find).toHaveBeenCalledWith({
      guildId: { $in: ['223456789012345678'] },
      $or: [{ dashboardDeconfiguredAt: { $exists: false } }, { dashboardDeconfiguredAt: null }],
    });
  });

  it('returns no dashboard guild summaries for an empty allow-list without querying', async () => {
    const find = vi.spyOn(GuildSettingsModel, 'find');

    const store = new MongoGuildConfigStore();
    await expect(store.listGuildConfigSummariesForGuilds([])).resolves.toEqual([]);

    expect(find).not.toHaveBeenCalled();
  });

  it('returns null for missing existing dashboard guild config reads', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoGuildConfigStore();
    await expect(store.getExistingGuildConfig('guild-1')).resolves.toBeNull();
  });

  it('creates default dashboard guild config explicitly and idempotently', async () => {
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.createDefaultGuildConfig('guild-1');

    expect(config.guildId).toBe('guild-1');
    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'guild-1' },
      {
        $setOnInsert: defaultGuildConfigFor('guild-1'),
        $unset: { dashboardDeconfiguredAt: '' },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  });

  it('updates only existing dashboard guild configs', async () => {
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoGuildConfigStore();
    await expect(
      store.saveExistingGuildConfig('guild-1', { compareModeDefault: 'mixed' }),
    ).resolves.toBeNull();

    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: 'guild-1' }),
      {
        $set: {
          compareModeDefault: 'mixed',
        },
        $unset: { dashboardDeconfiguredAt: '' },
      },
      {
        new: true,
      },
    );
  });

  it('adds and removes dashboard officers only on existing guild configs', async () => {
    const findOneAndUpdate = vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        compareOfficerUserIds: ['user-1'],
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    await expect(store.addOfficerToExistingGuild('guild-1', ' user-1 ')).resolves.toMatchObject({
      compareOfficerUserIds: ['user-1'],
    });
    expect(findOneAndUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ guildId: 'guild-1' }),
      {
        $addToSet: { compareOfficerUserIds: 'user-1' },
      },
      {
        new: true,
      },
    );

    await expect(store.removeOfficerFromExistingGuild('guild-1', 'user-1')).resolves.toMatchObject({
      compareOfficerUserIds: ['user-1'],
    });
    expect(findOneAndUpdate).toHaveBeenLastCalledWith(
      {
        guildId: 'guild-1',
        $or: [{ dashboardDeconfiguredAt: { $exists: false } }, { dashboardDeconfiguredAt: null }],
      },
      {
        $pull: { compareOfficerUserIds: 'user-1' },
      },
      {
        new: true,
      },
    );
  });
});

describe('MongoCharacterClaimStore', () => {
  const requestedAt = new Date('2026-04-09T00:00:00.000Z');
  const reviewedAt = new Date('2026-04-10T00:00:00.000Z');
  const claimInput = {
    guildId: 'guild-1',
    discordUserId: 'user-1',
    participantKey: 'character:us:stormrage:alyra',
    characterName: 'Alyra',
    region: 'US',
    realm: 'Stormrage',
  };
  const makeClaim = (overrides: Record<string, unknown> = {}) => ({
    ...claimInput,
    status: 'pending',
    peerCompareOptIn: false,
    publicPostOptIn: false,
    requestedAt,
    ...overrides,
  });

  const mockFindOneLean = (value: unknown) => {
    vi.spyOn(CharacterClaimModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(value),
    } as never);
  };

  it('defines active character uniqueness and lookup indexes without display identity fields', () => {
    const indexes = CharacterClaimModel.schema.indexes();
    const hasActiveCharacterUniqueness = indexes.some(
      ([fields, options]) =>
        fields.guildId === 1 &&
        fields.region === 1 &&
        fields.normalizedRealm === 1 &&
        fields.normalizedCharacterName === 1 &&
        options.unique === true &&
        JSON.stringify(options.partialFilterExpression) ===
          JSON.stringify({ status: { $in: ['pending', 'approved'] } }),
    );
    const hasTargetLookup = indexes.some(
      ([fields]) => fields.guildId === 1 && fields.participantKey === 1 && fields.status === 1,
    );
    const hasUserLookup = indexes.some(
      ([fields]) => fields.guildId === 1 && fields.discordUserId === 1 && fields.status === 1,
    );

    expect(hasActiveCharacterUniqueness).toBe(true);
    expect(hasTargetLookup).toBe(true);
    expect(hasUserLookup).toBe(true);
    expect(CharacterClaimModel.schema.path('displayName')).toBeUndefined();
    expect(CharacterClaimModel.schema.path('playerProfileId')).toBeUndefined();
  });

  it('backfills claim identity fields before creating active claim indexes', async () => {
    const documentId = { toString: () => 'doc-1' };
    vi.spyOn(CharacterClaimModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          _id: documentId,
          characterName: ' Alyra ',
          realm: ' Stormrage ',
          region: ' us ',
        },
      ]),
    } as never);
    const bulkWrite = vi.spyOn(CharacterClaimModel, 'bulkWrite').mockResolvedValue({} as never);
    vi.spyOn(CharacterClaimModel.collection, 'aggregate').mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    vi.spyOn(CharacterClaimModel.collection, 'indexes').mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      {
        name: 'guildId_1_discordUserId_1_participantKey_1',
        key: { guildId: 1, discordUserId: 1, participantKey: 1 },
        unique: true,
      },
    ] as never);
    const dropIndex = vi
      .spyOn(CharacterClaimModel.collection, 'dropIndex')
      .mockResolvedValue({ ok: 1 } as never);
    const createIndex = vi
      .spyOn(CharacterClaimModel.collection, 'createIndex')
      .mockResolvedValue('created-index' as never);

    const result = await migrateCharacterClaimIdentityFields();

    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { _id: documentId },
            update: {
              $set: expect.objectContaining({
                claimId: expect.any(String),
                region: 'US',
                normalizedRealm: 'stormrage',
                normalizedCharacterName: 'alyra',
              }),
            },
          },
        },
      ],
      { ordered: false },
    );
    expect(dropIndex).toHaveBeenCalledWith('guildId_1_discordUserId_1_participantKey_1');
    expect(createIndex).toHaveBeenCalledWith({ claimId: 1 }, { unique: true });
    expect(createIndex).toHaveBeenCalledWith(
      { guildId: 1, region: 1, normalizedRealm: 1, normalizedCharacterName: 1 },
      {
        unique: true,
        partialFilterExpression: { status: { $in: ['pending', 'approved'] } },
      },
    );
    expect(result).toEqual({
      backfilledCount: 1,
      droppedLegacyIndexNames: ['guildId_1_discordUserId_1_participantKey_1'],
    });
  });

  it('fails before creating active claim indexes when duplicate active claims exist', async () => {
    vi.spyOn(CharacterClaimModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    } as never);
    vi.spyOn(CharacterClaimModel.collection, 'aggregate').mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: {
            guildId: 'guild-1',
            region: 'US',
            normalizedRealm: 'stormrage',
            normalizedCharacterName: 'alyra',
          },
          count: 2,
          claimIds: ['claim-1', 'claim-2'],
        },
      ]),
    } as never);
    const indexes = vi.spyOn(CharacterClaimModel.collection, 'indexes');
    const createIndex = vi.spyOn(CharacterClaimModel.collection, 'createIndex');

    await expect(migrateCharacterClaimIdentityFields()).rejects.toThrow(
      /duplicate active claims/i,
    );

    expect(indexes).not.toHaveBeenCalled();
    expect(createIndex).not.toHaveBeenCalled();
  });

  it('requests pending claims with privacy disabled by default', async () => {
    mockFindOneLean(null);
    const savedDoc = makeClaim();
    const upsert = vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(savedDoc),
    } as never);

    const store = new MongoCharacterClaimStore();
    const saved = await store.requestCharacterClaim({
      ...claimInput,
      requestedAt,
    });

    expect(saved).toMatchObject({
      status: 'pending',
      peerCompareOptIn: false,
      publicPostOptIn: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: expect.any(String) }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          guildId: 'guild-1',
          discordUserId: 'user-1',
          participantKey: 'character:us:stormrage:alyra',
          region: 'US',
          normalizedRealm: 'stormrage',
          normalizedCharacterName: 'alyra',
          status: 'pending',
          peerCompareOptIn: false,
          publicPostOptIn: false,
          requestedAt,
        }),
      }),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('normalizes claim region at the store boundary', async () => {
    mockFindOneLean(null);
    vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeClaim()),
    } as never);

    const store = new MongoCharacterClaimStore();
    await store.requestCharacterClaim({
      ...claimInput,
      region: ' us ',
    });

    expect(CharacterClaimModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'US' }),
    );
    expect(CharacterClaimModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ region: 'US' }),
      }),
      expect.anything(),
    );
  });

  it('does not allow duplicate active pending or approved claims', async () => {
    mockFindOneLean(makeClaim({ status: 'approved' }));
    const upsert = vi.spyOn(CharacterClaimModel, 'findOneAndUpdate');

    const store = new MongoCharacterClaimStore();
    await expect(store.requestCharacterClaim(claimInput)).rejects.toThrow(
      /active character claim/i,
    );

    expect(upsert).not.toHaveBeenCalled();
  });

  it('approves claims and records reviewer metadata', async () => {
    const savedDoc = makeClaim({
      status: 'approved',
      reviewedAt,
      reviewedByDiscordUserId: 'officer-1',
    });
    const upsert = vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(savedDoc),
    } as never);

    const store = new MongoCharacterClaimStore();
    const approved = await store.approveCharacterClaim({
      ...claimInput,
      reviewedByDiscordUserId: 'officer-1',
      reviewedAt,
    });

    expect(approved).toMatchObject({
      status: 'approved',
      reviewedAt,
      reviewedByDiscordUserId: 'officer-1',
    });
    expect(upsert).toHaveBeenCalledWith(
      {
        guildId: 'guild-1',
        discordUserId: 'user-1',
        participantKey: 'character:us:stormrage:alyra',
        status: 'pending',
      },
      {
        $set: {
          guildId: 'guild-1',
          discordUserId: 'user-1',
          participantKey: 'character:us:stormrage:alyra',
          characterName: 'Alyra',
          region: 'US',
          realm: 'Stormrage',
          normalizedRealm: 'stormrage',
          normalizedCharacterName: 'alyra',
          status: 'approved',
          reviewedAt,
          reviewedByDiscordUserId: 'officer-1',
        },
      },
      { new: true },
    );
  });

  it('does not create approved claims when no pending claim exists', async () => {
    vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    const create = vi.spyOn(CharacterClaimModel, 'create');

    const store = new MongoCharacterClaimStore();
    const approved = await store.approveCharacterClaim({
      ...claimInput,
      reviewedByDiscordUserId: 'officer-1',
      reviewedAt,
    });

    expect(approved).toBeNull();
    expect(CharacterClaimModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'approved' }) }),
      { new: true },
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects pending claims', async () => {
    vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        makeClaim({
          status: 'rejected',
          reviewedAt,
          reviewedByDiscordUserId: 'officer-1',
        }),
      ),
    } as never);

    const store = new MongoCharacterClaimStore();
    const rejected = await store.rejectCharacterClaim({
      ...claimInput,
      reviewedAt,
      reviewedByDiscordUserId: 'officer-1',
    });

    expect(rejected?.status).toBe('rejected');
    expect(CharacterClaimModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'rejected' }) }),
      { new: true },
    );
  });

  it('revokes approved claims', async () => {
    vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(
        makeClaim({
          status: 'revoked',
          reviewedAt,
        }),
      ),
    } as never);

    const store = new MongoCharacterClaimStore();
    const revoked = await store.revokeCharacterClaim({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      participantKey: 'character:us:stormrage:alyra',
      revokedAt: reviewedAt,
    });

    expect(revoked?.status).toBe('revoked');
    expect(CharacterClaimModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'revoked' }) }),
      { new: true },
    );
  });

  it('looks up approved claims only', async () => {
    mockFindOneLean(makeClaim({ status: 'approved' }));

    const store = new MongoCharacterClaimStore();
    await store.findApprovedClaimForUserCharacter({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      participantKey: 'character:us:stormrage:alyra',
    });

    expect(CharacterClaimModel.findOne).toHaveBeenCalledWith({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      participantKey: 'character:us:stormrage:alyra',
      status: 'approved',
    });
  });

  it('finds approved target claims by participantKey', async () => {
    vi.spyOn(CharacterClaimModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([makeClaim({ status: 'approved' })]),
    } as never);

    const store = new MongoCharacterClaimStore();
    const claims = await store.findApprovedClaimsForParticipant({
      guildId: 'guild-1',
      participantKey: 'character:us:stormrage:alyra',
    });

    expect(claims).toHaveLength(1);
    expect(CharacterClaimModel.find).toHaveBeenCalledWith({
      guildId: 'guild-1',
      participantKey: 'character:us:stormrage:alyra',
      status: 'approved',
    });
  });

  it('updates privacy only for an approved owner claim', async () => {
    const savedDoc = makeClaim({
      status: 'approved',
      peerCompareOptIn: true,
      publicPostOptIn: true,
    });
    vi.spyOn(CharacterClaimModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(savedDoc),
    } as never);

    const store = new MongoCharacterClaimStore();
    const updated = await store.updateClaimPrivacy({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      participantKey: 'character:us:stormrage:alyra',
      peerCompareOptIn: true,
      publicPostOptIn: true,
    });

    expect(updated).toMatchObject({
      peerCompareOptIn: true,
      publicPostOptIn: true,
    });
    expect(CharacterClaimModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        guildId: 'guild-1',
        discordUserId: 'user-1',
        participantKey: 'character:us:stormrage:alyra',
        status: 'approved',
      },
      { $set: { peerCompareOptIn: true, publicPostOptIn: true } },
      { new: true },
    );
  });
});

describe('MongoRecapPreviewStateStore', () => {
  it('persists and retrieves valid preview state', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const savedState = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      summaryPayload: makeRecapSummary(),
      createdByUserId: 'user-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };

    const updateLean = vi.fn().mockResolvedValue(savedState);
    vi.spyOn(RecapPreviewStateModel, 'findOneAndUpdate').mockReturnValue({
      lean: updateLean,
    } as never);
    const findLean = vi.fn().mockResolvedValue(savedState);
    vi.spyOn(RecapPreviewStateModel, 'findOne').mockReturnValue({
      lean: findLean,
    } as never);

    const store = new MongoRecapPreviewStateStore();
    await store.savePreviewState(savedState);
    await store.getValidPreviewState({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });

    expect(RecapPreviewStateModel.findOne).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
      expiresAt: { $gt: now },
    });
  });

  it('returns null when preview state is missing or expired', async () => {
    const findLean = vi.fn().mockResolvedValue(null);
    vi.spyOn(RecapPreviewStateModel, 'findOne').mockReturnValue({
      lean: findLean,
    } as never);

    const store = new MongoRecapPreviewStateStore();
    const result = await store.getValidPreviewState({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });

    expect(result).toBeNull();
  });

  it('deletes preview state by lookup key', async () => {
    const deleteSpy = vi.spyOn(RecapPreviewStateModel, 'deleteOne').mockResolvedValue({
      acknowledged: true,
      deletedCount: 1,
    } as never);

    const store = new MongoRecapPreviewStateStore();
    await store.deletePreviewState({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });

    expect(deleteSpy).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });
  });

  it('consumes preview state atomically for valid entries', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const savedState = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      summaryPayload: makeRecapSummary(),
      createdByUserId: 'user-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    const consumeLean = vi.fn().mockResolvedValue(savedState);
    const consumeSpy = vi.spyOn(RecapPreviewStateModel, 'findOneAndDelete').mockReturnValue({
      lean: consumeLean,
    } as never);

    const store = new MongoRecapPreviewStateStore();
    await store.consumeValidPreviewState({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });

    expect(consumeSpy).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
      expiresAt: { $gt: now },
    });
  });

  it('uses guildId, channelId, and reportCode as preview identity', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    const savedState = {
      guildId: 'guild-1',
      channelId: 'channel-2',
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      summaryPayload: makeRecapSummary(),
      createdByUserId: 'user-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    vi.spyOn(RecapPreviewStateModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(savedState),
    } as never);

    const store = new MongoRecapPreviewStateStore();
    await store.savePreviewState(savedState);

    expect(RecapPreviewStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'guild-1', channelId: 'channel-2', reportCode: 'ABC123' },
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('drops the old guildId and reportCode unique index during migration', async () => {
    const indexesSpy = vi.spyOn(RecapPreviewStateModel.collection, 'indexes').mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      {
        name: 'guildId_1_reportCode_1',
        key: { guildId: 1, reportCode: 1 },
        unique: true,
      },
    ] as never);
    const dropSpy = vi
      .spyOn(RecapPreviewStateModel.collection, 'dropIndex')
      .mockResolvedValue({ ok: 1 } as never);
    const createSpy = vi
      .spyOn(RecapPreviewStateModel.collection, 'createIndex')
      .mockResolvedValue('guildId_1_channelId_1_reportCode_1' as never);

    await migrateRecapPreviewStateIndexes();

    expect(indexesSpy).toHaveBeenCalledOnce();
    expect(dropSpy).toHaveBeenCalledWith('guildId_1_reportCode_1');
    expect(createSpy).toHaveBeenCalledWith(
      { guildId: 1, channelId: 1, reportCode: 1 },
      { unique: true },
    );
  });
});

describe('MongoAutoRecapPromptStateStore', () => {
  const promptState = {
    guildId: 'guild-1',
    channelId: 'channel-1',
    reportCode: 'ABC123',
    gameFamily: 'retail' as const,
    sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
    sourceMessageId: 'source-message-1',
    sourceAuthorId: 'user-1',
    promptMessageId: 'prompt-message-1',
    expiresAt: new Date('2026-04-09T00:15:00.000Z'),
  };

  it('persists and retrieves valid prompt state by source message id', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.spyOn(AutoRecapPromptStateModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(promptState),
    } as never);
    vi.spyOn(AutoRecapPromptStateModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(promptState),
    } as never);

    const store = new MongoAutoRecapPromptStateStore();
    await store.savePromptState(promptState);
    const found = await store.getValidPromptState('source-message-1');

    expect(found?.sourceMessageId).toBe('source-message-1');
    expect(AutoRecapPromptStateModel.findOne).toHaveBeenCalledWith({
      sourceMessageId: 'source-message-1',
      expiresAt: { $gt: now },
    });
  });

  it('consumes valid prompt state atomically', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const consumeSpy = vi.spyOn(AutoRecapPromptStateModel, 'findOneAndDelete').mockReturnValue({
      lean: vi.fn().mockResolvedValue(promptState),
    } as never);

    const store = new MongoAutoRecapPromptStateStore();
    await store.consumeValidPromptState('source-message-1');

    expect(consumeSpy).toHaveBeenCalledWith({
      sourceMessageId: 'source-message-1',
      expiresAt: { $gt: now },
    });
  });

  it('treats prompt state past expiresAt as expired even before TTL cleanup', async () => {
    vi.spyOn(AutoRecapPromptStateModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoAutoRecapPromptStateStore();
    const found = await store.getValidPromptState('source-message-1');

    expect(found).toBeNull();
    expect(AutoRecapPromptStateModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: expect.any(Object) }),
    );
  });
});

describe('MongoAutoRecapDuplicateTrackingStore', () => {
  const trackingInput = {
    guildId: 'guild-1',
    channelId: 'channel-1',
    reportCode: 'ABC123',
    gameFamily: 'retail' as const,
    sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
    sourceMessageId: 'source-message-1',
    sourceAuthorId: 'user-1',
    mode: 'prompt' as const,
    expiresAt: new Date('2026-04-09T00:15:00.000Z'),
  };
  const processingRecord = {
    ...trackingInput,
    status: 'processing' as const,
  };

  it('supports an atomic passive detection claim', async () => {
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'create').mockResolvedValue({
      toObject: () => processingRecord,
    } as never);

    const store = new MongoAutoRecapDuplicateTrackingStore();
    const result = await store.claimPassiveDetection(trackingInput);

    expect(result).toMatchObject({ claimed: true, record: processingRecord });
    expect(AutoRecapDuplicateTrackingModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        status: 'processing',
      }),
    );
    expect(AutoRecapDuplicateTrackingModel.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        latestOutputMessageId: expect.anything(),
        latestOutputKind: expect.anything(),
        duplicateConfirmationMessageId: expect.anything(),
        confirmationNonce: expect.anything(),
      }),
    );
  });

  it('returns the active duplicate record when the atomic claim loses a race', async () => {
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'create').mockRejectedValue({ code: 11000 });
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        ...trackingInput,
        status: 'prompted',
        latestOutputMessageId: 'prompt-message-1',
        latestOutputKind: 'prompt',
      }),
    } as never);

    const store = new MongoAutoRecapDuplicateTrackingStore();
    const result = await store.claimPassiveDetection(trackingInput);

    expect(result).toMatchObject({
      claimed: false,
      record: {
        status: 'prompted',
        latestOutputMessageId: 'prompt-message-1',
        latestOutputKind: 'prompt',
      },
    });
  });

  it('stores latest output fields and enforces active expiry in lookups', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        ...trackingInput,
        status: 'preview_posted',
        latestOutputMessageId: 'preview-message-1',
        latestOutputKind: 'public_preview',
      }),
    } as never);
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoAutoRecapDuplicateTrackingStore();
    const updated = await store.updateTracking({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      status: 'preview_posted',
      latestOutputMessageId: 'preview-message-1',
      latestOutputKind: 'public_preview',
    });
    const expired = await store.getActiveTracking({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
    });

    expect(updated).toMatchObject({
      status: 'preview_posted',
      latestOutputMessageId: 'preview-message-1',
      latestOutputKind: 'public_preview',
    });
    expect(expired).toBeNull();
    expect(AutoRecapDuplicateTrackingModel.findOne).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      expiresAt: { $gt: now },
    });
  });

  it('clears stale confirmation and output fields when reclaiming expired tracking', async () => {
    const now = new Date('2026-04-09T00:20:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let storedRecord: Record<string, unknown> = {
      ...trackingInput,
      sourceMessageId: 'old-source-message-1',
      sourceAuthorId: 'old-user-1',
      status: 'prompted',
      latestOutputMessageId: 'prompt-message-1',
      latestOutputKind: 'prompt',
      duplicateConfirmationMessageId: 'duplicate-message-1',
      confirmationNonce: 'old-nonce',
      expiresAt: new Date('2026-04-09T00:19:00.000Z'),
    };
    const findOneAndUpdateSpy = vi
      .spyOn(AutoRecapDuplicateTrackingModel, 'findOneAndUpdate')
      .mockImplementation((_query, update) => {
        const mongoUpdate = update as {
          $set?: Record<string, unknown>;
          $unset?: Record<string, unknown>;
        };
        storedRecord = {
          ...storedRecord,
          ...(mongoUpdate.$set ?? {}),
        };
        for (const fieldName of Object.keys(mongoUpdate.$unset ?? {})) {
          delete storedRecord[fieldName];
        }
        return {
          lean: vi.fn().mockResolvedValue({ ...storedRecord }),
        } as never;
      });
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'create').mockRejectedValue(
      new Error('create should not be called when reclaiming an expired record'),
    );
    vi.spyOn(AutoRecapDuplicateTrackingModel, 'findOne').mockImplementation((query) => {
      const rawQuery = query as Record<string, unknown>;
      const expiresAtQuery = rawQuery.expiresAt as { $gt?: Date } | undefined;
      const matchesNonce =
        rawQuery.confirmationNonce === storedRecord.confirmationNonce &&
        storedRecord.expiresAt instanceof Date &&
        expiresAtQuery?.$gt instanceof Date &&
        storedRecord.expiresAt > expiresAtQuery.$gt;
      return {
        lean: vi.fn().mockResolvedValue(matchesNonce ? { ...storedRecord } : null),
      } as never;
    });

    const store = new MongoAutoRecapDuplicateTrackingStore();
    const result = await store.claimPassiveDetection({
      ...trackingInput,
      sourceMessageId: 'new-source-message-1',
      sourceAuthorId: 'new-user-1',
      expiresAt: new Date('2026-04-09T00:35:00.000Z'),
    });
    const oldNonceResult = await store.getByConfirmationNonce('old-nonce');

    expect(result).toMatchObject({
      claimed: true,
      record: {
        sourceMessageId: 'new-source-message-1',
        sourceAuthorId: 'new-user-1',
        status: 'processing',
      },
    });
    expect(result.record).not.toHaveProperty('latestOutputMessageId');
    expect(result.record).not.toHaveProperty('latestOutputKind');
    expect(result.record).not.toHaveProperty('duplicateConfirmationMessageId');
    expect(result.record).not.toHaveProperty('confirmationNonce');
    expect(oldNonceResult).toBeNull();
    expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        expiresAt: { $lte: now },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          sourceMessageId: 'new-source-message-1',
          status: 'processing',
        }),
        $unset: {
          latestOutputMessageId: '',
          latestOutputKind: '',
          duplicateConfirmationMessageId: '',
          confirmationNonce: '',
        },
      }),
      { new: true },
    );
  });
});

describe('MongoComparisonHistoryStore', () => {
  const reportStartedAt = new Date('2026-04-09T00:00:00.000Z');
  const before = new Date('2026-04-10T00:00:00.000Z');
  const participantKey = 'character:us:galakras:sigismund';

  const makeSnapshot = () => ({
    guildId: 'guild-1',
    reportCode: 'ABC123',
    reportStartedAt,
    participantKey,
  });

  const mockHistoryQuery = (docs: unknown[] = []) => {
    const lean = vi.fn().mockResolvedValue(docs);
    const select = vi.fn().mockReturnValue({ lean });
    const limit = vi.fn().mockReturnValue({ select });
    const sort = vi.fn().mockReturnValue({ limit });
    const find = vi.spyOn(ComparisonSnapshotModel, 'find').mockReturnValue({
      sort,
    } as never);

    return { find, sort, limit, select, lean };
  };

  it('defines unique report participant and character history indexes', () => {
    const indexes = ComparisonSnapshotModel.schema.indexes();

    const hasUniqueSnapshotIndex = indexes.some(([fields, options]) => {
      return (
        fields.guildId === 1 &&
        fields.reportCode === 1 &&
        fields.participantKey === 1 &&
        options.unique === true
      );
    });
    const hasCharacterLookupIndex = indexes.some(([fields]) => {
      return fields.guildId === 1 && fields.participantKey === 1 && fields.reportStartedAt === -1;
    });
    const hasMixedLookupIndex = indexes.some(([fields]) =>
      Object.prototype.hasOwnProperty.call(fields, 'playerProfileId'),
    );

    expect(hasUniqueSnapshotIndex).toBe(true);
    expect(hasCharacterLookupIndex).toBe(true);
    expect(hasMixedLookupIndex).toBe(false);
  });

  it('saves comparison snapshots using guildId, reportCode, and participantKey as upsert identity', async () => {
    const input = makeSnapshot();
    const lean = vi.fn().mockResolvedValue(input);
    const upsert = vi.spyOn(ComparisonSnapshotModel, 'findOneAndUpdate').mockReturnValue({
      lean,
    } as never);

    const store = new MongoComparisonHistoryStore();
    await store.saveComparisonSnapshot(input);

    expect(upsert).toHaveBeenCalledWith(
      {
        guildId: 'guild-1',
        reportCode: 'ABC123',
        participantKey,
      },
      {
        $set: input,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  });

  it('does not require raw Warcraft Logs payload fields when saving', async () => {
    const input = makeSnapshot();
    vi.spyOn(ComparisonSnapshotModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(input),
    } as never);

    const store = new MongoComparisonHistoryStore();
    const saved = await store.saveComparisonSnapshot(input);

    expect(saved).toEqual(input);
    const update = vi.mocked(ComparisonSnapshotModel.findOneAndUpdate).mock.calls[0]?.[1] as
      | { $set?: Record<string, unknown> }
      | undefined;
    expect(update?.$set).not.toHaveProperty('rawPayload');
    expect(update?.$set).not.toHaveProperty('normalizedPayload');
  });

  it('can persist probe-backed participant identity fields when provided', async () => {
    const input = {
      ...makeSnapshot(),
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      zoneName: 'Throne of Thunder',
      warcraftLogsActorId: 7,
      warcraftLogsGuid: 99060818,
      characterName: 'Sîgïsmund',
      region: 'US',
      realm: 'Galakras',
      server: 'Galakras',
      className: 'Warlock',
      specName: 'Affliction',
      role: 'dps',
      icon: 'Warlock-Affliction',
      rankPercent: 83,
      damageTotal: 984820677,
      healingTotal: 53328327,
      deaths: 1,
      interrupts: 3,
      dispels: 0,
      bestBossName: "Jin'rokh the Breaker",
      lowestBossName: 'Dark Animus',
    };
    vi.spyOn(ComparisonSnapshotModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(input),
    } as never);

    const store = new MongoComparisonHistoryStore();
    const saved = await store.saveComparisonSnapshot(input);

    expect(saved).toMatchObject({
      warcraftLogsActorId: 7,
      warcraftLogsGuid: 99060818,
      characterName: 'Sîgïsmund',
      className: 'Warlock',
      specName: 'Affliction',
      damageTotal: 984820677,
      healingTotal: 53328327,
    });
  });

  it('distinguishes warcraftLogsActorId from warcraftLogsGuid', async () => {
    const input = {
      ...makeSnapshot(),
      warcraftLogsActorId: 7,
      warcraftLogsGuid: 99060818,
    };
    vi.spyOn(ComparisonSnapshotModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(input),
    } as never);

    const store = new MongoComparisonHistoryStore();
    await store.saveComparisonSnapshot(input);

    const update = vi.mocked(ComparisonSnapshotModel.findOneAndUpdate).mock.calls[0]?.[1] as
      | { $set?: Record<string, unknown> }
      | undefined;
    expect(update?.$set?.warcraftLogsActorId).toBe(7);
    expect(update?.$set?.warcraftLogsGuid).toBe(99060818);
    expect(update?.$set).not.toHaveProperty('characterId');
  });

  it('finds character history by guildId, participantKey, and reportStartedAt before current report', async () => {
    const query = mockHistoryQuery([makeSnapshot()]);

    const store = new MongoComparisonHistoryStore();
    await store.findCharacterHistory({
      guildId: 'guild-1',
      participantKey,
      before,
    });

    expect(query.find).toHaveBeenCalledWith({
      guildId: 'guild-1',
      participantKey,
      reportStartedAt: { $lt: before },
    });
    expect(query.sort).toHaveBeenCalledWith({ reportStartedAt: -1 });
    expect(query.limit).toHaveBeenCalledWith(historyLimit);
    expect(query.select).toHaveBeenCalledWith(COMPARISON_SNAPSHOT_HISTORY_PROJECTION);
  });

  it('does not filter character history by characterName', async () => {
    const query = mockHistoryQuery([]);

    const store = new MongoComparisonHistoryStore();
    await store.findCharacterHistory({
      guildId: 'guild-1',
      participantKey,
      before,
    });

    const calls = query.find.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const filter = calls[0]?.[0];
    expect(filter).toBeDefined();
    expect(filter).not.toHaveProperty('characterName');
  });

  it('accepts an explicit character history limit override', async () => {
    const query = mockHistoryQuery([]);

    const store = new MongoComparisonHistoryStore();
    await store.findCharacterHistory({
      guildId: 'guild-1',
      participantKey,
      before,
      limit: 2,
    });

    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it('falls back to historyLimit for invalid limits to avoid unbounded queries', async () => {
    const query = mockHistoryQuery([]);

    const store = new MongoComparisonHistoryStore();
    await store.findCharacterHistory({
      guildId: 'guild-1',
      participantKey,
      before,
      limit: 0,
    });

    expect(query.limit).toHaveBeenCalledWith(historyLimit);
  });

  it('returns an empty array safely when character history is missing', async () => {
    mockHistoryQuery([]);

    const store = new MongoComparisonHistoryStore();
    const history = await store.findCharacterHistory({
      guildId: 'guild-1',
      participantKey,
      before,
    });

    expect(history).toEqual([]);
  });

  it('does not use ReportCacheModel, PlayerRaidSummaryModel, or trend services for comparison history', async () => {
    const reportCacheFind = vi.spyOn(ReportCacheModel, 'find').mockReturnValue({} as never);
    const playerSummaryFind = vi.spyOn(PlayerRaidSummaryModel, 'find').mockReturnValue({} as never);
    const trendIngest = vi
      .spyOn(MongoTrendTrackingService.prototype, 'ingestRaidHistory')
      .mockResolvedValue(undefined);
    const trendRecompute = vi
      .spyOn(MongoTrendTrackingService.prototype, 'recomputeTrendsForGuild')
      .mockResolvedValue(undefined);
    mockHistoryQuery([]);

    const store = new MongoComparisonHistoryStore();
    await store.findCharacterHistory({
      guildId: 'guild-1',
      participantKey,
      before,
    });

    expect(reportCacheFind).not.toHaveBeenCalled();
    expect(playerSummaryFind).not.toHaveBeenCalled();
    expect(trendIngest).not.toHaveBeenCalled();
    expect(trendRecompute).not.toHaveBeenCalled();
  });
});
describe('MongoTrendTrackingService', () => {
  it('upserts deterministically across reruns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'));

    const summaries = [
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 40,
        executionScore: 50,
        capturedAt: new Date('2026-04-01T00:00:00.000Z'),
        reportCode: 'r1',
      },
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 60,
        executionScore: 70,
        capturedAt: new Date('2026-04-02T00:00:00.000Z'),
        reportCode: 'r2',
      },
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 80,
        executionScore: 90,
        capturedAt: new Date('2026-04-03T00:00:00.000Z'),
        reportCode: 'r3',
      },
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 75,
        executionScore: 95,
        capturedAt: new Date('2026-04-04T00:00:00.000Z'),
        reportCode: 'r4',
      },
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 55,
        executionScore: 65,
        capturedAt: new Date('2026-04-05T00:00:00.000Z'),
        reportCode: 'r5',
      },
    ];

    vi.spyOn(PlayerRaidSummaryModel, 'find').mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(summaries),
      }),
    } as never);
    const bulkWrite = vi.spyOn(TrendSnapshotModel, 'bulkWrite').mockResolvedValue({} as never);

    const service = new MongoTrendTrackingService();
    await service.recomputeTrendsForGuild('guild-1');
    await service.recomputeTrendsForGuild('guild-1');

    expect(bulkWrite).toHaveBeenCalledTimes(2);

    const firstOps = bulkWrite.mock.calls[0]?.[0];
    const secondOps = bulkWrite.mock.calls[1]?.[0];

    expect(firstOps).toBeDefined();
    expect(secondOps).toBeDefined();
    expect(firstOps!).toEqual(secondOps!);
  });

  it('skips windows that do not have enough history', async () => {
    const summaries = [
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 40,
        executionScore: 50,
        capturedAt: new Date('2026-04-01T00:00:00.000Z'),
        reportCode: 'r1',
      },
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 60,
        executionScore: 70,
        capturedAt: new Date('2026-04-02T00:00:00.000Z'),
        reportCode: 'r2',
      },
      {
        guildId: 'guild-1',
        characterName: 'Alyra',
        averageParse: 80,
        executionScore: 90,
        capturedAt: new Date('2026-04-03T00:00:00.000Z'),
        reportCode: 'r3',
      },
    ];

    vi.spyOn(PlayerRaidSummaryModel, 'find').mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(summaries),
      }),
    } as never);
    const bulkWrite = vi.spyOn(TrendSnapshotModel, 'bulkWrite').mockResolvedValue({} as never);

    const service = new MongoTrendTrackingService();
    await service.recomputeTrendsForGuild('guild-1');

    expect(bulkWrite).toHaveBeenCalledOnce();

    const rawOperations = bulkWrite.mock.calls[0]?.[0] ?? [];

    expect(rawOperations).toHaveLength(3);

    const filters = rawOperations.map((op) => {
      if (!('updateOne' in op)) {
        throw new Error('Expected updateOne bulk operation');
      }

      const filter = op.updateOne.filter as {
        metric?: string;
        window?: string;
      };

      if (typeof filter.metric !== 'string' || typeof filter.window !== 'string') {
        throw new Error('Expected metric/window filter values');
      }

      return filter as {
        metric: string;
        window: string;
      };
    });

    expect(filters.every((filter) => filter.window === 'last_3_raids')).toBe(true);
    expect(filters.map((filter) => filter.metric).sort()).toEqual([
      'attendance_count',
      'execution_average',
      'parse_average',
    ]);
  });
});

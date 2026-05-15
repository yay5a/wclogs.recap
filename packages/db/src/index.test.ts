import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COMPARE_ACCESS_MODE,
  DEFAULT_COMPARE_MODE,
  defaultGuildConfigFor,
  type ReportIndexData,
} from '@wcl/domain';
import {
  CharacterClaimModel,
  GuildSettingsModel,
  migrateCharacterClaimIdentityFields,
  MongoAutoReportDuplicateTrackingStore,
  MongoAutoReportPromptStateStore,
  MongoCharacterClaimStore,
  MongoGuildConfigStore,
  MongoWclUserAuthStore,
  AutoReportDuplicateTrackingModel,
  AutoReportPromptStateModel,
  GuildReportMetadataCursorModel,
  GuildReportMetadataModel,
  MongoGuildReportMetadataStore,
  MongoReportIndexCacheStore,
  ReportIndexCacheModel,
  WclUserAuthModel,
  migrateWclUserAuthDiscordUserIndex,
  encryptWclToken,
} from './index.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const reportIndexFixture = (overrides: Partial<ReportIndexData> = {}): ReportIndexData => ({
  reportCode: 'ABC123',
  sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
  gameFamily: 'retail',
  title: 'Vault',
  zoneName: 'Vault of the Incarnates',
  zoneId: 31,
  startTime: 1_700_000_000_000,
  endTime: 1_700_003_600_000,
  completedBossFights: [
    {
      id: 1,
      encounterId: 10,
      name: 'Boss',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_300_000,
      kill: true,
      difficulty: 4,
      size: 20,
    },
  ],
  killBossFights: [
    {
      id: 1,
      encounterId: 10,
      name: 'Boss',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_300_000,
      kill: true,
      difficulty: 4,
      size: 20,
    },
  ],
  allBossFights: [
    {
      id: 1,
      encounterId: 10,
      name: 'Boss',
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_300_000,
      kill: true,
      difficulty: 4,
      size: 20,
    },
  ],
  zoneDifficulties: [{ id: 4, name: 'Heroic', sizes: [20] }],
  ...overrides,
});

describe('MongoReportIndexCacheStore', () => {
  it('reads cached report index data by report code and game family', async () => {
    const index = reportIndexFixture();
    vi.spyOn(ReportIndexCacheModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({ data: index }),
    } as never);

    const store = new MongoReportIndexCacheStore();

    await expect(
      store.getReportIndex({ reportCode: 'ABC123', gameFamily: 'retail' }),
    ).resolves.toEqual({ status: 'hit', data: index });
    expect(ReportIndexCacheModel.findOne).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      gameFamily: 'retail',
    });
  });

  it('treats omitted expiresAt as an indefinite cache entry', async () => {
    const index = reportIndexFixture();
    const update = vi
      .spyOn(ReportIndexCacheModel, 'findOneAndUpdate')
      .mockResolvedValue(null);

    const store = new MongoReportIndexCacheStore();
    await store.saveReportIndex({ reportCode: 'ABC123', gameFamily: 'retail', data: index });

    expect(update).toHaveBeenCalledWith(
      { reportCode: 'ABC123', gameFamily: 'retail' },
      {
        $set: {
          reportCode: 'ABC123',
          gameFamily: 'retail',
          data: index,
        },
        $unset: { expiresAt: '' },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  });

  it('returns stale status for expired cache entries', async () => {
    vi.setSystemTime(new Date('2026-05-15T00:00:00.000Z'));
    vi.spyOn(ReportIndexCacheModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        data: reportIndexFixture(),
        expiresAt: new Date('2026-05-14T23:59:00.000Z'),
      }),
    } as never);

    const store = new MongoReportIndexCacheStore();

    await expect(
      store.getReportIndex({ reportCode: 'ABC123', gameFamily: 'retail' }),
    ).resolves.toEqual({
      status: 'stale',
      expiresAt: new Date('2026-05-14T23:59:00.000Z'),
    });
  });

  it('upserts expiring cache entries by report code and game family', async () => {
    const index = reportIndexFixture({ gameFamily: 'mop_classic' });
    const expiresAt = new Date('2026-05-15T00:10:00.000Z');
    const update = vi
      .spyOn(ReportIndexCacheModel, 'findOneAndUpdate')
      .mockResolvedValue(null);

    const store = new MongoReportIndexCacheStore();
    await store.saveReportIndex({
      reportCode: 'ABC123',
      gameFamily: 'mop_classic',
      data: index,
      expiresAt,
    });

    expect(update).toHaveBeenCalledWith(
      { reportCode: 'ABC123', gameFamily: 'mop_classic' },
      {
        $set: {
          reportCode: 'ABC123',
          gameFamily: 'mop_classic',
          data: index,
          expiresAt,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  });
});

describe('MongoGuildReportMetadataStore', () => {
  const scope = {
    guildName: 'Shenanigans',
    guildServerSlug: 'Galakras',
    guildServerRegion: 'US',
    gameFamily: 'mop_classic' as const,
  };

  it('upserts report metadata by normalized guild scope and report code', async () => {
    const indexedAt = new Date('2026-05-15T12:00:00.000Z');
    const bulkWrite = vi.spyOn(GuildReportMetadataModel, 'bulkWrite').mockResolvedValue({
      upsertedCount: 1,
      matchedCount: 1,
      modifiedCount: 1,
    } as never);

    const store = new MongoGuildReportMetadataStore();
    const result = await store.upsertReports({
      scope,
      indexedAt,
      reports: [
        {
          reportCode: 'ABC123',
          title: 'Raid Night',
          owner: 'Logger',
          zoneId: 1046,
          startTime: 100,
          endTime: 200,
        },
        {
          reportCode: 'DEF456',
          startTime: 300,
        },
      ],
    });

    expect(result).toEqual({
      processedRows: 2,
      upsertedRows: 1,
      matchedRows: 1,
      modifiedRows: 1,
    });
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: {
              guildName: 'Shenanigans',
              guildServerSlug: 'galakras',
              guildServerRegion: 'us',
              gameFamily: 'mop_classic',
              reportCode: 'ABC123',
            },
            update: {
              $set: {
                guildName: 'Shenanigans',
                guildServerSlug: 'galakras',
                guildServerRegion: 'us',
                gameFamily: 'mop_classic',
                reportCode: 'ABC123',
                title: 'Raid Night',
                owner: 'Logger',
                zoneId: 1046,
                startTime: 100,
                endTime: 200,
                indexedAt,
              },
            },
            upsert: true,
          },
        },
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: expect.objectContaining({ reportCode: 'DEF456' }),
          }),
        }),
      ],
      { ordered: false },
    );
  });

  it('dedupes repeat report rows before writing metadata', async () => {
    const bulkWrite = vi.spyOn(GuildReportMetadataModel, 'bulkWrite').mockResolvedValue({
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
    } as never);

    const store = new MongoGuildReportMetadataStore();
    await store.upsertReports({
      scope,
      reports: [
        { reportCode: 'ABC123', title: 'First', startTime: 100 },
        { reportCode: 'ABC123', title: 'Second', startTime: 200 },
      ],
    });

    const operations = bulkWrite.mock.calls[0]?.[0] as unknown[];
    expect(operations).toHaveLength(1);
    expect(JSON.stringify(operations[0])).toContain('Second');
  });

  it('reads and updates the metadata cursor by guild scope', async () => {
    vi.spyOn(GuildReportMetadataCursorModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildName: 'Shenanigans',
        guildServerSlug: 'galakras',
        guildServerRegion: 'us',
        gameFamily: 'mop_classic',
        lastSeenStartTime: 300,
        lastIndexedAt: new Date('2026-05-15T12:00:00.000Z'),
      }),
    } as never);
    const saveCursor = vi.spyOn(GuildReportMetadataCursorModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildName: 'Shenanigans',
        guildServerSlug: 'galakras',
        guildServerRegion: 'us',
        gameFamily: 'mop_classic',
        lastSeenStartTime: 400,
        lastIndexedAt: new Date('2026-05-15T13:00:00.000Z'),
      }),
    } as never);

    const store = new MongoGuildReportMetadataStore();

    await expect(store.getCursor(scope)).resolves.toEqual({
      guildName: 'Shenanigans',
      guildServerSlug: 'galakras',
      guildServerRegion: 'us',
      gameFamily: 'mop_classic',
      lastSeenStartTime: 300,
      lastIndexedAt: new Date('2026-05-15T12:00:00.000Z'),
    });
    await expect(
      store.saveCursor({
        scope,
        lastSeenStartTime: 400,
        lastIndexedAt: new Date('2026-05-15T13:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ lastSeenStartTime: 400 });
    expect(saveCursor).toHaveBeenCalledWith(
      {
        guildName: 'Shenanigans',
        guildServerSlug: 'galakras',
        guildServerRegion: 'us',
        gameFamily: 'mop_classic',
      },
      {
        $set: {
          guildName: 'Shenanigans',
          guildServerSlug: 'galakras',
          guildServerRegion: 'us',
          gameFamily: 'mop_classic',
          lastSeenStartTime: 400,
          lastIndexedAt: new Date('2026-05-15T13:00:00.000Z'),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });
});

describe('MongoWclUserAuthStore', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const encryptionKeyBuffer = Buffer.alloc(32, 7);
  const makeStore = () => new MongoWclUserAuthStore({ encryptionKey });

  it('upserts WCL auth by Discord user ID', async () => {
    vi.spyOn(WclUserAuthModel, 'findOneAndUpdate').mockResolvedValue(null);
    const updatedAt = new Date('2026-04-09T00:00:00.000Z');
    const expiresAt = new Date('2026-04-09T01:00:00.000Z');

    const store = makeStore();
    await store.upsertForDiscordUser({
      discordUserId: 'user-1',
      provider: 'warcraftlogs',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      scope: 'view-user-profile',
      expiresAt,
      updatedAt,
    });

    expect(WclUserAuthModel.findOneAndUpdate).toHaveBeenCalledWith(
      { discordUserId: 'user-1' },
      {
        $set: {
          provider: 'warcraftlogs',
          accessTokenEnvelope: expect.objectContaining({
            algorithm: 'aes-256-gcm',
            keyVersion: 'v1',
            iv: expect.any(String),
            authTag: expect.any(String),
            ciphertext: expect.any(String),
          }),
          updatedAt,
          refreshTokenEnvelope: expect.objectContaining({
            algorithm: 'aes-256-gcm',
            keyVersion: 'v1',
            iv: expect.any(String),
            authTag: expect.any(String),
            ciphertext: expect.any(String),
          }),
          tokenType: 'Bearer',
          scope: 'view-user-profile',
          expiresAt,
        },
        $setOnInsert: {
          discordUserId: 'user-1',
          linkedAt: updatedAt,
        },
        $unset: {
          accessToken: '',
          refreshToken: '',
        },
      },
      { upsert: true },
    );
    expect(JSON.stringify(vi.mocked(WclUserAuthModel.findOneAndUpdate).mock.calls[0])).not.toContain(
      'access-token',
    );
    expect(JSON.stringify(vi.mocked(WclUserAuthModel.findOneAndUpdate).mock.calls[0])).not.toContain(
      'refresh-token',
    );
  });

  it('gets and decrypts WCL auth by Discord user ID', async () => {
    const record = {
      discordUserId: 'user-1',
      provider: 'warcraftlogs' as const,
      accessTokenEnvelope: encryptWclToken('access-token', encryptionKeyBuffer),
      refreshTokenEnvelope: encryptWclToken('refresh-token', encryptionKeyBuffer),
      linkedAt: new Date('2026-04-08T00:00:00.000Z'),
      updatedAt: new Date('2026-04-09T00:00:00.000Z'),
    };
    vi.spyOn(WclUserAuthModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(record),
    } as never);
    const updateOne = vi.spyOn(WclUserAuthModel, 'updateOne').mockResolvedValue({} as never);

    const store = makeStore();

    await expect(store.getByDiscordUserId('user-1')).resolves.toEqual({
      discordUserId: 'user-1',
      provider: 'warcraftlogs',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      linkedAt: record.linkedAt,
      updatedAt: record.updatedAt,
    });
    expect(WclUserAuthModel.findOne).toHaveBeenCalledWith({ discordUserId: 'user-1' });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('upgrades legacy plaintext token records after successful read', async () => {
    vi.spyOn(WclUserAuthModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        discordUserId: 'user-1',
        provider: 'warcraftlogs',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        linkedAt: new Date('2026-04-08T00:00:00.000Z'),
        updatedAt: new Date('2026-04-09T00:00:00.000Z'),
      }),
    } as never);
    const updateOne = vi.spyOn(WclUserAuthModel, 'updateOne').mockResolvedValue({} as never);

    const store = makeStore();
    await expect(store.getByDiscordUserId('user-1')).resolves.toMatchObject({
      discordUserId: 'user-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(updateOne).toHaveBeenCalledWith(
      { discordUserId: 'user-1' },
      {
        $set: {
          accessTokenEnvelope: expect.objectContaining({
            algorithm: 'aes-256-gcm',
            keyVersion: 'v1',
          }),
          refreshTokenEnvelope: expect.objectContaining({
            algorithm: 'aes-256-gcm',
            keyVersion: 'v1',
          }),
        },
        $unset: {
          accessToken: '',
          refreshToken: '',
        },
      },
    );
    expect(JSON.stringify(updateOne.mock.calls[0])).not.toContain('access-token');
    expect(JSON.stringify(updateOne.mock.calls[0])).not.toContain('refresh-token');
  });

  it('fails safely when encrypted token envelopes are corrupt', async () => {
    vi.spyOn(WclUserAuthModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        discordUserId: 'user-1',
        provider: 'warcraftlogs',
        accessTokenEnvelope: {
          keyVersion: 'v1',
          algorithm: 'aes-256-gcm',
          iv: 'bad',
          authTag: 'bad',
          ciphertext: 'bad',
        },
      }),
    } as never);
    vi.spyOn(WclUserAuthModel, 'updateOne').mockResolvedValue({} as never);

    const store = makeStore();
    await expect(store.getByDiscordUserId('user-1')).rejects.toMatchObject({
      name: 'WclTokenEncryptionError',
      code: 'decrypt_failed',
    });
  });

  it('returns safe WCL auth status without token material', async () => {
    const lean = vi.fn().mockResolvedValue({
      discordUserId: 'user-1',
      provider: 'warcraftlogs',
      tokenType: 'Bearer',
      scope: 'view-user-profile',
      expiresAt: new Date('2026-04-09T01:00:00.000Z'),
      linkedAt: new Date('2026-04-08T00:00:00.000Z'),
      updatedAt: new Date('2026-04-09T00:00:00.000Z'),
    });
    const select = vi.fn().mockReturnValue({ lean });
    vi.spyOn(WclUserAuthModel, 'findOne').mockReturnValue({ select } as never);

    const store = makeStore();
    const status = await store.getStatusByDiscordUserId('user-1');

    expect(select).toHaveBeenCalledWith(
      'discordUserId provider tokenType scope expiresAt linkedAt updatedAt',
    );
    expect(JSON.stringify(status)).not.toContain('access-token');
    expect(JSON.stringify(status)).not.toContain('refresh-token');
    expect(lean).toHaveBeenCalled();
    expect(status).toEqual(
      expect.objectContaining({
        discordUserId: 'user-1',
        provider: 'warcraftlogs',
        tokenType: 'Bearer',
      }),
    );
  });

  it('deletes WCL auth only for the current Discord user ID', async () => {
    vi.spyOn(WclUserAuthModel, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);

    const store = makeStore();
    await store.deleteForDiscordUser('user-1');

    expect(WclUserAuthModel.deleteOne).toHaveBeenCalledWith({ discordUserId: 'user-1' });
  });

  it('drops the legacy unique provider index before creating user-scoped indexes', async () => {
    vi.spyOn(WclUserAuthModel.collection, 'indexes').mockResolvedValue([
      { name: 'provider_1', unique: true, key: { provider: 1 } },
    ] as never);
    const dropIndex = vi
      .spyOn(WclUserAuthModel.collection, 'dropIndex')
      .mockResolvedValue({ ok: 1 } as never);
    const createIndex = vi
      .spyOn(WclUserAuthModel.collection, 'createIndex')
      .mockResolvedValue('index' as never);

    await migrateWclUserAuthDiscordUserIndex();

    expect(dropIndex).toHaveBeenCalledWith('provider_1');
    expect(createIndex).toHaveBeenCalledWith(
      { discordUserId: 1 },
      { unique: true, name: 'discordUserId_1' },
    );
    expect(createIndex).toHaveBeenCalledWith({ provider: 1 }, { name: 'provider_1' });
  });
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
    expect(config.autoReportMode).toBe('prompt');
    expect(config.autoReportChannelIds).toEqual([]);
    expect(config).not.toHaveProperty('accountabilityVisibility');
    expect(config).not.toHaveProperty('coachingShareabilityDefault');
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
        autoReportMode: 'always',
        autoReportChannelIds: ['channel-1', 42, 'channel-1', 'channel-2'],
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.compareAccessMode).toBe(DEFAULT_COMPARE_ACCESS_MODE);
    expect(config.compareOfficerUserIds).toEqual(['user-1', 'user-2']);
    expect(config.comparePublicPostingEnabled).toBe(false);
    expect(config.autoReportMode).toBe('prompt');
    expect(config.autoReportChannelIds).toEqual(['channel-1', 'channel-2']);
  });

  it('ignores retired config fields when loading legacy guild config documents', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        accountabilityVisibility: 'shareable',
        coachingShareabilityDefault: 'shareable',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.defaultGameFamily).toBe('retail');
    expect(config).not.toHaveProperty('accountabilityVisibility');
    expect(config).not.toHaveProperty('coachingShareabilityDefault');
  });

  it('persists configured values via upsert', async () => {
    const lean = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      compareAccessMode: 'owner_only',
      compareOfficerUserIds: ['user-1'],
      comparePublicPostingEnabled: true,
      autoReportMode: 'auto_preview',
      autoReportChannelIds: ['channel-1'],
    });
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean,
    } as never);

    const store = new MongoGuildConfigStore();
    const saved = await store.saveGuildConfig('guild-1', {
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      compareAccessMode: 'owner_only',
      compareOfficerUserIds: ['user-1'],
      comparePublicPostingEnabled: true,
      autoReportMode: 'auto_preview',
      autoReportChannelIds: ['channel-1'],
    });

    expect(saved.defaultGameFamily).toBe('mop_classic');
    expect(saved.compareModeDefault).toBe('mixed');
    expect(saved.compareAccessMode).toBe('owner_only');
    expect(saved.compareOfficerUserIds).toEqual(['user-1']);
    expect(saved.comparePublicPostingEnabled).toBe(true);
    expect(saved.autoReportMode).toBe('auto_preview');
    expect(saved.autoReportChannelIds).toEqual(['channel-1']);
    expect(saved).not.toHaveProperty('accountabilityVisibility');
    expect(saved).not.toHaveProperty('coachingShareabilityDefault');
    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'guild-1' },
      {
        $set: {
          defaultGameFamily: 'mop_classic',
          compareModeDefault: 'mixed',
          compareAccessMode: 'owner_only',
          compareOfficerUserIds: ['user-1'],
          comparePublicPostingEnabled: true,
          autoReportMode: 'auto_preview',
          autoReportChannelIds: ['channel-1'],
        },
        $unset: { dashboardDeconfiguredAt: '' },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
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
          autoReportChannelIds: ['channel-1'],
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
        autoReportChannelCount: 0,
      }),
      expect.objectContaining({
        guildId: '223456789012345678',
        compareOfficerUserCount: 2,
        autoReportChannelCount: 1,
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
    const createDefaultUpdate = vi.mocked(GuildSettingsModel.findOneAndUpdate).mock.calls[0]?.[1];

    expect(config.guildId).toBe('guild-1');
    expect(config).not.toHaveProperty('accountabilityVisibility');
    expect(config).not.toHaveProperty('coachingShareabilityDefault');
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
    expect((createDefaultUpdate as { $setOnInsert: Record<string, unknown> }).$setOnInsert).not.toHaveProperty(
      'accountabilityVisibility',
    );
    expect((createDefaultUpdate as { $setOnInsert: Record<string, unknown> }).$setOnInsert).not.toHaveProperty(
      'coachingShareabilityDefault',
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

  it('does not write retired fields back during unrelated config updates', async () => {
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        compareModeDefault: 'character',
        comparePublicPostingEnabled: true,
        accountabilityVisibility: 'off',
        coachingShareabilityDefault: 'private',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const saved = await store.saveGuildConfig('guild-1', {
      comparePublicPostingEnabled: true,
    });
    const update = vi.mocked(GuildSettingsModel.findOneAndUpdate).mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
    };

    expect(saved.comparePublicPostingEnabled).toBe(true);
    expect(saved).not.toHaveProperty('accountabilityVisibility');
    expect(saved).not.toHaveProperty('coachingShareabilityDefault');
    expect(update.$set).toEqual({ comparePublicPostingEnabled: true });
    expect(update.$set).not.toHaveProperty('accountabilityVisibility');
    expect(update.$set).not.toHaveProperty('coachingShareabilityDefault');
  });

  it('sanitizes retired keys out of raw update payloads before $set', async () => {
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        compareModeDefault: 'mixed',
        comparePublicPostingEnabled: true,
        accountabilityVisibility: 'shareable',
        coachingShareabilityDefault: 'shareable',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const rawUpdate = {
      comparePublicPostingEnabled: true,
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
    } as unknown as Partial<Omit<Awaited<ReturnType<MongoGuildConfigStore['getGuildConfig']>>, 'guildId'>>;

    const saved = await store.saveGuildConfig('guild-1', rawUpdate);
    const update = vi.mocked(GuildSettingsModel.findOneAndUpdate).mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
    };

    expect(saved.comparePublicPostingEnabled).toBe(true);
    expect(saved).not.toHaveProperty('accountabilityVisibility');
    expect(saved).not.toHaveProperty('coachingShareabilityDefault');
    expect(update.$set).toEqual({ comparePublicPostingEnabled: true });
    expect(update.$set).not.toHaveProperty('accountabilityVisibility');
    expect(update.$set).not.toHaveProperty('coachingShareabilityDefault');
  });

  it('skips writes when a raw update only contains retired keys', async () => {
    const findOneAndUpdate = vi.spyOn(GuildSettingsModel, 'findOneAndUpdate');
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        compareModeDefault: 'character',
        accountabilityVisibility: 'off',
        coachingShareabilityDefault: 'private',
      }),
    } as never);

    const store = new MongoGuildConfigStore();
    const rawUpdate = {
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
    } as unknown as Partial<Omit<Awaited<ReturnType<MongoGuildConfigStore['getGuildConfig']>>, 'guildId'>>;

    const saved = await store.saveGuildConfig('guild-1', rawUpdate);

    expect(saved.compareModeDefault).toBe('character');
    expect(saved).not.toHaveProperty('accountabilityVisibility');
    expect(saved).not.toHaveProperty('coachingShareabilityDefault');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(GuildSettingsModel.findOne).toHaveBeenCalledWith({
      guildId: 'guild-1',
      $or: [{ dashboardDeconfiguredAt: { $exists: false } }, { dashboardDeconfiguredAt: null }],
    });
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

describe('MongoAutoReportPromptStateStore', () => {
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
    vi.spyOn(AutoReportPromptStateModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(promptState),
    } as never);
    vi.spyOn(AutoReportPromptStateModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(promptState),
    } as never);

    const store = new MongoAutoReportPromptStateStore();
    await store.savePromptState(promptState);
    const found = await store.getValidPromptState('source-message-1');

    expect(found?.sourceMessageId).toBe('source-message-1');
    expect(AutoReportPromptStateModel.findOne).toHaveBeenCalledWith({
      sourceMessageId: 'source-message-1',
      expiresAt: { $gt: now },
    });
  });

  it('consumes valid prompt state atomically', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const consumeSpy = vi.spyOn(AutoReportPromptStateModel, 'findOneAndDelete').mockReturnValue({
      lean: vi.fn().mockResolvedValue(promptState),
    } as never);

    const store = new MongoAutoReportPromptStateStore();
    await store.consumeValidPromptState('source-message-1');

    expect(consumeSpy).toHaveBeenCalledWith({
      sourceMessageId: 'source-message-1',
      expiresAt: { $gt: now },
    });
  });

  it('treats prompt state past expiresAt as expired even before TTL cleanup', async () => {
    vi.spyOn(AutoReportPromptStateModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoAutoReportPromptStateStore();
    const found = await store.getValidPromptState('source-message-1');

    expect(found).toBeNull();
    expect(AutoReportPromptStateModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: expect.any(Object) }),
    );
  });
});

describe('MongoAutoReportDuplicateTrackingStore', () => {
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
    vi.spyOn(AutoReportDuplicateTrackingModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(AutoReportDuplicateTrackingModel, 'create').mockResolvedValue({
      toObject: () => processingRecord,
    } as never);

    const store = new MongoAutoReportDuplicateTrackingStore();
    const result = await store.claimPassiveDetection(trackingInput);

    expect(result).toMatchObject({ claimed: true, record: processingRecord });
    expect(AutoReportDuplicateTrackingModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        status: 'processing',
      }),
    );
    expect(AutoReportDuplicateTrackingModel.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        latestOutputMessageId: expect.anything(),
        latestOutputKind: expect.anything(),
        duplicateConfirmationMessageId: expect.anything(),
        confirmationNonce: expect.anything(),
      }),
    );
  });

  it('returns the active duplicate record when the atomic claim loses a race', async () => {
    vi.spyOn(AutoReportDuplicateTrackingModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(AutoReportDuplicateTrackingModel, 'create').mockRejectedValue({ code: 11000 });
    vi.spyOn(AutoReportDuplicateTrackingModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        ...trackingInput,
        status: 'prompted',
        latestOutputMessageId: 'prompt-message-1',
        latestOutputKind: 'prompt',
      }),
    } as never);

    const store = new MongoAutoReportDuplicateTrackingStore();
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
    vi.spyOn(AutoReportDuplicateTrackingModel, 'findOneAndUpdate').mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        ...trackingInput,
        status: 'preview_posted',
        latestOutputMessageId: 'preview-message-1',
        latestOutputKind: 'public_preview',
      }),
    } as never);
    vi.spyOn(AutoReportDuplicateTrackingModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoAutoReportDuplicateTrackingStore();
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
    expect(AutoReportDuplicateTrackingModel.findOne).toHaveBeenCalledWith({
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
      .spyOn(AutoReportDuplicateTrackingModel, 'findOneAndUpdate')
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
    vi.spyOn(AutoReportDuplicateTrackingModel, 'create').mockRejectedValue(
      new Error('create should not be called when reclaiming an expired record'),
    );
    vi.spyOn(AutoReportDuplicateTrackingModel, 'findOne').mockImplementation((query) => {
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

    const store = new MongoAutoReportDuplicateTrackingStore();
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

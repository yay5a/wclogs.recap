import crypto from 'node:crypto';
import type { CharacterClaimStatus } from '@wcl/domain';
import {
  CharacterClaimModel,
  type CharacterClaimDocument,
} from '../models/character-claim-model.js';

export type CharacterClaimRecord = CharacterClaimDocument;

export interface CharacterClaimIdentityInput {
  guildId: string;
  discordUserId: string;
  participantKey: string;
}

export interface CharacterClaimCharacterInput extends CharacterClaimIdentityInput {
  characterName: string;
  region: string;
  realm: string;
}

export interface RequestCharacterClaimInput extends CharacterClaimCharacterInput {
  requestedAt?: Date;
}

export interface ReviewCharacterClaimInput extends CharacterClaimCharacterInput {
  reviewedByDiscordUserId: string;
  reviewedAt?: Date;
}

export interface RevokeCharacterClaimInput extends CharacterClaimIdentityInput {
  revokedAt?: Date;
  revokedByDiscordUserId?: string;
  revokeReason?: string;
}

export interface ReviewClaimByIdInput {
  guildId: string;
  claimId: string;
  reviewedByDiscordUserId?: string | undefined;
  reviewedAt?: Date;
}

export interface RevokeClaimByIdInput {
  guildId: string;
  claimId: string;
  revokedByDiscordUserId?: string | undefined;
  revokedAt?: Date;
  revokeReason?: string | undefined;
}

export interface UpdateClaimPrivacyInput extends CharacterClaimIdentityInput {
  peerCompareOptIn?: boolean;
  publicPostOptIn?: boolean;
}

const ACTIVE_CLAIM_STATUSES: CharacterClaimStatus[] = ['pending', 'approved'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeClaimIdentityPart = (value: string): string => value.trim().toLowerCase();
const normalizeClaimRegion = (value: string): string => value.trim().toUpperCase();

const normalizedClaimFields = (input: { characterName: string; realm: string }) => ({
  normalizedRealm: normalizeClaimIdentityPart(input.realm),
  normalizedCharacterName: normalizeClaimIdentityPart(input.characterName),
});

const missingClaimIdentityFieldFilter = {
  $or: [
    { claimId: { $exists: false } },
    { claimId: null },
    { claimId: '' },
    { normalizedRealm: { $exists: false } },
    { normalizedRealm: null },
    { normalizedRealm: '' },
    { normalizedCharacterName: { $exists: false } },
    { normalizedCharacterName: null },
    { normalizedCharacterName: '' },
    { region: { $exists: false } },
    { region: null },
    { region: '' },
    { region: { $regex: /(^\s)|(\s$)|[a-z]/ } },
  ],
};

const assignOptionalDate = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (value instanceof Date) target[key] = value;
};

const assignOptionalString = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (typeof value === 'string') target[key] = value;
};

const isCharacterClaimStatus = (value: unknown): value is CharacterClaimStatus =>
  value === 'pending' || value === 'approved' || value === 'rejected' || value === 'revoked';

const toCharacterClaimRecord = (doc: unknown): CharacterClaimRecord | null => {
  if (!isRecord(doc)) return null;
  if (
    typeof doc.guildId !== 'string' ||
    typeof doc.discordUserId !== 'string' ||
    typeof doc.participantKey !== 'string' ||
    typeof doc.characterName !== 'string' ||
    typeof doc.region !== 'string' ||
    typeof doc.realm !== 'string' ||
    !isCharacterClaimStatus(doc.status) ||
    typeof doc.peerCompareOptIn !== 'boolean' ||
    typeof doc.publicPostOptIn !== 'boolean' ||
    !(doc.requestedAt instanceof Date)
  ) {
    return null;
  }

  const claimId =
    typeof doc.claimId === 'string'
      ? doc.claimId
      : isRecord(doc._id) && typeof doc._id.toString === 'function'
        ? doc._id.toString()
        : typeof doc._id === 'string'
          ? doc._id
          : `${doc.guildId}:${doc.discordUserId}:${doc.participantKey}`;

  if (!claimId) return null;

  const record: Record<string, unknown> = {
    claimId,
    guildId: doc.guildId,
    discordUserId: doc.discordUserId,
    participantKey: doc.participantKey,
    characterName: doc.characterName,
    region: doc.region,
    realm: doc.realm,
    status: doc.status,
    peerCompareOptIn: doc.peerCompareOptIn,
    publicPostOptIn: doc.publicPostOptIn,
    requestedAt: doc.requestedAt,
  };
  assignOptionalDate(record, 'reviewedAt', doc.reviewedAt);
  assignOptionalString(record, 'reviewedByDiscordUserId', doc.reviewedByDiscordUserId);
  assignOptionalDate(record, 'revokedAt', doc.revokedAt);
  assignOptionalString(record, 'revokedByDiscordUserId', doc.revokedByDiscordUserId);
  assignOptionalString(record, 'revokeReason', doc.revokeReason);
  assignOptionalDate(record, 'createdAt', doc.createdAt);
  assignOptionalDate(record, 'updatedAt', doc.updatedAt);
  return record as unknown as CharacterClaimRecord;
};

const parseRequiredClaim = (doc: unknown, failureMessage: string): CharacterClaimRecord => {
  const parsed = toCharacterClaimRecord(doc);
  if (!parsed) throw new Error(failureMessage);
  return parsed;
};

export interface CharacterClaimIdentityMigrationResult {
  backfilledCount: number;
  droppedLegacyIndexNames: string[];
}

type CharacterClaimBackfillDocument = {
  _id: unknown;
  claimId?: unknown;
  characterName?: unknown;
  realm?: unknown;
  region?: unknown;
  normalizedRealm?: unknown;
  normalizedCharacterName?: unknown;
};

type DuplicateActiveClaimIdentity = {
  _id?: {
    guildId?: unknown;
    region?: unknown;
    normalizedRealm?: unknown;
    normalizedCharacterName?: unknown;
  };
  count?: unknown;
  claimIds?: unknown[];
  documentIds?: unknown[];
};

const isMissingString = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

const sampleIds = (docs: Array<{ _id: unknown }>): string =>
  docs
    .slice(0, 5)
    .map((doc) => String(doc._id))
    .join(', ');

const describeDuplicateActiveClaim = (duplicate: DuplicateActiveClaimIdentity): string => {
  const key = duplicate._id ?? {};
  const label = [key.guildId, key.region, key.normalizedRealm, key.normalizedCharacterName]
    .map((value) => (typeof value === 'string' && value ? value : '<missing>'))
    .join('/');
  const claimIds = Array.isArray(duplicate.claimIds)
    ? duplicate.claimIds
        .slice(0, 5)
        .map((value) => String(value))
        .join(',')
    : '';
  return `${label} count=${String(duplicate.count ?? '?')}${claimIds ? ` claimIds=${claimIds}` : ''}`;
};

const isLegacyExactOwnerClaimIndex = (index: {
  key: Record<string, unknown> | undefined;
  unique: boolean | undefined;
}): boolean => {
  const key = index.key;
  if (!key || index.unique !== true) return false;
  const entries = Object.entries(key);
  return (
    entries.length === 3 && key.guildId === 1 && key.discordUserId === 1 && key.participantKey === 1
  );
};

export const migrateCharacterClaimIdentityFields =
  async (): Promise<CharacterClaimIdentityMigrationResult> => {
    const found = await CharacterClaimModel.find(missingClaimIdentityFieldFilter).lean();
    const docs = Array.isArray(found) ? (found as CharacterClaimBackfillDocument[]) : [];
    const invalidDocs = docs.filter((doc) => {
      const needsRealm = isMissingString(doc.normalizedRealm);
      const needsCharacterName = isMissingString(doc.normalizedCharacterName);
      return (
        isMissingString(doc.region) ||
        (needsRealm && typeof doc.realm !== 'string') ||
        (needsCharacterName && typeof doc.characterName !== 'string')
      );
    });
    if (invalidDocs.length > 0) {
      throw new Error(
        `Cannot backfill character claim identity fields for ${invalidDocs.length} claim(s); missing region, characterName, or realm. Sample ids: ${sampleIds(invalidDocs)}`,
      );
    }

    const operations = docs
      .map((doc) => {
        const set: Record<string, string> = {};
        if (isMissingString(doc.claimId)) {
          set.claimId = crypto.randomUUID();
        }
        const normalizedRegion = normalizeClaimRegion(doc.region as string);
        if (doc.region !== normalizedRegion) {
          set.region = normalizedRegion;
        }
        if (isMissingString(doc.normalizedRealm)) {
          set.normalizedRealm = normalizeClaimIdentityPart(doc.realm as string);
        }
        if (isMissingString(doc.normalizedCharacterName)) {
          set.normalizedCharacterName = normalizeClaimIdentityPart(doc.characterName as string);
        }
        return Object.keys(set).length > 0
          ? {
              updateOne: {
                filter: { _id: doc._id },
                update: { $set: set },
              },
            }
          : null;
      })
      .filter((operation): operation is NonNullable<typeof operation> => operation !== null);

    if (operations.length > 0) {
      await CharacterClaimModel.bulkWrite(operations, { ordered: false });
    }

    const duplicateActiveClaims = await CharacterClaimModel.collection
      .aggregate<DuplicateActiveClaimIdentity>([
        { $match: { status: { $in: ACTIVE_CLAIM_STATUSES } } },
        {
          $group: {
            _id: {
              guildId: '$guildId',
              region: '$region',
              normalizedRealm: '$normalizedRealm',
              normalizedCharacterName: '$normalizedCharacterName',
            },
            count: { $sum: 1 },
            claimIds: { $push: '$claimId' },
            documentIds: { $push: '$_id' },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $limit: 20 },
      ])
      .toArray();
    if (duplicateActiveClaims.length > 0) {
      throw new Error(
        `Cannot create active character claim identity index; duplicate active claims exist: ${duplicateActiveClaims
          .map(describeDuplicateActiveClaim)
          .join('; ')}`,
      );
    }

    const indexes = await CharacterClaimModel.collection.indexes();
    const droppedLegacyIndexNames = indexes
      .filter((index) =>
        isLegacyExactOwnerClaimIndex({
          key: index.key as Record<string, unknown> | undefined,
          unique: index.unique,
        }),
      )
      .map((index) => index.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    await Promise.all(
      droppedLegacyIndexNames.map((name) => CharacterClaimModel.collection.dropIndex(name)),
    );

    await CharacterClaimModel.collection.createIndex({ claimId: 1 }, { unique: true });
    await CharacterClaimModel.collection.createIndex(
      { guildId: 1, region: 1, normalizedRealm: 1, normalizedCharacterName: 1 },
      {
        unique: true,
        partialFilterExpression: { status: { $in: ACTIVE_CLAIM_STATUSES } },
      },
    );

    return {
      backfilledCount: operations.length,
      droppedLegacyIndexNames,
    };
  };

export class MongoCharacterClaimStore {
  public async requestCharacterClaim(
    input: RequestCharacterClaimInput,
  ): Promise<CharacterClaimRecord> {
    const region = normalizeClaimRegion(input.region);
    const existingActive = await CharacterClaimModel.findOne({
      guildId: input.guildId,
      region,
      ...normalizedClaimFields(input),
      status: { $in: ACTIVE_CLAIM_STATUSES },
    }).lean();

    if (existingActive) {
      throw new Error('An active character claim already exists.');
    }

    const requestedAt = input.requestedAt ?? new Date();
    const claimId = crypto.randomUUID();
    const saved = await CharacterClaimModel.findOneAndUpdate(
      { claimId },
      {
        $setOnInsert: {
          claimId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          participantKey: input.participantKey,
          characterName: input.characterName,
          region,
          realm: input.realm,
          ...normalizedClaimFields(input),
          status: 'pending',
          peerCompareOptIn: false,
          publicPostOptIn: false,
          requestedAt,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
      },
    ).lean();

    return parseRequiredClaim(saved, 'Failed to request character claim.');
  }

  public async approveCharacterClaim(
    input: ReviewCharacterClaimInput,
  ): Promise<CharacterClaimRecord | null> {
    const region = normalizeClaimRegion(input.region);
    const reviewedAt = input.reviewedAt ?? new Date();
    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        participantKey: input.participantKey,
        status: 'pending',
      },
      {
        $set: {
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          participantKey: input.participantKey,
          characterName: input.characterName,
          region,
          realm: input.realm,
          ...normalizedClaimFields(input),
          status: 'approved',
          reviewedAt,
          reviewedByDiscordUserId: input.reviewedByDiscordUserId,
        },
      },
      {
        returnDocument: 'after',
      },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async rejectCharacterClaim(
    input: ReviewCharacterClaimInput,
  ): Promise<CharacterClaimRecord | null> {
    const region = normalizeClaimRegion(input.region);
    const reviewedAt = input.reviewedAt ?? new Date();
    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        participantKey: input.participantKey,
        status: 'pending',
      },
      {
        $set: {
          status: 'rejected',
          reviewedAt,
          reviewedByDiscordUserId: input.reviewedByDiscordUserId,
          characterName: input.characterName,
          region,
          realm: input.realm,
          ...normalizedClaimFields(input),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async revokeCharacterClaim(
    input: RevokeCharacterClaimInput,
  ): Promise<CharacterClaimRecord | null> {
    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        participantKey: input.participantKey,
        status: 'approved',
      },
      {
        $set: {
          status: 'revoked',
          revokedAt: input.revokedAt ?? new Date(),
          ...(input.revokedByDiscordUserId
            ? { revokedByDiscordUserId: input.revokedByDiscordUserId }
            : {}),
          ...(input.revokeReason ? { revokeReason: input.revokeReason } : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async approveClaimById(input: ReviewClaimByIdInput): Promise<CharacterClaimRecord | null> {
    const reviewedAt = input.reviewedAt ?? new Date();
    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        claimId: input.claimId,
        status: 'pending',
      },
      {
        $set: {
          status: 'approved',
          reviewedAt,
          ...(input.reviewedByDiscordUserId
            ? { reviewedByDiscordUserId: input.reviewedByDiscordUserId }
            : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async rejectClaimById(input: ReviewClaimByIdInput): Promise<CharacterClaimRecord | null> {
    const reviewedAt = input.reviewedAt ?? new Date();
    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        claimId: input.claimId,
        status: 'pending',
      },
      {
        $set: {
          status: 'rejected',
          reviewedAt,
          ...(input.reviewedByDiscordUserId
            ? { reviewedByDiscordUserId: input.reviewedByDiscordUserId }
            : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async revokeClaimById(input: RevokeClaimByIdInput): Promise<CharacterClaimRecord | null> {
    const revokedAt = input.revokedAt ?? new Date();
    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        claimId: input.claimId,
        status: 'approved',
      },
      {
        $set: {
          status: 'revoked',
          revokedAt,
          ...(input.revokedByDiscordUserId
            ? { revokedByDiscordUserId: input.revokedByDiscordUserId }
            : {}),
          ...(input.revokeReason ? { revokeReason: input.revokeReason } : {}),
        },
      },
      { returnDocument: 'after' },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async findApprovedClaimForUserCharacter(
    input: CharacterClaimIdentityInput,
  ): Promise<CharacterClaimRecord | null> {
    const found = await CharacterClaimModel.findOne({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      participantKey: input.participantKey,
      status: 'approved',
    }).lean();

    return toCharacterClaimRecord(found);
  }

  public async findApprovedClaimsForParticipant(input: {
    guildId: string;
    participantKey: string;
  }): Promise<CharacterClaimRecord[]> {
    const found = await CharacterClaimModel.find({
      guildId: input.guildId,
      participantKey: input.participantKey,
      status: 'approved',
    }).lean();

    return Array.isArray(found)
      ? found
          .map((doc) => toCharacterClaimRecord(doc))
          .filter((doc): doc is CharacterClaimRecord => doc !== null)
      : [];
  }

  public async updateClaimPrivacy(
    input: UpdateClaimPrivacyInput,
  ): Promise<CharacterClaimRecord | null> {
    const update: Record<string, boolean> = {};
    if (typeof input.peerCompareOptIn === 'boolean') {
      update.peerCompareOptIn = input.peerCompareOptIn;
    }
    if (typeof input.publicPostOptIn === 'boolean') {
      update.publicPostOptIn = input.publicPostOptIn;
    }

    const saved = await CharacterClaimModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        participantKey: input.participantKey,
        status: 'approved',
      },
      { $set: update },
      { returnDocument: 'after' },
    ).lean();

    return toCharacterClaimRecord(saved);
  }

  public async listClaimsForUser(input: {
    guildId: string;
    discordUserId: string;
  }): Promise<CharacterClaimRecord[]> {
    const found = await CharacterClaimModel.find({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
    })
      .sort({ updatedAt: -1 })
      .lean();

    return Array.isArray(found)
      ? found
          .map((doc) => toCharacterClaimRecord(doc))
          .filter((doc): doc is CharacterClaimRecord => doc !== null)
      : [];
  }

  public async listPendingClaims(input: { guildId: string }): Promise<CharacterClaimRecord[]> {
    const found = await CharacterClaimModel.find({
      guildId: input.guildId,
      status: 'pending',
    })
      .sort({ requestedAt: 1 })
      .lean();

    return Array.isArray(found)
      ? found
          .map((doc) => toCharacterClaimRecord(doc))
          .filter((doc): doc is CharacterClaimRecord => doc !== null)
      : [];
  }

  public async listClaimsByStatus(input: {
    guildId: string;
    status: CharacterClaimStatus;
  }): Promise<CharacterClaimRecord[]> {
    const sort =
      input.status === 'pending'
        ? { requestedAt: 1 as const }
        : input.status === 'approved'
          ? { reviewedAt: -1 as const, updatedAt: -1 as const }
          : { revokedAt: -1 as const, updatedAt: -1 as const };
    const found = await CharacterClaimModel.find({
      guildId: input.guildId,
      status: input.status,
    })
      .sort(sort)
      .lean();

    return Array.isArray(found)
      ? found
          .map((doc) => toCharacterClaimRecord(doc))
          .filter((doc): doc is CharacterClaimRecord => doc !== null)
      : [];
  }
}

import type { CharacterClaimStatus } from "@wcl/domain";
import {
    CharacterClaimModel,
    type CharacterClaimDocument,
} from "../models/character-claim-model.js";

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
    reviewedAt?: Date;
}

export interface UpdateClaimPrivacyInput extends CharacterClaimIdentityInput {
    peerCompareOptIn?: boolean;
    publicPostOptIn?: boolean;
}

const ACTIVE_CLAIM_STATUSES: CharacterClaimStatus[] = ["pending", "approved"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const assignOptionalDate = (
    target: Record<string, unknown>,
    key: string,
    value: unknown,
) => {
    if (value instanceof Date) target[key] = value;
};

const assignOptionalString = (
    target: Record<string, unknown>,
    key: string,
    value: unknown,
) => {
    if (typeof value === "string") target[key] = value;
};

const isCharacterClaimStatus = (value: unknown): value is CharacterClaimStatus =>
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "revoked";

const toCharacterClaimRecord = (doc: unknown): CharacterClaimRecord | null => {
    if (!isRecord(doc)) return null;
    if (
        typeof doc.guildId !== "string" ||
        typeof doc.discordUserId !== "string" ||
        typeof doc.participantKey !== "string" ||
        typeof doc.characterName !== "string" ||
        typeof doc.region !== "string" ||
        typeof doc.realm !== "string" ||
        !isCharacterClaimStatus(doc.status) ||
        typeof doc.peerCompareOptIn !== "boolean" ||
        typeof doc.publicPostOptIn !== "boolean" ||
        !(doc.requestedAt instanceof Date)
    ) {
        return null;
    }

    const record: Record<string, unknown> = {
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
    assignOptionalDate(record, "reviewedAt", doc.reviewedAt);
    assignOptionalString(record, "reviewedByDiscordUserId", doc.reviewedByDiscordUserId);
    assignOptionalDate(record, "createdAt", doc.createdAt);
    assignOptionalDate(record, "updatedAt", doc.updatedAt);
    return record as unknown as CharacterClaimRecord;
};

const parseRequiredClaim = (doc: unknown, failureMessage: string): CharacterClaimRecord => {
    const parsed = toCharacterClaimRecord(doc);
    if (!parsed) throw new Error(failureMessage);
    return parsed;
};

export class MongoCharacterClaimStore {
    public async requestCharacterClaim(
        input: RequestCharacterClaimInput,
    ): Promise<CharacterClaimRecord> {
        const existingActive = await CharacterClaimModel.findOne({
            guildId: input.guildId,
            discordUserId: input.discordUserId,
            participantKey: input.participantKey,
            status: { $in: ACTIVE_CLAIM_STATUSES },
        }).lean();

        if (existingActive) {
            throw new Error("An active character claim already exists.");
        }

        const requestedAt = input.requestedAt ?? new Date();
        const saved = await CharacterClaimModel.findOneAndUpdate(
            {
                guildId: input.guildId,
                discordUserId: input.discordUserId,
                participantKey: input.participantKey,
            },
            {
                $set: {
                    guildId: input.guildId,
                    discordUserId: input.discordUserId,
                    participantKey: input.participantKey,
                    characterName: input.characterName,
                    region: input.region,
                    realm: input.realm,
                    status: "pending",
                    peerCompareOptIn: false,
                    publicPostOptIn: false,
                    requestedAt,
                },
                $unset: {
                    reviewedAt: "",
                    reviewedByDiscordUserId: "",
                },
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        return parseRequiredClaim(saved, "Failed to request character claim.");
    }

    public async approveCharacterClaim(
        input: ReviewCharacterClaimInput,
    ): Promise<CharacterClaimRecord> {
        const reviewedAt = input.reviewedAt ?? new Date();
        const saved = await CharacterClaimModel.findOneAndUpdate(
            {
                guildId: input.guildId,
                discordUserId: input.discordUserId,
                participantKey: input.participantKey,
            },
            {
                $set: {
                    guildId: input.guildId,
                    discordUserId: input.discordUserId,
                    participantKey: input.participantKey,
                    characterName: input.characterName,
                    region: input.region,
                    realm: input.realm,
                    status: "approved",
                    reviewedAt,
                    reviewedByDiscordUserId: input.reviewedByDiscordUserId,
                },
                $setOnInsert: {
                    peerCompareOptIn: false,
                    publicPostOptIn: false,
                    requestedAt: reviewedAt,
                },
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        return parseRequiredClaim(saved, "Failed to approve character claim.");
    }

    public async rejectCharacterClaim(
        input: ReviewCharacterClaimInput,
    ): Promise<CharacterClaimRecord | null> {
        const reviewedAt = input.reviewedAt ?? new Date();
        const saved = await CharacterClaimModel.findOneAndUpdate(
            {
                guildId: input.guildId,
                discordUserId: input.discordUserId,
                participantKey: input.participantKey,
                status: "pending",
            },
            {
                $set: {
                    status: "rejected",
                    reviewedAt,
                    reviewedByDiscordUserId: input.reviewedByDiscordUserId,
                    characterName: input.characterName,
                    region: input.region,
                    realm: input.realm,
                },
            },
            { new: true },
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
                status: "approved",
            },
            {
                $set: {
                    status: "revoked",
                    reviewedAt: input.reviewedAt ?? new Date(),
                },
            },
            { new: true },
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
            status: "approved",
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
            status: "approved",
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
        if (typeof input.peerCompareOptIn === "boolean") {
            update.peerCompareOptIn = input.peerCompareOptIn;
        }
        if (typeof input.publicPostOptIn === "boolean") {
            update.publicPostOptIn = input.publicPostOptIn;
        }

        const saved = await CharacterClaimModel.findOneAndUpdate(
            {
                guildId: input.guildId,
                discordUserId: input.discordUserId,
                participantKey: input.participantKey,
                status: "approved",
            },
            { $set: update },
            { new: true },
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

    public async listPendingClaims(input: {
        guildId: string;
    }): Promise<CharacterClaimRecord[]> {
        const found = await CharacterClaimModel.find({
            guildId: input.guildId,
            status: "pending",
        })
            .sort({ requestedAt: 1 })
            .lean();

        return Array.isArray(found)
            ? found
                .map((doc) => toCharacterClaimRecord(doc))
                .filter((doc): doc is CharacterClaimRecord => doc !== null)
            : [];
    }
}

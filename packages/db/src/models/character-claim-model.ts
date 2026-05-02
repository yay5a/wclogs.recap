import crypto from "node:crypto";
import mongoose, { Schema, type Model } from "mongoose";
import {
    CHARACTER_CLAIM_STATUSES,
    type CharacterClaimStatus,
} from "@wcl/domain";

export interface CharacterClaimDocument {
    claimId: string;
    guildId: string;
    discordUserId: string;
    participantKey: string;
    characterName: string;
    region: string;
    realm: string;
    normalizedRealm?: string;
    normalizedCharacterName?: string;
    status: CharacterClaimStatus;
    peerCompareOptIn: boolean;
    publicPostOptIn: boolean;
    requestedAt: Date;
    reviewedAt?: Date;
    reviewedByDiscordUserId?: string;
    revokedAt?: Date;
    revokedByDiscordUserId?: string;
    revokeReason?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

const characterClaimSchema = new Schema<CharacterClaimDocument>(
    {
        claimId: {
            type: String,
            required: true,
            unique: true,
            default: () => crypto.randomUUID(),
            index: true,
        },
        guildId: { type: String, required: true, index: true },
        discordUserId: { type: String, required: true, index: true },
        participantKey: { type: String, required: true, index: true },
        characterName: { type: String, required: true },
        region: { type: String, required: true },
        realm: { type: String, required: true },
        normalizedRealm: { type: String, required: true, index: true },
        normalizedCharacterName: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: CHARACTER_CLAIM_STATUSES,
            required: true,
            default: "pending",
            index: true,
        },
        peerCompareOptIn: { type: Boolean, required: true, default: false },
        publicPostOptIn: { type: Boolean, required: true, default: false },
        requestedAt: { type: Date, required: true, default: Date.now },
        reviewedAt: { type: Date },
        reviewedByDiscordUserId: { type: String },
        revokedAt: { type: Date },
        revokedByDiscordUserId: { type: String },
        revokeReason: { type: String },
    },
    { timestamps: true },
);

characterClaimSchema.index(
    { guildId: 1, region: 1, normalizedRealm: 1, normalizedCharacterName: 1 },
    {
        unique: true,
        partialFilterExpression: { status: { $in: ["pending", "approved"] } },
    },
);
characterClaimSchema.index({ guildId: 1, participantKey: 1, status: 1 });
characterClaimSchema.index({ guildId: 1, discordUserId: 1, status: 1 });

export const CharacterClaimModel: Model<CharacterClaimDocument> =
    (mongoose.models.CharacterClaim as Model<CharacterClaimDocument> | undefined) ??
    mongoose.model<CharacterClaimDocument>("CharacterClaim", characterClaimSchema);

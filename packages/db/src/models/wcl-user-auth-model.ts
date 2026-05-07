import mongoose, { Schema, type Model } from "mongoose";
import type { WclTokenEnvelope } from "../wcl-token-encryption.js";

export type WclUserAuthDocument = {
    discordUserId: string;
    provider: "warcraftlogs";
    accessTokenEnvelope?: WclTokenEnvelope;
    refreshTokenEnvelope?: WclTokenEnvelope;
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    linkedAt: Date;
    updatedAt: Date;
};

const wclTokenEnvelopeSchema = new Schema<WclTokenEnvelope>(
    {
        keyVersion: { type: String, required: true },
        algorithm: { type: String, required: true },
        iv: { type: String, required: true },
        authTag: { type: String, required: true },
        ciphertext: { type: String, required: true },
    },
    {
        _id: false,
        versionKey: false,
    },
);

const wclUserAuthSchema = new Schema<WclUserAuthDocument>(
    {
        discordUserId: { type: String, required: true, unique: true },
        provider: { type: String, required: true, index: true },
        accessTokenEnvelope: { type: wclTokenEnvelopeSchema, required: false },
        refreshTokenEnvelope: { type: wclTokenEnvelopeSchema, required: false },
        accessToken: { type: String, required: false },
        refreshToken: { type: String, required: false },
        tokenType: { type: String, required: false },
        scope: { type: String, required: false },
        expiresAt: { type: Date, required: false },
        linkedAt: { type: Date, required: true },
        updatedAt: { type: Date, required: true },
    },
    {
        versionKey: false,
    },
);

export const WclUserAuthModel: Model<WclUserAuthDocument> =
    (mongoose.models.WclUserAuth as Model<WclUserAuthDocument> | undefined) ??
    mongoose.model<WclUserAuthDocument>("WclUserAuth", wclUserAuthSchema);

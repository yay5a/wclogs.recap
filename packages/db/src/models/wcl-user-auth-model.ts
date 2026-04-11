import mongoose, { Schema, type Model } from "mongoose";

export type WclUserAuthDocument = {
    provider: "warcraftlogs";
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    updatedAt: Date;
};

const wclUserAuthSchema = new Schema<WclUserAuthDocument>(
    {
        provider: { type: String, required: true, unique: true },
        accessToken: { type: String, required: true },
        refreshToken: { type: String, required: false },
        tokenType: { type: String, required: false },
        scope: { type: String, required: false },
        expiresAt: { type: Date, required: false },
        updatedAt: { type: Date, required: true },
    },
    {
        versionKey: false,
    },
);

export const WclUserAuthModel: Model<WclUserAuthDocument> =
    (mongoose.models.WclUserAuth as Model<WclUserAuthDocument> | undefined) ??
    mongoose.model<WclUserAuthDocument>("WclUserAuth", wclUserAuthSchema);

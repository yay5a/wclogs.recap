import { Schema, model, models } from "mongoose";

const wclUserAuthSchema = new Schema(
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

export type WclUserAuthDocument = {
    provider: "warcraftlogs";
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    updatedAt: Date;
};

export const WclUserAuthModel =
    models.WclUserAuth ?? model("WclUserAuth", wclUserAuthSchema);

import mongoose, { Schema, type Model } from "mongoose";

export interface ComparisonSnapshotDocument {
    guildId: string;
    reportCode: string;
    reportStartedAt: Date;
    participantKey: string;
    sourceUrl?: string;
    zoneName?: string;
    warcraftLogsActorId?: number;
    warcraftLogsGuid?: number;
    characterName?: string;
    region?: string;
    realm?: string;
    server?: string;
    className?: string;
    specName?: string;
    role?: string;
    icon?: string;
    rankPercent?: number;
    damageTotal?: number;
    healingTotal?: number;
    deaths?: number;
    interrupts?: number;
    dispels?: number;
    bestBossName?: string;
    lowestBossName?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

const comparisonSnapshotSchema = new Schema<ComparisonSnapshotDocument>(
    {
        guildId: { type: String, required: true, index: true },
        reportCode: { type: String, required: true, index: true },
        reportStartedAt: { type: Date, required: true, index: true },
        participantKey: { type: String, required: true, index: true },
        sourceUrl: { type: String },
        zoneName: { type: String },
        warcraftLogsActorId: { type: Number },
        warcraftLogsGuid: { type: Number },
        characterName: { type: String },
        region: { type: String },
        realm: { type: String },
        server: { type: String },
        className: { type: String },
        specName: { type: String },
        role: { type: String },
        icon: { type: String },
        rankPercent: { type: Number },
        damageTotal: { type: Number },
        healingTotal: { type: Number },
        deaths: { type: Number },
        interrupts: { type: Number },
        dispels: { type: Number },
        bestBossName: { type: String },
        lowestBossName: { type: String },
    },
    { timestamps: true },
);

comparisonSnapshotSchema.index(
    { guildId: 1, reportCode: 1, participantKey: 1 },
    { unique: true },
);
comparisonSnapshotSchema.index({
    guildId: 1,
    participantKey: 1,
    reportStartedAt: -1,
});

export const ComparisonSnapshotModel: Model<ComparisonSnapshotDocument> =
    (mongoose.models.ComparisonSnapshot as
        | Model<ComparisonSnapshotDocument>
        | undefined) ??
    mongoose.model<ComparisonSnapshotDocument>(
        "ComparisonSnapshot",
        comparisonSnapshotSchema,
    );

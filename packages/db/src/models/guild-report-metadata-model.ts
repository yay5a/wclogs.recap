import type { GameFamily } from "@wcl/domain";
import mongoose, { Schema, type Model } from "mongoose";

export interface GuildReportMetadataDocument {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    gameFamily: GameFamily;
    reportCode: string;
    title?: string;
    owner?: string;
    zoneId?: number;
    startTime: number;
    endTime?: number;
    indexedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface GuildReportMetadataCursorDocument {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    gameFamily: GameFamily;
    lastSeenStartTime: number;
    lastIndexedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const guildScopeFields = {
    guildName: { type: String, required: true, index: true },
    guildServerSlug: { type: String, required: true, index: true },
    guildServerRegion: { type: String, required: true, index: true },
    gameFamily: {
        type: String,
        enum: ["retail", "mop_classic"],
        required: true,
        index: true,
    },
} as const;

const guildReportMetadataSchema = new Schema<GuildReportMetadataDocument>(
    {
        ...guildScopeFields,
        reportCode: { type: String, required: true, index: true },
        title: { type: String },
        owner: { type: String },
        zoneId: { type: Number },
        startTime: { type: Number, required: true, index: true },
        endTime: { type: Number },
        indexedAt: { type: Date, required: true, default: Date.now },
    },
    { timestamps: true },
);

guildReportMetadataSchema.index(
    {
        guildName: 1,
        guildServerSlug: 1,
        guildServerRegion: 1,
        gameFamily: 1,
        reportCode: 1,
    },
    { unique: true },
);
guildReportMetadataSchema.index({
    guildName: 1,
    guildServerSlug: 1,
    guildServerRegion: 1,
    gameFamily: 1,
    startTime: -1,
});

const guildReportMetadataCursorSchema = new Schema<GuildReportMetadataCursorDocument>(
    {
        ...guildScopeFields,
        lastSeenStartTime: { type: Number, required: true },
        lastIndexedAt: { type: Date, required: true },
    },
    { timestamps: true },
);

guildReportMetadataCursorSchema.index(
    {
        guildName: 1,
        guildServerSlug: 1,
        guildServerRegion: 1,
        gameFamily: 1,
    },
    { unique: true },
);

export const GuildReportMetadataModel: Model<GuildReportMetadataDocument> =
    (mongoose.models.GuildReportMetadata as Model<GuildReportMetadataDocument> | undefined) ??
    mongoose.model<GuildReportMetadataDocument>(
        "GuildReportMetadata",
        guildReportMetadataSchema,
    );

export const GuildReportMetadataCursorModel: Model<GuildReportMetadataCursorDocument> =
    (mongoose.models.GuildReportMetadataCursor as
        | Model<GuildReportMetadataCursorDocument>
        | undefined) ??
    mongoose.model<GuildReportMetadataCursorDocument>(
        "GuildReportMetadataCursor",
        guildReportMetadataCursorSchema,
    );

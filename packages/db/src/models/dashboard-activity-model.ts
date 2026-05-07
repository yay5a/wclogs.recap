import mongoose, { Schema, type Model } from "mongoose";
import type { ActivityActor, BotActivityKind } from "@wcl/domain";

export interface DashboardActivityDocument {
    guildId: string;
    channelId?: string;
    sourceMessageId?: string;
    actor?: ActivityActor;
    kind: BotActivityKind;
    reportCode?: string;
    sourceUrl?: string;
    discordMessageUrl?: string;
    characterLabel?: string;
    targetDiscordUserId?: string;
    idempotencyKey?: string;
    createdAt: Date;
    expiresAt: Date;
    archivedAt?: Date;
}

const activityActorSchema = new Schema<ActivityActor>(
    {
        kind: { type: String, enum: ["discord", "admin-secret", "system"], required: true },
        discordUserId: { type: String },
    },
    { _id: false },
);

const dashboardActivitySchema = new Schema<DashboardActivityDocument>(
    {
        guildId: { type: String, required: true, index: true },
        channelId: { type: String, index: true },
        sourceMessageId: { type: String },
        actor: { type: activityActorSchema },
        kind: {
            type: String,
            required: true,
            enum: [
                "report_preview_created",
                "report_posted",
                "private_comparison_rendered",
                "public_comparison_posted",
                "claim_requested",
                "claim_approved",
                "claim_rejected",
                "claim_revoked",
                "config_updated",
                "officer_added",
                "officer_removed",
            ],
            index: true,
        },
        reportCode: { type: String, index: true },
        sourceUrl: { type: String },
        discordMessageUrl: { type: String },
        characterLabel: { type: String },
        targetDiscordUserId: { type: String, index: true },
        idempotencyKey: { type: String, unique: true, sparse: true },
        createdAt: { type: Date, required: true, default: Date.now, index: true },
        expiresAt: { type: Date, required: true, index: true },
        archivedAt: { type: Date },
    },
    { timestamps: false },
);

dashboardActivitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
dashboardActivitySchema.index({ guildId: 1, createdAt: -1 });

export const DashboardActivityModel: Model<DashboardActivityDocument> =
    (mongoose.models.DashboardActivity as Model<DashboardActivityDocument> | undefined) ??
    mongoose.model<DashboardActivityDocument>("DashboardActivity", dashboardActivitySchema);

import mongoose, { Schema } from "mongoose";
import { defaultGuildConfigFor } from "@wcl/domain";
export const connectMongo = async (uri) => mongoose.connect(uri);
const guildSettingsSchema = new Schema({
    guildId: { type: String, required: true, unique: true },
    defaultGameFamily: {
        type: String,
        enum: ["retail", "mop_classic"],
        default: "retail",
    },
    compareModeDefault: {
        type: String,
        enum: ["character", "mixed"],
        default: "character",
    },
    accountabilityVisibility: {
        type: String,
        enum: ["off", "officers-only", "shareable"],
        default: "off",
    },
    coachingShareabilityDefault: {
        type: String,
        enum: ["private", "shareable"],
        default: "private",
    },
    recapPostModeDefault: {
        type: String,
        enum: ["preview-and-post", "preview-only"],
        default: "preview-and-post",
    },
    officersRoleIds: [{ type: String }],
}, { timestamps: true });
const playerProfileSchema = new Schema({
    guildId: { type: String, required: true, index: true },
    discordUserId: { type: String, index: true },
    displayName: { type: String, required: true },
    characterIdentityIds: [
        { type: Schema.Types.ObjectId, ref: "CharacterIdentity" },
    ],
    confidenceScore: { type: Number, default: 0 },
}, { timestamps: true });
const characterIdentitySchema = new Schema({
    profileId: {
        type: Schema.Types.ObjectId,
        ref: "PlayerProfile",
        index: true,
    },
    characterName: { type: String, required: true },
    realm: { type: String },
    gameFamily: {
        type: String,
        enum: ["retail", "mop_classic"],
        required: true,
    },
    specHistory: [
        { specName: String, firstSeenAt: Date, lastSeenAt: Date },
    ],
    autoLinked: { type: Boolean, default: false },
    candidateLinks: [{ discordUserId: String, confidence: Number }],
}, { timestamps: true });
const reportCacheSchema = new Schema({
    reportCode: { type: String, unique: true, required: true },
    sourceUrl: { type: String, required: true },
    gameFamily: {
        type: String,
        enum: ["retail", "mop_classic"],
        required: true,
    },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    normalizedPayload: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
}, { timestamps: true });
const raidSnapshotSchema = new Schema({
    guildId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    title: String,
    zoneName: String,
    gameFamily: String,
    startedAt: Date,
    endedAt: Date,
}, { timestamps: true });
const fightSnapshotSchema = new Schema({
    raidSnapshotId: {
        type: Schema.Types.ObjectId,
        ref: "RaidSnapshot",
        index: true,
    },
    fightId: Number,
    name: String,
    kill: Boolean,
    startedAt: Date,
    endedAt: Date,
}, { timestamps: true });
const playerRaidSummarySchema = new Schema({
    guildId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    raidSnapshotId: {
        type: Schema.Types.ObjectId,
        ref: "RaidSnapshot",
        index: true,
    },
    playerProfileId: {
        type: Schema.Types.ObjectId,
        ref: "PlayerProfile",
        index: true,
    },
    characterName: String,
    bestParse: Number,
    averageParse: Number,
    executionScore: Number,
    capturedAt: Date,
}, { timestamps: true });
const trendSnapshotSchema = new Schema({
    guildId: { type: String, required: true, index: true },
    playerProfileId: {
        type: Schema.Types.ObjectId,
        ref: "PlayerProfile",
        index: true,
    },
    playerName: { type: String, index: true },
    metric: { type: String, required: true },
    window: { type: String, required: true },
    value: Number,
    capturedAt: Date,
}, { timestamps: true });
const accountabilityEventSchema = new Schema({
    guildId: { type: String, required: true, index: true },
    reportCode: String,
    eventType: String,
    payload: Schema.Types.Mixed,
    visibility: {
        type: String,
        enum: ["off", "officers-only", "shareable"],
        default: "off",
    },
}, { timestamps: true });
const coachingInsightSchema = new Schema({
    guildId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    shareability: {
        type: String,
        enum: ["private", "shareable"],
        default: "private",
    },
    insights: { type: Schema.Types.Mixed },
}, { timestamps: true });
const jobSchema = new Schema({
    type: { type: String, required: true, index: true },
    status: {
        type: String,
        enum: ["pending", "running", "completed", "failed"],
        default: "pending",
    },
    payload: Schema.Types.Mixed,
    runAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    lastError: String,
}, { timestamps: true });
const auditLogSchema = new Schema({
    actorType: { type: String, required: true },
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    metadata: Schema.Types.Mixed,
}, { timestamps: true });
export const GuildSettingsModel = mongoose.model("GuildSettings", guildSettingsSchema);
export const PlayerProfileModel = mongoose.model("PlayerProfile", playerProfileSchema);
export const CharacterIdentityModel = mongoose.model("CharacterIdentity", characterIdentitySchema);
export const ReportCacheModel = mongoose.model("ReportCache", reportCacheSchema);
export const RaidSnapshotModel = mongoose.model("RaidSnapshot", raidSnapshotSchema);
export const FightSnapshotModel = mongoose.model("FightSnapshot", fightSnapshotSchema);
export const PlayerRaidSummaryModel = mongoose.model("PlayerRaidSummary", playerRaidSummarySchema);
export const TrendSnapshotModel = mongoose.model("TrendSnapshot", trendSnapshotSchema);
export const AccountabilityEventModel = mongoose.model("AccountabilityEvent", accountabilityEventSchema);
export const CoachingInsightModel = mongoose.model("CoachingInsight", coachingInsightSchema);
export const JobModel = mongoose.model("Job", jobSchema);
export const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);
const parseGameFamily = (value) => value === "mop_classic" ? "mop_classic" : "retail";
const parseCompareMode = (value) => value === "mixed" ? "mixed" : "character";
const parseVisibility = (value) => value === "officers-only" || value === "shareable" ? value : "off";
const parseCoachingShareability = (value) => value === "shareable" ? "shareable" : "private";
const parseRecapPostMode = (value) => value === "preview-only" ? "preview-only" : "preview-and-post";
const toGuildConfig = (guildId, doc) => {
    const fallback = defaultGuildConfigFor(guildId);
    const raw = doc;
    if (!raw)
        return fallback;
    return {
        guildId,
        defaultGameFamily: parseGameFamily(raw.defaultGameFamily),
        compareModeDefault: parseCompareMode(raw.compareModeDefault),
        accountabilityVisibility: parseVisibility(raw.accountabilityVisibility),
        coachingShareabilityDefault: parseCoachingShareability(raw.coachingShareabilityDefault),
        recapPostModeDefault: parseRecapPostMode(raw.recapPostModeDefault),
    };
};
export class MongoGuildConfigStore {
    async getGuildConfig(guildId) {
        const existing = await GuildSettingsModel.findOne({ guildId }).lean();
        return toGuildConfig(guildId, existing);
    }
    async saveGuildConfig(guildId, update) {
        const saved = await GuildSettingsModel.findOneAndUpdate({ guildId }, {
            $set: {
                ...update,
            },
        }, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }).lean();
        return toGuildConfig(guildId, saved);
    }
}
export class MongoCoachingViewService {
    async buildShareableCoachingView(reportCode) {
        // TODO: Populate insight payload from player-level raid metrics once coaching rules are implemented.
        const doc = await CoachingInsightModel.findOne({ reportCode }).lean();
        return (doc ?? {
            reportCode,
            status: "stub",
            message: "Coaching insights are not implemented yet.",
        });
    }
}
export class MongoAccountabilityViewService {
    async buildAccountabilityView(reportCode, visibility) {
        // TODO: Generate officer/shareable accountability narratives from persisted events.
        const events = await AccountabilityEventModel.find({
            reportCode,
            visibility,
        })
            .sort({ createdAt: -1 })
            .lean();
        return {
            reportCode,
            visibility,
            status: "stub",
            events,
        };
    }
}
export class MongoTrendTrackingService {
    async ingestRaidHistory(guildId, report) {
        await RaidSnapshotModel.findOneAndUpdate({ guildId, reportCode: report.reportCode }, {
            $set: {
                guildId,
                reportCode: report.reportCode,
                title: report.title,
                zoneName: report.zoneName,
                gameFamily: report.gameFamily,
                startedAt: new Date(report.startTime),
                endedAt: new Date(report.endTime),
            },
        }, {
            upsert: true,
            setDefaultsOnInsert: true,
        });
        const captures = report.players.map((player) => {
            const setPayload = {
                guildId,
                reportCode: report.reportCode,
                characterName: player.name,
                capturedAt: new Date(report.endTime),
            };
            if (typeof player.bestParse === "number") {
                setPayload.bestParse = player.bestParse;
            }
            if (typeof player.avgParse === "number") {
                setPayload.averageParse = player.avgParse;
            }
            if (typeof player.executionScore === "number") {
                setPayload.executionScore = player.executionScore;
            }
            return {
                updateOne: {
                    filter: {
                        guildId,
                        reportCode: report.reportCode,
                        characterName: player.name,
                    },
                    update: {
                        $set: setPayload,
                    },
                    upsert: true,
                },
            };
        });
        if (captures.length > 0) {
            await PlayerRaidSummaryModel.bulkWrite(captures);
        }
    }
    async recomputeTrendsForGuild(guildId) {
        // TODO: Compute rolling windows and improvement deltas from PlayerRaidSummaryModel snapshots.
        await TrendSnapshotModel.updateOne({ guildId, metric: "placeholder", window: "rolling_4" }, {
            $set: {
                guildId,
                metric: "placeholder",
                window: "rolling_4",
                value: 0,
                capturedAt: new Date(),
            },
        }, { upsert: true });
    }
}
//# sourceMappingURL=index.js.map
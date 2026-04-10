import mongoose, { Schema } from "mongoose";
import type {
    AccountabilityViewService,
    AccountabilityVisibility,
    CoachingViewService,
    CompareMode,
    GameFamily,
    GuildConfig,
    GuildConfigStore,
    NormalizedReport,
    RecapPostMode,
    RecapSummary,
    CoachingShareability,
    TrendTrackingService,
} from "@wcl/domain";
import { defaultGuildConfigFor } from "@wcl/domain";

export const connectMongo = async (uri: string) => mongoose.connect(uri);

const guildSettingsSchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const playerProfileSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        discordUserId: { type: String, index: true },
        displayName: { type: String, required: true },
        characterIdentityIds: [
            { type: Schema.Types.ObjectId, ref: "CharacterIdentity" },
        ],
        confidenceScore: { type: Number, default: 0 },
    },
    { timestamps: true },
);

const characterIdentitySchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const reportCacheSchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const raidSnapshotSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        reportCode: { type: String, required: true, index: true },
        title: String,
        zoneName: String,
        gameFamily: String,
        startedAt: Date,
        endedAt: Date,
    },
    { timestamps: true },
);

const fightSnapshotSchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const playerRaidSummarySchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const trendSnapshotSchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const accountabilityEventSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        reportCode: String,
        eventType: String,
        payload: Schema.Types.Mixed,
        visibility: {
            type: String,
            enum: ["off", "officers-only", "shareable"],
            default: "off",
        },
    },
    { timestamps: true },
);

const coachingInsightSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        reportCode: { type: String, required: true, index: true },
        shareability: {
            type: String,
            enum: ["private", "shareable"],
            default: "private",
        },
        insights: { type: Schema.Types.Mixed },
    },
    { timestamps: true },
);

const jobSchema = new Schema(
    {
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
    },
    { timestamps: true },
);

const auditLogSchema = new Schema(
    {
        actorType: { type: String, required: true },
        actorId: { type: String, required: true },
        action: { type: String, required: true },
        targetType: String,
        targetId: String,
        metadata: Schema.Types.Mixed,
    },
    { timestamps: true },
);

const recapPreviewStateSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        channelId: { type: String, required: true, index: true },
        reportCode: { type: String, required: true, index: true },
        sourceUrl: { type: String, required: true },
        summaryPayload: { type: Schema.Types.Mixed, required: true },
        createdByUserId: { type: String, required: true, index: true },
        interactionId: { type: String, index: true },
        messageId: { type: String, index: true },
        createdAt: { type: Date, required: true, default: Date.now },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: false },
);
recapPreviewStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
recapPreviewStateSchema.index({ interactionId: 1, messageId: 1 });
recapPreviewStateSchema.index({ guildId: 1, reportCode: 1 }, { unique: true });

export const GuildSettingsModel = mongoose.model(
    "GuildSettings",
    guildSettingsSchema,
);
export const PlayerProfileModel = mongoose.model(
    "PlayerProfile",
    playerProfileSchema,
);
export const CharacterIdentityModel = mongoose.model(
    "CharacterIdentity",
    characterIdentitySchema,
);
export const ReportCacheModel = mongoose.model(
    "ReportCache",
    reportCacheSchema,
);
export const RaidSnapshotModel = mongoose.model(
    "RaidSnapshot",
    raidSnapshotSchema,
);

export const FightSnapshotModel = mongoose.model(
    "FightSnapshot",
    fightSnapshotSchema,
);
export const PlayerRaidSummaryModel = mongoose.model(
    "PlayerRaidSummary",
    playerRaidSummarySchema,
);
export const TrendSnapshotModel = mongoose.model(
    "TrendSnapshot",
    trendSnapshotSchema,
);
export const AccountabilityEventModel = mongoose.model(
    "AccountabilityEvent",
    accountabilityEventSchema,
);
export const CoachingInsightModel = mongoose.model(
    "CoachingInsight",
    coachingInsightSchema,
);
export const JobModel = mongoose.model("Job", jobSchema);
export const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);
export const RecapPreviewStateModel = mongoose.model(
    "RecapPreviewState",
    recapPreviewStateSchema,
);

export interface RecapPreviewStateRecord {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapSummary;
    createdByUserId: string;
    interactionId?: string;
    messageId?: string;
    createdAt: Date;
    expiresAt: Date;
}

export interface SaveRecapPreviewStateInput {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapSummary;
    createdByUserId: string;
    interactionId?: string;
    messageId?: string;
    createdAt: Date;
    expiresAt: Date;
}

export interface PreviewStateLookup {
    reportCode: string;
    guildId: string;
}

const parseGameFamily = (value: unknown): GameFamily =>
    value === "mop_classic" ? "mop_classic" : "retail";
const parseCompareMode = (value: unknown): CompareMode =>
    value === "mixed" ? "mixed" : "character";
const parseVisibility = (value: unknown): AccountabilityVisibility =>
    value === "officers-only" || value === "shareable" ? value : "off";
const parseCoachingShareability = (value: unknown): CoachingShareability =>
    value === "shareable" ? "shareable" : "private";
const parseRecapPostMode = (value: unknown): RecapPostMode =>
    value === "preview-only" ? "preview-only" : "preview-and-post";

const toGuildConfig = (guildId: string, doc: unknown): GuildConfig => {
    const fallback = defaultGuildConfigFor(guildId);
    const raw = doc as Record<string, unknown> | null;
    if (!raw) return fallback;

    return {
        guildId,
        defaultGameFamily: parseGameFamily(raw.defaultGameFamily),
        compareModeDefault: parseCompareMode(raw.compareModeDefault),
        accountabilityVisibility: parseVisibility(raw.accountabilityVisibility),
        coachingShareabilityDefault: parseCoachingShareability(
            raw.coachingShareabilityDefault,
        ),
        recapPostModeDefault: parseRecapPostMode(raw.recapPostModeDefault),
    };
};

export class MongoGuildConfigStore implements GuildConfigStore {
    public async getGuildConfig(guildId: string): Promise<GuildConfig> {
        const existing = await GuildSettingsModel.findOne({ guildId }).lean();
        return toGuildConfig(guildId, existing);
    }

    public async saveGuildConfig(
        guildId: string,
        update: Partial<Omit<GuildConfig, "guildId">>,
    ): Promise<GuildConfig> {
        const saved = await GuildSettingsModel.findOneAndUpdate(
            { guildId },
            {
                $set: {
                    ...update,
                },
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        return toGuildConfig(guildId, saved);
    }
}

const isRecapSummary = (value: unknown): value is RecapSummary => {
    if (!value || typeof value !== "object") return false;
    const raw = value as Record<string, unknown>;

    const isGameFamily =
        raw.gameFamily === "retail" || raw.gameFamily === "mop_classic";
    const isCompareMode =
        raw.compareModeUsed === "character" || raw.compareModeUsed === "mixed";
    const isVisibility =
        raw.accountabilityVisibility === "off" ||
        raw.accountabilityVisibility === "officers-only" ||
        raw.accountabilityVisibility === "shareable";
    const isCoachingShareability =
        raw.coachingShareability === "private" ||
        raw.coachingShareability === "shareable";
    const isRecapPostMode =
        raw.recapPostMode === "preview-and-post" ||
        raw.recapPostMode === "preview-only";

    return (
        typeof raw.reportTitle === "string" &&
        typeof raw.reportDateISO === "string" &&
        isGameFamily &&
        typeof raw.bossesKilled === "number" &&
        isCompareMode &&
        isVisibility &&
        isCoachingShareability &&
        isRecapPostMode &&
        Array.isArray(raw.topOverallParsers) &&
        Array.isArray(raw.bossHighlights) &&
        Array.isArray(raw.raidSuperlatives) &&
        typeof raw.teamNote === "string"
    );
};

const toRecapPreviewStateRecord = (
    doc: unknown,
): RecapPreviewStateRecord | null => {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    if (
        typeof raw.guildId !== "string" ||
        typeof raw.channelId !== "string" ||
        typeof raw.reportCode !== "string" ||
        typeof raw.sourceUrl !== "string" ||
        typeof raw.createdByUserId !== "string" ||
        !(raw.createdAt instanceof Date) ||
        !(raw.expiresAt instanceof Date)
    ) {
        return null;
    }

    if (!isRecapSummary(raw.summaryPayload)) {
        return null;
    }

    const record: RecapPreviewStateRecord = {
        guildId: raw.guildId,
        channelId: raw.channelId,
        reportCode: raw.reportCode,
        sourceUrl: raw.sourceUrl,
        summaryPayload: raw.summaryPayload,
        createdByUserId: raw.createdByUserId,
        createdAt: raw.createdAt,
        expiresAt: raw.expiresAt,
    };
    if (typeof raw.interactionId === "string") {
        record.interactionId = raw.interactionId;
    }
    if (typeof raw.messageId === "string") {
        record.messageId = raw.messageId;
    }
    return record;
};

export class MongoRecapPreviewStateStore {
    public async savePreviewState(
        input: SaveRecapPreviewStateInput,
    ): Promise<RecapPreviewStateRecord> {
        const saved = await RecapPreviewStateModel.findOneAndUpdate(
            { guildId: input.guildId, reportCode: input.reportCode },
            {
                $set: {
                    guildId: input.guildId,
                    channelId: input.channelId,
                    reportCode: input.reportCode,
                    sourceUrl: input.sourceUrl,
                    summaryPayload: input.summaryPayload,
                    createdByUserId: input.createdByUserId,
                    interactionId: input.interactionId,
                    messageId: input.messageId,
                    createdAt: input.createdAt,
                    expiresAt: input.expiresAt,
                },
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        const parsed = toRecapPreviewStateRecord(saved);
        if (!parsed) {
            throw new Error("Failed to persist recap preview state.");
        }
        return parsed;
    }

    public async getValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<RecapPreviewStateRecord | null> {
        const found = await RecapPreviewStateModel.findOne({
            reportCode: lookup.reportCode,
            guildId: lookup.guildId,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toRecapPreviewStateRecord(found);
    }

    public async deletePreviewState(lookup: PreviewStateLookup): Promise<void> {
        await RecapPreviewStateModel.deleteOne({
            reportCode: lookup.reportCode,
            guildId: lookup.guildId,
        });
    }
}

export class MongoCoachingViewService implements CoachingViewService {
    public async buildShareableCoachingView(
        reportCode: string,
    ): Promise<unknown> {
        // TODO: Populate insight payload from player-level raid metrics once coaching rules are implemented.
        const doc = await CoachingInsightModel.findOne({ reportCode }).lean();
        return (
            doc ?? {
                reportCode,
                status: "stub",
                message: "Coaching insights are not implemented yet.",
            }
        );
    }
}

export class MongoAccountabilityViewService
    implements AccountabilityViewService
{
    public async buildAccountabilityView(
        reportCode: string,
        visibility: AccountabilityVisibility,
    ): Promise<unknown> {
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

export class MongoTrendTrackingService implements TrendTrackingService {
    public async ingestRaidHistory(
        guildId: string,
        report: NormalizedReport,
    ): Promise<void> {
        await RaidSnapshotModel.findOneAndUpdate(
            { guildId, reportCode: report.reportCode },
            {
                $set: {
                    guildId,
                    reportCode: report.reportCode,
                    title: report.title,
                    zoneName: report.zoneName,
                    gameFamily: report.gameFamily,
                    startedAt: new Date(report.startTime),
                    endedAt: new Date(report.endTime),
                },
            },
            {
                upsert: true,
                setDefaultsOnInsert: true,
            },
        );

        const captures = report.players.map((player) => {
            const setPayload: Record<string, unknown> = {
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

    public async recomputeTrendsForGuild(guildId: string): Promise<void> {
        const capturedAt = new Date();
        console.info("trend recomputation started", { guildId });

        const summaries = await PlayerRaidSummaryModel.find({ guildId })
            .sort({
                capturedAt: 1,
                reportCode: 1,
                characterName: 1,
            })
            .lean();

        type PlayerSummary = {
            reportCode?: string;
            averageParse?: number;
            executionScore?: number;
            capturedAt?: Date;
        };

        type PlayerIdentity = {
            key: string;
            guildId: string;
            snapshots: PlayerSummary[];
            playerProfileId?: mongoose.Types.ObjectId;
            playerName?: string;
        };

        const players = new Map<string, PlayerIdentity>();
        for (const summary of summaries) {
            const rawProfileId = summary.playerProfileId;
            const profileId =
                rawProfileId instanceof mongoose.Types.ObjectId
                    ? rawProfileId
                    : undefined;

            const name =
                typeof summary.characterName === "string" &&
                summary.characterName.trim().length > 0
                    ? summary.characterName.trim()
                    : undefined;

            const key = profileId
                ? `profile:${String(profileId)}`
                : `name:${name ?? "unknown"}`;

            const existing = players.get(key);
            if (existing) {
                existing.snapshots.push(summary as PlayerSummary);
                continue;
            }

            const playerIdentity: PlayerIdentity = {
                key,
                guildId,
                snapshots: [summary as PlayerSummary],
                ...(profileId ? { playerProfileId: profileId } : {}),
                ...(!profileId && name ? { playerName: name } : {}),
            };

            players.set(key, playerIdentity);
        }

        const windows = [
            { size: 3, label: "last_3_raids" },
            { size: 5, label: "last_5_raids" },
        ] as const;

        const average = (values: number[]): number | undefined => {
            if (values.length === 0) return undefined;
            return (
                values.reduce((acc, value) => acc + value, 0) / values.length
            );
        };

        type TrendBulkWriteOperations = NonNullable<
            Parameters<typeof TrendSnapshotModel.bulkWrite>[0]
        >;
        const operations: TrendBulkWriteOperations = [];

        for (const player of players.values()) {
            for (const window of windows) {
                if (player.snapshots.length < window.size) {
                    continue;
                }

                const samples = player.snapshots.slice(-window.size);
                const parseValues = samples
                    .map((sample) => sample.averageParse)
                    .filter(
                        (value): value is number => typeof value === "number",
                    );
                const executionValues = samples
                    .map((sample) => sample.executionScore)
                    .filter(
                        (value): value is number => typeof value === "number",
                    );

                const parseAverage = average(parseValues);
                const executionAverage = average(executionValues);

                const identityFilter = player.playerProfileId
                    ? { playerProfileId: player.playerProfileId }
                    : player.playerName
                      ? { playerName: player.playerName }
                      : undefined;

                if (!identityFilter) {
                    continue;
                }

                const enqueueMetric = (metric: string, value: number) => {
                    const filter = {
                        guildId,
                        metric,
                        window: window.label,
                        ...identityFilter,
                    };

                    operations.push({
                        updateOne: {
                            filter,
                            update: {
                                $set: {
                                    ...filter,
                                    value,
                                    capturedAt,
                                },
                            },
                            upsert: true,
                        },
                    });
                };

                if (typeof parseAverage === "number") {
                    enqueueMetric("parse_average", parseAverage);
                }
                if (typeof executionAverage === "number") {
                    enqueueMetric("execution_average", executionAverage);
                }
                enqueueMetric("attendance_count", samples.length);
            }
        }

        if (operations.length === 0) {
            console.info(
                "trend recomputation skipped; no trend windows derived",
                {
                    guildId,
                    players: players.size,
                },
            );
            return;
        }

        try {
            await TrendSnapshotModel.bulkWrite(operations);
            console.info("trend recomputation completed", {
                guildId,
                players: players.size,
                snapshotsUpserted: operations.length,
            });
        } catch (error) {
            console.error("trend recomputation failed", {
                guildId,
                error,
            });
            throw error;
        }
    }
}

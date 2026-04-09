import mongoose from "mongoose";
import type { AccountabilityViewService, AccountabilityVisibility, CoachingViewService, GuildConfig, GuildConfigStore, NormalizedReport, TrendTrackingService } from "@wcl/domain";
export declare const connectMongo: (uri: string) => Promise<typeof mongoose>;
export declare const GuildSettingsModel: mongoose.Model<{
    guildId: string;
    defaultGameFamily: "retail" | "mop_classic";
    compareModeDefault: "character" | "mixed";
    accountabilityVisibility: "off" | "officers-only" | "shareable";
    coachingShareabilityDefault: "shareable" | "private";
    recapPostModeDefault: "preview-and-post" | "preview-only";
    officersRoleIds: string[];
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    defaultGameFamily: "retail" | "mop_classic";
    compareModeDefault: "character" | "mixed";
    accountabilityVisibility: "off" | "officers-only" | "shareable";
    coachingShareabilityDefault: "shareable" | "private";
    recapPostModeDefault: "preview-and-post" | "preview-only";
    officersRoleIds: string[];
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    defaultGameFamily: "retail" | "mop_classic";
    compareModeDefault: "character" | "mixed";
    accountabilityVisibility: "off" | "officers-only" | "shareable";
    coachingShareabilityDefault: "shareable" | "private";
    recapPostModeDefault: "preview-and-post" | "preview-only";
    officersRoleIds: string[];
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    defaultGameFamily: "retail" | "mop_classic";
    compareModeDefault: "character" | "mixed";
    accountabilityVisibility: "off" | "officers-only" | "shareable";
    coachingShareabilityDefault: "shareable" | "private";
    recapPostModeDefault: "preview-and-post" | "preview-only";
    officersRoleIds: string[];
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    defaultGameFamily: "retail" | "mop_classic";
    compareModeDefault: "character" | "mixed";
    accountabilityVisibility: "off" | "officers-only" | "shareable";
    coachingShareabilityDefault: "shareable" | "private";
    recapPostModeDefault: "preview-and-post" | "preview-only";
    officersRoleIds: string[];
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    defaultGameFamily: "retail" | "mop_classic";
    compareModeDefault: "character" | "mixed";
    accountabilityVisibility: "off" | "officers-only" | "shareable";
    coachingShareabilityDefault: "shareable" | "private";
    recapPostModeDefault: "preview-and-post" | "preview-only";
    officersRoleIds: string[];
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const PlayerProfileModel: mongoose.Model<{
    guildId: string;
    displayName: string;
    characterIdentityIds: mongoose.Types.ObjectId[];
    confidenceScore: number;
    discordUserId?: string | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    displayName: string;
    characterIdentityIds: mongoose.Types.ObjectId[];
    confidenceScore: number;
    discordUserId?: string | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    displayName: string;
    characterIdentityIds: mongoose.Types.ObjectId[];
    confidenceScore: number;
    discordUserId?: string | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    displayName: string;
    characterIdentityIds: mongoose.Types.ObjectId[];
    confidenceScore: number;
    discordUserId?: string | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    displayName: string;
    characterIdentityIds: mongoose.Types.ObjectId[];
    confidenceScore: number;
    discordUserId?: string | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    displayName: string;
    characterIdentityIds: mongoose.Types.ObjectId[];
    confidenceScore: number;
    discordUserId?: string | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const CharacterIdentityModel: mongoose.Model<{
    characterName: string;
    gameFamily: "retail" | "mop_classic";
    specHistory: mongoose.Types.DocumentArray<{
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }> & {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }>;
    autoLinked: boolean;
    candidateLinks: mongoose.Types.DocumentArray<{
        discordUserId?: string | null;
        confidence?: number | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        discordUserId?: string | null;
        confidence?: number | null;
    }> & {
        discordUserId?: string | null;
        confidence?: number | null;
    }>;
    profileId?: mongoose.Types.ObjectId | null;
    realm?: string | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    characterName: string;
    gameFamily: "retail" | "mop_classic";
    specHistory: mongoose.Types.DocumentArray<{
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }> & {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }>;
    autoLinked: boolean;
    candidateLinks: mongoose.Types.DocumentArray<{
        discordUserId?: string | null;
        confidence?: number | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        discordUserId?: string | null;
        confidence?: number | null;
    }> & {
        discordUserId?: string | null;
        confidence?: number | null;
    }>;
    profileId?: mongoose.Types.ObjectId | null;
    realm?: string | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    characterName: string;
    gameFamily: "retail" | "mop_classic";
    specHistory: mongoose.Types.DocumentArray<{
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }> & {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }>;
    autoLinked: boolean;
    candidateLinks: mongoose.Types.DocumentArray<{
        discordUserId?: string | null;
        confidence?: number | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        discordUserId?: string | null;
        confidence?: number | null;
    }> & {
        discordUserId?: string | null;
        confidence?: number | null;
    }>;
    profileId?: mongoose.Types.ObjectId | null;
    realm?: string | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    characterName: string;
    gameFamily: "retail" | "mop_classic";
    specHistory: mongoose.Types.DocumentArray<{
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }> & {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }>;
    autoLinked: boolean;
    candidateLinks: mongoose.Types.DocumentArray<{
        discordUserId?: string | null;
        confidence?: number | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        discordUserId?: string | null;
        confidence?: number | null;
    }> & {
        discordUserId?: string | null;
        confidence?: number | null;
    }>;
    profileId?: mongoose.Types.ObjectId | null;
    realm?: string | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    characterName: string;
    gameFamily: "retail" | "mop_classic";
    specHistory: mongoose.Types.DocumentArray<{
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }> & {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }>;
    autoLinked: boolean;
    candidateLinks: mongoose.Types.DocumentArray<{
        discordUserId?: string | null;
        confidence?: number | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        discordUserId?: string | null;
        confidence?: number | null;
    }> & {
        discordUserId?: string | null;
        confidence?: number | null;
    }>;
    profileId?: mongoose.Types.ObjectId | null;
    realm?: string | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    characterName: string;
    gameFamily: "retail" | "mop_classic";
    specHistory: mongoose.Types.DocumentArray<{
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }> & {
        specName?: string | null;
        firstSeenAt?: NativeDate | null;
        lastSeenAt?: NativeDate | null;
    }>;
    autoLinked: boolean;
    candidateLinks: mongoose.Types.DocumentArray<{
        discordUserId?: string | null;
        confidence?: number | null;
    }, mongoose.Types.Subdocument<mongoose.mongo.BSON.ObjectId, any, {
        discordUserId?: string | null;
        confidence?: number | null;
    }> & {
        discordUserId?: string | null;
        confidence?: number | null;
    }>;
    profileId?: mongoose.Types.ObjectId | null;
    realm?: string | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const ReportCacheModel: mongoose.Model<{
    gameFamily: "retail" | "mop_classic";
    reportCode: string;
    sourceUrl: string;
    rawPayload: any;
    normalizedPayload: any;
    fetchedAt: NativeDate;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    gameFamily: "retail" | "mop_classic";
    reportCode: string;
    sourceUrl: string;
    rawPayload: any;
    normalizedPayload: any;
    fetchedAt: NativeDate;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    gameFamily: "retail" | "mop_classic";
    reportCode: string;
    sourceUrl: string;
    rawPayload: any;
    normalizedPayload: any;
    fetchedAt: NativeDate;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    gameFamily: "retail" | "mop_classic";
    reportCode: string;
    sourceUrl: string;
    rawPayload: any;
    normalizedPayload: any;
    fetchedAt: NativeDate;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    gameFamily: "retail" | "mop_classic";
    reportCode: string;
    sourceUrl: string;
    rawPayload: any;
    normalizedPayload: any;
    fetchedAt: NativeDate;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    gameFamily: "retail" | "mop_classic";
    reportCode: string;
    sourceUrl: string;
    rawPayload: any;
    normalizedPayload: any;
    fetchedAt: NativeDate;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const RaidSnapshotModel: mongoose.Model<{
    guildId: string;
    reportCode: string;
    gameFamily?: string | null;
    title?: string | null;
    zoneName?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    reportCode: string;
    gameFamily?: string | null;
    title?: string | null;
    zoneName?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    reportCode: string;
    gameFamily?: string | null;
    title?: string | null;
    zoneName?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    reportCode: string;
    gameFamily?: string | null;
    title?: string | null;
    zoneName?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    reportCode: string;
    gameFamily?: string | null;
    title?: string | null;
    zoneName?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    reportCode: string;
    gameFamily?: string | null;
    title?: string | null;
    zoneName?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const FightSnapshotModel: mongoose.Model<{
    name?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
    fightId?: number | null;
    kill?: boolean | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    name?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
    fightId?: number | null;
    kill?: boolean | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    name?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
    fightId?: number | null;
    kill?: boolean | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    name?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
    fightId?: number | null;
    kill?: boolean | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    name?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
    fightId?: number | null;
    kill?: boolean | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    name?: string | null;
    startedAt?: NativeDate | null;
    endedAt?: NativeDate | null;
    fightId?: number | null;
    kill?: boolean | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const PlayerRaidSummaryModel: mongoose.Model<{
    guildId: string;
    reportCode: string;
    characterName?: string | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
    bestParse?: number | null;
    averageParse?: number | null;
    executionScore?: number | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    reportCode: string;
    characterName?: string | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
    bestParse?: number | null;
    averageParse?: number | null;
    executionScore?: number | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    reportCode: string;
    characterName?: string | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
    bestParse?: number | null;
    averageParse?: number | null;
    executionScore?: number | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    reportCode: string;
    characterName?: string | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
    bestParse?: number | null;
    averageParse?: number | null;
    executionScore?: number | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    reportCode: string;
    characterName?: string | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
    bestParse?: number | null;
    averageParse?: number | null;
    executionScore?: number | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    reportCode: string;
    characterName?: string | null;
    raidSnapshotId?: mongoose.Types.ObjectId | null;
    bestParse?: number | null;
    averageParse?: number | null;
    executionScore?: number | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const TrendSnapshotModel: mongoose.Model<{
    guildId: string;
    metric: string;
    window: string;
    playerName?: string | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
    value?: number | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    metric: string;
    window: string;
    playerName?: string | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
    value?: number | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    metric: string;
    window: string;
    playerName?: string | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
    value?: number | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    metric: string;
    window: string;
    playerName?: string | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
    value?: number | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    metric: string;
    window: string;
    playerName?: string | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
    value?: number | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    metric: string;
    window: string;
    playerName?: string | null;
    capturedAt?: NativeDate | null;
    playerProfileId?: mongoose.Types.ObjectId | null;
    value?: number | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const AccountabilityEventModel: mongoose.Model<{
    guildId: string;
    visibility: "off" | "officers-only" | "shareable";
    reportCode?: string | null;
    eventType?: string | null;
    payload?: any;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    visibility: "off" | "officers-only" | "shareable";
    reportCode?: string | null;
    eventType?: string | null;
    payload?: any;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    visibility: "off" | "officers-only" | "shareable";
    reportCode?: string | null;
    eventType?: string | null;
    payload?: any;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    visibility: "off" | "officers-only" | "shareable";
    reportCode?: string | null;
    eventType?: string | null;
    payload?: any;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    visibility: "off" | "officers-only" | "shareable";
    reportCode?: string | null;
    eventType?: string | null;
    payload?: any;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    visibility: "off" | "officers-only" | "shareable";
    reportCode?: string | null;
    eventType?: string | null;
    payload?: any;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const CoachingInsightModel: mongoose.Model<{
    guildId: string;
    reportCode: string;
    shareability: "shareable" | "private";
    insights?: any;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    guildId: string;
    reportCode: string;
    shareability: "shareable" | "private";
    insights?: any;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    guildId: string;
    reportCode: string;
    shareability: "shareable" | "private";
    insights?: any;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    guildId: string;
    reportCode: string;
    shareability: "shareable" | "private";
    insights?: any;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    guildId: string;
    reportCode: string;
    shareability: "shareable" | "private";
    insights?: any;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    guildId: string;
    reportCode: string;
    shareability: "shareable" | "private";
    insights?: any;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const JobModel: mongoose.Model<{
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    runAt: NativeDate;
    attempts: number;
    payload?: any;
    lastError?: string | null;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    runAt: NativeDate;
    attempts: number;
    payload?: any;
    lastError?: string | null;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    runAt: NativeDate;
    attempts: number;
    payload?: any;
    lastError?: string | null;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    runAt: NativeDate;
    attempts: number;
    payload?: any;
    lastError?: string | null;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    runAt: NativeDate;
    attempts: number;
    payload?: any;
    lastError?: string | null;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    type: string;
    status: "pending" | "running" | "completed" | "failed";
    runAt: NativeDate;
    attempts: number;
    payload?: any;
    lastError?: string | null;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare const AuditLogModel: mongoose.Model<{
    actorType: string;
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    actorType: string;
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    actorType: string;
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    actorType: string;
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    actorType: string;
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    actorType: string;
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: any;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export declare class MongoGuildConfigStore implements GuildConfigStore {
    getGuildConfig(guildId: string): Promise<GuildConfig>;
    saveGuildConfig(guildId: string, update: Partial<Omit<GuildConfig, "guildId">>): Promise<GuildConfig>;
}
export declare class MongoCoachingViewService implements CoachingViewService {
    buildShareableCoachingView(reportCode: string): Promise<unknown>;
}
export declare class MongoAccountabilityViewService implements AccountabilityViewService {
    buildAccountabilityView(reportCode: string, visibility: AccountabilityVisibility): Promise<unknown>;
}
export declare class MongoTrendTrackingService implements TrendTrackingService {
    ingestRaidHistory(guildId: string, report: NormalizedReport): Promise<void>;
    recomputeTrendsForGuild(guildId: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map
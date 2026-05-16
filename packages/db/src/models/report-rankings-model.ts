import type { GameFamily } from '@wcl/domain';
import mongoose, { Schema, type Model } from 'mongoose';

export type ReportRankingTimeframe = 'today' | 'historical';
export type ReportRankingCompareMode = 'rankings' | 'parses';

export interface ReportRankingsRawDocument {
  reportCode: string;
  fetchedAt: Date;
  queryVarsHash: string;
  payloadJson: unknown;
  timeframe?: ReportRankingTimeframe;
  compareMode?: ReportRankingCompareMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportRankingsFactDocument {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
  reportCode: string;
  reportStartTime: number;
  fightId: number;
  encounterId: number;
  difficulty: number;
  size: number;
  partition?: number;
  timeframe: ReportRankingTimeframe;
  compareMode: ReportRankingCompareMode;
  speedPercentile?: number;
  executionPercentile?: number;
  rank?: number;
  outOf?: number;
  durationMs?: number;
  startTime?: number;
  kill: boolean;
  isWipeRanked?: boolean;
  sourceFetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuildEncounterTrendWeeklyDocument {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
  encounterId: number;
  difficulty: number;
  size: number;
  partition?: number;
  weekStart: Date;
  timeframe: ReportRankingTimeframe;
  compareMode: ReportRankingCompareMode;
  sampleCount: number;
  speedMedian?: number;
  speedP90?: number;
  speedMedianDelta?: number;
  executionMedian?: number;
  executionP90?: number;
  executionMedianDelta?: number;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const gameFamilyField = {
  type: String,
  enum: ['retail', 'mop_classic'],
  required: true,
  index: true,
} as const;

const timeframeField = {
  type: String,
  enum: ['today', 'historical'],
  required: true,
  index: true,
} as const;

const compareModeField = {
  type: String,
  enum: ['rankings', 'parses'],
  required: true,
  index: true,
} as const;

const guildScopeFields = {
  guildName: { type: String, required: true, index: true },
  guildServerSlug: { type: String, required: true, index: true },
  guildServerRegion: { type: String, required: true, index: true },
  gameFamily: gameFamilyField,
} as const;

const reportRankingsRawSchema = new Schema<ReportRankingsRawDocument>(
  {
    reportCode: { type: String, required: true, index: true },
    fetchedAt: { type: Date, required: true, index: true },
    queryVarsHash: { type: String, required: true, index: true },
    payloadJson: { type: Schema.Types.Mixed, required: true },
    timeframe: { type: String, enum: ['today', 'historical'] },
    compareMode: { type: String, enum: ['rankings', 'parses'] },
  },
  { timestamps: true, collection: 'report_rankings_raw' },
);

reportRankingsRawSchema.index({ reportCode: 1, fetchedAt: -1 });
reportRankingsRawSchema.index({ reportCode: 1, queryVarsHash: 1, fetchedAt: -1 });

const reportRankingsFactSchema = new Schema<ReportRankingsFactDocument>(
  {
    ...guildScopeFields,
    reportCode: { type: String, required: true, index: true },
    reportStartTime: { type: Number, required: true, index: true },
    fightId: { type: Number, required: true, index: true },
    encounterId: { type: Number, required: true, index: true },
    difficulty: { type: Number, required: true, index: true },
    size: { type: Number, required: true, index: true },
    partition: { type: Number, index: true },
    timeframe: timeframeField,
    compareMode: compareModeField,
    speedPercentile: { type: Number },
    executionPercentile: { type: Number },
    rank: { type: Number },
    outOf: { type: Number },
    durationMs: { type: Number },
    startTime: { type: Number },
    kill: { type: Boolean, required: true },
    isWipeRanked: { type: Boolean },
    sourceFetchedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'report_rankings_fact' },
);

reportRankingsFactSchema.index(
  { reportCode: 1, fightId: 1, partition: 1, timeframe: 1, compareMode: 1 },
  { unique: true },
);
reportRankingsFactSchema.index({
  guildName: 1,
  guildServerSlug: 1,
  guildServerRegion: 1,
  gameFamily: 1,
  encounterId: 1,
  partition: 1,
  reportStartTime: 1,
  timeframe: 1,
  compareMode: 1,
});

const guildEncounterTrendWeeklySchema = new Schema<GuildEncounterTrendWeeklyDocument>(
  {
    ...guildScopeFields,
    encounterId: { type: Number, required: true, index: true },
    difficulty: { type: Number, required: true, index: true },
    size: { type: Number, required: true, index: true },
    partition: { type: Number, index: true },
    weekStart: { type: Date, required: true, index: true },
    timeframe: timeframeField,
    compareMode: compareModeField,
    sampleCount: { type: Number, required: true },
    speedMedian: { type: Number },
    speedP90: { type: Number },
    speedMedianDelta: { type: Number },
    executionMedian: { type: Number },
    executionP90: { type: Number },
    executionMedianDelta: { type: Number },
    computedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'guild_encounter_trend_weekly' },
);

guildEncounterTrendWeeklySchema.index(
  {
    guildName: 1,
    guildServerSlug: 1,
    guildServerRegion: 1,
    gameFamily: 1,
    encounterId: 1,
    difficulty: 1,
    size: 1,
    partition: 1,
    weekStart: 1,
    timeframe: 1,
    compareMode: 1,
  },
  { unique: true },
);

export const ReportRankingsRawModel: Model<ReportRankingsRawDocument> =
  (mongoose.models.ReportRankingsRaw as Model<ReportRankingsRawDocument> | undefined) ??
  mongoose.model<ReportRankingsRawDocument>('ReportRankingsRaw', reportRankingsRawSchema);

export const ReportRankingsFactModel: Model<ReportRankingsFactDocument> =
  (mongoose.models.ReportRankingsFact as Model<ReportRankingsFactDocument> | undefined) ??
  mongoose.model<ReportRankingsFactDocument>('ReportRankingsFact', reportRankingsFactSchema);

export const GuildEncounterTrendWeeklyModel: Model<GuildEncounterTrendWeeklyDocument> =
  (mongoose.models.GuildEncounterTrendWeekly as
    | Model<GuildEncounterTrendWeeklyDocument>
    | undefined) ??
  mongoose.model<GuildEncounterTrendWeeklyDocument>(
    'GuildEncounterTrendWeekly',
    guildEncounterTrendWeeklySchema,
  );

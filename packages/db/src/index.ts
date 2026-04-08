import mongoose, { Schema } from 'mongoose';

export const connectMongo = async (uri: string) => mongoose.connect(uri);

const guildSettingsSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  accountabilityVisibility: {
    type: String,
    enum: ['off', 'officers-only', 'shareable'],
    default: 'off',
  },
  officersRoleIds: [{ type: String }],
}, { timestamps: true });

const playerProfileSchema = new Schema({
  guildId: { type: String, required: true, index: true },
  discordUserId: { type: String, index: true },
  displayName: { type: String, required: true },
  characterIdentityIds: [{ type: Schema.Types.ObjectId, ref: 'CharacterIdentity' }],
  confidenceScore: { type: Number, default: 0 },
}, { timestamps: true });

const characterIdentitySchema = new Schema({
  profileId: { type: Schema.Types.ObjectId, ref: 'PlayerProfile', index: true },
  characterName: { type: String, required: true },
  realm: { type: String },
  gameFamily: { type: String, enum: ['retail', 'mop_classic'], required: true },
  specHistory: [{ specName: String, firstSeenAt: Date, lastSeenAt: Date }],
  autoLinked: { type: Boolean, default: false },
  candidateLinks: [{ discordUserId: String, confidence: Number }],
}, { timestamps: true });

const reportCacheSchema = new Schema({
  reportCode: { type: String, unique: true, required: true },
  sourceUrl: { type: String, required: true },
  gameFamily: { type: String, enum: ['retail', 'mop_classic'], required: true },
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
  raidSnapshotId: { type: Schema.Types.ObjectId, ref: 'RaidSnapshot', index: true },
  fightId: Number,
  name: String,
  kill: Boolean,
  startedAt: Date,
  endedAt: Date,
}, { timestamps: true });

const playerRaidSummarySchema = new Schema({
  raidSnapshotId: { type: Schema.Types.ObjectId, ref: 'RaidSnapshot', index: true },
  playerProfileId: { type: Schema.Types.ObjectId, ref: 'PlayerProfile', index: true },
  characterName: String,
  bestParse: Number,
  averageParse: Number,
  executionScore: Number,
}, { timestamps: true });

const trendSnapshotSchema = new Schema({
  guildId: { type: String, required: true, index: true },
  playerProfileId: { type: Schema.Types.ObjectId, ref: 'PlayerProfile', index: true },
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
  visibility: { type: String, enum: ['off', 'officers-only', 'shareable'], default: 'off' },
}, { timestamps: true });

const jobSchema = new Schema({
  type: { type: String, required: true, index: true },
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
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

export const GuildSettingsModel = mongoose.model('GuildSettings', guildSettingsSchema);
export const PlayerProfileModel = mongoose.model('PlayerProfile', playerProfileSchema);
export const CharacterIdentityModel = mongoose.model('CharacterIdentity', characterIdentitySchema);
export const ReportCacheModel = mongoose.model('ReportCache', reportCacheSchema);
export const RaidSnapshotModel = mongoose.model('RaidSnapshot', raidSnapshotSchema);
export const FightSnapshotModel = mongoose.model('FightSnapshot', fightSnapshotSchema);
export const PlayerRaidSummaryModel = mongoose.model('PlayerRaidSummary', playerRaidSummarySchema);
export const TrendSnapshotModel = mongoose.model('TrendSnapshot', trendSnapshotSchema);
export const AccountabilityEventModel = mongoose.model('AccountabilityEvent', accountabilityEventSchema);
export const JobModel = mongoose.model('Job', jobSchema);
export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);

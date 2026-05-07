import { DEFAULT_COMPARE_MODE, type CompareMode } from './comparison/compare-mode.js';
import { DEFAULT_COMPARE_ACCESS_MODE, type CompareAccessMode } from './comparison/privacy.js';
export type {
  ActivityActor,
  BotActivityEvent,
  BotActivityKind,
  BotActivityStore,
} from './dashboard-activity.js';

export const GAME_FAMILIES = ['retail', 'mop_classic'] as const;
export type GameFamily = (typeof GAME_FAMILIES)[number];

export const parseGameFamily = (value: unknown): GameFamily | undefined =>
  GAME_FAMILIES.includes(value as GameFamily) ? (value as GameFamily) : undefined;

export type RecapPostMode = 'preview-and-post' | 'preview-only';

export const AUTO_RECAP_MODES = ['off', 'prompt', 'auto_preview', 'auto_post'] as const;
export type AutoRecapMode = (typeof AUTO_RECAP_MODES)[number];

export const parseAutoRecapMode = (value: unknown): AutoRecapMode | undefined =>
  AUTO_RECAP_MODES.includes(value as AutoRecapMode) ? (value as AutoRecapMode) : undefined;

export interface GuildConfig {
  guildId: string;
  defaultGameFamily: GameFamily;
  compareModeDefault: CompareMode;
  compareAccessMode: CompareAccessMode;
  compareOfficerUserIds: string[];
  dashboardOfficerAccessEnabled: boolean;
  comparePublicPostingEnabled: boolean;
  recapPostModeDefault: RecapPostMode;
  autoRecapMode: AutoRecapMode;
  autoRecapChannelIds: string[];
}

export interface GuildConfigStore {
  getGuildConfig(guildId: string): Promise<GuildConfig>;
  saveGuildConfig(
    guildId: string,
    update: Partial<Omit<GuildConfig, 'guildId'>>,
  ): Promise<GuildConfig>;
  addCompareOfficerUser?(guildId: string, discordUserId: string): Promise<GuildConfig>;
  removeCompareOfficerUser?(guildId: string, discordUserId: string): Promise<GuildConfig>;
}

export const defaultGuildConfigFor = (guildId: string): GuildConfig => ({
  guildId,
  defaultGameFamily: 'retail',
  compareModeDefault: DEFAULT_COMPARE_MODE,
  compareAccessMode: DEFAULT_COMPARE_ACCESS_MODE,
  compareOfficerUserIds: [],
  dashboardOfficerAccessEnabled: false,
  comparePublicPostingEnabled: false,
  recapPostModeDefault: 'preview-and-post',
  autoRecapMode: 'prompt',
  autoRecapChannelIds: [],
});

export interface NormalizedPlayer {
  id: string;
  actorId?: number;
  warcraftLogsActorId?: number;
  warcraftLogsGuid?: number;
  name: string;
  nameKey?: string;
  realm?: string;
  server?: string;
  region?: string;
  className?: string;
  specName?: string;
  role?: string;
  bestParse?: number;
  avgParse?: number;
  executionScore?: number;
}

export interface NormalizedFight {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  kill: boolean;
}

export interface NormalizedEncounterFight extends NormalizedFight {
  encounterId?: number;
  difficulty?: number;
  difficultyName?: string;
  inProgress?: boolean;
}

export interface NormalizedLeaderboardEntry {
  scope: 'report' | 'boss';
  bossName?: string;
  fightId?: number;
  playerId?: number;
  playerName?: string;
  className?: string;
  specName?: string;
  role?: string;
  metric: string;
  selectedMetric?: string;
  value: number;
  rank?: number;
  amount?: number;
  best?: number;
  rankPercent?: number;
  bracketPercent?: number;
}

export interface NormalizedBossPerformance {
  bossName: string;
  fightId: number;
  encounterId?: number;
  difficulty?: number;
  difficultyName?: string;
  kill?: boolean;
  pullCount?: number;
  fightDate?: number;
  fightDurationMs?: number;
  guildName?: string;
  realmName?: string;
  zoneName?: string;
  reportUrl?: string;
  fastestPhaseTimes?: Array<{
    phaseId: number;
    label: string;
    name?: string;
    durationMs: number;
  }>;
  bestParses?: Array<{
    playerName: string;
    parse: number;
    amount?: number;
    metric?: string;
    className?: string;
    specName?: string;
  }>;
  topDamageTaken?: Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
  }>;
  topHealers?: Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
  }>;
  deaths?: number;
  raidDamageTaken?: number;
  dispels?: number;
  battleRezzes?: number;
  kicks?: number;
  topParse?: NormalizedLeaderboardEntry;
  topDamage?: { playerName: string; value: number };
  topHealing?: { playerName: string; value: number };
  mostDeaths?: { playerName: string; value: number };
  topInterrupts?: { playerName: string; value: number };
  topSurvivability?: { playerName: string; value: number };
}

export interface NormalizedReport {
  reportCode: string;
  title: string;
  startTime: number;
  endTime: number;
  gameFamily: GameFamily;
  zoneName?: string;
  fights: NormalizedFight[];
  encounterFights?: NormalizedEncounterFight[];
  players: NormalizedPlayer[];
  leaderboards?: NormalizedLeaderboardEntry[];
  bossPerformances?: NormalizedBossPerformance[];
  reportWideRecap?: {
    topDamageDone: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topHealingDone: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topDamageTaken?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topDeaths?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topInterrupts?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topDispels?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topSurvivability?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    totals: {
      deaths?: number;
      raidDamageTaken?: number;
      dispels?: number;
      interrupts?: number;
    };
  };
  reportWideEncounterRecap?: {
    topDamageDone: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topHealingDone: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topDamageTaken?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topDeaths?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topInterrupts?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    topDispels?: Array<{
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    }>;
    totals: {
      deaths?: number;
      raidDamageTaken?: number;
      dispels?: number;
      interrupts?: number;
    };
  };
  reportWideRankings?: {
    dps: NormalizedLeaderboardEntry[];
    hps: NormalizedLeaderboardEntry[];
  };
}

export interface PreviousRaidLookup {
  findPreviousRaidSummaries(guildId: string, beforeDate: Date): Promise<NormalizedPlayer[]>;
}

export { buildComparisonBaseline } from './comparison/baseline.js';
export type {
  AvailableBaselineMetricComparison,
  BaselineMetricComparison,
  BaselineMetricDirection,
  BaselineMetricLabel,
  BaselineMetricName,
  BaselineMetrics,
  BaselineStatus,
  ComparisonBaseline,
  ComparisonBaselineRow,
  UnavailableBaselineMetricComparison,
  UnavailableBaselineReason,
} from './comparison/baseline.js';
export { extractComparisonSnapshots } from './comparison/snapshot.js';
export type {
  ComparisonSnapshotExtractionIssue,
  ComparisonSnapshotExtractionResult,
  ComparisonSnapshotInput,
  ExtractComparisonSnapshotsInput,
} from './comparison/snapshot.js';
export {
  COMPARE_MODES,
  DEFAULT_COMPARE_MODE,
  isCompareMode,
  parseCompareMode,
} from './comparison/compare-mode.js';
export type { CompareMode, CompareModeSource } from './comparison/compare-mode.js';
export {
  countNearDelta,
  historyLimit,
  outputNearPercent,
  parseNearPercentilePoints,
  trustedSampleSize,
} from './comparison/constants.js';
export {
  authorizeCompareRequest,
  CHARACTER_CLAIM_STATUSES,
  COMPARE_ACCESS_MODES,
  COMPARE_VISIBILITIES,
  DEFAULT_COMPARE_ACCESS_MODE,
  DEFAULT_COMPARE_VISIBILITY,
  getCompareAuthorizationDenialMessage,
  hasDiscordPermission,
  isCharacterClaimStatus,
  isCompareAccessMode,
  isCompareOfficer,
  isCompareVisibility,
  parseCompareAccessMode,
  parseCompareVisibility,
} from './comparison/privacy.js';
export type {
  CharacterClaimStatus,
  CompareAccessMode,
  CompareApprovedCharacterClaim,
  CompareAuthorizationDecision,
  CompareAuthorizationGuildSettings,
  CompareAuthorizationInput,
  CompareAuthorizationReason,
  CompareRequesterContext,
  CompareVisibility,
} from './comparison/privacy.js';
export {
  buildParticipantKey,
  normalizeIdentityPart,
  resolveCharacterComparisonIdentity,
  resolveComparisonIdentity,
  resolveMixedComparisonIdentity,
} from './comparison/identity.js';
export type {
  ComparisonIdentity,
  ComparisonIdentityInput,
  ComparisonIdentityKind,
  ComparisonIdentityStatus,
  MissingPlayerMappingComparisonIdentity,
  NotComparableComparisonIdentity,
  ReadyCharacterComparisonIdentity,
  ReadyPlayerComparisonIdentity,
} from './comparison/identity.js';
export { buildReportSummary } from './report/build-report-summary.js';
export type {
  ReportEncounterSummary,
  ReportMetricRow,
  ReportParseRow,
  ReportSummary,
} from './report/types.js';
export {
  getBossEncounterId,
  hasDungeonPullData,
  parseFightSummaries,
  pickEncounterSummaryFight,
  sumTableValues,
  summarizeBossTables,
  type FightSummaryRow,
} from './report-mappers.js';

export interface TrendTrackingService {
  ingestRaidHistory(guildId: string, report: NormalizedReport): Promise<void>;
  recomputeTrendsForGuild(guildId: string): Promise<void>;
}

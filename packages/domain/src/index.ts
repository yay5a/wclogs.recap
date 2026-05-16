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

export const AUTO_REPORT_MODES = ['off', 'prompt', 'auto_preview', 'auto_post'] as const;
export type AutoReportMode = (typeof AUTO_REPORT_MODES)[number];

export const parseAutoReportMode = (value: unknown): AutoReportMode | undefined =>
  AUTO_REPORT_MODES.includes(value as AutoReportMode) ? (value as AutoReportMode) : undefined;

export interface GuildConfig {
  guildId: string;
  defaultGameFamily: GameFamily;
  compareModeDefault: CompareMode;
  compareAccessMode: CompareAccessMode;
  compareOfficerUserIds: string[];
  dashboardOfficerAccessEnabled: boolean;
  comparePublicPostingEnabled: boolean;
  autoReportMode: AutoReportMode;
  autoReportChannelIds: string[];
  wclGuildName?: string;
  wclGuildServerSlug?: string;
  wclGuildServerRegion?: string;
  wclZoneId?: number;
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
  autoReportMode: 'prompt',
  autoReportChannelIds: [],
});

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
  performanceAverage?: number;
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
  topHealers?: Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
  }>;
  deaths?: number;
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
export type {
  ReportEncounterSummary,
  ReportIndexData,
  ReportIndexFightRow,
  GuildRankEncounterRow,
  GuildRankMetricSource,
  GuildRankMetricSourceLabel,
  GuildRankMetricRow,
  GuildRankProgressRanks,
  GuildRankSummary,
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

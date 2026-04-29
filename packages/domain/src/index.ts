import type { AccountabilityVisibility, CoachingShareability } from '@wcl/contracts';
import { DEFAULT_COMPARE_MODE, type CompareMode } from './comparison/compare-mode.js';

export type GameFamily = 'retail' | 'mop_classic';

export type RecapPostMode = 'preview-and-post' | 'preview-only';

export interface GuildConfig {
  guildId: string;
  defaultGameFamily: GameFamily;
  compareModeDefault: CompareMode;
  accountabilityVisibility: AccountabilityVisibility;
  coachingShareabilityDefault: CoachingShareability;
  recapPostModeDefault: RecapPostMode;
}

export interface GuildConfigStore {
  getGuildConfig(guildId: string): Promise<GuildConfig>;
  saveGuildConfig(
    guildId: string,
    update: Partial<Omit<GuildConfig, 'guildId'>>,
  ): Promise<GuildConfig>;
}

export const defaultGuildConfigFor = (guildId: string): GuildConfig => ({
  guildId,
  defaultGameFamily: 'retail',
  compareModeDefault: DEFAULT_COMPARE_MODE,
  accountabilityVisibility: 'off',
  coachingShareabilityDefault: 'private',
  recapPostModeDefault: 'preview-and-post',
});

export interface NormalizedPlayer {
  id: string;
  actorId?: number;
  name: string;
  nameKey?: string;
  realm?: string;
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
  reportWideRankings?: {
    dps: NormalizedLeaderboardEntry[];
    hps: NormalizedLeaderboardEntry[];
  };
}

export interface RecapSummary {
  reportTitle: string;
  titleLine: string;
  secondaryLine: string;
  reportDateISO: string;
  reportDateLabel: string;
  killTimeLabel: string;
  pullCount: number;
  reportLink: string;
  gameFamily: GameFamily;
  zoneName?: string;
  bossesKilled: number;
  compareModeUsed: CompareMode;
  accountabilityVisibility: AccountabilityVisibility;
  coachingShareability: CoachingShareability;
  recapPostMode: RecapPostMode;
  fastestPhaseTimes: Array<{ label: string; durationMs: number; name?: string }>;
  topDamageTaken: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  topHealers: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  topDamageDone: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  topHealingDone: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  topInterrupts: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  topDispels: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  topSurvivability: Array<{ playerName: string; value: number; classSpecLabel?: string }>;
  totals: {
    totalDeaths?: number;
    mostWipesBoss?: string;
    mostWipesCount?: number;
    raidDamageTaken?: number;
    dispels?: number;
    battleRezzes?: number;
    kicks?: number;
  };
  bestExecution?: { playerName: string; value: number };
  mostImprovedPlayer?: { playerName: string; delta: number };
  highestParses: Array<{
    playerName: string;
    metric: 'DPS' | 'HPS';
    value: number;
    bossName?: string;
    fightId?: number;
    className?: string;
    specName?: string;
    classSpecLabel?: string;
  }>;
  topDamageAverageParses: Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
    classSpecLabel?: string;
  }>;
  topHealingAverageParses: Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
    classSpecLabel?: string;
  }>;
  bossHighlights: Array<{ bossName: string; fightId: number; text: string }>;
  raidSuperlatives: Array<{ label: string; text: string }>;
  teamNote: string;
}

export interface PreviousRaidLookup {
  findPreviousRaidSummaries(guildId: string, beforeDate: Date): Promise<NormalizedPlayer[]>;
}

export interface BuildRecapSummaryOptions {
  guildConfig?: GuildConfig;
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
export { deriveDeterministicTeamNote, Outcome } from './recap/outcome.js';
export { Performance } from './recap/performance.js';
export { Volume } from './recap/volume.js';
export { Execution } from './recap/execution.js';
export { buildRecapSummary } from './recap/build-recap-summary.js';
export {
  getBossEncounterId,
  hasDungeonPullData,
  parseFightSummaries,
  pickEncounterSummaryFight,
  sumTableValues,
  summarizeBossTables,
  type FightSummaryRow,
} from './report-mappers.js';

// Temporary adapter layer for incremental migration to @wcl/contracts.
export type {
  AccountabilityVisibility,
  CoachingShareability,
  CoachingViewService,
  AccountabilityViewService,
  SubscriptionService,
  IdentityMergeReviewService,
} from '@wcl/contracts';

export interface TrendTrackingService {
  ingestRaidHistory(guildId: string, report: NormalizedReport): Promise<void>;
  recomputeTrendsForGuild(guildId: string): Promise<void>;
}

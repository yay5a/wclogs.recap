export type GameFamily = 'retail' | 'mop_classic';
export type CompareMode = 'character' | 'mixed';
import type { AccountabilityVisibility, CoachingShareability } from '@wcl/contracts';

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
  compareModeDefault: 'character',
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
  bestPlayerParses: Array<{
    playerName: string;
    parse: number;
    metricLabel: string;
    metric?: string;
    amount?: number;
    className?: string;
    specName?: string;
    classSpecLabel?: string;
  }>;
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
  bestSingleBossParse?: {
    playerName: string;
    value: number;
    bossName: string;
    fightId: number;
    metric: string;
  };
  bestAverageParse?: { playerName: string; value: number; metric: string };
  bestExecution?: { playerName: string; value: number };
  mostImprovedPlayer?: { playerName: string; delta: number };
  topOverallParsers: Array<{
    playerName: string;
    value: number;
    metric: string;
  }>;
  topOverallDamageParsers: Array<{
    playerName: string;
    value: number;
    metric: 'DPS';
  }>;
  topOverallHealingParsers: Array<{
    playerName: string;
    value: number;
    metric: 'HPS';
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

export { deriveDeterministicTeamNote, Outcome } from './recap/outcome.js';
export { Performance } from './recap/performance.js';
export { Volume } from './recap/volume.js';
export { Execution } from './recap/execution.js';
export { buildRecapSummary } from './recap/build-recap-summary.js';

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

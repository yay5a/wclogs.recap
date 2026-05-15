import type { GameFamily, ReportMetricRow } from '@wcl/domain';
import type { ParsedPlayerDetail } from '../parsers/report-details.js';
import type { ParsedTableEntry } from '../parsers/table.js';
import type { NormalizedLeaderboardEntry } from '@wcl/domain';

export interface ReportIndexFightRow {
  id: number;
  encounterId: number;
  name: string;
  startTime: number;
  endTime: number;
  kill: boolean;
  difficulty?: number;
  size?: number;
  inProgress?: boolean;
}

export interface ReportIndexData {
  reportCode: string;
  sourceUrl: string;
  gameFamily: GameFamily;
  title: string;
  zoneName?: string;
  zoneId?: number;
  startTime: number;
  endTime: number;
  completedBossFights: ReportIndexFightRow[];
  killBossFights: ReportIndexFightRow[];
  allBossFights: ReportIndexFightRow[];
  zoneDifficulties: Array<{ id: number; name: string; sizes?: number[] }>;
}

export interface ReportMasterData {
  actors: Array<{ id?: number; name: string; className?: string; server?: string }>;
}

export interface ReportTableMetrics {
  topDamageDone: ParsedTableEntry[];
  topHealingDone: ParsedTableEntry[];
  topDamageTaken: ParsedTableEntry[];
  topDeaths: ParsedTableEntry[];
  topInterrupts: ParsedTableEntry[];
  topDispels: ParsedTableEntry[];
  totals: {
    deaths?: number;
    raidDamageTaken?: number;
    interrupts?: number;
    dispels?: number;
  };
  deathsByFightId: Record<number, number>;
  encounterTopDamageDoneByEncounterId: Record<number, ParsedTableEntry[]>;
  encounterTopHealingDoneByEncounterId: Record<number, ParsedTableEntry[]>;
  encounterTopDamageTakenByEncounterId: Record<number, ParsedTableEntry[]>;
}

export interface ReportEncounterSummaryRow {
  encounterId: number;
  bossName: string;
  difficultyName?: string;
  pulls: number;
  kills: number;
  wipes: number;
  totalDurationMs: number;
  longestPullMs?: number;
  shortestPullMs?: number;
  shortestKillDurationMs?: number;
  deaths: number;
  highestTotalDps?: ReportMetricRow;
  highestHps?: ReportMetricRow;
  highestDamageTakenRate?: ReportMetricRow;
}

export interface GuildRankInput {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  zoneId: number;
  difficulty: string;
  size: string;
  gameFamily?: GameFamily;
}

export interface GuildRankWindows {
  currentStartMs: number;
  currentEndMs: number;
  baselineStartMs: number;
  baselineEndMs: number;
}

export interface GuildReportDiscoveryRow {
  code: string;
  startTime: number;
  endTime?: number;
  zoneId?: number;
  zoneName?: string;
}

export interface GuildOfficialRanks {
  progress: {
    world?: number;
    region?: number;
    realm?: number;
  };
  speed: {
    world?: number;
    region?: number;
    realm?: number;
  };
  completeRaidSpeed: {
    world?: number;
    region?: number;
    realm?: number;
  };
  source: 'zoneRanking' | 'unavailable';
  progressSource: 'zoneRanking' | 'unavailable';
}

export interface GuildRankEncounterMetric {
  encounterName: string;
  bestScore?: number;
  medianScore?: number;
}

export interface GuildRankMetricSet {
  perEncounter: GuildRankEncounterMetric[];
}

export interface ReportCollectorBundle {
  index: ReportIndexData;
  masterData: ReportMasterData;
  playerDetails: ParsedPlayerDetail[];
  rankings: {
    dps: NormalizedLeaderboardEntry[];
    hps: NormalizedLeaderboardEntry[];
    tankDps: NormalizedLeaderboardEntry[];
  };
  tableMetrics: ReportTableMetrics;
}

export interface GuildRankCollectorBundle {
  input: GuildRankInput;
  windows: GuildRankWindows;
  officialRanks: GuildOfficialRanks;
  currentReports: GuildReportDiscoveryRow[];
  baselineReports: GuildReportDiscoveryRow[];
  currentSpeed: GuildRankMetricSet;
  baselineSpeed: GuildRankMetricSet;
  currentExecution: GuildRankMetricSet;
  baselineExecution: GuildRankMetricSet;
  progressPulls: { pulls: number; wipes: number; clearedEncounters: number; totalEncounters: number };
  currentWindowDiscovery: {
    candidateReports: number;
    zoneMatchedReports: number;
    difficultySizeMatchedReports: number;
  };
  zoneName: string;
  difficultyLabel: string;
  sizeLabel: string;
}

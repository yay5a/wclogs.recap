import type {
  GameFamily,
  GuildRankMetricSource,
  NormalizedLeaderboardEntry,
  ReportIndexData,
  ReportMetricRow,
  ReportParseRow,
} from '@wcl/domain';
import type { ParsedPlayerDetail } from '../parsers/report-details.js';
import type { ParsedTableEntry } from '../parsers/table.js';

export type { ReportIndexData, ReportIndexFightRow } from '@wcl/domain';

export interface ReportMasterData {
  actors: Array<{ id?: number; name: string; className?: string; server?: string }>;
}

export interface ReportTableMetrics {
  topDamageDone: ParsedTableEntry[];
  topHealingDone: ParsedTableEntry[];
  topDeaths: ParsedTableEntry[];
  topInterrupts: ParsedTableEntry[];
  topDispels: ParsedTableEntry[];
  totals: {
    deaths?: number;
    interrupts?: number;
    dispels?: number;
  };
  deathsByFightId: Record<number, number>;
  encounterTopDamageDoneByEncounterId: Record<number, ParsedTableEntry[]>;
  encounterTopHealingDoneByEncounterId: Record<number, ParsedTableEntry[]>;
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
  highestParseDps?: ReportParseRow;
  highestParseHps?: ReportParseRow;
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

export interface GuildRankTrendScope {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
}

export interface GuildRankWeeklyTrendRow {
  encounterId: number;
  difficulty: number;
  size: number;
  weekStart: Date;
  timeframe: 'today' | 'historical';
  compareMode: 'rankings' | 'parses';
  sampleCount: number;
  speedMedian?: number;
  speedP90?: number;
  speedMedianDelta?: number;
  executionMedian?: number;
  executionP90?: number;
  executionMedianDelta?: number;
}

export interface GuildRankTrendReader {
  listWeeklyTrends(input: { scope: GuildRankTrendScope }): Promise<GuildRankWeeklyTrendRow[]>;
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
  source: 'zoneRanking' | 'progressRaceData' | 'unavailable';
  progressSource: 'zoneRanking' | 'progressRaceData' | 'unavailable';
}

export interface GuildRankEncounterMetric {
  encounterName: string;
  bestDerivedPercentile?: number;
  medianDerivedPercentile?: number;
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
  };
  tableMetrics: ReportTableMetrics;
}

export interface GuildRankCollectorBundle {
  input: GuildRankInput;
  windows: GuildRankWindows;
  metricSource: GuildRankMetricSource;
  officialRanks: GuildOfficialRanks;
  currentReports: GuildReportDiscoveryRow[];
  baselineReports: GuildReportDiscoveryRow[];
  currentSpeed: GuildRankMetricSet;
  baselineSpeed: GuildRankMetricSet;
  currentExecution: GuildRankMetricSet;
  baselineExecution: GuildRankMetricSet;
  progressPulls: {
    pulls: number;
    wipes: number;
    clearedEncounters: number;
    totalEncounters: number;
  };
  currentWindowDiscovery: {
    candidateReports: number;
    zoneMatchedReports: number;
    difficultySizeMatchedReports: number;
  };
  zoneName: string;
  difficultyLabel: string;
  sizeLabel: string;
}

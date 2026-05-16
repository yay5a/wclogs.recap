export interface ReportMetricRow {
  playerName: string;
  value: number;
  activeTimeMs?: number;
  className?: string;
  specName?: string;
}

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
  gameFamily: 'retail' | 'mop_classic';
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

export interface ReportParseRow extends ReportMetricRow {
  metric: 'DPS' | 'HPS';
  bossName?: string;
  fightId?: number;
}

export interface ReportEncounterSummary {
  bossName: string;
  encounterId?: number;
  difficultyName?: string;
  pulls: number;
  kills: number;
  wipes: number;
  totalDurationMs: number;
  longestPullMs?: number;
  shortestPullMs?: number;
  deaths?: number;
  totalDamage?: number;
  totalHealing?: number;
  highestTotalDps?: ReportMetricRow;
  highestHps?: ReportMetricRow;
  highestParseDps?: ReportParseRow;
  highestParseHps?: ReportParseRow;
}

export interface ReportSummary {
  reportCode: string;
  reportTitle: string;
  raidName?: string;
  difficultyName?: string;
  sizeLabel?: string;
  reportLink: string;
  dateISO: string;
  startTimeISO: string;
  endTimeISO: string;
  durationMs: number;
  bossPulls: number;
  totalKills: number;
  totalWipes: number;
  totalDeaths?: number;
  encounters: ReportEncounterSummary[];
  bestExecutionEncounter?: ReportEncounterSummary;
  biggestTroubleEncounter?: ReportEncounterSummary;
  highestParses: {
    dps?: ReportParseRow;
    hps?: ReportParseRow;
  };
  topPlayers: {
    highestAverageParse: ReportMetricRow[];
    highestTotalDamage: ReportMetricRow[];
    highestTotalHealing: ReportMetricRow[];
    highestTotalDps: ReportMetricRow[];
    highestHps: ReportMetricRow[];
    mostDeaths: ReportMetricRow[];
    mostInterrupts: ReportMetricRow[];
    mostDispels: ReportMetricRow[];
  };
  partialDataNotes: string[];
}

export interface GuildRankMetricRow {
  bestDerivedPercentile?: number;
  bestDerivedPercentileDelta?: number;
  medianDerivedPercentile?: number;
  medianDerivedPercentileDelta?: number;
}

export interface GuildRankEncounterRow {
  encounterName: string;
  speed: GuildRankMetricRow;
  execution: GuildRankMetricRow;
}

export interface GuildRankProgressRanks {
  world?: number;
  region?: number;
  realm?: number;
}

export type GuildRankMetricSource = 'trend_cache' | 'derived_report_scan';
export type GuildRankMetricSourceLabel = 'Cached WCL Rankings' | 'Derived from WCL Reports';

export interface GuildRankSummary {
  guildName: string;
  zoneName: string;
  difficultyLabel: string;
  sizeLabel: string;
  metricSource: GuildRankMetricSource;
  window: {
    currentStartIso: string;
    currentEndIso: string;
    baselineStartIso: string;
    baselineEndIso: string;
  };
  progress: {
    clearedEncounters: number;
    totalEncounters: number;
    pulls: number;
    wipes: number;
    ranks: GuildRankProgressRanks;
    ranksAvailable: boolean;
    sourceLabel: 'Official WCL Rankings' | 'Progress Only: Ranking Unavailable';
  };
  speed: {
    sourceLabel: 'Official WCL Rankings' | GuildRankMetricSourceLabel;
    ranks?: GuildRankProgressRanks;
    completeRaidRanks?: GuildRankProgressRanks;
    overall: GuildRankMetricRow;
    bestEncounterGain?: { encounterName: string; delta: number };
    encounters: GuildRankEncounterRow[];
  };
  execution: {
    sourceLabel: 'Official WCL Rankings' | GuildRankMetricSourceLabel;
    ranks?: GuildRankProgressRanks;
    overall: GuildRankMetricRow;
    bestEncounterGain?: { encounterName: string; delta: number };
    encounters: GuildRankEncounterRow[];
  };
  notes: string[];
}

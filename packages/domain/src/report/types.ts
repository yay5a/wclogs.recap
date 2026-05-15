export interface ReportMetricRow {
  playerName: string;
  value: number;
  activeTimeMs?: number;
  className?: string;
  specName?: string;
}

export interface ReportParseRow extends ReportMetricRow {
  metric: 'DPS' | 'HPS' | 'DTPS';
  sourceMetric?: 'dps-tank';
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
  totalDamageTaken?: number;
  highestTotalDps?: ReportMetricRow;
  highestHps?: ReportMetricRow;
  highestDamageTakenRate?: ReportMetricRow;
  highestParseDps?: ReportParseRow;
  highestParseHps?: ReportParseRow;
  dtpsParseAvailable: false;
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
    dtps?: ReportParseRow;
    dtpsAvailable: boolean;
  };
  topPlayers: {
    highestAverageParse: ReportMetricRow[];
    highestTotalDamage: ReportMetricRow[];
    highestTotalHealing: ReportMetricRow[];
    highestTotalDamageTaken: ReportMetricRow[];
    highestTotalDps: ReportMetricRow[];
    highestHps: ReportMetricRow[];
    highestDamageTakenRate: ReportMetricRow[];
    mostDeaths: ReportMetricRow[];
    mostInterrupts: ReportMetricRow[];
    mostDispels: ReportMetricRow[];
  };
  partialDataNotes: string[];
}

export interface GuildRankMetricRow {
  bestScore?: number;
  bestScoreDelta?: number;
  medianScore?: number;
  medianScoreDelta?: number;
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

export interface GuildRankSummary {
  guildName: string;
  zoneName: string;
  difficultyLabel: string;
  sizeLabel: string;
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
    sourceLabel: 'Official WCL Rankings' | 'Derived from WCL Reports';
    ranks?: GuildRankProgressRanks;
    completeRaidRanks?: GuildRankProgressRanks;
    overall: GuildRankMetricRow;
    bestEncounterGain?: { encounterName: string; delta: number };
    encounters: GuildRankEncounterRow[];
  };
  execution: {
    sourceLabel: 'Official WCL Rankings' | 'Derived from WCL Reports';
    ranks?: GuildRankProgressRanks;
    overall: GuildRankMetricRow;
    bestEncounterGain?: { encounterName: string; delta: number };
    encounters: GuildRankEncounterRow[];
  };
  notes: string[];
}

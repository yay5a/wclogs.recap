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
  ownerName?: string;
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
  mostDeaths?: ReportMetricRow[];
  mostInterrupts?: ReportMetricRow[];
  mostDispels?: ReportMetricRow[];
  mostHealthstonesConsumed?: ReportMetricRow[];
}

export interface ReportBrezPlayer {
  id: number;
  name: string;
}

export interface ReportBrezPlayerCount extends ReportBrezPlayer {
  count: number;
}

export interface ReportBrezMatch {
  caster: ReportBrezPlayer;
  receiver: ReportBrezPlayer;
  fightID: number;
  fightName?: string;
  deathTimestamp: string;
  resurrectTimestamp: string;
  responseSec: number;
}

export interface ReportBrezSummary {
  topCasters: ReportBrezPlayerCount[];
  topReceivers: ReportBrezPlayerCount[];
  fastest?: ReportBrezMatch;
}

export interface ReportSummary {
  reportCode: string;
  reportTitle: string;
  reportOwnerName?: string;
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
  battleRez?: ReportBrezSummary;
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

export type GuildRankMetricSource = 'trend_cache' | 'indexed_report_scan';
export type GuildRankMetricSourceLabel = 'Cached Rank Percentiles' | 'Derived from indexed reports';

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
    sourceLabel: 'World, Region, Server Rank Positions' | 'Progress Only: Ranking Unavailable';
  };
  speed: {
    sourceLabel:
      | 'World, Region, Server Rank Positions and Cached Rank Percentiles'
      | GuildRankMetricSourceLabel;
    ranks?: GuildRankProgressRanks;
    completeRaidRanks?: GuildRankProgressRanks;
    overall: GuildRankMetricRow;
    bestEncounterGain?: { encounterName: string; delta: number };
    encounters: GuildRankEncounterRow[];
  };
  execution: {
    sourceLabel: GuildRankMetricSourceLabel;
    ranks?: GuildRankProgressRanks;
    overall: GuildRankMetricRow;
    bestEncounterGain?: { encounterName: string; delta: number };
    encounters: GuildRankEncounterRow[];
  };
  notes: string[];
}

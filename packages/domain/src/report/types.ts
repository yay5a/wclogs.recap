export interface ReportMetricRow {
  playerName: string;
  value: number;
  className?: string;
  specName?: string;
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
    dtpsAvailable: false;
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

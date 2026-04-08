export type GameFamily = 'retail' | 'mop_classic';

export type ComparisonMode = 'character' | 'account' | 'mixed';
export type AccountabilityVisibility = 'off' | 'officers-only' | 'shareable';
export type CoachingShareability = 'officers-only' | 'shareable';
export type RecapPostMode = 'preview-only' | 'allow-post';

export interface GuildConfig {
  guildId: string;
  defaultGameFamily?: GameFamily;
  compareModeDefault: ComparisonMode;
  accountabilityVisibility: AccountabilityVisibility;
  coachingShareabilityDefault: CoachingShareability;
  recapPostModeDefault: RecapPostMode;
}

export interface GuildConfigInput {
  defaultGameFamily?: GameFamily;
  compareModeDefault?: ComparisonMode;
  accountabilityVisibility?: AccountabilityVisibility;
  coachingShareabilityDefault?: CoachingShareability;
  recapPostModeDefault?: RecapPostMode;
}

export interface GuildConfigStore {
  getGuildConfig(guildId: string): Promise<GuildConfig>;
  saveGuildConfig(guildId: string, input: GuildConfigInput): Promise<GuildConfig>;
}

export interface NormalizedPlayerPerformance {
  bestSingleBossParse?: number;
  averageParseAcrossKills?: number;
}

export interface NormalizedPlayerExecution {
  executionScore?: number;
}

export interface NormalizedPlayer {
  id: string;
  name: string;
  realm?: string;
  className?: string;
  specName?: string;
  performance: NormalizedPlayerPerformance;
  execution: NormalizedPlayerExecution;
}

export interface NormalizedFight {
  id: number;
  name: string;
  startTime: number;
  endTime: number;
  kill: boolean;
}

export interface NormalizedReport {
  reportCode: string;
  title: string;
  startTime: number;
  endTime: number;
  gameFamily: GameFamily;
  zoneName?: string;
  comparisonMode: ComparisonMode;
  sourceHost: string;
  requestedFightId?: number;
  fights: NormalizedFight[];
  players: NormalizedPlayer[];
}

export interface RecapSummary {
  reportTitle: string;
  reportDateISO: string;
  gameFamily: GameFamily;
  zoneName?: string;
  bossesKilled: number;
  bestSingleBossParse?: { playerName: string; value: number };
  bestAverageParse?: { playerName: string; value: number };
  bestExecution?: { playerName: string; value: number };
  mostImprovedPlayer?: { playerName: string; delta: number };
  teamNote: string;
}

export interface PreviousRaidLookup {
  findPreviousRaidSummaries(
    guildId: string,
    beforeDate: Date,
    gameFamily?: GameFamily,
  ): Promise<NormalizedPlayer[]>;
}

export const deriveDeterministicTeamNote = (bossesKilled: number): string => {
  if (bossesKilled >= 8) return 'Team note: Full-clear momentum is strong; capture callout clips.';
  if (bossesKilled >= 4) return 'Team note: Progress is stable; set one focus mechanic for next raid.';
  return 'Team note: Early progression week; prioritize clean mechanic reps.';
};

export const buildRecapSummary = (
  report: NormalizedReport,
  previousPlayers?: NormalizedPlayer[],
): RecapSummary => {
  const killed = report.fights.filter((f) => f.kill).length;
  const byParse = [...report.players]
    .filter((p) => typeof p.performance.bestSingleBossParse === 'number')
    .sort(
      (a, b) =>
        (b.performance.bestSingleBossParse ?? 0) -
        (a.performance.bestSingleBossParse ?? 0),
    );
  const byAvg = [...report.players]
    .filter((p) => typeof p.performance.averageParseAcrossKills === 'number')
    .sort(
      (a, b) =>
        (b.performance.averageParseAcrossKills ?? 0) -
        (a.performance.averageParseAcrossKills ?? 0),
    );
  const byExec = [...report.players]
    .filter((p) => typeof p.execution.executionScore === 'number')
    .sort(
      (a, b) =>
        (b.execution.executionScore ?? 0) - (a.execution.executionScore ?? 0),
    );

  const previousByName = new Map((previousPlayers ?? []).map((p) => [p.name, p]));
  const improved = report.players
    .map((p) => {
      const prev = previousByName.get(p.name);
      if (
        !prev ||
        typeof p.performance.averageParseAcrossKills !== 'number' ||
        typeof prev.performance.averageParseAcrossKills !== 'number'
      ) {
        return undefined;
      }
      return {
        playerName: p.name,
        delta:
          p.performance.averageParseAcrossKills -
          prev.performance.averageParseAcrossKills,
      };
    })
    .filter((x): x is { playerName: string; delta: number } => Boolean(x))
    .sort((a, b) => b.delta - a.delta);

  const summary: RecapSummary = {
    reportTitle: report.title,
    reportDateISO: new Date(report.startTime).toISOString(),
    gameFamily: report.gameFamily,
    bossesKilled: killed,
    teamNote: deriveDeterministicTeamNote(killed),
  };

  if (report.zoneName) summary.zoneName = report.zoneName;
  if (byParse[0]) {
    summary.bestSingleBossParse = {
      playerName: byParse[0].name,
      value: byParse[0].performance.bestSingleBossParse ?? 0,
    };
  }
  if (byAvg[0]) {
    summary.bestAverageParse = {
      playerName: byAvg[0].name,
      value: byAvg[0].performance.averageParseAcrossKills ?? 0,
    };
  }
  if (byExec[0]) {
    summary.bestExecution = {
      playerName: byExec[0].name,
      value: byExec[0].execution.executionScore ?? 0,
    };
  }
  if (improved[0] && improved[0].delta > 0) summary.mostImprovedPlayer = improved[0];

  return summary;
};

// TODO: Future interfaces
export interface CoachingViewService {
  buildShareableCoachingView(reportCode: string): Promise<unknown>;
}

export interface AccountabilityViewService {
  buildAccountabilityView(
    reportCode: string,
    visibility: AccountabilityVisibility,
  ): Promise<unknown>;
}

export interface TrendTrackingService {
  recomputeTrendsForGuild(guildId: string): Promise<void>;
}

export interface SubscriptionService {
  scheduleReportSubscription(guildId: string, channelId: string): Promise<void>;
}

export interface IdentityMergeReviewService {
  enqueueCandidateReview(profileId: string): Promise<void>;
}

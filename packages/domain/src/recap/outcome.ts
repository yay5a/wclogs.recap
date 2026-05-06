import type {
  CompareMode,
  GuildConfig,
  NormalizedBossPerformance,
  NormalizedReport,
  RecapSummary,
} from '../index.js';
import { DEFAULT_COMPARE_MODE } from '../comparison/compare-mode.js';
import {
  buildTitleContext,
  formatDateMmDdYyyy,
  formatRaidDurationHoursMinutes,
  resolveDifficultyLabel,
  type SelectedBoss,
} from './helpers.js';

export interface OutcomeInput {
  report: NormalizedReport;
  guildConfig?: GuildConfig;
  selectedBoss: SelectedBoss;
  bossPerformances: NormalizedBossPerformance[];
}

export interface OutcomeResult {
  section: Pick<
    RecapSummary,
    | 'reportTitle'
    | 'titleLine'
    | 'secondaryLine'
    | 'reportDateISO'
    | 'reportDateLabel'
    | 'killTimeLabel'
    | 'pullCount'
    | 'reportLink'
    | 'gameFamily'
    | 'bossesKilled'
    | 'compareModeUsed'
    | 'recapPostMode'
    | 'fastestPhaseTimes'
    | 'teamNote'
  > & { zoneName?: string };
}

export const Outcome = {
  build({ report, guildConfig, selectedBoss }: OutcomeInput): OutcomeResult {
    const compareModeUsed: CompareMode =
      guildConfig?.compareModeDefault ?? DEFAULT_COMPARE_MODE;
    const killed = report.fights.filter((f) => f.kill).length;
    const zoneName = selectedBoss?.zoneName ?? report.zoneName;
    const difficultyLabel = resolveDifficultyLabel(
      selectedBoss?.difficultyName,
      selectedBoss?.difficulty,
    );
    const { titleLine, reportAndZoneMatch } = buildTitleContext({
      reportTitle: report.title,
      ...(zoneName ? { zoneName } : {}),
      ...(difficultyLabel ? { difficultyLabel } : {}),
    });

    const section: OutcomeResult['section'] = {
      reportTitle: titleLine,
      titleLine,
      secondaryLine: selectedBoss?.guildName
        ? `${selectedBoss.guildName} on ${selectedBoss.realmName ?? 'Unknown Realm'}`
        : 'Unknown Guild on Unknown Realm',
      reportDateISO: new Date(report.startTime).toISOString(),
      reportDateLabel: formatDateMmDdYyyy(report.startTime),
      killTimeLabel: formatRaidDurationHoursMinutes(Math.max(0, report.endTime - report.startTime)),
      pullCount: report.fights.length,
      reportLink:
        selectedBoss?.reportUrl ?? `https://www.warcraftlogs.com/reports/${report.reportCode}`,
      gameFamily: report.gameFamily,
      bossesKilled: killed,
      compareModeUsed,
      recapPostMode: guildConfig?.recapPostModeDefault ?? 'preview-and-post',
      fastestPhaseTimes: [],
      teamNote: deriveDeterministicTeamNote(killed),
    };

    if (zoneName && !reportAndZoneMatch) {
      section.zoneName = zoneName;
    }

    return { section };
  },
};

export const deriveDeterministicTeamNote = (bossesKilled: number): string => {
  if (bossesKilled >= 8) return 'Team note: Full-clear momentum is strong; capture callout clips.';
  if (bossesKilled >= 4)
    return 'Team note: Progress is stable; set one focus mechanic for next raid.';
  return 'Team note: Early progression week; prioritize clean mechanic reps.';
};

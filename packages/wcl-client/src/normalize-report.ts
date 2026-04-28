import type {
  FightSummaryRow,
  NormalizedBossPerformance,
  NormalizedFight,
  NormalizedLeaderboardEntry,
  NormalizedPlayer,
  NormalizedReport,
} from '@wcl/domain';
import {
  getBossEncounterId,
  hasDungeonPullData,
  parseFightSummaries,
  pickEncounterSummaryFight,
  sumTableValues,
  summarizeBossTables,
} from '@wcl/domain';
import { createLogger } from '@wcl/shared';
import {
  asNumber,
  asObject,
  asString,
  indexLeaderboardByActorAndName,
  normalizeName,
  parseBossRankingsPayload,
  parsePlayerDetailsPayload,
  parseReportRankingsPayload,
  parseTablePayloadDetailed,
  type ParsedTableEntry,
} from './parsers/index.js';
import type { ParsedReportUrl } from './report-code.js';
import { REPORT_TABLE_DATA_TYPES, type TableDataType } from './schema-enums.js';
import { getReportNode, type EncounterSummaryRow } from './raw-report.js';

const logger = createLogger('wcl-client');

interface EncounterPhaseRow {
  id: number;
  name: string;
  isIntermission?: boolean;
}

type BossPerformanceRecap = NormalizedBossPerformance & {
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
};

// Best-effort fallback labels only. Difficulty IDs are zone-specific in practice;
// prefer Zone.difficulties metadata from the report's zone when present.
const WCL_DIFFICULTY_LABELS = new Map<number, string>([
  [1, 'LFR'],
  [2, 'Flex'],
  [3, 'Normal'],
  [4, 'Heroic'],
  [5, 'Mythic'],
  [10, 'Dungeon'],
]);

const getZoneDifficultyLabels = (report?: Record<string, unknown>): Map<number, string> => {
  const zone = asObject(report?.zone);
  const rows = zone && Array.isArray(zone.difficulties) ? zone.difficulties : [];

  const labels = new Map<number, string>();
  for (const value of rows) {
    const row = asObject(value);
    const id = asNumber(row?.id);
    const name = asString(row?.name);
    if (typeof id === 'number' && typeof name === 'string' && name.length > 0) {
      labels.set(id, name);
    }
  }

  return labels;
};

const getDifficultyLabel = (
  difficulty?: number,
  report?: Record<string, unknown>,
): string | undefined => {
  if (typeof difficulty !== 'number') return undefined;
  const zoneDifficultyName = getZoneDifficultyLabels(report).get(difficulty);
  if (zoneDifficultyName) return zoneDifficultyName;
  // TODO(world-data): when we add world/game data lookups, resolve zone-specific
  // difficulty names from canonical zone metadata before using static fallbacks.
  return WCL_DIFFICULTY_LABELS.get(difficulty) ?? `Difficulty ${difficulty}`;
};

const getFightDeathsFromRankingsPayload = (
  payload: unknown,
  fightId: number,
): number | undefined => {
  if (typeof payload !== 'string') return undefined;
  try {
    const root = asObject(JSON.parse(payload));
    if (!root) return undefined;
    const rows = Array.isArray(root.data) ? root.data : [];
    for (const value of rows) {
      const row = asObject(value);
      const rowFightId = asNumber(row?.fightID) ?? asNumber(row?.fightId);
      if (rowFightId !== fightId) continue;
      const deaths = asNumber(row?.deaths);
      if (typeof deaths === 'number') return deaths;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const takeTopEntries = (entries: ParsedTableEntry[] | undefined, limit = 3): ParsedTableEntry[] =>
  [...(entries ?? [])]
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, limit);

const buildRealmLabel = (report: Record<string, unknown>): string | undefined => {
  const guild = asObject(report.guild);
  const server = asObject(guild?.server);
  const serverName = asString(server?.name);
  const region = asString(asObject(server?.region)?.compactName);

  if (serverName && region) return `${serverName}-${region}`;
  return serverName;
};

const parseEncounterPhases = (
  report: Record<string, unknown>,
): Map<number, EncounterPhaseRow[]> => {
  const result = new Map<number, EncounterPhaseRow[]>();

  for (const value of Array.isArray(report.phases) ? report.phases : []) {
    const row = asObject(value);
    const encounterID = asNumber(row?.encounterID);
    if (typeof encounterID !== 'number') continue;

    const phaseRows = row && Array.isArray(row.phases) ? row.phases : [];
    const phases = phaseRows.flatMap((phaseValue) => {
      const phase = asObject(phaseValue);
      const id = asNumber(phase?.id);
      const name = asString(phase?.name);
      if (typeof id !== 'number' || typeof name !== 'string') {
        return [];
      }

      // Build the phase entry, omitting isIntermission when undefined. Use optional chaining
      // on phase to safely access isIntermission. Under exactOptionalPropertyTypes, avoid
      // assigning undefined explicitly to optional properties.
      const entry: EncounterPhaseRow = {
        id,
        name,
        // When phase is undefined or does not contain isIntermission, this will be false.
        // We conditionally include the property only if it exists on the source.
        ...(phase && 'isIntermission' in phase
          ? {
              isIntermission: phase.isIntermission === true,
            }
          : {}),
      };
      return [entry];
    });

    result.set(encounterID, phases);
  }

  return result;
};

const getMetricFromLeaderboard = (entry: NormalizedLeaderboardEntry): string | undefined => {
  const row = asObject(entry as unknown);
  const explicitMetricCandidates = [
    asString(row?.selectedMetric),
    asString(row?.playerMetric),
    asString(row?.metric),
  ];
  for (const metric of explicitMetricCandidates) {
    const normalized = metric?.trim().toUpperCase();
    if (normalized === 'DPS' || normalized === 'HPS' || normalized === 'DTPS') {
      return normalized;
    }
  }

  const role = asString(row?.role)?.toLowerCase();
  if (role === 'healer') return 'HPS';
  if (role === 'tank') return 'DTPS';

  return 'DPS';
};

const getAmountFromLeaderboard = (entry: NormalizedLeaderboardEntry): number | undefined => {
  const row = asObject(entry as unknown);

  return (
    asNumber(row?.amount) ??
    asNumber(row?.metricValue) ??
    asNumber(row?.total) ??
    asNumber(row?.score) ??
    asNumber(row?.dps) ??
    asNumber(row?.hps) ??
    asNumber(row?.tankhps)
  );
};

const getNameFromLeaderboard = (entry: NormalizedLeaderboardEntry): string | undefined => {
  const row = asObject(entry as unknown);
  return asString(row?.playerName) ?? asString(row?.name) ?? asString(row?.actorName);
};

const getActorIdFromLeaderboard = (entry: NormalizedLeaderboardEntry): number | undefined => {
  const row = asObject(entry as unknown);
  return asNumber(row?.actorId) ?? asNumber(row?.id);
};

const getSpecFromLeaderboard = (
  entry: NormalizedLeaderboardEntry | undefined,
): string | undefined => {
  if (!entry) return undefined;
  const row = asObject(entry as unknown);
  return asString(row?.specName) ?? asString(row?.spec);
};

const getClassFromLeaderboard = (
  entry: NormalizedLeaderboardEntry | undefined,
): string | undefined => {
  if (!entry) return undefined;
  const row = asObject(entry as unknown);
  return asString(row?.className) ?? asString(row?.class);
};

const computeFastestPhaseTimes = (
  fights: FightSummaryRow[],
  metadata: EncounterPhaseRow[],
): Array<{
  phaseId: number;
  label: string;
  name?: string;
  durationMs: number;
}> => {
  const phaseById = new Map<number, EncounterPhaseRow>(metadata.map((phase) => [phase.id, phase]));
  const fastestByPhase = new Map<number, number>();

  for (const fight of fights) {
    const transitions = [...fight.phaseTransitions].sort(
      (left, right) => left.startTime - right.startTime,
    );

    // phaseTransitions.id and PhaseMetadata.id are schema "absolute phase index"
    // values (normal phases + intermissions in one sequence). Keep this index for
    // timing windows, then filter intermissions via metadata before recording fastest
    // "real phase" timings.
    let currentPhaseId = 1;
    let currentStart = fight.startTime;

    for (const transition of transitions) {
      const duration = transition.startTime - currentStart;
      const phaseInfo = phaseById.get(currentPhaseId);
      const isIntermission = phaseInfo ? Boolean(phaseInfo.isIntermission) : false;

      if (duration > 0 && !isIntermission) {
        const currentFastest = fastestByPhase.get(currentPhaseId);
        if (typeof currentFastest !== 'number' || duration < currentFastest) {
          fastestByPhase.set(currentPhaseId, duration);
        }
      }

      currentPhaseId = transition.id;
      currentStart = transition.startTime;
    }

    const finalDuration = fight.endTime - currentStart;
    {
      const phaseInfoFinal = phaseById.get(currentPhaseId);
      const isIntermissionFinal = phaseInfoFinal ? Boolean(phaseInfoFinal.isIntermission) : false;

      if (finalDuration > 0 && !isIntermissionFinal) {
        const currentFastest = fastestByPhase.get(currentPhaseId);
        if (typeof currentFastest !== 'number' || finalDuration < currentFastest) {
          fastestByPhase.set(currentPhaseId, finalDuration);
        }
      }
    }
  }

  return [...fastestByPhase.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([phaseId, durationMs]) => {
      const metadataRow = phaseById.get(phaseId);
      const row: {
        phaseId: number;
        label: string;
        durationMs: number;
        name?: string;
      } = {
        phaseId,
        label: `P${phaseId}`,
        durationMs,
      };
      if (metadataRow && metadataRow.name) {
        row.name = metadataRow.name;
      }
      return row;
    });
};

const computeSelectedFightPhaseTimes = (
  fight: FightSummaryRow | undefined,
  metadata: EncounterPhaseRow[],
): Array<{
  phaseId: number;
  label: string;
  name?: string;
  durationMs: number;
}> => {
  if (!fight) return [];
  const phaseById = new Map<number, EncounterPhaseRow>(metadata.map((phase) => [phase.id, phase]));
  const transitions = [...fight.phaseTransitions].sort(
    (left, right) => left.startTime - right.startTime,
  );

  const rows: Array<{
    phaseId: number;
    label: string;
    name?: string;
    durationMs: number;
  }> = [];
  let currentPhaseId = 1;
  let currentStart = fight.startTime;

  for (const transition of transitions) {
    const duration = transition.startTime - currentStart;
    const phaseInfo = phaseById.get(currentPhaseId);
    const isIntermission = phaseInfo ? Boolean(phaseInfo.isIntermission) : false;
    if (duration > 0 && !isIntermission) {
      rows.push({
        phaseId: currentPhaseId,
        label: `P${currentPhaseId}`,
        durationMs: duration,
        ...(phaseInfo?.name ? { name: phaseInfo.name } : {}),
      });
    }
    currentPhaseId = transition.id;
    currentStart = transition.startTime;
  }

  const finalDuration = fight.endTime - currentStart;
  const finalInfo = phaseById.get(currentPhaseId);
  const finalIsIntermission = finalInfo ? Boolean(finalInfo.isIntermission) : false;
  if (finalDuration > 0 && !finalIsIntermission) {
    rows.push({
      phaseId: currentPhaseId,
      label: `P${currentPhaseId}`,
      durationMs: finalDuration,
      ...(finalInfo?.name ? { name: finalInfo.name } : {}),
    });
  }

  return rows;
};

const parseEncounterSummariesFromRaw = (
  enriched?: Record<string, unknown>,
): EncounterSummaryRow[] => {
  if (!enriched) return [];

  if (Array.isArray(enriched.encounterSummaries)) {
    return enriched.encounterSummaries.flatMap((value) => {
      const row = asObject(value);
      const encounterID = asNumber(row?.encounterID);
      const fightId = asNumber(row?.fightId);
      const bossName = asString(row?.bossName);
      if (
        typeof encounterID !== 'number' ||
        typeof fightId !== 'number' ||
        typeof bossName !== 'string'
      ) {
        return [];
      }

      const difficulty = asNumber(row?.difficulty);
      const summary: EncounterSummaryRow = {
        encounterID,
        fightId,
        bossName,
        kill: Boolean(row?.kill),
        rankings: row?.rankings,
        tables: asObject(row?.tables) ?? {},
        ...(typeof difficulty === 'number' ? { difficulty } : {}),
      };
      return [summary];
    });
  }

  const rankingsByFightId = new Map<number, unknown>();
  for (const value of Array.isArray(enriched.bossRankings) ? enriched.bossRankings : []) {
    const row = asObject(value);
    const fightId = asNumber(row?.fightId);
    if (typeof fightId !== 'number') continue;
    rankingsByFightId.set(fightId, row?.payload);
  }

  return (Array.isArray(enriched.bossTables) ? enriched.bossTables : []).flatMap((value) => {
    const row = asObject(value);
    const fightId = asNumber(row?.fightId);
    const bossName = asString(row?.bossName);

    if (typeof fightId !== 'number' || typeof bossName !== 'string') {
      return [];
    }

    const difficulty = asNumber(row?.difficulty);
    const summary: EncounterSummaryRow = {
      encounterID: asNumber(row?.encounterID) ?? 0,
      fightId,
      bossName,
      kill: Boolean(row?.kill),
      rankings: rankingsByFightId.get(fightId),
      tables: asObject(row?.tables) ?? {},
      ...(typeof difficulty === 'number' ? { difficulty } : {}),
    };
    return [summary];
  });
};

export const normalizeEnrichedReport = (
  raw: unknown,
  parsed: ParsedReportUrl,
): NormalizedReport => {
  const now = (): number => Date.now();
  const logTiming = (step: string, startedAt: number, counts?: Record<string, number>): void => {
    logger.info(
      {
        reportCode: parsed.reportCode,
        step,
        durationMs: now() - startedAt,
        ...(counts ? { counts } : {}),
      },
      'wcl-client timing',
    );
  };
  const enriched = asObject(raw);
  const base = enriched?.base ?? raw;
  const report = getReportNode(base);

  if (!report) {
    throw new Error('Unexpected WCL payload shape');
  }

  const allEncounterFights = parseFightSummaries(report);
  const reportContainsDungeonPulls = allEncounterFights.some(hasDungeonPullData);
  const killFights = allEncounterFights.filter((fight) => fight.kill);
  const fightsToExpose = killFights.length > 0 ? killFights : allEncounterFights;

  const fights: NormalizedFight[] = fightsToExpose.map((fight) => ({
    id: fight.id,
    name: fight.name,
    startTime: fight.startTime,
    endTime: fight.endTime,
    kill: fight.kill,
  }));

  const rankingsParseStartedAt = now();
  const reportLeaderboards = parseReportRankingsPayload(
    enriched?.reportRankings ?? report.rankings,
    (message, context) => {
      logger.warn(
        {
          reportCode: parsed.reportCode,
          section: 'report_rankings',
          context,
        },
        message,
      );
    },
  );

  const encounterSummaries = parseEncounterSummariesFromRaw(enriched);
  const bossLeaderboards = encounterSummaries.flatMap((summary) => {
    const context: { bossName?: string; fightId?: number } = {
      bossName: summary.bossName,
      fightId: summary.fightId,
    };

    return parseBossRankingsPayload(summary.rankings, context, (message, parserContext) => {
      logger.warn(
        {
          reportCode: parsed.reportCode,
          fightId: summary.fightId,
          section: 'boss_rankings',
          context: parserContext,
        },
        message,
      );
    });
  });
  logTiming('parse rankings', rankingsParseStartedAt, {
    reportLeaderboards: reportLeaderboards.length,
    bossLeaderboards: bossLeaderboards.length,
    encounterSummaries: encounterSummaries.length,
  });

  const parsePlayersStartedAt = now();
  const playerDetails = parsePlayerDetailsPayload(enriched?.playerDetails);
  const detailByName = new Map(playerDetails.map((entry) => [normalizeName(entry.name), entry]));

  const leaderboardIndex = indexLeaderboardByActorAndName([
    ...reportLeaderboards,
    ...bossLeaderboards,
  ]);

  const players: NormalizedPlayer[] = (
    asObject(report.masterData)?.actors instanceof Array
      ? (asObject(report.masterData)?.actors as unknown[])
      : []
  ).flatMap((actorValue, index) => {
    const actor = asObject(actorValue);
    if (!actor) return [];

    const name = asString(actor.name);
    if (!name) return [];

    const actorId = asNumber(actor.id);
    const detail = detailByName.get(normalizeName(name));
    const leaderboardMatches =
      (typeof actorId === 'number' ? leaderboardIndex.byActorId.get(actorId) : undefined) ??
      leaderboardIndex.byName.get(normalizeName(name)) ??
      [];

    const player: NormalizedPlayer = {
      id: String(actorId ?? index),
      name,
      nameKey: normalizeName(name),
    };

    if (typeof actorId === 'number') {
      player.actorId = actorId;
    }

    const className = asString(actor.subType) ?? detail?.className;
    const realm = asString(actor.server);

    if (className) player.className = className;
    if (realm) player.realm = realm;
    if (detail?.specName) player.specName = detail.specName;
    if (detail?.role) player.role = detail.role;

    const reportEntries = leaderboardMatches.filter((entry) => entry.scope === 'report');

    if (reportEntries.length > 0) {
      const values = reportEntries.map((entry) => entry.value);
      player.bestParse = Math.max(...values);
      player.avgParse = values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    return [player];
  });
  logTiming('parse players/playerDetails join', parsePlayersStartedAt, {
    playerDetails: playerDetails.length,
    players: players.length,
  });

  const playerByName = new Map(players.map((player) => [player.nameKey, player]));
  const playerByActorId = new Map<number, NormalizedPlayer>();
  for (const player of players) {
    if (typeof player.actorId === 'number') {
      playerByActorId.set(player.actorId, player);
    }
  }
  const parseReportWideTablesStartedAt = now();
  const reportTableNode = asObject(enriched?.reportTables);
  const parsedReportTableResults: Partial<
    Record<TableDataType, { entries: ParsedTableEntry[]; isValidEmpty: boolean }>
  > = {};
  for (const dataType of REPORT_TABLE_DATA_TYPES) {
    const payload = reportTableNode?.[dataType];
    if (payload === undefined || payload === null) continue;

    parsedReportTableResults[dataType] = parseTablePayloadDetailed(
      payload,
      dataType,
      (message, context) => {
        logger.warn(
          {
            reportCode: parsed.reportCode,
            section: `report_table:${dataType}`,
            context,
          },
          message,
        );
      },
    );
  }
  const mapReportWideRows = (
    entries: ParsedTableEntry[] | undefined,
    limit: number,
  ): Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
  }> =>
    takeTopEntries(
      Array.from(
        (entries ?? []).reduce((byPlayer, entry) => {
          if (!entry.playerName) return byPlayer;
          const nameKey = normalizeName(entry.playerName);
          if (!playerByName.has(nameKey)) return byPlayer;

          const existing = byPlayer.get(nameKey);
          if (existing) {
            existing.value += entry.value ?? 0;
            return byPlayer;
          }

          byPlayer.set(nameKey, { ...entry, value: entry.value ?? 0 });
          return byPlayer;
        }, new Map<string, ParsedTableEntry>()),
      ).map(([, entry]) => entry),
      limit,
    ).map((entry) => {
      const player = entry.playerName
        ? playerByName.get(normalizeName(entry.playerName))
        : undefined;
      return {
        playerName: entry.playerName ?? 'Unknown',
        value: entry.value ?? 0,
        ...(player?.className ? { className: player.className } : {}),
        ...(player?.specName ? { specName: player.specName } : {}),
      };
    });
  const reportWideRecap = {
    topDamageDone: mapReportWideRows(parsedReportTableResults.DamageDone?.entries, 3),
    topDamageTaken: mapReportWideRows(parsedReportTableResults.DamageTaken?.entries, 3),
    topHealingDone: mapReportWideRows(parsedReportTableResults.Healing?.entries, 3),
    topInterrupts: mapReportWideRows(parsedReportTableResults.Interrupts?.entries, 3),
    topDispels: mapReportWideRows(parsedReportTableResults.Dispels?.entries, 3),
    topSurvivability: mapReportWideRows(parsedReportTableResults.Survivability?.entries, 3),
    totals: {
      ...(parsedReportTableResults.Deaths &&
      typeof sumTableValues(parsedReportTableResults.Deaths.entries) === 'number'
        ? {
            deaths: sumTableValues(parsedReportTableResults.Deaths.entries),
          }
        : {}),
      ...(parsedReportTableResults.DamageTaken &&
      typeof sumTableValues(parsedReportTableResults.DamageTaken.entries) === 'number'
        ? {
            raidDamageTaken: sumTableValues(parsedReportTableResults.DamageTaken.entries),
          }
        : {}),
      ...(parsedReportTableResults.Dispels &&
      typeof sumTableValues(parsedReportTableResults.Dispels.entries) === 'number'
        ? {
            dispels: sumTableValues(parsedReportTableResults.Dispels.entries),
          }
        : {}),
      ...(parsedReportTableResults.Interrupts &&
      typeof sumTableValues(parsedReportTableResults.Interrupts.entries) === 'number'
        ? {
            interrupts: sumTableValues(parsedReportTableResults.Interrupts.entries),
          }
        : {}),
    },
  };
  logTiming('parse report-wide tables', parseReportWideTablesStartedAt, {
    tableTypes: Object.keys(parsedReportTableResults).length,
    playerRows: players.length,
  });

  const phaseMetadataByEncounterId = parseEncounterPhases(report);
  const fightsByEncounterId = new Map<number, FightSummaryRow[]>();

  for (const fight of allEncounterFights) {
    const encounterID = getBossEncounterId(fight);
    if (typeof encounterID !== 'number') continue;
    const existing = fightsByEncounterId.get(encounterID) ?? [];
    existing.push(fight);
    fightsByEncounterId.set(encounterID, existing);
  }

  const summariesByEncounterId = new Map<number, EncounterSummaryRow[]>();
  for (const summary of encounterSummaries) {
    const existing = summariesByEncounterId.get(summary.encounterID) ?? [];
    existing.push(summary);
    summariesByEncounterId.set(summary.encounterID, existing);
  }

  const bossLeaderboardsByFightId = new Map<number, NormalizedLeaderboardEntry[]>();
  for (const entry of bossLeaderboards) {
    if (typeof entry.fightId !== 'number') continue;
    const existing = bossLeaderboardsByFightId.get(entry.fightId) ?? [];
    existing.push(entry);
    bossLeaderboardsByFightId.set(entry.fightId, existing);
  }

  const guildName = asString(asObject(report.guild)?.name);
  const realmName = buildRealmLabel(report);
  const zoneName = asString(asObject(report.zone)?.name);
  const reportStartTime = asNumber(report.startTime) ?? 0;

  const bossPerformances: NormalizedBossPerformance[] = [];

  const encounterIds = new Set<number>([
    ...fightsByEncounterId.keys(),
    ...summariesByEncounterId.keys(),
  ]);

  const perEncounterNormalizationStartedAt = now();
  let parsedEncounterTableCount = 0;
  for (const encounterID of encounterIds) {
    const encounterFights = fightsByEncounterId.get(encounterID) ?? [];
    const encounterSummariesForEncounter = summariesByEncounterId.get(encounterID) ?? [];
    const summaryRows: EncounterSummaryRow[] =
      encounterSummariesForEncounter.length > 0
        ? encounterSummariesForEncounter
        : (() => {
            const fallbackFight = pickEncounterSummaryFight(encounterFights);
            if (!fallbackFight) return [];
            return [
              {
                encounterID,
                bossName: fallbackFight.name,
                fightId: fallbackFight.id,
                kill: fallbackFight.kill,
                tables: {},
                ...(typeof fallbackFight.difficulty === 'number'
                  ? { difficulty: fallbackFight.difficulty }
                  : {}),
              } satisfies EncounterSummaryRow,
            ];
          })();

    for (const summaryFight of summaryRows) {
      const tableNode = asObject(summaryFight.tables);
      const parsedTableResults: Partial<
        Record<TableDataType, { entries: ParsedTableEntry[]; isValidEmpty: boolean }>
      > = {};
      for (const dataType of REPORT_TABLE_DATA_TYPES) {
        const payload = tableNode?.[dataType];
        if (payload === undefined || payload === null) continue;

        parsedTableResults[dataType] = parseTablePayloadDetailed(
          payload,
          dataType,
          (message, context) => {
            logger.warn(
              {
                reportCode: parsed.reportCode,
                fightId: summaryFight.fightId,
                section: `table:${dataType}`,
                context,
              },
              message,
            );
          },
        );
        parsedEncounterTableCount += 1;
      }
      const parsedTables: Partial<Record<TableDataType, ParsedTableEntry[]>> = Object.fromEntries(
        REPORT_TABLE_DATA_TYPES.map((dataType) => [
          dataType,
          parsedTableResults[dataType]?.entries ?? [],
        ]),
      );

      const bossEntries = [...(bossLeaderboardsByFightId.get(summaryFight.fightId) ?? [])].sort(
        (left, right) => right.value - left.value,
      );

      const topBossParse = bossEntries[0];
      const basePerformance = summarizeBossTables(
        summaryFight.bossName,
        summaryFight.fightId,
        parsedTables,
        topBossParse,
      );

      const bestParses = bossEntries.slice(0, 3).flatMap((entry) => {
        const playerName = getNameFromLeaderboard(entry);
        if (!playerName) return [];

        const actorId = getActorIdFromLeaderboard(entry);
        const player =
          (typeof actorId === 'number' ? playerByActorId.get(actorId) : undefined) ??
          playerByName.get(normalizeName(playerName));
        const amount = getAmountFromLeaderboard(entry);
        const metric = getMetricFromLeaderboard(entry);
        const className = getClassFromLeaderboard(entry) ?? player?.className;
        const specName = getSpecFromLeaderboard(entry) ?? player?.specName;

        return [
          {
            playerName,
            parse: entry.value,
            ...(typeof amount === 'number' ? { amount } : {}),
            ...(typeof metric === 'string' && metric.length > 0 ? { metric } : {}),
            ...(className ? { className } : {}),
            ...(specName ? { specName } : {}),
          },
        ];
      });

      const leaderboardByPlayerName = new Map<string, NormalizedLeaderboardEntry>();
      for (const entry of bossEntries) {
        const playerName = getNameFromLeaderboard(entry);
        if (!playerName) continue;
        const key = normalizeName(playerName);
        if (!leaderboardByPlayerName.has(key)) {
          leaderboardByPlayerName.set(key, entry);
        }
      }

      const mapTableRows = (entries: ParsedTableEntry[] | undefined, limit = 3) =>
        takeTopEntries(
          (entries ?? []).filter((entry) => {
            if (!entry.playerName) return false;
            return playerByName.has(normalizeName(entry.playerName));
          }),
          limit,
        ).map((entry) => {
          const player = entry.playerName
            ? playerByName.get(normalizeName(entry.playerName))
            : undefined;
          const leaderboardRow = entry.playerName
            ? leaderboardByPlayerName.get(normalizeName(entry.playerName))
            : undefined;
          const className = getClassFromLeaderboard(leaderboardRow) ?? player?.className;
          const specName = getSpecFromLeaderboard(leaderboardRow) ?? player?.specName;

          return {
            playerName: entry.playerName ?? 'Unknown',
            value: entry.value ?? 0,
            ...(className ? { className } : {}),
            ...(specName ? { specName } : {}),
          };
        });

      const summaryFightRow = encounterFights.find((fight) => fight.id === summaryFight.fightId);
      const difficultyName = getDifficultyLabel(summaryFight.difficulty, report);
      const fightDurationMs = summaryFightRow
        ? summaryFightRow.endTime - summaryFightRow.startTime
        : undefined;
      const fightDate =
        reportStartTime > 0 && summaryFightRow
          ? reportStartTime + summaryFightRow.endTime
          : undefined;

      const recap: BossPerformanceRecap = {
        ...basePerformance,
        encounterId: encounterID,
        // Include difficulty only when defined to satisfy exactOptionalPropertyTypes
        ...(typeof summaryFight.difficulty === 'number'
          ? { difficulty: summaryFight.difficulty }
          : {}),
        ...(difficultyName ? { difficultyName } : {}),
        kill: summaryFight.kill,
        pullCount: encounterFights.length,
        ...(typeof fightDurationMs === 'number' ? { fightDurationMs } : {}),
        ...(typeof fightDate === 'number' ? { fightDate } : {}),
        ...(guildName ? { guildName } : {}),
        ...(realmName ? { realmName } : {}),
        ...(zoneName ? { zoneName } : {}),
        reportUrl: parsed.rawUrl,
        bestParses,
        ...((summaryFightRow && hasDungeonPullData(summaryFightRow)) || reportContainsDungeonPulls
          ? {
              // TODO(dungeon): add dedicated Mythic+/dungeon recap fields derived from dungeonPulls
              // instead of raid-boss phase/table aggregates.
            }
          : {
              ...(() => {
                const deathsFromTable = sumTableValues(parsedTables.Deaths);
                const deaths =
                  typeof deathsFromTable === 'number'
                    ? deathsFromTable
                    : parsedTableResults.Deaths?.isValidEmpty
                      ? 0
                      : getFightDeathsFromRankingsPayload(
                          summaryFight.rankings,
                          summaryFight.fightId,
                        );
                const raidDamageTaken = sumTableValues(parsedTables.DamageTaken);
                const dispelsFromTable = sumTableValues(parsedTables.Dispels);
                const dispels =
                  typeof dispelsFromTable === 'number'
                    ? dispelsFromTable
                    : parsedTableResults.Dispels?.isValidEmpty
                      ? 0
                      : undefined;
                const kicksFromTable = sumTableValues(parsedTables.Interrupts);
                const kicks =
                  typeof kicksFromTable === 'number'
                    ? kicksFromTable
                    : parsedTableResults.Interrupts?.isValidEmpty
                      ? 0
                      : undefined;
                return {
                  ...(typeof deaths === 'number' ? { deaths } : {}),
                  ...(typeof raidDamageTaken === 'number' ? { raidDamageTaken } : {}),
                  ...(typeof dispels === 'number' ? { dispels } : {}),
                  ...(typeof kicks === 'number' ? { kicks } : {}),
                };
              })(),
              fastestPhaseTimes: (() => {
                const selectedFightPhases = computeSelectedFightPhaseTimes(
                  summaryFightRow,
                  phaseMetadataByEncounterId.get(encounterID) ?? [],
                );
                if (selectedFightPhases.length > 0) return selectedFightPhases;
                return computeFastestPhaseTimes(
                  encounterFights,
                  phaseMetadataByEncounterId.get(encounterID) ?? [],
                );
              })(),
              topDamageTaken: mapTableRows(parsedTables.DamageTaken),
              topHealers: bossEntries
                .filter(
                  (entry) => asString(asObject(entry as unknown)?.role)?.toLowerCase() === 'healer',
                )
                .slice(0, 3)
                .flatMap((entry) => {
                  const playerName = getNameFromLeaderboard(entry);
                  if (!playerName) return [];
                  const value = getAmountFromLeaderboard(entry);
                  if (typeof value !== 'number') return [];

                  const actorId = getActorIdFromLeaderboard(entry);
                  const player =
                    (typeof actorId === 'number' ? playerByActorId.get(actorId) : undefined) ??
                    playerByName.get(normalizeName(playerName));
                  const className = getClassFromLeaderboard(entry) ?? player?.className;
                  const specName = getSpecFromLeaderboard(entry) ?? player?.specName;

                  return [
                    {
                      playerName,
                      value,
                      ...(className ? { className } : {}),
                      ...(specName ? { specName } : {}),
                    },
                  ];
                }),
            }),
      };

      bossPerformances.push(recap);
    }
  }
  logTiming('per-encounter boss recap normalization', perEncounterNormalizationStartedAt, {
    encounters: encounterIds.size,
    bossPerformances: bossPerformances.length,
    parsedTables: parsedEncounterTableCount,
  });

  const summaryAssemblyStartedAt = now();
  const normalized = {
    reportCode: parsed.reportCode,
    title: asString(report.title) ?? 'Untitled Report',
    startTime: asNumber(report.startTime) ?? Date.now(),
    endTime: asNumber(report.endTime) ?? Date.now(),
    gameFamily: parsed.gameFamily,
    fights,
    players,
    leaderboards: [...reportLeaderboards, ...bossLeaderboards],
    bossPerformances,
    reportWideRecap,
  } as NormalizedReport;

  if (zoneName) {
    (normalized as NormalizedReport & { zoneName?: string }).zoneName = zoneName;
  }
  logTiming('summary object assembly', summaryAssemblyStartedAt, {
    fights: fights.length,
    players: players.length,
    bossPerformances: bossPerformances.length,
  });

  return normalized;
};

export const normalizeReport = (raw: unknown, parsed: ParsedReportUrl): NormalizedReport =>
  normalizeEnrichedReport({ base: raw }, parsed);

export const retailAdapter = normalizeEnrichedReport;
export const mopClassicAdapter = normalizeEnrichedReport;

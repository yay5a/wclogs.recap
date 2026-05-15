import { createLogger } from '@wcl/shared';
import type { WclGraphqlClient } from '../graphql-client.js';
import {
  parseTablePayloadDetailed,
  type ParsedTableEntry,
  type ParsedTablePayload,
} from '../parsers/table.js';
import type { ReportTableMetrics } from '../pipeline/types.js';
import type { ReportIndexFightRow } from '../pipeline/types.js';
import type { TableDataType } from '../schema-enums.js';

const logger = createLogger('wcl-client');
const RETRYABLE_WCL_STATUSES = new Set([429, 502, 503, 504]);

const TABLE_QUERY = `
query ReportTableByType(
  $code: String!
  $allowUnlisted: Boolean!
  $fightIDs: [Int]
  $dataType: TableDataType!
  $filterExpression: String
) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      table(
        dataType: $dataType
        fightIDs: $fightIDs
        filterExpression: $filterExpression
        translate: false
      )
    }
  }
}`;

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const readWclErrorStatus = (error: unknown): number | undefined => {
  const root = asObject(error);
  const response = asObject(root?.response);
  const status = response?.status ?? root?.status;
  if (typeof status === 'number') return status;

  if (error instanceof Error) {
    const match = error.message.match(/(?:Code:|"status":)\s*(\d{3})/);
    if (match?.[1]) return Number(match[1]);
  }

  return undefined;
};

export const isRetryableWclError = (error: unknown): boolean => {
  const status = readWclErrorStatus(error);
  return typeof status === 'number' && RETRYABLE_WCL_STATUSES.has(status);
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withBackoff = async <T>(
  operation: () => Promise<T>,
  options: {
    baseMs: number;
    maxMs: number;
    retries: number;
    shouldRetry: (error: unknown) => boolean;
    onRetry?: (input: { error: unknown; attempt: number; delayMs: number }) => void;
  },
): Promise<T> => {
  let attempts = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempts >= options.retries || !options.shouldRetry(error)) {
        throw error;
      }

      const delayMs = Math.min(options.maxMs, options.baseMs * 2 ** attempts);
      attempts += 1;
      options.onRetry?.({ error, attempt: attempts, delayMs });
      await delay(delayMs);
    }
  }
};

const getTableNode = (payload: unknown): unknown => {
  const root = payload as { data?: { reportData?: { report?: { table?: unknown } } } };
  return root?.data?.reportData?.report?.table;
};

const sumRows = (rows: ParsedTableEntry[] | undefined): number | undefined => {
  if (!rows) return undefined;
  return rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
};

const filterMetricRows = (rows: ParsedTableEntry[] | undefined): ParsedTableEntry[] =>
  (rows ?? []).filter((row) => typeof row.value === 'number' && row.playerName);

const groupFightIdsByEncounter = (
  fights: ReportIndexFightRow[],
): Map<number, number[]> => {
  const byEncounterId = new Map<number, number[]>();
  for (const fight of fights) {
    const fightIds = byEncounterId.get(fight.encounterId);
    if (fightIds) {
      fightIds.push(fight.id);
    } else {
      byEncounterId.set(fight.encounterId, [fight.id]);
    }
  }
  return byEncounterId;
};

const collectType = async (
  client: WclGraphqlClient,
  input: { reportCode: string; fightIds: number[]; dataType: TableDataType; filterExpression: string },
): Promise<ParsedTablePayload> => {
  const variables = {
    code: input.reportCode,
    allowUnlisted: true,
    fightIDs: input.fightIds,
    dataType: input.dataType,
    filterExpression: input.filterExpression,
  };
  const payload = await withBackoff(
    () => client.request<Record<string, unknown>>(TABLE_QUERY, variables),
    {
      baseMs: 2_000,
      maxMs: 60_000,
      retries: 3,
      shouldRetry: isRetryableWclError,
      onRetry: ({ error, attempt, delayMs }) => {
        logger.warn(
          {
            reportCode: input.reportCode,
            dataType: input.dataType,
            attempt,
            status: readWclErrorStatus(error),
            delayMs,
          },
          'wcl table request retrying',
        );
      },
    },
  );
  return parseTablePayloadDetailed(getTableNode(payload), input.dataType);
};

const TABLE_FILTERS: Record<TableDataType, string> = {
  DamageDone:
    '(encounterID != 0) AND (source.disposition = "friendly") AND (target.disposition = "enemy")',
  DamageTaken:
    '(encounterID != 0) AND (target.disposition = "friendly")',
  Healing:
    '(encounterID != 0) AND (inCategory("healing") = true) AND (source.disposition = "friendly") AND (target.disposition = "friendly")',
  Deaths: '(encounterID != 0) AND (type = "death") AND (target.disposition = "friendly") AND (feign = false)',
  Dispels: '(encounterID != 0) AND (source.disposition = "friendly")',
  Interrupts:
    '(encounterID != 0) AND (type = "interrupt") AND (source.disposition = "friendly") AND (target.disposition = "enemy")',
  Survivability: '(encounterID != 0) AND (target.disposition = "friendly")',
  Summary: '(encounterID != 0)',
};

export const collectTableMetrics = async (
  client: WclGraphqlClient,
  input: {
    reportCode: string;
    completedFightIds: number[];
    completedBossFights?: ReportIndexFightRow[];
  },
): Promise<ReportTableMetrics> => {
  if (input.completedFightIds.length === 0) {
    return {
      topDamageDone: [],
      topHealingDone: [],
      topDamageTaken: [],
      topDeaths: [],
      topInterrupts: [],
      topDispels: [],
      totals: {},
      deathsByFightId: {},
      encounterTopDamageDoneByEncounterId: {},
      encounterTopHealingDoneByEncounterId: {},
      encounterTopDamageTakenByEncounterId: {},
    };
  }

  const [damageDone, damageTaken, healing, deaths, interrupts, dispels] = await Promise.all([
    collectType(client, {
      reportCode: input.reportCode,
      fightIds: input.completedFightIds,
      dataType: 'DamageDone',
      filterExpression: TABLE_FILTERS.DamageDone,
    }),
    collectType(client, {
      reportCode: input.reportCode,
      fightIds: input.completedFightIds,
      dataType: 'DamageTaken',
      filterExpression: TABLE_FILTERS.DamageTaken,
    }),
    collectType(client, {
      reportCode: input.reportCode,
      fightIds: input.completedFightIds,
      dataType: 'Healing',
      filterExpression: TABLE_FILTERS.Healing,
    }),
    collectType(client, {
      reportCode: input.reportCode,
      fightIds: input.completedFightIds,
      dataType: 'Deaths',
      filterExpression: TABLE_FILTERS.Deaths,
    }),
    collectType(client, {
      reportCode: input.reportCode,
      fightIds: input.completedFightIds,
      dataType: 'Interrupts',
      filterExpression: TABLE_FILTERS.Interrupts,
    }),
    collectType(client, {
      reportCode: input.reportCode,
      fightIds: input.completedFightIds,
      dataType: 'Dispels',
      filterExpression: TABLE_FILTERS.Dispels,
    }),
  ]);

  const deathsByFightIdRows = await Promise.all(
    input.completedFightIds.map(async (fightId) => {
      const fightDeaths = await collectType(client, {
        reportCode: input.reportCode,
        fightIds: [fightId],
        dataType: 'Deaths',
        filterExpression: TABLE_FILTERS.Deaths,
      });
      return [fightId, sumRows(fightDeaths.entries) ?? 0] as const;
    }),
  );

  const completedBossFights = input.completedBossFights ?? [];
  const perEncounterRows = await Promise.all(
    [...groupFightIdsByEncounter(completedBossFights).entries()].map(
      async ([encounterId, fightIds]) => {
        const [encounterDamageDone, encounterHealing, encounterDamageTaken] = await Promise.all([
          collectType(client, {
            reportCode: input.reportCode,
            fightIds,
            dataType: 'DamageDone',
            filterExpression: TABLE_FILTERS.DamageDone,
          }),
          collectType(client, {
            reportCode: input.reportCode,
            fightIds,
            dataType: 'Healing',
            filterExpression: TABLE_FILTERS.Healing,
          }),
          collectType(client, {
            reportCode: input.reportCode,
            fightIds,
            dataType: 'DamageTaken',
            filterExpression: TABLE_FILTERS.DamageTaken,
          }),
        ]);

        return [
          encounterId,
          {
            topDamageDone: filterMetricRows(encounterDamageDone.entries),
            topHealingDone: filterMetricRows(encounterHealing.entries),
            topDamageTaken: filterMetricRows(encounterDamageTaken.entries),
          },
        ] as const;
      },
    ),
  );

  const deathsByFightId = Object.fromEntries(deathsByFightIdRows);
  const encounterTopDamageDoneByEncounterId = Object.fromEntries(
    perEncounterRows.map(([encounterId, rows]) => [encounterId, rows.topDamageDone]),
  );
  const encounterTopHealingDoneByEncounterId = Object.fromEntries(
    perEncounterRows.map(([encounterId, rows]) => [encounterId, rows.topHealingDone]),
  );
  const encounterTopDamageTakenByEncounterId = Object.fromEntries(
    perEncounterRows.map(([encounterId, rows]) => [encounterId, rows.topDamageTaken]),
  );
  const deathsTotal = sumRows(deaths.entries);
  const damageTakenTotal = sumRows(damageTaken.entries);
  const interruptsTotal = sumRows(interrupts.entries);
  const dispelsTotal = sumRows(dispels.entries);

  return {
    topDamageDone: filterMetricRows(damageDone.entries),
    topHealingDone: filterMetricRows(healing.entries),
    topDamageTaken: filterMetricRows(damageTaken.entries),
    topDeaths: filterMetricRows(deaths.entries),
    topInterrupts: filterMetricRows(interrupts.entries),
    topDispels: filterMetricRows(dispels.entries),
    totals: {
      ...(typeof deathsTotal === 'number' ? { deaths: deathsTotal } : {}),
      ...(typeof damageTakenTotal === 'number' ? { raidDamageTaken: damageTakenTotal } : {}),
      ...(typeof interruptsTotal === 'number' ? { interrupts: interruptsTotal } : {}),
      ...(typeof dispelsTotal === 'number' ? { dispels: dispelsTotal } : {}),
    },
    deathsByFightId,
    encounterTopDamageDoneByEncounterId,
    encounterTopHealingDoneByEncounterId,
    encounterTopDamageTakenByEncounterId,
  };
};

import type { GameFamily, ReportIndexData, ReportIndexFightRow, ReportSummary } from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
import type { WclGraphqlClient } from '../graphql-client.js';
import { collectMasterData } from '../collectors/master-data-collector.js';
import { collectPlayerDetails } from '../collectors/player-details-collector.js';
import { collectReportIndex } from '../collectors/report-index-collector.js';
import { collectReportRankings } from '../collectors/report-rankings-collector.js';
import { collectTableMetrics } from '../collectors/table-collector.js';
import { normalizeReportRenderModel } from '../normalizers/report-render-model-normalizer.js';
import {
  getReportIndexCacheExpiresAt,
  type ReportIndexCacheReadResult,
  type ReportIndexCacheStore,
} from '../report-index-cache.js';

const logger = createLogger('wcl-client');

interface CollectReportSummaryOptions {
  reportIndexCacheStore?: ReportIndexCacheStore;
}

const getFightModeKey = (fight: ReportIndexFightRow): string | undefined =>
  typeof fight.difficulty === 'number' && typeof fight.size === 'number'
    ? `${fight.difficulty}:${fight.size}`
    : undefined;

const selectPrimaryFightMode = (
  fights: ReportIndexFightRow[],
): { difficulty: number; size: number } | undefined => {
  const counts = new Map<string, { difficulty: number; size: number; count: number }>();
  let best: { difficulty: number; size: number; count: number } | undefined;

  for (const fight of fights) {
    const key = getFightModeKey(fight);
    if (!key || typeof fight.difficulty !== 'number' || typeof fight.size !== 'number') continue;

    const next = counts.get(key) ?? { difficulty: fight.difficulty, size: fight.size, count: 0 };
    next.count += 1;
    counts.set(key, next);
    if (!best || next.count > best.count) best = next;
  }

  return best ? { difficulty: best.difficulty, size: best.size } : undefined;
};

const matchesFightMode = (
  fight: ReportIndexFightRow,
  mode: { difficulty: number; size: number },
): boolean => fight.difficulty === mode.difficulty && fight.size === mode.size;

const scopeIndexToPrimaryFightMode = (index: ReportIndexData): ReportIndexData => {
  const mode = selectPrimaryFightMode(index.completedBossFights);
  if (!mode) return index;

  const completedBossFights = index.completedBossFights.filter((fight) =>
    matchesFightMode(fight, mode),
  );
  if (completedBossFights.length === index.completedBossFights.length) return index;

  return {
    ...index,
    completedBossFights,
    killBossFights: completedBossFights.filter((fight) => fight.kill),
    allBossFights: index.allBossFights.filter((fight) => matchesFightMode(fight, mode)),
  };
};

const collectCachedReportIndex = async (
  client: WclGraphqlClient,
  input: { sourceUrl: string; reportCode: string; gameFamily: GameFamily },
  cacheStore?: ReportIndexCacheStore,
) => {
  const key = { reportCode: input.reportCode, gameFamily: input.gameFamily };
  if (cacheStore) {
    try {
      const cached = await cacheStore.getReportIndex(key);
      logReportIndexCacheRead(key, cached);
      if (cached.status === 'hit') return cached.data;
    } catch (error) {
      logger.warn(
        { ...key, error: serializeError(error) },
        'report index cache read failed; fetching fresh index',
      );
    }
  }

  const index = await collectReportIndex(client, input);
  if (!cacheStore) return index;

  try {
    const expiresAt = getReportIndexCacheExpiresAt(index);
    await cacheStore.saveReportIndex({
      ...key,
      data: index,
      ...(expiresAt ? { expiresAt } : {}),
    });
    logger.info(
      { ...key, ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}) },
      'report_index_cache_write',
    );
  } catch (error) {
    logger.warn(
      { ...key, error: serializeError(error) },
      'report index cache write failed',
    );
  }
  return index;
};

const logReportIndexCacheRead = (
  key: { reportCode: string; gameFamily: GameFamily },
  result: ReportIndexCacheReadResult,
): void => {
  logger.info(
    {
      ...key,
      ...(result.status === 'stale' && result.expiresAt
        ? { expiresAt: result.expiresAt.toISOString() }
        : {}),
    },
    `report_index_cache_${result.status}`,
  );
};

export const collectReportSummaryData = async (
  client: WclGraphqlClient,
  input: { sourceUrl: string; reportCode: string; gameFamily: GameFamily },
  options: CollectReportSummaryOptions = {},
): Promise<ReportSummary> => {
  const index = scopeIndexToPrimaryFightMode(
    await collectCachedReportIndex(client, input, options.reportIndexCacheStore),
  );

  const [masterData, playerDetails, rankings, tableMetrics] = await Promise.all([
    collectMasterData(client, { reportCode: input.reportCode }),
    collectPlayerDetails(client, {
      reportCode: input.reportCode,
      completedFightIds: index.completedBossFights.map((fight) => fight.id),
    }),
    collectReportRankings(client, {
      reportCode: input.reportCode,
      killFightIds: index.killBossFights.map((fight) => fight.id),
    }),
    collectTableMetrics(client, {
      reportCode: input.reportCode,
      completedFightIds: index.completedBossFights.map((fight) => fight.id),
      completedBossFights: index.completedBossFights,
    }),
  ]);

  return normalizeReportRenderModel({
    index,
    masterData,
    playerDetails,
    rankings,
    tableMetrics,
  });
};

import type { GameFamily, ReportSummary } from '@wcl/domain';
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
  const index = await collectCachedReportIndex(client, input, options.reportIndexCacheStore);

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

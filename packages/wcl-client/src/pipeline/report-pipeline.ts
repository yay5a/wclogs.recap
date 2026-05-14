import type { GameFamily, ReportSummary } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { collectMasterData } from '../collectors/master-data-collector.js';
import { collectPlayerDetails } from '../collectors/player-details-collector.js';
import { collectReportIndex } from '../collectors/report-index-collector.js';
import { collectReportRankings } from '../collectors/report-rankings-collector.js';
import { collectTableMetrics } from '../collectors/table-collector.js';
import { normalizeReportRenderModel } from '../normalizers/report-render-model-normalizer.js';

export const collectReportSummaryData = async (
  client: WclGraphqlClient,
  input: { sourceUrl: string; reportCode: string; gameFamily: GameFamily },
): Promise<ReportSummary> => {
  const index = await collectReportIndex(client, input);

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

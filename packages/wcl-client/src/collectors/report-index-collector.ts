import type { GameFamily } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject, asString } from '../parsers/common.js';
import type { ReportIndexData, ReportIndexFightRow } from '../pipeline/types.js';

const REPORT_INDEX_QUERY = `
query ReportIndex($code: String!, $allowUnlisted: Boolean!, $includeRateLimitData: Boolean! = false) {
  rateLimitData @include(if: $includeRateLimitData) {
    limitPerHour
    pointsSpentThisHour
    pointsResetIn
  }
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      title
      startTime
      endTime
      zone {
        id
        name
        difficulties {
          id
          name
          sizes
        }
      }
      fights(killType: All) {
        id
        encounterID
        originalEncounterID
        difficulty
        size
        name
        startTime
        endTime
        kill
        inProgress
      }
    }
  }
}`;

const getReportNode = (payload: unknown): Record<string, unknown> | undefined => {
  const root = asObject(payload);
  const data = asObject(root?.data);
  const reportData = asObject(data?.reportData ?? root?.reportData);
  return asObject(reportData?.report);
};

const toFightRow = (value: unknown): ReportIndexFightRow | undefined => {
  const row = asObject(value);
  if (!row) return undefined;
  const id = asNumber(row.id);
  const encounterId = asNumber(row.encounterID);
  const originalEncounterId = asNumber(row.originalEncounterID);
  const name = asString(row.name);
  const startTime = asNumber(row.startTime);
  const endTime = asNumber(row.endTime);

  const resolvedEncounterId =
    typeof encounterId === 'number' && encounterId > 0
      ? encounterId
      : typeof originalEncounterId === 'number' && originalEncounterId > 0
        ? originalEncounterId
        : undefined;

  if (
    typeof id !== 'number' ||
    typeof resolvedEncounterId !== 'number' ||
    typeof name !== 'string' ||
    typeof startTime !== 'number' ||
    typeof endTime !== 'number'
  ) {
    return undefined;
  }

  const difficulty = asNumber(row.difficulty);
  const size = asNumber(row.size);
  const inProgress = row.inProgress === true;

  return {
    id,
    encounterId: resolvedEncounterId,
    name,
    startTime,
    endTime,
    kill: row.kill === true,
    ...(typeof difficulty === 'number' ? { difficulty } : {}),
    ...(typeof size === 'number' ? { size } : {}),
    ...(inProgress ? { inProgress: true } : {}),
  };
};

export const collectReportIndex = async (
  client: WclGraphqlClient,
  input: { reportCode: string; sourceUrl: string; gameFamily: GameFamily },
): Promise<ReportIndexData> => {
  const payload = await client.request<Record<string, unknown>>(REPORT_INDEX_QUERY, {
    code: input.reportCode,
    allowUnlisted: true,
    includeRateLimitData: true,
  });

  const report = getReportNode(payload);
  if (!report) {
    throw new Error('Unexpected WCL payload shape');
  }

  const title = asString(report.title) ?? 'Untitled Report';
  const startTime = asNumber(report.startTime) ?? Date.now();
  const endTime = asNumber(report.endTime) ?? Date.now();

  const zone = asObject(report.zone);
  const zoneName = asString(zone?.name);
  const zoneId = asNumber(zone?.id);
  const zoneDifficulties = (asArray(zone?.difficulties) ?? []).flatMap((value) => {
    const row = asObject(value);
    const id = asNumber(row?.id);
    const name = asString(row?.name);
    if (typeof id !== 'number' || typeof name !== 'string') return [];
    const sizes = (asArray(row?.sizes) ?? []).flatMap((sizeValue) => {
      const size = asNumber(sizeValue);
      return typeof size === 'number' ? [size] : [];
    });
    return [{ id, name, ...(sizes.length > 0 ? { sizes } : {}) }];
  });

  const allBossFights = (asArray(report.fights) ?? []).flatMap((value) => {
    const parsed = toFightRow(value);
    return parsed ? [parsed] : [];
  });

  const completedBossFights = allBossFights.filter((fight) => fight.inProgress !== true);
  const killBossFights = completedBossFights.filter((fight) => fight.kill);

  return {
    reportCode: input.reportCode,
    sourceUrl: input.sourceUrl,
    gameFamily: input.gameFamily,
    title,
    ...(zoneName ? { zoneName } : {}),
    ...(typeof zoneId === 'number' ? { zoneId } : {}),
    startTime,
    endTime,
    completedBossFights,
    killBossFights,
    allBossFights,
    zoneDifficulties,
  };
};

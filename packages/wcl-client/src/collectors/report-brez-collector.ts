import type { ReportBrezSummary, ReportIndexFightRow } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject } from '../parsers/common.js';
import { parseBrezSummary, type BrezActor } from '../parsers/brez-parser.js';

const REPORT_BREZ_EVENTS_QUERY = `
query ReportBrezEventsPage(
  $code: String!
  $allowUnlisted: Boolean!
  $fightIDs: [Int]
  $limit: Int
  $filterExpression: String
  $startTime: Float
) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      events(
        fightIDs: $fightIDs
        limit: $limit
        dataType: All
        filterExpression: $filterExpression
        startTime: $startTime
        translate: false
        useActorIDs: true
        useAbilityIDs: true
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}
`;

const BREZ_EVENT_LIMIT = 1000;
const MAX_BREZ_EVENT_PAGES = 20;
const BREZ_FILTER_EXPRESSION = `
(
  type = "death"
  AND target.type = "player"
  AND feign != true
)
OR
(
  source.type = "player"
  AND type IN ("cast", "resurrect")
  AND ability.name IN ("Rebirth", "Raise Ally", "Soulstone")
)
`;

const getEventNode = (payload: unknown): Record<string, unknown> | undefined => {
  const root = asObject(payload);
  const data = asObject(root?.data);
  const reportData = asObject(data?.reportData ?? root?.reportData);
  const report = asObject(reportData?.report);
  return asObject(report?.events);
};

const getEventRows = (eventsNode: unknown): unknown[] => {
  const node = asObject(eventsNode);
  return asArray(node?.data) ?? [];
};

const hasBrezData = (summary: ReportBrezSummary): boolean =>
  summary.topCasters.length > 0 || summary.topReceivers.length > 0 || Boolean(summary.fastest);

export const collectReportBrezSummary = async (
  client: WclGraphqlClient,
  input: {
    reportCode: string;
    completedBossFights: ReportIndexFightRow[];
    actors: BrezActor[];
  },
): Promise<ReportBrezSummary | undefined> => {
  if (input.completedBossFights.length === 0) return undefined;

  const completedFightIds = input.completedBossFights.map((fight) => fight.id);
  const fightNameById = new Map(input.completedBossFights.map((fight) => [fight.id, fight.name]));
  const rows: unknown[] = [];
  let startTime: number | undefined;

  for (let page = 0; page < MAX_BREZ_EVENT_PAGES; page += 1) {
    const payload = await client.request<Record<string, unknown>>(REPORT_BREZ_EVENTS_QUERY, {
      code: input.reportCode,
      allowUnlisted: true,
      fightIDs: completedFightIds,
      limit: BREZ_EVENT_LIMIT,
      filterExpression: BREZ_FILTER_EXPRESSION,
      ...(typeof startTime === 'number' ? { startTime } : {}),
    });

    const eventsNode = getEventNode(payload);
    rows.push(...getEventRows(eventsNode));

    const nextPageTimestamp = asNumber(asObject(eventsNode)?.nextPageTimestamp);
    if (typeof nextPageTimestamp !== 'number') break;
    if (typeof startTime === 'number' && nextPageTimestamp <= startTime) break;
    startTime = nextPageTimestamp;
  }

  const summary = parseBrezSummary(rows, input.actors);
  const fightName =
    summary.fastest && summary.fastest.fightID
      ? fightNameById.get(summary.fastest.fightID)
      : undefined;
  const resolvedSummary =
    summary.fastest && fightName
      ? { ...summary, fastest: { ...summary.fastest, fightName } }
      : summary;

  return hasBrezData(resolvedSummary) ? resolvedSummary : undefined;
};

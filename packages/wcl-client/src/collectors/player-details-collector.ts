import type { WclGraphqlClient } from '../graphql-client.js';
import { parsePlayerDetailsPayload, type ParsedPlayerDetail } from '../parsers/report-details.js';

const PLAYER_DETAILS_QUERY = `
query ReportPlayerDetails(
  $code: String!
  $allowUnlisted: Boolean!
  $fightIDs: [Int]
  $killType: KillType
  $includeCombatantInfo: Boolean!
) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      playerDetails(
        fightIDs: $fightIDs
        killType: $killType
        includeCombatantInfo: $includeCombatantInfo
        translate: false
      )
    }
  }
}`;

const getPlayerDetailsNode = (payload: unknown): unknown => {
  const root = payload as { data?: { reportData?: { report?: { playerDetails?: unknown } } } };
  return root?.data?.reportData?.report?.playerDetails;
};

export const collectPlayerDetails = async (
  client: WclGraphqlClient,
  input: { reportCode: string; completedFightIds: number[] },
): Promise<ParsedPlayerDetail[]> => {
  if (input.completedFightIds.length === 0) return [];

  const payload = await client.request<Record<string, unknown>>(PLAYER_DETAILS_QUERY, {
    code: input.reportCode,
    allowUnlisted: true,
    fightIDs: input.completedFightIds,
    killType: 'Encounters',
    includeCombatantInfo: false,
  });

  return parsePlayerDetailsPayload(getPlayerDetailsNode(payload));
};

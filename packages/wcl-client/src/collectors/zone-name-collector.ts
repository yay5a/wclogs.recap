import type { WclGraphqlClient } from '../graphql-client.js';
import { asObject, asString } from '../parsers/common.js';

const ZONE_NAME_QUERY = `
query ZoneName($zoneId: Int!) {
  worldData {
    zone(id: $zoneId) {
      id
      name
    }
  }
}`;

export const collectZoneName = async (
  client: WclGraphqlClient,
  zoneId: number,
): Promise<string | undefined> => {
  const payload = await client.request<Record<string, unknown>>(ZONE_NAME_QUERY, { zoneId });
  const data = asObject((payload as { data?: unknown })?.data);
  const worldData = asObject(data?.worldData);
  const zone = asObject(worldData?.zone);
  return asString(zone?.name);
};

import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject, asString } from '../parsers/common.js';
import type { ReportMasterData } from '../pipeline/types.js';

const MASTER_DATA_QUERY = `
query ReportMasterData($code: String!, $allowUnlisted: Boolean!) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      masterData {
        actors(type: "Player") {
          id
          name
          subType
          server
        }
      }
    }
  }
}`;

export const collectMasterData = async (
  client: WclGraphqlClient,
  input: { reportCode: string },
): Promise<ReportMasterData> => {
  const payload = await client.request<Record<string, unknown>>(MASTER_DATA_QUERY, {
    code: input.reportCode,
    allowUnlisted: true,
  });

  const data = asObject((payload as { data?: unknown })?.data);
  const report = asObject(asObject(data?.reportData)?.report);
  const masterData = asObject(report?.masterData);

  const actors = (asArray(masterData?.actors) ?? []).flatMap((value) => {
    const row = asObject(value);
    const name = asString(row?.name);
    if (!name) return [];
    const id = asNumber(row?.id);
    const className = asString(row?.subType);
    const server = asString(row?.server);
    return [
      {
        name,
        ...(typeof id === 'number' ? { id } : {}),
        ...(className ? { className } : {}),
        ...(server ? { server } : {}),
      },
    ];
  });

  return { actors };
};

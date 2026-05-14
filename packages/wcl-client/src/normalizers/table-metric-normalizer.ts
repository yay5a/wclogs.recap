import type { ReportMetricRow } from '@wcl/domain';
import type { ParsedPlayerDetail } from '../parsers/report-details.js';
import type { ParsedTableEntry } from '../parsers/table.js';
import type { ReportMasterData } from '../pipeline/types.js';

const normalizeNameKey = (value: string): string => value.trim().toLowerCase();

const toMetaByName = (
  masterData: ReportMasterData,
  playerDetails: ParsedPlayerDetail[],
): Map<string, { className?: string; specName?: string }> => {
  const byName = new Map<string, { className?: string; specName?: string }>();

  for (const actor of masterData.actors) {
    byName.set(normalizeNameKey(actor.name), {
      ...(actor.className ? { className: actor.className } : {}),
    });
  }

  for (const detail of playerDetails) {
    const key = normalizeNameKey(detail.name);
    const existing = byName.get(key) ?? {};
    byName.set(key, {
      ...existing,
      ...(existing.className ? {} : detail.className ? { className: detail.className } : {}),
      ...(detail.specName ? { specName: detail.specName } : {}),
    });
  }

  return byName;
};

export const normalizeTableMetricRows = (
  rows: ParsedTableEntry[],
  masterData: ReportMasterData,
  playerDetails: ParsedPlayerDetail[],
  limit = 3,
): ReportMetricRow[] => {
  const metadataByName = toMetaByName(masterData, playerDetails);

  return [...rows]
    .filter((row) => row.playerName)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, limit)
    .map((row) => {
      const playerName = row.playerName ?? 'Unknown';
      const metadata = metadataByName.get(normalizeNameKey(playerName));
      return {
        playerName,
        value: row.value,
        ...(typeof row.activeTimeMs === 'number' ? { activeTimeMs: row.activeTimeMs } : {}),
        ...(metadata?.className ? { className: metadata.className } : {}),
        ...(metadata?.specName ? { specName: metadata.specName } : {}),
      };
    });
};

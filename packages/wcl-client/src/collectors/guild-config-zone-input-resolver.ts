import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject, asString } from '../parsers/common.js';
import type { GuildRankInput } from '../pipeline/types.js';

const ZONE_RESOLVER_QUERY = `
query ZoneResolver($zoneId: Int!) {
  worldData {
    zone(id: $zoneId) {
      id
      name
      difficulties {
        id
        name
        sizes
      }
      encounters {
        id
        name
      }
      partitions {
        id
        name
        compactName
        default
      }
    }
  }
}`;

const ZONE_LIST_FALLBACK_QUERY = `
query ZoneListFallback {
  worldData {
    zones {
      id
      name
    }
  }
}`;

const parseRequestedSize = (raw: string): number | undefined => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '10man') return 10;
  if (normalized === '25man') return 25;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) ? numeric : undefined;
};

export interface ResolvedGuildRankInput extends GuildRankInput {
  difficultyId: number;
  sizeValue: number;
  difficultyLabel: string;
  sizeLabel: string;
  zoneName: string;
  totalEncounters: number;
  partitionId?: number;
  encounters: Array<{ id: number; name: string }>;
}

export const resolveGuildConfigZoneInput = async (
  client: WclGraphqlClient,
  input: GuildRankInput,
): Promise<ResolvedGuildRankInput> => {
  const payload = await client.request<Record<string, unknown>>(ZONE_RESOLVER_QUERY, {
    zoneId: input.zoneId,
  });

  const worldData = asObject((payload as { data?: Record<string, unknown> })?.data)?.worldData;
  const zone = asObject(asObject(worldData)?.zone);
  const requestedDifficulty = input.difficulty.trim().toLowerCase();
  const requestedSizeValue = parseRequestedSize(input.size);
  if (typeof requestedSizeValue !== 'number') {
    throw new Error(`Unsupported size option: ${input.size}`);
  }

  if (!zone) {
    const fallbackPayload = await client.request<Record<string, unknown>>(
      ZONE_LIST_FALLBACK_QUERY,
      {},
    );
    const worldDataFallback = asObject(
      (fallbackPayload as { data?: Record<string, unknown> })?.data,
    )?.worldData;
    const zones = asArray(asObject(worldDataFallback)?.zones) ?? [];
    const zoneFromList = zones
      .map((value) => asObject(value))
      .find((row) => asNumber(row?.id) === input.zoneId);

    if (!zoneFromList) {
      throw new Error(`Configured zone ${input.zoneId} is unavailable in world data.`);
    }

    const mappedDifficultyId =
      requestedDifficulty === 'normal' ? 3 : requestedDifficulty === 'heroic' ? 4 : undefined;

    if (typeof mappedDifficultyId !== 'number') {
      throw new Error(
        `Difficulty ${input.difficulty} is not supported for fallback zone resolution.`,
      );
    }

    const zoneName = asString(zoneFromList.name) ?? `Zone ${input.zoneId}`;
    const difficultyLabel =
      requestedDifficulty === 'normal'
        ? 'Normal'
        : requestedDifficulty === 'heroic'
          ? 'Heroic'
          : input.difficulty;

    return {
      ...input,
      difficultyId: mappedDifficultyId,
      sizeValue: requestedSizeValue,
      difficultyLabel,
      sizeLabel: `${requestedSizeValue}man`,
      zoneName,
      totalEncounters: 0,
      encounters: [],
    };
  }

  const zoneName = asString(zone.name) ?? `Zone ${input.zoneId}`;

  const difficulties = (asArray(zone.difficulties) ?? []).flatMap((value) => {
    const row = asObject(value);
    const id = asNumber(row?.id);
    const name = asString(row?.name);
    if (typeof id !== 'number' || typeof name !== 'string') return [];
    const sizes = (asArray(row?.sizes) ?? []).flatMap((sizeValue) => {
      const parsed = asNumber(sizeValue);
      return typeof parsed === 'number' ? [parsed] : [];
    });
    return [{ id, name, sizes }];
  });

  const selectedDifficulty = difficulties.find(
    (row) => row.name.trim().toLowerCase() === requestedDifficulty,
  );
  if (!selectedDifficulty) {
    throw new Error(`Difficulty ${input.difficulty} is not valid for zone ${zoneName}.`);
  }

  if (
    selectedDifficulty.sizes.length > 0 &&
    !selectedDifficulty.sizes.includes(requestedSizeValue)
  ) {
    throw new Error(
      `Size ${input.size} is not supported for ${selectedDifficulty.name} in zone ${zoneName}.`,
    );
  }

  const encounters = (asArray(zone.encounters) ?? []).flatMap((value) => {
    const row = asObject(value);
    const id = asNumber(row?.id);
    const name = asString(row?.name);
    return typeof id === 'number' && name ? [{ id, name }] : [];
  });
  const defaultPartitionId = (asArray(zone.partitions) ?? [])
    .map((value) => asObject(value))
    .find((row) => row?.default === true);
  const partitionId = asNumber(defaultPartitionId?.id);

  return {
    ...input,
    difficultyId: selectedDifficulty.id,
    sizeValue: requestedSizeValue,
    difficultyLabel: selectedDifficulty.name,
    sizeLabel: `${requestedSizeValue}man`,
    zoneName,
    totalEncounters: encounters.length,
    ...(typeof partitionId === 'number' ? { partitionId } : {}),
    encounters,
  };
};

import {
  parseGameFamily,
  type GameFamily,
  type ReportIndexData,
  type ReportIndexFightRow,
} from '@wcl/domain';
import { ReportIndexCacheModel } from '../models/report-index-cache-model.js';

type ReportIndexCacheKey = {
  reportCode: string;
  gameFamily: GameFamily;
};

type ReportIndexCacheReadResult =
  | { status: 'hit'; data: ReportIndexData }
  | { status: 'miss' }
  | { status: 'stale'; expiresAt?: Date };

type SaveReportIndexInput = ReportIndexCacheKey & {
  data: ReportIndexData;
  expiresAt?: Date;
};

type ReportIndexZoneDifficulty = ReportIndexData['zoneDifficulties'][number];

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const parseNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const values = value.map((item) => asFiniteNumber(item));
  return values.every((item): item is number => typeof item === 'number') ? values : undefined;
};

const parseFightRow = (value: unknown): ReportIndexFightRow | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const id = asFiniteNumber(raw.id);
  const encounterId = asFiniteNumber(raw.encounterId);
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  const startTime = asFiniteNumber(raw.startTime);
  const endTime = asFiniteNumber(raw.endTime);
  if (
    typeof id !== 'number' ||
    typeof encounterId !== 'number' ||
    !name ||
    typeof startTime !== 'number' ||
    typeof endTime !== 'number' ||
    typeof raw.kill !== 'boolean'
  ) {
    return null;
  }

  return {
    id,
    encounterId,
    name,
    startTime,
    endTime,
    kill: raw.kill,
    ...(typeof raw.difficulty === 'number' && Number.isFinite(raw.difficulty)
      ? { difficulty: raw.difficulty }
      : {}),
    ...(typeof raw.size === 'number' && Number.isFinite(raw.size) ? { size: raw.size } : {}),
    ...(typeof raw.inProgress === 'boolean' ? { inProgress: raw.inProgress } : {}),
  };
};

const parseFightRows = (value: unknown): ReportIndexFightRow[] | null => {
  if (!Array.isArray(value)) return null;
  const rows = value.map((row) => parseFightRow(row));
  return rows.every((row): row is ReportIndexFightRow => row !== null) ? rows : null;
};

const parseZoneDifficulty = (value: unknown): ReportIndexZoneDifficulty | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const id = asFiniteNumber(raw.id);
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  if (typeof id !== 'number' || !name) return null;

  const sizes = parseNumberArray(raw.sizes);
  return {
    id,
    name,
    ...(sizes ? { sizes } : {}),
  };
};

const parseZoneDifficulties = (value: unknown): ReportIndexZoneDifficulty[] | null => {
  if (!Array.isArray(value)) return null;
  const rows = value.map((row) => parseZoneDifficulty(row));
  return rows.every((row): row is ReportIndexZoneDifficulty => row !== null) ? rows : null;
};

const parseReportIndexData = (value: unknown): ReportIndexData | null => {
  const raw = asObject(value);
  if (!raw) return null;

  const gameFamily = parseGameFamily(raw.gameFamily);
  const startTime = asFiniteNumber(raw.startTime);
  const endTime = asFiniteNumber(raw.endTime);
  const completedBossFights = parseFightRows(raw.completedBossFights);
  const killBossFights = parseFightRows(raw.killBossFights);
  const allBossFights = parseFightRows(raw.allBossFights);
  const zoneDifficulties = parseZoneDifficulties(raw.zoneDifficulties);

  if (
    typeof raw.reportCode !== 'string' ||
    typeof raw.sourceUrl !== 'string' ||
    !gameFamily ||
    typeof raw.title !== 'string' ||
    typeof startTime !== 'number' ||
    typeof endTime !== 'number' ||
    !completedBossFights ||
    !killBossFights ||
    !allBossFights ||
    !zoneDifficulties
  ) {
    return null;
  }

  return {
    reportCode: raw.reportCode,
    sourceUrl: raw.sourceUrl,
    gameFamily,
    title: raw.title,
    ...(typeof raw.zoneName === 'string' ? { zoneName: raw.zoneName } : {}),
    ...(typeof raw.zoneId === 'number' && Number.isFinite(raw.zoneId)
      ? { zoneId: raw.zoneId }
      : {}),
    startTime,
    endTime,
    completedBossFights,
    killBossFights,
    allBossFights,
    zoneDifficulties,
  };
};

export class MongoReportIndexCacheStore {
  public async getReportIndex(input: ReportIndexCacheKey): Promise<ReportIndexCacheReadResult> {
    const found = await ReportIndexCacheModel.findOne({
      reportCode: input.reportCode,
      gameFamily: input.gameFamily,
    }).lean();
    const raw = asObject(found);
    if (!raw) return { status: 'miss' };
    if (raw.expiresAt instanceof Date && raw.expiresAt <= new Date()) {
      return { status: 'stale', expiresAt: raw.expiresAt };
    }
    const data = parseReportIndexData(raw.data);
    return data ? { status: 'hit', data } : { status: 'miss' };
  }

  public async saveReportIndex(input: SaveReportIndexInput): Promise<void> {
    const set: Record<string, unknown> = {
      reportCode: input.reportCode,
      gameFamily: input.gameFamily,
      data: input.data,
    };
    if (input.expiresAt) set.expiresAt = input.expiresAt;

    await ReportIndexCacheModel.findOneAndUpdate(
      { reportCode: input.reportCode, gameFamily: input.gameFamily },
      {
        $set: set,
        ...(input.expiresAt ? {} : { $unset: { expiresAt: '' } }),
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
}

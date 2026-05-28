import {
  asArray,
  asNumber,
  asObject,
  asString,
  defaultDebugWarn,
  describePayloadShape,
  parseUnknownJson,
} from './common.js';
import type { DebugWarn } from './common.js';
import type { TableDataType } from '../schema-enums.js';

export interface ParsedTableEntry {
  dataType: TableDataType;
  playerId?: number;
  playerName?: string;
  actorType?: string;
  activeTimeMs?: number;
  value: number;
}

export interface ParsedTablePayload {
  entries: ParsedTableEntry[];
  isValidEmpty: boolean;
}

const VALUE_KEY_BY_TYPE: Record<TableDataType, string[]> = {
  DamageDone: ['total', 'amount', 'value'],
  DamageTaken: ['total', 'amount', 'value'],
  Healing: ['total', 'amount', 'value'],
  Casts: ['casts', 'uses', 'total', 'amount', 'value'],
  Deaths: ['deaths', 'amount', 'total', 'value'],
  Interrupts: ['interrupts', 'amount', 'total', 'value'],
  Dispels: ['dispels', 'total', 'amount', 'value'],
  Survivability: ['survivability', 'value', 'percentile'],
  Summary: ['value', 'amount', 'total'],
};

const findValue = (entry: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = asNumber(entry[key]);
    if (typeof value === 'number') return value;
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const unwrapTableRows = (rows: readonly unknown[]): unknown[] =>
  rows.flatMap((row) => {
    if (isRecord(row) && Array.isArray(row.entries)) {
      return unwrapTableRows(row.entries);
    }

    return [row];
  });

const describeMalformedTableRow = (entry: Record<string, unknown>) => {
  const rowKeys = Object.keys(entry).sort();
  const rowKey = rowKeys.length === 1 ? rowKeys[0] : undefined;
  const nested = rowKey ? asObject(entry[rowKey]) : undefined;
  const nestedKeys = nested ? Object.keys(nested).sort() : [];

  return {
    rowShape: describePayloadShape(entry),
    rowKeys,
    ...(rowKey ? { rowKey } : {}),
    ...(nestedKeys.length > 0 ? { nestedKeys } : {}),
  };
};

const parseNestedDetailsRows = (
  row: Record<string, unknown>,
  dataType: TableDataType,
): ParsedTableEntry[] => {
  if (dataType !== 'Dispels' && dataType !== 'Interrupts') return [];

  const details = asArray(row.details);
  if (!details || details.length === 0) return [];

  return details.flatMap((detail) => {
    const detailRow = asObject(detail);
    if (!detailRow) return [];

    const value = findValue(detailRow, VALUE_KEY_BY_TYPE[dataType]);
    if (typeof value !== 'number') return [];

    const actor = asObject(detailRow.actor);
    const playerName = asString(detailRow.name) ?? asString(actor?.name);
    const actorType = asString(actor?.type);
    const playerId =
      asNumber(detailRow.id) ??
      asNumber(detailRow.playerID) ??
      asNumber(detailRow.playerId) ??
      asNumber(detailRow.guid);

    return [
      {
        dataType,
        value,
        ...(typeof playerId === 'number' ? { playerId } : {}),
        ...(playerName ? { playerName } : {}),
        ...(actorType ? { actorType } : {}),
      },
    ];
  });
};

const isDeathsEventRow = (entry: Record<string, unknown>): boolean => {
  if (typeof asNumber(entry.timestamp) !== 'number') return false;
  const hasDeathPayload =
    Array.isArray(asArray(entry.events)) ||
    Array.isArray(asArray(entry.deathWindow)) ||
    typeof asNumber(entry.overkill) === 'number' ||
    asObject(entry.killingBlow) !== undefined;

  return hasDeathPayload;
};

const parseDeathsEventRow = (entry: Record<string, unknown>): ParsedTableEntry[] => {
  const actor = asObject(entry.actor);
  const playerName = asString(entry.name) ?? asString(actor?.name);
  const actorType = asString(actor?.type);
  const playerId =
    asNumber(entry.id) ??
    asNumber(entry.playerID) ??
    asNumber(entry.playerId) ??
    asNumber(entry.guid);

  return [
    {
      dataType: 'Deaths',
      value: 1,
      ...(typeof playerId === 'number' ? { playerId } : {}),
      ...(playerName ? { playerName } : {}),
      ...(actorType ? { actorType } : {}),
    },
  ];
};

const getTableEntries = (
  payload: unknown,
  dataType: TableDataType,
  warn: DebugWarn,
): { rows: unknown[]; isValidShape: boolean } => {
  const root = asObject(payload);
  if (!root) {
    const rows = asArray(payload) ?? [];
    if (payload !== undefined && payload !== null && rows.length === 0) {
      warn(`table parser (${dataType} payload): unrecognized payload shape`, {
        payloadShape: describePayloadShape(payload),
      });
    }
    return { rows, isValidShape: rows.length > 0 };
  }

  const data = asObject(root.data);
  const table = asObject(root.table);
  const details = asObject(root.details);

  const rows = [
    ...(asArray(root.entries) ?? []),
    ...(asArray(root.composition) ?? []),
    ...(asArray(root.data) ?? []),
    ...(asArray(data?.entries) ?? []),
    ...(asArray(data?.data) ?? []),
    ...(asArray(root.players) ?? []),
    ...(asArray(table?.entries) ?? []),
    ...(asArray(table?.data) ?? []),
    ...(asArray(details?.entries) ?? []),
  ];

  if (dataType === 'Survivability') {
    const players = asArray(data?.players) ?? [];
    const actorTotals = asArray(data?.actortotals) ?? [];
    const hasSurvivabilityEnvelope =
      Array.isArray(asArray(data?.players)) ||
      Array.isArray(asArray(data?.fights)) ||
      Array.isArray(asArray(data?.actortotals)) ||
      Array.isArray(asArray(data?.abilitytotals));
    if (hasSurvivabilityEnvelope) {
      return {
        rows: actorTotals.length > 0 ? actorTotals : players.length > 0 ? players : [],
        isValidShape: true,
      };
    }
  }

  const hasExplicitEmptyEntries =
    Array.isArray(asArray(root.entries)) || Array.isArray(asArray(data?.entries));

  if (rows.length === 0) {
    if (!hasExplicitEmptyEntries) {
      warn(`table parser (${dataType} payload): unrecognized payload shape`, {
        payloadShape: describePayloadShape(payload),
      });
    }
    return { rows, isValidShape: hasExplicitEmptyEntries };
  }

  return { rows, isValidShape: true };
};

export const parseTablePayloadDetailed = (
  payload: unknown,
  dataType: TableDataType,
  warn: DebugWarn = defaultDebugWarn,
): ParsedTablePayload => {
  const parsed = parseUnknownJson(payload, warn, `table:${dataType}`);
  const { rows, isValidShape } = getTableEntries(parsed, dataType, warn);

  const entries = unwrapTableRows(rows).flatMap((row) => {
    const entry = asObject(row);
    if (!entry) return [];

    const nestedDetailEntries = parseNestedDetailsRows(entry, dataType);
    if (nestedDetailEntries.length > 0) {
      return nestedDetailEntries;
    }

    // WCL table rows vary across report types; probe multiple keys for totals and IDs.
    const value = findValue(entry, VALUE_KEY_BY_TYPE[dataType]);
    if (typeof value !== 'number') {
      if (dataType === 'Deaths' && isDeathsEventRow(entry)) {
        return parseDeathsEventRow(entry);
      }

      // Survivability payloads often include player/fight metadata rows that are valid but not
      // currently rendered in the report card.
      if (dataType === 'Survivability') {
        return [];
      }

      warn(`table parser (${dataType} payload): skipped malformed row`, describeMalformedTableRow(entry));
      return [];
    }

    const actor = asObject(entry.actor);
    const playerId =
      asNumber(entry.id) ??
      asNumber(entry.playerID) ??
      asNumber(entry.playerId) ??
      asNumber(entry.guid);
    const playerName = asString(entry.name) ?? asString(actor?.name);
    const actorType = asString(actor?.type);
    const activeTimeMs = asNumber(entry.activeTimeMs) ?? asNumber(entry.activeTime);

    const parsedEntry: ParsedTableEntry = {
      dataType,
      value,
      ...(typeof playerId === 'number' ? { playerId } : {}),
      ...(playerName ? { playerName } : {}),
      ...(actorType ? { actorType } : {}),
      ...(typeof activeTimeMs === 'number' && activeTimeMs > 0 ? { activeTimeMs } : {}),
    };
    return [parsedEntry];
  });
  return {
    entries,
    isValidEmpty: isValidShape && rows.length === 0,
  };
};

export const parseTablePayload = (
  payload: unknown,
  dataType: TableDataType,
  warn: DebugWarn = defaultDebugWarn,
): ParsedTableEntry[] => parseTablePayloadDetailed(payload, dataType, warn).entries;

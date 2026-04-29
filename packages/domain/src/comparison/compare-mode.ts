export const COMPARE_MODES = ['character', 'mixed'] as const;

export type CompareMode = (typeof COMPARE_MODES)[number];

export type CompareModeSource = 'command' | 'guild-default' | 'system-default';

export const DEFAULT_COMPARE_MODE: CompareMode = 'character';

export const isCompareMode = (value: unknown): value is CompareMode =>
  typeof value === 'string' &&
  (COMPARE_MODES as readonly string[]).includes(value);

export const parseCompareMode = (value: unknown): CompareMode | undefined =>
  isCompareMode(value) ? value : undefined;

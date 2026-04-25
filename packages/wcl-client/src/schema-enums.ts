export const KILL_TYPES = [
    "All",
    "Encounters",
    "Kills",
    "Trash",
    "Wipes",
] as const;

export type KillType = (typeof KILL_TYPES)[number];

export const TABLE_DATA_TYPES = [
    "DamageDone",
    "DamageTaken",
    "Healing",
    "Deaths",
    "Dispels",
    "Interrupts",
    "Survivability",
    "Summary",
] as const;

export type TableDataType = (typeof TABLE_DATA_TYPES)[number];

// Subset currently used by this client for report/encounter table calls.
export const REPORT_TABLE_DATA_TYPES = [
    "DamageDone",
    "DamageTaken",
    "Healing",
    "Deaths",
    "Dispels",
    "Interrupts",
    "Survivability",
] as const satisfies readonly TableDataType[];

export const REPORT_RECAP_TABLE_DATA_TYPES = [
    "DamageDone",
    "DamageTaken",
    "Healing",
    "Deaths",
    "Dispels",
    "Interrupts",
] as const satisfies readonly TableDataType[];

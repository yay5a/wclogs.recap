const REPORT_ENCOUNTER_PREFIX = 'rpt:enc';
const MAX_CUSTOM_ID_LENGTH = 100;
const REPORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;

export type ReportEncounterCustomIdParseResult =
  | { ok: true; reportCode: string; encounterId: number }
  | { ok: false };

const isValidEncounterId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && (value > 0 || value === -1);

export const makeReportEncounterCustomId = (input: {
  reportCode: string;
  encounterId: number;
}): string => {
  if (!isValidEncounterId(input.encounterId)) {
    throw new Error('Invalid report encounter id');
  }
  const customId = `${REPORT_ENCOUNTER_PREFIX}:${input.reportCode}:${input.encounterId}`;

  if (!parseReportEncounterCustomId(customId).ok) {
    throw new Error('Invalid report encounter custom_id');
  }

  return customId;
};

export const isReportEncounterCustomIdCandidate = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(`${REPORT_ENCOUNTER_PREFIX}:`);

export const parseReportEncounterCustomId = (
  customId: unknown,
): ReportEncounterCustomIdParseResult => {
  if (typeof customId !== 'string') return { ok: false };
  if (customId.length > MAX_CUSTOM_ID_LENGTH) return { ok: false };

  const parts = customId.split(':');
  if (parts.length !== 4) return { ok: false };

  const scope = parts[0];
  const action = parts[1];
  const reportCode = parts[2];
  const encounterIdText = parts[3];

  if (scope !== 'rpt' || action !== 'enc' || !reportCode || !encounterIdText) {
    return { ok: false };
  }
  if (!REPORT_CODE_PATTERN.test(reportCode)) return { ok: false };

  const encounterId = Number(encounterIdText);
  if (!isValidEncounterId(encounterId)) {
    return { ok: false } as const;
  }
  if (!Number.isInteger(encounterId) || encounterId == 0) return { ok: false };

  return { ok: true, reportCode, encounterId };
};

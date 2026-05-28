const PREFIX = 'rpt';
const ACTION = 'enc';
const MAX_CUSTOM_ID_LENGTH = 100;
const REPORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;

export type ReportEncounterCustomId =
  | { ok: true; reportCode: string; encounterId: number }
  | { ok: false };

export const makeReportEncounterCustomId = (input: {
  reportCode: string;
  encounterId: number;
}): string => `${PREFIX}:${ACTION}:${input.reportCode}:${input.encounterId}`;

export const isReportEncounterCustomIdCandidate = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(`${PREFIX}:${ACTION}:`);

export const parseReportEncounterCustomId = (value: unknown): ReportEncounterCustomId => {
  if (!isReportEncounterCustomIdCandidate(value)) return { ok: false };
  if (value.length > MAX_CUSTOM_ID_LENGTH) return { ok: false };

  const parts = value.split(':');
  if (parts.length !== 4) return { ok: false };

  const [prefix, action, reportCode, rawEncounterId] = parts;
  if (prefix !== PREFIX || action !== ACTION) return { ok: false };
  if (!reportCode || !REPORT_CODE_PATTERN.test(reportCode)) return { ok: false };

  const encounterId = Number(rawEncounterId);
  if (!Number.isSafeInteger(encounterId) || encounterId <= 0) return { ok: false };

  return { ok: true, reportCode, encounterId };
};

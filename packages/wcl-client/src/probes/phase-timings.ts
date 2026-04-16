import { asArray, asNumber, asObject, asString } from '../parsers/common.js';

export interface EncounterPhaseMetadata {
  id: number;
  name: string;
  isIntermission?: boolean;
}

export interface EncounterFightForTimings {
  id: number;
  encounterID: number;
  startTime: number;
  endTime: number;
  kill: boolean;
  phaseTransitions: Array<{ id: number; startTime: number }>;
}

export interface FightPhaseWindow {
  phaseId: number;
  phaseName?: string;
  isIntermission?: boolean;
  phaseStartTime: number;
  phaseEndTime: number;
  durationMs: number;
}

export interface EncounterAttemptPhaseTimings {
  fightId: number;
  kill: boolean;
  startTime: number;
  endTime: number;
  fightDurationMs: number;
  phaseWindows: FightPhaseWindow[];
}

interface PhaseDurationSummary {
  phaseId: number;
  phaseName?: string;
  averageDurationMs: number;
  medianDurationMs: number;
  fastestDurationMs: number;
  slowestDurationMs: number;
}

export interface EncounterPhaseTimingFixture {
  encounterId: number;
  attempts: EncounterAttemptPhaseTimings[];
  summary: {
    totalAttempts: number;
    killCount: number;
    wipeCount: number;
    latestKillFightId?: number;
    latestPullFightId?: number;
    nonIntermissionPhaseStats: PhaseDurationSummary[];
  };
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
  }
  return sorted[middle]!;
};

export const deriveEncounterPhaseTimes = (args: {
  encounterId: number;
  fights: EncounterFightForTimings[];
  metadata: EncounterPhaseMetadata[];
}): EncounterPhaseTimingFixture => {
  const phaseById = new Map<number, EncounterPhaseMetadata>(
    args.metadata.map((row) => [row.id, row]),
  );

  const attempts = args.fights
    .filter((fight) => fight.encounterID === args.encounterId)
    .sort((left, right) => left.startTime - right.startTime)
    .map((fight): EncounterAttemptPhaseTimings => {
      const transitions = [...fight.phaseTransitions]
        .filter(
          (transition) =>
            transition.startTime > fight.startTime && transition.startTime < fight.endTime,
        )
        .sort((left, right) => left.startTime - right.startTime);

      const phaseWindows: FightPhaseWindow[] = [];
      let currentPhaseId = 1;
      let currentStart = fight.startTime;

      for (const transition of transitions) {
        const phaseInfo = phaseById.get(currentPhaseId);
        phaseWindows.push({
          phaseId: currentPhaseId,
          ...(phaseInfo?.name ? { phaseName: phaseInfo.name } : {}),
          ...(phaseInfo && 'isIntermission' in phaseInfo
            ? { isIntermission: phaseInfo.isIntermission === true }
            : {}),
          phaseStartTime: currentStart,
          phaseEndTime: transition.startTime,
          durationMs: transition.startTime - currentStart,
        });

        currentPhaseId = transition.id;
        currentStart = transition.startTime;
      }

      const finalInfo = phaseById.get(currentPhaseId);
      phaseWindows.push({
        phaseId: currentPhaseId,
        ...(finalInfo?.name ? { phaseName: finalInfo.name } : {}),
        ...(finalInfo && 'isIntermission' in finalInfo
          ? { isIntermission: finalInfo.isIntermission === true }
          : {}),
        phaseStartTime: currentStart,
        phaseEndTime: fight.endTime,
        durationMs: fight.endTime - currentStart,
      });

      return {
        fightId: fight.id,
        kill: fight.kill,
        startTime: fight.startTime,
        endTime: fight.endTime,
        fightDurationMs: fight.endTime - fight.startTime,
        phaseWindows,
      };
    });

  const nonIntermissionDurations = new Map<number, number[]>();
  for (const attempt of attempts) {
    for (const phase of attempt.phaseWindows) {
      if (phase.durationMs <= 0 || phase.isIntermission === true) {
        continue;
      }
      const values = nonIntermissionDurations.get(phase.phaseId) ?? [];
      values.push(phase.durationMs);
      nonIntermissionDurations.set(phase.phaseId, values);
    }
  }

  const latestAttempt = attempts[attempts.length - 1];
  const latestKill = [...attempts].reverse().find((attempt) => attempt.kill);

  return {
    encounterId: args.encounterId,
    attempts,
    summary: {
      totalAttempts: attempts.length,
      killCount: attempts.filter((attempt) => attempt.kill).length,
      wipeCount: attempts.filter((attempt) => !attempt.kill).length,
      ...(latestKill ? { latestKillFightId: latestKill.fightId } : {}),
      ...(latestAttempt ? { latestPullFightId: latestAttempt.fightId } : {}),
      nonIntermissionPhaseStats: [...nonIntermissionDurations.entries()]
        .map(([phaseId, durations]): PhaseDurationSummary => {
          const total = durations.reduce((sum, value) => sum + value, 0);
          const fastestDurationMs = Math.min(...durations);
          const slowestDurationMs = Math.max(...durations);
          const phaseInfo = phaseById.get(phaseId);

          return {
            phaseId,
            ...(phaseInfo?.name ? { phaseName: phaseInfo.name } : {}),
            averageDurationMs: Math.round(total / durations.length),
            medianDurationMs: median(durations),
            fastestDurationMs,
            slowestDurationMs,
          };
        })
        .sort((left, right) => left.phaseId - right.phaseId),
    },
  };
};

export const summarizeRankingsPayload = (payload: unknown): { logLine: string } => {
  const asRecord = asObject(payload);
  const rootType = Array.isArray(payload) ? 'array' : payload === null ? 'null' : typeof payload;

  const topLevelKeys = asRecord ? Object.keys(asRecord) : [];
  const dataRows = asArray(asRecord?.data);
  const firstRow = dataRows?.[0];
  const firstRecord = asObject(firstRow);
  const encounter = asObject(firstRecord?.encounter);
  const roles = asObject(firstRecord?.roles);

  const roleBuckets = ['tanks', 'healers', 'dps'].filter((role) => asObject(roles?.[role]));

  const getCharacterCount = (role: 'tanks' | 'healers' | 'dps'): number => {
    const bucket = asObject(roles?.[role]);
    const characters = asArray(bucket?.characters);
    return characters?.length ?? 0;
  };

  const segments: string[] = [
    `type=${rootType}`,
    `keys=[${topLevelKeys.join(',')}]`,
    `dataLength=${dataRows?.length ?? 0}`,
  ];

  if (firstRecord) {
    const fightId = asNumber(firstRecord.fightID) ?? asNumber(firstRecord.fightId);
    const encounterName = asString(encounter?.name) ?? asString(firstRecord.encounter);
    const difficulty = asNumber(firstRecord.difficulty);

    segments.push(
      `firstRow={fightID:${fightId ?? 'n/a'},encounter:${encounterName ?? 'n/a'},difficulty:${difficulty ?? 'n/a'},roles:[${roleBuckets.join('|')}]}`,
    );
    segments.push(
      `characters={tanks:${getCharacterCount('tanks')},healers:${getCharacterCount('healers')},dps:${getCharacterCount('dps')}}`,
    );
  }

  return {
    logLine: segments.join(' '),
  };
};

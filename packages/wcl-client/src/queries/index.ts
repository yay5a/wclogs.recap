import { KILL_TYPES, REPORT_TABLE_DATA_TYPES } from "../schema-enums.js";

export interface BaseReportSummaryPayload {
    data?: {
        rateLimitData?: {
            limitPerHour?: number;
            pointsSpentThisHour?: number;
            pointsResetIn?: number;
        };
        reportData?: {
            report?: Record<string, unknown>;
        };
    };
}

export interface ReportRankingsPayload {
    data?: {
        reportData?: {
            report?: {
                rankings?: unknown;
            };
        };
    };
}

export interface PlayerDetailsPayload {
    data?: {
        reportData?: {
            report?: {
                playerDetails?: unknown;
            };
        };
    };
}

export interface ReportTablePayload {
    data?: {
        reportData?: {
            report?: Record<string, unknown>;
        };
    };
}

export interface BossRankingsPayload {
    data?: {
        reportData?: {
            report?: {
                rankings?: unknown;
            };
        };
    };
}

export const BASE_REPORT_QUERY = `
  query BaseReportSummary(
    $code: String!
    $allowUnlisted: Boolean!
    $includeRateLimitData: Boolean! = false
  ) {
    rateLimitData @include(if: $includeRateLimitData) {
      limitPerHour
      pointsSpentThisHour
      pointsResetIn
    }
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        archiveStatus {
          isArchived
          isAccessible
          archiveDate
        }
        title
        startTime
        endTime
        zone {
          name
          frozen
          difficulties {
            id
            name
          }
        }
        guild {
          name
          server {
            name
            region { compactName }
          }
        }
        phases {
          encounterID
          phases {
            id
            name
            isIntermission
          }
        }
        fights(killType: ${KILL_TYPES[1]}) {
          id
          encounterID
          difficulty
          name
          startTime
          endTime
          kill
          bossPercentage
          fightPercentage
          inProgress
          originalEncounterID
          phaseTransitions {
            id
            startTime
          }
        }
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
  }
`;

export const REPORT_RANKINGS_QUERY = `
  query ReportRankings($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default)
      }
    }
  }
`;

export const BOSS_RANKINGS_QUERY = `
  query BossRankings(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default, fightIDs: $fightIDs)
      }
    }
  }
`;

export const PLAYER_DETAILS_QUERY = `
  query PlayerDetails(
    $code: String!
    $allowUnlisted: Boolean!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        playerDetails(
          includeCombatantInfo: true
          startTime: $startTime
          endTime: $endTime
        )
      }
    }
  }
`;

export const TABLE_QUERY = `
  query ReportTable($code: String!, $allowUnlisted: Boolean!, $fightIDs: [Int]) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        damageDone: table(dataType: ${REPORT_TABLE_DATA_TYPES[0]}, fightIDs: $fightIDs)
        damageTaken: table(dataType: ${REPORT_TABLE_DATA_TYPES[1]}, fightIDs: $fightIDs)
        healing: table(dataType: ${REPORT_TABLE_DATA_TYPES[2]}, fightIDs: $fightIDs)
        deaths: table(dataType: ${REPORT_TABLE_DATA_TYPES[3]}, fightIDs: $fightIDs)
        dispels: table(dataType: ${REPORT_TABLE_DATA_TYPES[4]}, fightIDs: $fightIDs)
        interrupts: table(dataType: ${REPORT_TABLE_DATA_TYPES[5]}, fightIDs: $fightIDs)
        survivability: table(dataType: ${REPORT_TABLE_DATA_TYPES[6]}, fightIDs: $fightIDs)
      }
    }
  }
`;

export const REPORT_WIDE_TABLE_QUERY = `
  query ReportWideTable(
    $code: String!
    $allowUnlisted: Boolean!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        damageDone: table(dataType: ${REPORT_TABLE_DATA_TYPES[0]}, startTime: $startTime, endTime: $endTime)
        damageTaken: table(dataType: ${REPORT_TABLE_DATA_TYPES[1]}, startTime: $startTime, endTime: $endTime)
        healing: table(dataType: ${REPORT_TABLE_DATA_TYPES[2]}, startTime: $startTime, endTime: $endTime)
        deaths: table(dataType: ${REPORT_TABLE_DATA_TYPES[3]}, startTime: $startTime, endTime: $endTime)
        dispels: table(dataType: ${REPORT_TABLE_DATA_TYPES[4]}, startTime: $startTime, endTime: $endTime)
        interrupts: table(dataType: ${REPORT_TABLE_DATA_TYPES[5]}, startTime: $startTime, endTime: $endTime)
        survivability: table(dataType: ${REPORT_TABLE_DATA_TYPES[6]}, startTime: $startTime, endTime: $endTime)
      }
    }
  }
`;

export type GraphQlExecutor = <TPayload>(
    query: string,
    variables: Record<string, unknown>,
) => Promise<TPayload>;

export const createWclQueries = (execute: GraphQlExecutor) => ({
    baseReportSummary: (variables: {
        code: string;
        allowUnlisted: boolean;
        includeRateLimitData: boolean;
    }) => execute<BaseReportSummaryPayload>(BASE_REPORT_QUERY, variables),
    reportRankings: (variables: { code: string; allowUnlisted: boolean }) =>
        execute<ReportRankingsPayload>(REPORT_RANKINGS_QUERY, variables),
    bossRankings: (variables: {
        code: string;
        allowUnlisted: boolean;
        fightIDs?: number[];
    }) => execute<BossRankingsPayload>(BOSS_RANKINGS_QUERY, variables),
    playerDetails: (variables: {
        code: string;
        allowUnlisted: boolean;
        startTime: number;
        endTime: number;
    }) => execute<PlayerDetailsPayload>(PLAYER_DETAILS_QUERY, variables),
    table: (variables: { code: string; allowUnlisted: boolean; fightIDs?: number[] }) =>
        execute<ReportTablePayload>(TABLE_QUERY, variables),
    reportWideTable: (variables: {
        code: string;
        allowUnlisted: boolean;
        startTime: number;
        endTime: number;
    }) => execute<ReportTablePayload>(REPORT_WIDE_TABLE_QUERY, variables),
});

export type WclQueries = ReturnType<typeof createWclQueries>;

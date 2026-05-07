import {
    KILL_TYPES,
    REPORT_SUMMARY_TABLE_DATA_TYPES,
    REPORT_TABLE_DATA_TYPES,
    type KillType,
    type TableDataType,
} from "../schema-enums.js";

interface BaseReportSummaryPayload {
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

interface ReportRankingsPayload {
    data?: {
        reportData?: {
            report?: {
                rankings?: unknown;
            };
        };
    };
}

interface PlayerDetailsPayload {
    data?: {
        reportData?: {
            report?: {
                playerDetails?: unknown;
            };
        };
    };
}

interface ReportTablePayload {
    data?: {
        reportData?: {
            report?: Record<string, unknown>;
        };
    };
}

interface BossRankingsPayload {
    data?: {
        reportData?: {
            report?: {
                rankings?: unknown;
            };
        };
    };
}

const BASE_REPORT_QUERY = `
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

const REPORT_RANKINGS_QUERY = `
  query ReportRankings($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default)
      }
    }
  }
`;

const REPORT_RANKINGS_DPS_COMBINED_QUERY = `
  query ReportRankingsDpsCombined($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: dps, timeframe: Today, compare: Rankings)
      }
    }
  }
`;

const REPORT_RANKINGS_HPS_COMBINED_QUERY = `
  query ReportRankingsHpsCombined($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: hps, timeframe: Today, compare: Rankings)
      }
    }
  }
`;

const BOSS_RANKINGS_QUERY = `
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

const PLAYER_DETAILS_QUERY = `
  query PlayerDetails(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
    $killType: KillType
    $includeCombatantInfo: Boolean!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        playerDetails(
          fightIDs: $fightIDs
          killType: $killType
          includeCombatantInfo: $includeCombatantInfo
          translate: false
        )
      }
    }
  }
`;

const TABLE_QUERY = `
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

const REPORT_WIDE_TABLE_QUERY = `
  query ReportWideTableByType(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
    $filterExpression: String
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        table(
          dataType: DATA_TYPE_PLACEHOLDER
          fightIDs: $fightIDs
          filterExpression: $filterExpression
        )
      }
    }
  }
`;

export const REPORT_WIDE_KILL_TABLE_FILTERS: Record<
    (typeof REPORT_SUMMARY_TABLE_DATA_TYPES)[number],
    string
> = {
    DamageDone:
        '((encounterID != 0) AND (encounterEnd = "kill")) AND (source.disposition = "friendly") AND (target.disposition = "enemy")',
    DamageTaken:
        '((encounterID != 0) AND (encounterEnd = "kill")) AND (target.disposition = "friendly")',
    Healing:
        '((encounterID != 0) AND (encounterEnd = "kill")) AND (inCategory("healing") = true) AND (source.disposition = "friendly") AND (target.disposition = "friendly")',
    Deaths: '((encounterID != 0) AND (encounterEnd = "kill")) AND (type = "death") AND (target.disposition = "friendly") AND (feign = false)',
    Dispels:
        '((encounterID != 0) AND (encounterEnd = "kill")) AND (source.disposition = "friendly")',
    Interrupts:
        '((encounterID != 0) AND (encounterEnd = "kill")) AND (type = "interrupt") AND (source.disposition = "friendly") AND (target.disposition = "enemy")',
};

export const REPORT_WIDE_ENCOUNTER_TABLE_FILTERS: Record<
    (typeof REPORT_SUMMARY_TABLE_DATA_TYPES)[number],
    string
> = {
    DamageDone:
        '(encounterID != 0) AND (source.disposition = "friendly") AND (target.disposition = "enemy")',
    DamageTaken:
        '(encounterID != 0) AND (target.disposition = "friendly")',
    Healing:
        '(encounterID != 0) AND (inCategory("healing") = true) AND (source.disposition = "friendly") AND (target.disposition = "friendly")',
    Deaths: '(encounterID != 0) AND (type = "death") AND (target.disposition = "friendly") AND (feign = false)',
    Dispels:
        '(encounterID != 0) AND (source.disposition = "friendly")',
    Interrupts:
        '(encounterID != 0) AND (type = "interrupt") AND (source.disposition = "friendly") AND (target.disposition = "enemy")',
};

export const buildReportWideTableQuery = (dataType: TableDataType): string =>
    REPORT_WIDE_TABLE_QUERY.replace("DATA_TYPE_PLACEHOLDER", dataType);

type GraphQlExecutor = <TPayload>(
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
    reportRankingsDpsCombined: (variables: {
        code: string;
        allowUnlisted: boolean;
    }) =>
        execute<ReportRankingsPayload>(
            REPORT_RANKINGS_DPS_COMBINED_QUERY,
            variables,
        ),
    reportRankingsHpsCombined: (variables: {
        code: string;
        allowUnlisted: boolean;
    }) =>
        execute<ReportRankingsPayload>(
            REPORT_RANKINGS_HPS_COMBINED_QUERY,
            variables,
        ),
    bossRankings: (variables: {
        code: string;
        allowUnlisted: boolean;
        fightIDs?: number[];
    }) => execute<BossRankingsPayload>(BOSS_RANKINGS_QUERY, variables),
    playerDetails: (variables: {
        code: string;
        allowUnlisted: boolean;
        fightIDs?: number[];
        killType?: KillType;
        includeCombatantInfo: boolean;
    }) => execute<PlayerDetailsPayload>(PLAYER_DETAILS_QUERY, variables),
    table: (variables: {
        code: string;
        allowUnlisted: boolean;
        fightIDs?: number[];
    }) => execute<ReportTablePayload>(TABLE_QUERY, variables),
    reportWideTable: (variables: {
        code: string;
        allowUnlisted: boolean;
        dataType: TableDataType;
        fightIDs?: number[];
        filterExpression?: string;
    }) => {
        const { dataType, ...requestVariables } = variables;
        return execute<ReportTablePayload>(
            buildReportWideTableQuery(dataType),
            requestVariables,
        );
    },
});

export type WclQueries = ReturnType<typeof createWclQueries>;

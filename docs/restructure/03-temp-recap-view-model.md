type TempRecapRender = {
  header: {
    titleLine: string;
    secondaryLine: string;
    killTimeLabel: string;
    reportDateLabel: string;
    pullCount: number;
    reportLink: string;
  };

  standouts?: {
    mostImprovedPlayer?: {
      playerName: string;
      delta: number;
    };
  };

  rankings?: {
    bestSingleBossParse?: {
      playerName: string;
      value: number;
      bossName: string;
      metric: "DPS" | "HPS" | "DTPS";
    };
    topOverallParsers?: Array<{
      playerName: string;
      value: number;
      metric: "DPS" | "HPS" | "DTPS";
    }>;
    topOverallDamageParsers?: Array<{
      playerName: string;
      value: number;
      metric: "DPS";
    }>;
    topOverallHealingParsers?: Array<{
      playerName: string;
      value: number;
      metric: "HPS";
    }>;
    bestPlayerParses?: Array<{
      playerName: string;
      parse: number;
      metric: "DPS" | "HPS" | "DTPS";
      amount?: number;
      classSpecLabel?: string;
    }>;
  };

  bossHighlights?: Array<{
    bossName: string;
    text: string;
  }>;

  raidSuperlatives?: Array<{
    label: string;
    text: string;
  }>;

  totals?: {
    totalDeaths?: number;
    raidDamageTaken?: number;
    dispels?: number;
    battleRezzes?: number;
    kicks?: number;
  };

  reportWideStats?: {
    topDamageDone?: Array<{
      playerName: string;
      value: number;
      classSpecLabel?: string;
    }>;
    topHealingDone?: Array<{
      playerName: string;
      value: number;
      classSpecLabel?: string;
    }>;
    topDamageTaken?: Array<{
      playerName: string;
      value: number;
      classSpecLabel?: string;
    }>;
    topInterrupts?: Array<{
      playerName: string;
      value: number;
      classSpecLabel?: string;
    }>;
    topDispels?: Array<{
      playerName: string;
      value: number;
      classSpecLabel?: string;
    }>;
    topSurvivability?: Array<{
      playerName: string;
      value: number;
      classSpecLabel?: string;
    }>;
  };
};

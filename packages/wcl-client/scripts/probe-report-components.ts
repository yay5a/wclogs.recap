import { GraphQLClient } from "graphql-request";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface ProbeDefinition {
    name: "deaths" | "dispels" | "interrupts" | "survivability";
    contents: string;
}

interface EvaluateScriptResponse {
    output?: unknown;
    logs?: unknown;
    error?: unknown;
}

const PROBES: ProbeDefinition[] = [
    {
        name: "deaths",
        contents:
            'return report.table({ dataType: "Deaths", fightIDs: filter.fightIDs });',
    },
    {
        name: "dispels",
        contents:
            'return report.table({ dataType: "Dispels", fightIDs: filter.fightIDs });',
    },
    {
        name: "interrupts",
        contents:
            'return report.table({ dataType: "Interrupts", fightIDs: filter.fightIDs });',
    },
    {
        name: "survivability",
        contents:
            'return report.table({ dataType: "Survivability", fightIDs: filter.fightIDs });',
    },
];

const EVALUATE_QUERY = `
query ProbeReportComponent(
  $reportCode: String!
  $contents: String!
  $filter: ReportComponentFilter
  $debug: Boolean!
) {
  reportComponentData {
    evaluateScript(
      reportCode: $reportCode
      contents: $contents
      filter: $filter
      debug: $debug
    ) {
      output
      logs
      error
    }
  }
}
`;

const MASTER_DATA_QUERY = `
query ProbeMasterData($reportCode: String!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      masterData {
        actors(type: "Player") {
          id
          name
          type
          subType
        }
        abilities {
          gameID
          name
          type
        }
      }
    }
  }
}
`;

const asObject = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;

const getEnv = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

const getArgs = (): { reportCode: string; fightId: number } => {
    const [, , reportCodeArg, fightIdArg] = process.argv;
    const reportCode = reportCodeArg?.trim();
    const fightId = Number(fightIdArg);

    if (!reportCode) {
        throw new Error("Usage: pnpm --filter @wcl/wcl-client probe:report-components <reportCode> <fightId>");
    }

    if (!Number.isInteger(fightId) || fightId <= 0) {
        throw new Error("fightId must be a positive integer");
    }

    return { reportCode, fightId };
};

const run = async (): Promise<void> => {
    const { reportCode, fightId } = getArgs();

    const client = new GraphQLClient(getEnv("WCL_API_BASE_URL"), {
        headers: {
            Authorization: `Bearer ${getEnv("WCL_OAUTH_TOKEN")}`,
        },
    });

    const outputDir = join(process.cwd(), "packages/wcl-client/src/fixtures/probes");
    await mkdir(outputDir, { recursive: true });

    for (const probe of PROBES) {
        const result = await client.request<unknown>(EVALUATE_QUERY, {
            reportCode,
            contents: probe.contents,
            filter: { fightIDs: [fightId] },
            debug: true,
        });

        const evaluateScript = asObject(
            asObject(asObject(result)?.reportComponentData)?.evaluateScript,
        ) as EvaluateScriptResponse | undefined;

        const outputPath = join(
            outputDir,
            `${probe.name}.${reportCode}.fight-${fightId}.json`,
        );
        await writeFile(
            outputPath,
            JSON.stringify(evaluateScript?.output ?? null, null, 2),
            "utf8",
        );

        const debugPath = join(
            outputDir,
            `${probe.name}.${reportCode}.fight-${fightId}.debug.json`,
        );
        await writeFile(
            debugPath,
            JSON.stringify(
                {
                    reportCode,
                    fightId,
                    probe: probe.name,
                    output: evaluateScript?.output ?? null,
                    logs: evaluateScript?.logs ?? null,
                    error: evaluateScript?.error ?? null,
                },
                null,
                2,
            ),
            "utf8",
        );
    }

    const masterDataResult = await client.request<unknown>(MASTER_DATA_QUERY, {
        reportCode,
    });
    const masterData = asObject(
        asObject(asObject(asObject(masterDataResult)?.reportData)?.report)?.masterData,
    );

    const masterDataPath = join(outputDir, `master-data.${reportCode}.json`);
    await writeFile(masterDataPath, JSON.stringify(masterData ?? null, null, 2), "utf8");

    console.log(
        `Saved probe fixtures for report ${reportCode} fight ${fightId} to ${outputDir}`,
    );
};

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Probe run failed: ${message}`);
    process.exitCode = 1;
});

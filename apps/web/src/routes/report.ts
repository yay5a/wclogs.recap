import type { FastifyPluginAsync } from "fastify";
import type { WclClient } from "@wcl/wcl-client";
import type { createLogger } from "@wcl/shared";

type ReportRouteOptions = {
    wclClient: WclClient;
    logger: ReturnType<typeof createLogger>;
};

const toWclReportUrl = (reportCode: string): string =>
    `https://www.warcraftlogs.com/reports/${reportCode}`;

export const registerReportRoutes: FastifyPluginAsync<ReportRouteOptions> = async (
    app,
    options,
) => {
    app.post("/api/report", async (request, reply) => {
        const body =
            typeof request.body === "object" && request.body !== null
                ? (request.body as Record<string, unknown>)
                : undefined;
        const reportCode =
            typeof body?.reportCode === "string" ? body.reportCode.trim() : "";

        if (!/^[A-Za-z0-9]+$/.test(reportCode)) {
            return reply.code(400).send({
                ok: false,
                message: "reportCode must be a non-empty alphanumeric value",
            });
        }

        try {
            const report = await options.wclClient.fetchAndNormalizeReport(
                toWclReportUrl(reportCode),
            );

            return reply.send({
                ok: true,
                message: "Report payload generated",
                payload: report,
            });
        } catch (error) {
            options.logger.error({ error, reportCode }, "report route failed");
            return reply.code(502).send({
                ok: false,
                message: "Failed to generate report payload",
            });
        }
    });
};

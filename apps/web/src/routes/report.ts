import type { FastifyPluginAsync } from "fastify";
import type { WclClient } from "@wcl/wcl-client";
import { WclReportFetchError } from "@wcl/wcl-client";
import type { createLogger } from "@wcl/shared";
import type { WebEnv } from "../config.js";
import { getDashboardAuthFromRequest } from "./dashboard/auth.js";

type ReportRouteOptions = {
    env: WebEnv;
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
            const auth = getDashboardAuthFromRequest(request, options.env);
            const discordUserId = auth?.kind === "discord" ? auth.discordUserId : undefined;
            const report = await options.wclClient.fetchAndNormalizeReport(
                toWclReportUrl(reportCode),
                discordUserId ? { discordUserId } : undefined,
            );

            return reply.send({
                ok: true,
                message: "Report payload generated",
                payload: report,
            });
        } catch (error) {
            if (error instanceof WclReportFetchError) {
                options.logger.error(
                    {
                        reportCode,
                        authMode: error.authMode,
                        failureCategory: error.category,
                        ...(typeof error.status === "number" ? { status: error.status } : {}),
                    },
                    "report route failed",
                );
                if (
                    error.category === "private_or_auth_required" ||
                    error.category === "missing_linked_auth"
                ) {
                    return reply.code(403).send({
                        ok: false,
                        message:
                            "This report may require Warcraft Logs authorization. Link your Warcraft Logs account from the dashboard, then try again.",
                    });
                }
                if (error.category === "expired_linked_auth") {
                    return reply.code(403).send({
                        ok: false,
                        message:
                            "Your Warcraft Logs authorization has expired. Re-link Warcraft Logs from the dashboard, then try again.",
                    });
                }
                if (error.category === "linked_auth_unreadable") {
                    return reply.code(403).send({
                        ok: false,
                        message:
                            "Your Warcraft Logs authorization needs to be refreshed. Re-link Warcraft Logs from the dashboard, then try again.",
                    });
                }
            } else {
                options.logger.error({ error, reportCode }, "report route failed");
            }
            return reply.code(502).send({
                ok: false,
                message: "Failed to generate report payload",
            });
        }
    });
};

import { trimmed, z } from "@wcl/shared";

const dashboardAuthDisabled = z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true");

const webEnvSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    PORT: z.coerce.number().default(3000),
    MONGODB_URI: trimmed().url(),
    DISCORD_PUBLIC_KEY: trimmed().regex(
        /^[a-fA-F0-9]{64}$/,
        "DISCORD_PUBLIC_KEY must be a 64-character hex string",
    ),
    DISCORD_APPLICATION_ID: trimmed().regex(
        /^\d+$/,
        "DISCORD_APPLICATION_ID must be numeric",
    ),
    DISCORD_BOT_TOKEN: trimmed().regex(
        /^\S+$/,
        "DISCORD_BOT_TOKEN must not contain whitespace",
    ),
    DISCORD_CLIENT_SECRET: trimmed()
        .min(1, "DISCORD_CLIENT_SECRET must not be empty")
        .optional(),
    DISCORD_OAUTH_REDIRECT_URI: trimmed().url().optional(),
    WCL_CLIENT_ID: trimmed(),
    WCL_CLIENT_SECRET: trimmed(),
    WCL_API_BASE_URL: trimmed()
        .url()
        .default("https://www.warcraftlogs.com/api/v2/client"),
    WCL_REDIRECT_URI: trimmed().url(),
    COOKIE_SECRET: trimmed().min(1, "COOKIE_SECRET is required"),
    DASHBOARD_ADMIN_SECRET: trimmed()
        .min(1, "DASHBOARD_ADMIN_SECRET must not be empty")
        .optional(),
    DASHBOARD_AUTH_DISABLED: dashboardAuthDisabled,
}).superRefine((env, context) => {
    if (env.NODE_ENV === "production" && env.DASHBOARD_AUTH_DISABLED) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["DASHBOARD_AUTH_DISABLED"],
            message: "DASHBOARD_AUTH_DISABLED=true is not allowed in production",
        });
    }

    if (env.NODE_ENV === "production" && !env.DASHBOARD_ADMIN_SECRET) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["DASHBOARD_ADMIN_SECRET"],
            message: "DASHBOARD_ADMIN_SECRET is required in production",
        });
    }

    if (
        (env.DISCORD_CLIENT_SECRET && !env.DISCORD_OAUTH_REDIRECT_URI) ||
        (!env.DISCORD_CLIENT_SECRET && env.DISCORD_OAUTH_REDIRECT_URI)
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["DISCORD_OAUTH_REDIRECT_URI"],
            message:
                "DISCORD_CLIENT_SECRET and DISCORD_OAUTH_REDIRECT_URI must be set together",
        });
    }

    if (
        env.NODE_ENV === "development" &&
        !env.DASHBOARD_AUTH_DISABLED &&
        !env.DASHBOARD_ADMIN_SECRET
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["DASHBOARD_ADMIN_SECRET"],
            message:
                "DASHBOARD_ADMIN_SECRET is required in development unless DASHBOARD_AUTH_DISABLED=true",
        });
    }
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const parseWebEnv = (rawEnv: NodeJS.ProcessEnv): WebEnv =>
    webEnvSchema.parse(rawEnv);

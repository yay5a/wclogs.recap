// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig(
    eslint.configs.recommended,
    tseslint.configs.recommended,
    prettier,
    {
        files: ["**/*.{ts,tsx}"],
        ignores: ["**/dist/**", "**/node_modules/**"],
        languageOptions: {
            parserOptions: {
                projectService: false,
            },
        },
        rules: {
            // Ratchet step: surface explicit `any` usage as warnings first to
            // improve safety gradually without blocking existing workflows.
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
    {
        files: ["packages/wcl-client/src/**/*.ts", "apps/worker/src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "warn",
            "@typescript-eslint/no-unsafe-member-access": "warn",
            "@typescript-eslint/no-unsafe-call": "warn",
            "@typescript-eslint/no-unsafe-return": "warn",
            "@typescript-eslint/no-unsafe-argument": "warn",
        },
    },
    {
        files: ["apps/web/client/**/*.{ts,tsx}"],
        rules: {
            "no-undef": "off",
        },
    },
    {
        files: ["packages/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@wcl/web",
                            message:
                                "Packages must not depend on the web app layer; keep app composition in apps/web.",
                        },
                        {
                            name: "@wcl/worker",
                            message:
                                "Packages must not depend on the worker app layer; compose package dependencies in apps/worker.",
                        },
                    ],
                    patterns: [
                        {
                            group: ["apps/*", "apps/**"],
                            message:
                                "Packages must not import from apps/** directly; move shared contracts into packages instead.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["packages/wcl-client/src/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@wcl/db",
                            message:
                                "wcl-client must not depend on db directly; inject a cache/store port from the composition layer instead.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["packages/shared/src/**/*.ts", "packages/domain/src/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "@wcl/db",
                            message:
                                "shared/domain must stay persistence-agnostic; db access belongs in package composition or apps.",
                        },
                        {
                            name: "@wcl/discord",
                            message:
                                "shared/domain must not depend on Discord transport concerns.",
                        },
                        {
                            name: "@wcl/wcl-client",
                            message:
                                "shared/domain must not depend on Warcraft Logs transport clients.",
                        },
                        {
                            name: "@wcl/web",
                            message:
                                "shared/domain must not depend on web app-layer concerns.",
                        },
                        {
                            name: "@wcl/worker",
                            message:
                                "shared/domain must not depend on worker app-layer orchestration.",
                        },
                    ],
                },
            ],
        },
    },
);

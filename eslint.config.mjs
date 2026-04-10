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
        files: ["**/*.ts"],
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
);

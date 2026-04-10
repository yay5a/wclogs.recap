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
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
);

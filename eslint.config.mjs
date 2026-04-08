<<<<<<< HEAD
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts'],
    ignores: ['**/dist/**', '**/node_modules/**'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
=======
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
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
>>>>>>> c1868b4 (generated framework through codex)
);

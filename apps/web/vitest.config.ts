import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@wcl\/([^/]+)$/,
                replacement: resolve(repoRoot, "packages/$1/src/index.ts"),
            },
        ],
    },
    test: {
        include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    },
});

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@wcl\/([^/]+)$/,
                replacement: resolve(repoRoot, "packages/$1/src/index.ts"),
            },
        ],
    },
});

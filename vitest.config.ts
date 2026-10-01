import { defineConfig } from "vitest/config";
import * as path from "node:path";

const repoRoot = path.join(__dirname, "../../..");
const serverOnlyStub = path.join(repoRoot, "tests/__stubs__/server-only.ts");

export default defineConfig({
  resolve: {
    alias: [
      { find: "@cinatra-ai/design-primitives", replacement: path.join(__dirname, "src/__tests__/fixtures/design-primitives.tsx") },
      { find: "server-only", replacement: serverOnlyStub },
      {
        find: "@/lib/database",
        replacement: path.join(repoRoot, "tests/__stubs__/database.ts"),
      },
      { find: /^@\/(.+)$/, replacement: path.join(repoRoot, "src") + "/$1" },
    ],
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});

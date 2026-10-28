import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // npm run coverage (threshold: TS core >= 90%, ADR-0004): measures only each package's src; the UI and CLI use core through dist, so core counts only its own tests
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      reporter: ["text-summary", "text", "html"],
      reportsDirectory: "coverage",
      thresholds: { "packages/core/src/**": { lines: 90, statements: 90, functions: 90 } },
    },
  },
});

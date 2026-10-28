import { defineConfig } from "@playwright/test";

// Long random-operation soak test: npm run soak. A real-shell test instance, run one at a time; the duration is SNIPTOSS_SOAK_MINUTES (default 120 minutes).
// The test sets its own timeout from the duration; it opens a window on screen
export default defineConfig({
  testDir: "tests/soak",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "tests/soak/.results",
});

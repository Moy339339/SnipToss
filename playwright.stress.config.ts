import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The full round of the concurrent-write stress test (tests/e2e/write-stress.spec.ts, ADR-0005 item 6): npm run stress.
// npm run e2e runs only a short round of a dozen steps; this one does 300 UI steps + 2400 or more agent writes, takes a few minutes, and runs on its own
process.env.SNIPTOSS_STRESS = "1";

export default defineConfig({
  ...base,
  testMatch: "**/write-stress.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15 * 60_000,
});

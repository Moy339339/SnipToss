import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// Measure the app built the way it is released (ReadyToRun, with its own .NET runtime; npm run perf builds it with build-app.ps1 -Publish into tests/shell/.app-r2r):
// the first press of the capture shortcut is mostly JIT compilation, so framework-dependent Debug / Release builds give inaccurate numbers
process.env.SNIPTOSS_SHELL_EXE ??= fileURLToPath(new URL("tests/shell/.app-r2r/SnipToss.exe", import.meta.url));

// Performance budget (ADR-0004 item 10): npm run perf. Uses real-shell test instances to measure startup, the capture overlay, a 20,000-row list and scrolling with 1000 notes;
// going over budget (BUDGET in tests/perf) fails the run. Runs one at a time (parallel runs slow each other down and skew the numbers); opens windows and flashes the capture overlay on screen
export default defineConfig({
  testDir: "tests/perf",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: "list",
  outputDir: "tests/perf/.results",
});

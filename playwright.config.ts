import { defineConfig } from "@playwright/test";

// UI e2e (layer 3 in docs/adr/0004-testing-layers.md): npm run e2e.
// Uses the system's own Edge (WebView2 is Edge's engine, so it is closest to the real app, and no separate browser download is needed).
// Run npm run build first (the UI is read from packages/web/dist, the command line from packages/cli/dist)
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // Each worker is one Edge + one Node, about 0.9 GB. The default is 2: with 4 the peak is 3.7 GB, which strains memory when other programs are running;
  // 2 workers use about 2 GB and are about 30% slower. When nothing else is running you can set $env:SNIPTOSS_E2E_WORKERS = 4
  workers: Number(process.env.SNIPTOSS_E2E_WORKERS) || 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    channel: "msedge",
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  outputDir: "tests/e2e/.results",
});

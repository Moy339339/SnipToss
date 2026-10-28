import { defineConfig } from "@playwright/test";

// Real-shell smoke tests (layer 4 in docs/adr/0004-testing-layers.md): npm run e2e:shell.
// Each test starts a SnipToss.exe test instance (tests/shell/harness.ts), which briefly opens a window on screen and shows a tray icon;
// the app is the copy built into tests/shell/.app, so it does not touch the everyday app/bin build or its settings.
export default defineConfig({
  testDir: "tests/shell",
  testMatch: "**/*.spec.ts",
  // Each instance starts its own set of WebView2 processes; more parallel workers slow each other down and time out
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  outputDir: "tests/shell/.results",
});

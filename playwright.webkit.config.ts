import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// The UI e2e checks that depend on the browser engine, in WebKit (the engine of the Mac app's window): line breaking around full-width
// punctuation (tests/e2e/line-breaks.spec.ts). Runs on the Mac CI (mac.yml), not in npm run verify: it needs Playwright's own WebKit
// (npx playwright install webkit), which the Windows setup doesn't download. Run npm run build first, as for npm run e2e
export default defineConfig({
  ...base,
  testMatch: "**/line-breaks.spec.ts",
  use: {
    browserName: "webkit",
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  outputDir: "tests/e2e/.results-webkit",
});

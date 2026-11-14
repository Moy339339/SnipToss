// Renders the pictures used by onboarding (rerun after changing the landing page in scripts/readme-shots/sample.mjs):
//   node scripts/build-demo-art.mjs
// - packages/web/public/sample/landing-page.jpg: the sample item ("Try with a sample" copies it into the app's Sample folder), 1600 × 1000
// - packages/web/src/assets/demo-before.jpg, demo-after.jpg: the same page before and after the notes were applied, 752 × 470,
//   shown inside the onboarding animations (Demo.tsx)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { landingHtml } from "./readme-shots/sample.mjs";

const web = join(import.meta.dirname, "..", "packages", "web");
mkdirSync(join(web, "public", "sample"), { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
async function shot(html, file, scale, quality) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file, type: "jpeg", quality });
  await page.close();
}
await shot(landingHtml(), join(web, "public", "sample", "landing-page.jpg"), 1, 88);
await shot(landingHtml(), join(web, "src", "assets", "demo-before.jpg"), 0.47, 80);
await shot(landingHtml({ fixed: true }), join(web, "src", "assets", "demo-after.jpg"), 0.47, 80);
await browser.close();
console.log("Wrote the sample item and the onboarding pictures");

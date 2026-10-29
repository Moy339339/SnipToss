// The sample material of the README scenes. Everything here is made up: a landing page that looks AI-generated (headline too thin, wrong button color,
// a watermark in the corner: for the notes to point out), the same page after the notes were applied, and a short product clip.
// The photo is an AI-generated picture without any text (assets/coffee-pour.jpg); the page and the clip are rendered with headless Edge,
// so they are real pictures and a real video file, not drawings of an interface.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const photo =
  "data:image/jpeg;base64," + readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assets", "coffee-pour.jpg")).toString("base64");

/**
 * The landing page at 1600 × 1000.
 *   fixed: the page after the notes were applied (bold title, brand-brown button, no watermark)
 *   banner: the wide variant used as the second image of the project (a headline only)
 */
export function landingHtml({ fixed = false, banner = false } = {}) {
  return `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1600px; height: 1000px; font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; color: #2b1d14;
         background: #f1e3cf url(${photo}) center / cover no-repeat; overflow: hidden; position: relative; }
  nav { position: absolute; top: 48px; left: 96px; right: 96px; display: flex; align-items: center; justify-content: space-between; font-size: 22px; }
  nav .logo { font-weight: 700; letter-spacing: 0.04em; }
  nav .links { display: flex; gap: 40px; color: #4e3a2c; }
  h1 { position: absolute; top: ${banner ? 150 : 250}px; left: 96px; width: 760px; font-size: 92px; line-height: 1.02; font-weight: ${fixed || banner ? 700 : 200}; letter-spacing: -0.02em; }
  p { position: absolute; top: 500px; left: 100px; width: 600px; font-size: 26px; line-height: 1.5; color: #4e3a2c; }
  .cta { position: absolute; top: 640px; left: 100px; padding: 22px 44px; border-radius: 999px; background: ${fixed ? "#6b3f25" : "#e0338a"}; color: #fff; font-size: 24px; font-weight: 600; }
  .ghost { position: absolute; top: 646px; left: 380px; font-size: 22px; color: #4e3a2c; padding: 18px 8px; }
  .mark { position: absolute; right: 150px; top: 130px; font-size: 40px; font-weight: 700; color: rgba(255, 255, 255, 0.55); transform: rotate(-12deg); letter-spacing: 0.3em; }
</style></head><body>
  <nav><div class="logo">SLOW POUR</div><div class="links"><span>Beans</span><span>Brew guides</span><span>Visit us</span></div></nav>
  <h1>${banner ? "New beans every Monday." : "Coffee, brewed slowly."}</h1>
  ${banner ? "" : "<p>Small-batch beans roasted every Monday and delivered to your door within the week.</p>"}
  <div class="cta">Start a subscription</div><div class="ghost">See this week's beans →</div>
  ${fixed ? "" : '<div class="mark">STOCKPHOTO</div>'}
</body></html>`;
}

/** The product clip: 6 seconds at 24 frames per second, 1280 × 720. A slow push-in on the photo; the headline fades in at 2.0 s and the button follows at 3.0 s */
const clipHtml = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; height: 720px; overflow: hidden; position: relative; font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; color: #2b1d14; background: #f1e3cf; }
  #photo { position: absolute; inset: 0; background: url(${photo}) center / cover no-repeat; transform-origin: 76% 66%; }
  .brand { position: absolute; top: 40px; left: 80px; font-weight: 700; letter-spacing: 0.04em; font-size: 20px; }
  h1 { position: absolute; top: 230px; left: 80px; width: 560px; font-size: 76px; line-height: 1.02; font-weight: 300; letter-spacing: -0.02em; opacity: 0; }
  p { position: absolute; top: 430px; left: 84px; width: 460px; font-size: 22px; line-height: 1.5; color: #4e3a2c; opacity: 0; }
  .cta { position: absolute; top: 540px; left: 84px; padding: 16px 34px; border-radius: 999px; background: #6b3f25; color: #fff; font-size: 20px; font-weight: 600; opacity: 0; }
</style></head><body>
  <div id="photo"></div>
  <div class="brand">SLOW POUR</div>
  <h1 id="h">Coffee, brewed slowly.</h1>
  <p id="p">Small-batch beans roasted every Monday and delivered to your door within the week.</p>
  <div class="cta" id="c">Start a subscription</div>
<script>
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const $ = (id) => document.getElementById(id);
  window.setT = (t) => {
    $("photo").style.transform = "scale(" + (1 + 0.14 * (t / 6)) + ")";
    for (const [id, at, dy] of [["h", 2.0, 26], ["p", 2.7, 20], ["c", 3.2, 16]]) {
      const v = ease((t - at) / 0.7);
      $(id).style.opacity = v;
      $(id).style.transform = "translateY(" + (1 - v) * dy + "px)";
    }
  };
  window.setT(0);
</script></body></html>`;

/** Renders the landing page (and its variants) to PNG files in dir: hero.png, banner.png, hero-after.png */
export async function renderLanding(dir) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent(landingHtml());
  await page.screenshot({ path: join(dir, "hero.png") });
  await page.setContent(landingHtml({ fixed: true }));
  await page.screenshot({ path: join(dir, "hero-after.png") });
  await page.setViewportSize({ width: 1600, height: 500 });
  await page.setContent(landingHtml({ banner: true }));
  await page.screenshot({ path: join(dir, "banner.png") });
  await browser.close();
}

/** The page as a 1280 × 720 screen picture (what the fake monitor of the capture scene shows) */
export async function renderScreen(file) {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 0.8 });
  await page.setContent(landingHtml());
  await page.screenshot({ path: file });
  await browser.close();
}

/** The product clip as an H.264 MP4 with a key frame every half second (scrubbing lands on them) */
export async function renderClip(file) {
  const frames = mkdtempSync(join(tmpdir(), "clip-"));
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(clipHtml);
  for (let i = 0; i < 144; i++) {
    await page.evaluate((t) => window.setT(t), i / 24);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
  }
  await browser.close();
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-framerate",
      "24",
      "-i",
      join(frames, "f%04d.png"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-crf",
      "18",
      "-g",
      "12",
      "-movflags",
      "+faststart",
      file,
    ],
    { encoding: "utf8" },
  );
  rmSync(frames, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed to encode the clip: ${r.stderr}`);
  console.log(`Saved: ${file}`);
}

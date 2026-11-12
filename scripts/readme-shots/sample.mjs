// The sample material of the README scenes. Everything here is made up: a landing page that looks AI-generated (headline too thin, wrong button color,
// a watermark in the corner: for the notes to point out), the same page after the notes were applied, and a short product clip.
// The photo is an AI-generated picture without any text (assets/coffee-pour.jpg); the page and the clip are rendered with headless Edge,
// so they are real pictures and a real video file, not drawings of an interface.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const assets = join(dirname(fileURLToPath(import.meta.url)), "assets");
const dataUrl = (file) => "data:image/jpeg;base64," + readFileSync(join(assets, file)).toString("base64");
const photo = dataUrl("coffee-pour.jpg");

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

/**
 * The second sample, for pictures that must not repeat the first: an event poster (1200 × 1500, or a wide 1200 × 630 flyer) on an AI-generated photo.
 * Flaws for the notes to point out: the title is too small and the date has too little contrast
 */
export function posterHtml({ wide = false } = {}) {
  return `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: ${wide ? 630 : 1500}px; font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif;
         background: #07131c url(${dataUrl("jazz-poster.jpg")}) center / cover no-repeat; overflow: hidden; position: relative; }
  .title { position: absolute; top: ${wide ? 50 : 96}px; left: 0; right: 0; text-align: center; font-size: 64px; font-weight: 300; letter-spacing: 0.22em; color: #e9dcc0; }
  .sub { position: absolute; top: ${wide ? 140 : 190}px; left: 0; right: 0; text-align: center; font-size: 26px; letter-spacing: 0.3em; color: #a99c82; }
  .date { position: absolute; bottom: ${wide ? 40 : 120}px; left: 0; right: 0; text-align: center; font-size: 36px; letter-spacing: 0.08em; color: #6f5f40; }
</style></head><body>
  <div class="title">LATE NIGHT JAZZ</div><div class="sub">LIVE AT THE PIER</div><div class="date">Friday · 9 PM · Free entry</div>
</body></html>`;
}

/** Renders the poster and the wide flyer to PNG files in dir: poster.png, flyer.png */
export async function renderPoster(dir) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
  await page.setContent(posterHtml());
  await page.screenshot({ path: join(dir, "poster.png") });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(posterHtml({ wide: true }));
  await page.screenshot({ path: join(dir, "flyer.png") });
  await browser.close();
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

/**
 * A chat with an AI agent as a 1280 × 720 screen: a long answer that ends with three questions (headline, button color, watermarked photo).
 * A made-up, generic chat window: it is not the interface of any product
 */
const chatHtml = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; height: 720px; overflow: hidden; display: flex; font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #1f2328; background: #ffffff; }
  aside { width: 236px; background: #f5f6f8; border-right: 1px solid #e3e5e9; padding: 18px 14px; font-size: 14px; color: #57606a; }
  aside .new { border: 1px solid #d5d9df; border-radius: 10px; padding: 9px 12px; background: #ffffff; color: #1f2328; font-weight: 600; margin-bottom: 22px; }
  aside .cap { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #8b949e; margin: 0 8px 8px; }
  aside .item { padding: 8px 10px; border-radius: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  aside .item.on { background: #e6e9ee; color: #1f2328; font-weight: 600; }
  main { flex: 1; position: relative; }
  .col { width: 760px; margin: 0 auto; padding-top: 24px; }
  .me { margin-left: auto; width: fit-content; max-width: 520px; background: #eef0f3; border-radius: 18px 18px 4px 18px; padding: 11px 16px; font-size: 16px; line-height: 1.45; }
  .who { display: flex; align-items: center; gap: 10px; margin: 18px 0 10px; font-size: 14px; font-weight: 600; color: #57606a; }
  .who i { width: 24px; height: 24px; border-radius: 7px; background: linear-gradient(135deg, #2f3640, #6b7684); }
  .ai { font-size: 18px; line-height: 1.55; }
  .ai p { margin-bottom: 12px; }
  .ai ul { margin: 0 0 12px 22px; }
  .ai li { padding-left: 4px; }
  .ai code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 15px; background: #eef0f3; border-radius: 5px; padding: 2px 6px; }
  .ai .q { padding: 9px 12px; margin: 0 -12px 6px; }
  .ai b { font-weight: 700; }
  .box { position: absolute; left: 0; right: 0; bottom: 22px; }
  .box div { width: 760px; margin: 0 auto; border: 1px solid #d5d9df; border-radius: 16px; background: #fff; padding: 15px 18px; font-size: 16px; color: #8b949e;
             display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 10px rgba(20, 30, 50, 0.06); }
  .box span { width: 30px; height: 30px; border-radius: 50%; background: #1f2328; color: #fff; display: grid; place-items: center; font-size: 16px; }
</style></head><body>
  <aside>
    <div class="new">+ New chat</div>
    <div class="cap">Today</div>
    <div class="item on">Slow Pour landing page</div>
    <div class="item">Brew guide illustrations</div>
    <div class="cap" style="margin-top: 18px">Earlier</div>
    <div class="item">Newsletter template</div>
    <div class="item">Menu board for the shop</div>
    <div class="item">Subscription pricing table</div>
  </aside>
  <main>
    <div class="col">
      <div class="me">Build the landing page from the brief. Ask me if anything is unclear.</div>
      <div class="who"><i></i>Agent</div>
      <div class="ai" id="reply">
        <p>The first version of the landing page is ready in <code>slow-pour-site/index.html</code>. What is in it:</p>
        <ul><li>A hero with the photo you gave me and a one-line headline</li><li>The subscribe button and a link to this week's beans</li><li>A layout that holds down to a 360 px phone screen</li></ul>
        <p>Before I go on, three things are yours to decide:</p>
        <div class="q"><b>1. Headline.</b> I went with “Coffee, brewed slowly.” Keep it, or should I write a few alternatives?</div>
        <div class="q"><b>2. Button color.</b> It is pink (#E0338A) for now. Stay with pink, or switch to the brand's coffee brown?</div>
        <div class="q"><b>3. Hero photo.</b> The stock photo still has a watermark. Buy the license, or should I generate a new one?</div>
      </div>
    </div>
    <div class="box"><div>Reply…<span>↑</span></div></div>
  </main>
</body></html>`;

/**
 * The chat as a 1280 × 720 screen picture (what the fake monitor of the capture scene shows).
 * Next to it, <file>.json: where the answer and its three questions are on that screen ({ reply, questions: [{ x, y, width, height }] }), for the scene to mark
 */
export async function renderScreen(file) {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(chatHtml);
  await page.evaluate(() => document.fonts.ready);
  const boxes = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    return { reply: box(document.getElementById("reply")), questions: [...document.querySelectorAll(".q")].map(box) };
  });
  writeFileSync(`${file}.json`, JSON.stringify(boxes));
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

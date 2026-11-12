// The sample material of the README scenes. Everything here is made up, for four kinds of work people hand to an AI:
// a web page (the landing page of a sparkling-water brand), a video (an animated teaser in four shots), a poster (a summer music festival)
// and an illustration (a picture-book cover). Each has small flaws for the notes to point out, and the page and the poster also exist
// as they look after the notes were applied.
// The pictures in assets/ are AI-generated and carry no text; the page, the poster, the screen and the clip are rendered with headless Edge,
// so they are real pictures and a real video file, not drawings of an interface.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const assets = join(dirname(fileURLToPath(import.meta.url)), "assets");
const dataUrl = (file) => "data:image/jpeg;base64," + readFileSync(join(assets, file)).toString("base64");
const FONT = '"Segoe UI Variable Display", "Segoe UI", sans-serif';
const INK = "#0b3d3a";
const CORAL = "#ff5a5f";

/**
 * The landing page at 1600 × 1000: a can in a splash on the right, the words on the left.
 * Flaws: the headline is too thin, the button is a dull gray, a loud sticker sits next to the can.
 *   fixed: the page after the notes were applied (bold headline, coral button, no sticker)
 *   banner: the wide variant used as the second image of the project (a headline only)
 */
export function landingHtml({ fixed = false, banner = false } = {}) {
  return `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1600px; height: 1000px; font-family: ${FONT}; color: ${INK};
         background: #b4f4ec url(${dataUrl("soda-can.jpg")}) center / cover no-repeat; overflow: hidden; position: relative; }
  nav { position: absolute; top: 48px; left: 96px; right: 96px; display: flex; align-items: center; justify-content: space-between; font-size: 22px; }
  nav .logo { font-weight: 800; letter-spacing: 0.06em; }
  nav .links { display: flex; gap: 40px; }
  h1 { position: absolute; top: ${banner ? 150 : 250}px; left: 96px; width: 760px; font-size: 92px; line-height: 1.02; font-weight: ${fixed || banner ? 800 : 200}; letter-spacing: -0.02em; }
  p { position: absolute; top: 500px; left: 100px; width: 560px; font-size: 26px; line-height: 1.5; color: #24615c; }
  .cta { position: absolute; top: 640px; left: 100px; padding: 22px 44px; border-radius: 999px; background: ${fixed ? CORAL : "#8d99a6"}; color: #fff; font-size: 24px; font-weight: 600; }
  .ghost { position: absolute; top: 646px; left: 356px; font-size: 22px; color: #24615c; padding: 18px 8px; }
  .sticker { position: absolute; left: 1338px; top: 96px; width: 150px; height: 150px; transform: rotate(14deg); display: grid; place-items: center;
             color: #fff; font-size: 34px; font-weight: 900; letter-spacing: 0.02em; }
  .sticker svg { position: absolute; inset: 0; }
  .sticker span { position: relative; }
</style></head><body>
  <nav><div class="logo">RUBY POP</div><div class="links"><span>Flavors</span><span>Find a store</span><span>Our story</span></div></nav>
  <h1>${banner ? "A new flavor every month." : "Grapefruit,<br>with bubbles."}</h1>
  ${banner ? "" : "<p>Real juice, fine bubbles and no added sugar, delivered cold to your door.</p>"}
  <div class="cta">Get a case</div><div class="ghost">See all flavors →</div>
  ${
    fixed || banner
      ? ""
      : `<div class="sticker"><svg viewBox="-100 -100 200 200"><polygon fill="#e4002b" points="${Array.from({ length: 28 }, (_, i) => {
          const r = i % 2 ? 78 : 100;
          const a = (i / 28) * 2 * Math.PI;
          return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
        }).join(" ")}"/></svg><span>NEW!!</span></div>`
  }
</body></html>`;
}

/**
 * The second sample: the key visual of a summer music festival, as a poster (1200 × 1500) or a wide flyer (1500 × 1000).
 * Flaws: the title is too small and the date has too little contrast.
 *   fixed: the flyer after the notes were applied (a large title, a readable date, the opening time)
 */
export function posterHtml({ wide = false, fixed = false } = {}) {
  return `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${wide ? 1500 : 1200}px; height: ${wide ? 1000 : 1500}px; font-family: ${FONT};
         background: #ffe500 url(${dataUrl("festival-art.jpg")}) ${wide ? "center / cover" : "center 62% / auto 72%"} no-repeat; overflow: hidden; position: relative; }
  .title { position: absolute; top: ${fixed ? 34 : 84}px; left: 0; right: 0; text-align: center; font-size: ${fixed ? 150 : 60}px; font-weight: ${fixed ? 900 : 300};
           letter-spacing: ${fixed ? 0.02 : 0.24}em; color: #0a1ef0; }
  .sub { position: absolute; top: ${fixed ? 206 : 166}px; left: 0; right: 0; text-align: center; font-size: 26px; font-weight: 600; letter-spacing: 0.3em; color: #ff0a7a; }
  .date { position: absolute; bottom: ${wide ? 34 : 60}px; left: 0; right: 0; text-align: center; font-size: 40px; letter-spacing: 0.06em;
          color: ${fixed ? "#ffffff" : "#3a4cff"}; font-weight: ${fixed ? 700 : 400}; }
</style></head><body>
  <div class="title">SUNBURST</div><div class="sub">SUMMER MUSIC FESTIVAL</div>
  <div class="date">July 18–20 · Harbor Park${fixed ? " · Gates open 2 PM" : ""}</div>
</body></html>`;
}

/** Renders the poster and the wide flyer to PNG files in dir: poster.png, flyer.png, and flyer-after.png (the flyer after its notes were applied) */
export async function renderPoster(dir) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
  await page.setContent(posterHtml());
  await page.screenshot({ path: join(dir, "poster.png") });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.setContent(posterHtml({ wide: true }));
  await page.screenshot({ path: join(dir, "flyer.png") });
  await page.setContent(posterHtml({ wide: true, fixed: true }));
  await page.screenshot({ path: join(dir, "flyer-after.png") });
  await browser.close();
}

/** The illustration (1500 × 1000) as a PNG file: a picture-book cover with two moons in its sky */
export async function renderIllustration(file) {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.setContent(
    `<body style="margin:0"><img src="${dataUrl("illustration.jpg")}" style="display:block;width:1500px;height:1000px"></body>`,
  );
  await page.screenshot({ path: file });
  await browser.close();
}

/**
 * The teaser: 20 seconds at 24 frames per second, 1280 × 720. Four shots that look different from each other (so a picture of four of its
 * frames is not four times the same picture), each with a slow camera move, then the closing card:
 * 0–3 s the town at dawn, 3–6 s a close-up, 6–9 s the ride downhill, 9–12 s the lantern market, 12–20 s the brand
 */
export const CLIP_SECONDS = 20;
const clipHtml = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1280px; height: 720px; overflow: hidden; position: relative; font-family: ${FONT}; background: #000; }
  .shot { position: absolute; inset: 0; overflow: hidden; display: none; }
  .shot div { position: absolute; inset: 0; background-size: cover; background-position: center; }
  #s5 { background: linear-gradient(135deg, #ffb703 0%, #ff5a5f 55%, #e0338a 100%); color: #fff; text-align: center; }
  #end { position: absolute; top: 250px; left: 0; right: 0; font-size: 120px; font-weight: 900; letter-spacing: 0.04em; }
  #line { position: absolute; top: 410px; left: 0; right: 0; font-size: 34px; font-weight: 500; }
</style></head><body>
  ${[1, 2, 3, 4].map((i) => `<div class="shot" id="s${i}"><div id="p${i}" style="background-image: url(${dataUrl(`film-${i}.jpg`)})"></div></div>`).join("")}
  <div class="shot" id="s5"><div id="end" style="position:absolute; inset:auto; top:250px; left:0; right:0">RUBY POP</div><div id="line" style="position:absolute; inset:auto; top:410px; left:0; right:0">Summer, in a can.</div></div>
<script>
  const $ = (id) => document.getElementById(id);
  const CUTS = [0, 3, 6, 9, 12];
  const mix = (a, b, x) => a + (b - a) * Math.min(1, Math.max(0, x));
  window.setT = (t) => {
    const n = CUTS.filter((c) => t >= c).length;
    for (let i = 1; i <= 5; i++) $("s" + i).style.display = i === n ? "block" : "none";
    const x = (t - CUTS[n - 1]) / 3;
    $("p1").style.transformOrigin = "32% 82%";
    $("p1").style.transform = "scale(" + mix(1, 1.1, x) + ")";
    $("p2").style.transformOrigin = "60% 30%";
    $("p2").style.transform = "scale(" + mix(1.08, 1, x) + ")";
    $("p3").style.transform = "scale(1.08) translateX(" + mix(3, -3, x) + "%)";
    $("p4").style.transformOrigin = "50% 60%";
    $("p4").style.transform = "scale(" + mix(1, 1.08, x) + ")";
    $("end").style.opacity = mix(0, 1, (t - 12) / 0.8);
    $("end").style.transform = "scale(" + mix(0.92, 1, (t - 12) / 0.8) + ")";
    $("line").style.opacity = mix(0, 1, (t - 13) / 0.8);
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
 * A chat with an AI agent as a 1280 × 720 screen: a long answer that ends with three questions, each with two options to look at
 * (color palettes, headline weights, hero pictures). A made-up, generic chat window: it is not the interface of any product
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
  .col { width: 760px; margin: 0 auto; padding-top: 18px; }
  .me { margin-left: auto; width: fit-content; max-width: 520px; background: #eef0f3; border-radius: 18px 18px 4px 18px; padding: 10px 16px; font-size: 16px; line-height: 1.45; }
  .who { display: flex; align-items: center; gap: 10px; margin: 14px 0 8px; font-size: 14px; font-weight: 600; color: #57606a; }
  .who i { width: 24px; height: 24px; border-radius: 7px; background: linear-gradient(135deg, #2f3640, #6b7684); }
  .ai { font-size: 18px; line-height: 1.5; }
  .ai p { margin-bottom: 8px; }
  .ai code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 15px; background: #eef0f3; border-radius: 5px; padding: 2px 6px; }
  .ai .q { padding: 8px 12px; margin: 0 -12px 6px; }
  .ai b { font-weight: 700; }
  .opts { display: flex; gap: 28px; margin-top: 8px; align-items: center; font-size: 15px; color: #57606a; }
  .opt { display: flex; align-items: center; gap: 10px; }
  .sw { display: flex; border-radius: 9px; overflow: hidden; box-shadow: 0 1px 4px rgba(20, 30, 50, 0.18); }
  .sw i { width: 40px; height: 40px; }
  .type { font-family: ${FONT}; font-size: 30px; color: ${INK}; letter-spacing: -0.01em; }
  .thumb { width: 150px; height: 94px; border-radius: 9px; background-size: cover; background-position: 70% center; box-shadow: 0 1px 4px rgba(20, 30, 50, 0.18); }
  .box { position: absolute; left: 0; right: 0; bottom: 14px; }
  .box div { width: 760px; margin: 0 auto; border: 1px solid #d5d9df; border-radius: 16px; background: #fff; padding: 12px 18px; font-size: 16px; color: #8b949e;
             display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 10px rgba(20, 30, 50, 0.06); }
  .box span { width: 30px; height: 30px; border-radius: 50%; background: #1f2328; color: #fff; display: grid; place-items: center; font-size: 16px; }
</style></head><body>
  <aside>
    <div class="new">+ New chat</div>
    <div class="cap">Today</div>
    <div class="item on">Ruby Pop landing page</div>
    <div class="item">Festival poster ideas</div>
    <div class="cap" style="margin-top: 18px">Earlier</div>
    <div class="item">Picture-book cover</div>
    <div class="item">Teaser storyboard</div>
    <div class="item">Newsletter template</div>
  </aside>
  <main>
    <div class="col">
      <div class="me">Build the landing page from the brief. Ask me if anything is unclear.</div>
      <div class="who"><i></i>Agent</div>
      <div class="ai" id="reply">
        <p>The first version of the landing page is ready in <code>ruby-pop-launch/index.html</code>. Before I go on, three things are yours to decide:</p>
        <div class="q"><b>1. Palette.</b> Cool and fresh, or warm like the can?
          <div class="opts"><div class="opt">A<div class="sw"><i style="background:#b4f4ec"></i><i style="background:#3ccfc0"></i><i style="background:#0b3d3a"></i><i style="background:#ffffff"></i></div></div>
          <div class="opt">B<div class="sw"><i style="background:#ffd23f"></i><i style="background:#ff8c42"></i><i style="background:#ff5a5f"></i><i style="background:#e0338a"></i></div></div></div></div>
        <div class="q"><b>2. Headline.</b> Light and airy, or bold?
          <div class="opts"><div class="opt">A<span class="type" style="font-weight:200">with bubbles.</span></div><div class="opt">B<span class="type" style="font-weight:800">with bubbles.</span></div></div></div>
        <div class="q"><b>3. Hero picture.</b> I made two. Which one goes on the page?
          <div class="opts"><div class="opt">A<div class="thumb" style="background-image:url(${dataUrl("soda-can.jpg")})"></div></div><div class="opt">B<div class="thumb" style="background-image:url(${dataUrl("soda-can-alt.jpg")})"></div></div></div></div>
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

/** The teaser as an H.264 MP4 with a key frame every half second (scrubbing lands on them) */
export async function renderClip(file) {
  const frames = mkdtempSync(join(tmpdir(), "clip-"));
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(clipHtml);
  for (let i = 0; i < CLIP_SECONDS * 24; i++) {
    await page.evaluate((t) => window.setT(t), i / 24);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.jpg`), quality: 95 });
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
      join(frames, "f%04d.jpg"),
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

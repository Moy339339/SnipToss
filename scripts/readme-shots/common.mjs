// Shared pieces of the README screenshot scenes (scripts/readme-shots.mjs): the sample project, a test instance with its own settings,
// and drawing notes through the real UI (mouse and keyboard events over CDP), plus a recorder for the animated scenes.
// Nothing here touches the everyday settings (SNIPTOSS_SETTINGS points to a temp folder) or the clipboard.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The sample project lives under %TEMP%\Projects: the library shows the containing folder ("…\Temp\Projects"), so no other path is exposed */
export const PROJECTS = join(tmpdir(), "Projects");
export const PROJECT = join(PROJECTS, "slow-pour-site");
/** The second sample project (a poster), for pictures that must not repeat the first */
export const PROJECT2 = join(PROJECTS, "late-night-jazz");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function wait(what, fn, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/** The notes written in the scenes, per UI language. The first three are the ones every still uses; the pen note is only drawn in the marking scene */
export const NOTES = {
  en: {
    title: "Title is too thin and gets lost on the background. Use a bold weight.",
    button: "Button color doesn't match the brand. Use the coffee brown #6B3F25.",
    mark: "Remove the stock watermark.",
    pen: "The stream is too thin. Make it thicker and slower.",
    steam: "The push-in is too fast here. Slow it down.",
    late: "The title fades in too late. Show it from the first frame.",
    screen: "Headline is too thin. Use a bold weight.",
    screenButton: "Button color doesn't match the brand.",
    posterTitle: "Title is too small for a poster. Make it twice as large.",
    posterDate: "Date and time are hard to read. Add more contrast.",
    posterPin: "Add the venue address next to the date.",
  },
  "zh-CN": {
    title: "标题字太细，压在背景上看不清，改成粗体。",
    button: "按钮颜色和品牌不搭，改成咖啡棕 #6B3F25。",
    mark: "去掉图库水印。",
    pen: "咖啡柱太细，加粗一点，再慢一点。",
    steam: "这里推近得太快，放慢一点。",
    late: "标题出现得太晚，从第一帧就显示。",
    screen: "标题字太细，改成粗体。",
    screenButton: "按钮颜色和品牌不搭。",
    posterTitle: "海报标题太小，放大一倍。",
    posterDate: "日期和时间看不清，加强对比。",
    posterPin: "在日期旁补上场地地址。",
  },
};

/** A test instance with the given UI language, showing only the given library. Returns the connected page and a close() that ends the process tree */
export async function launch(
  exe,
  { locale, dataDir, library, expanded = [], placement = { Left: 60, Top: 60, Width: 1280, Height: 800 }, capture = {}, prefs = {} },
) {
  mkdirSync(dataDir, { recursive: true });
  const settings = join(dataDir, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({
      Library: library.map((Path) => ({ Path, Pinned: false })),
      Expanded: expanded,
      Placement: placement,
      // The tour and the first-use hints count as seen, so they aren't in the pictures
      Prefs: { language: locale, onboarding: ["tour", "hint.copy", "hint.video"], ...prefs },
      Capture: { Hotkey: "", KeepInTray: false, TrayHintShown: true, SelectHintDone: true, ...capture },
      Migrations: 1,
    }),
  );
  const proc = spawn(exe, [], {
    env: {
      ...process.env,
      SNIPTOSS_SETTINGS: settings,
      // This variable replaces the browser arguments the app sets itself, so the autoplay one is repeated here (videos play on a key press)
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=0 --autoplay-policy=no-user-gesture-required",
    },
    stdio: "ignore",
  });
  const portFile = join(dataDir, "WebView2", "EBWebView", "DevToolsActivePort");
  const port = await wait("the debugging port", () => existsSync(portFile) && Number(readFileSync(portFile, "utf8").split("\n")[0]));
  const app = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await wait("the UI", () =>
    app
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => !p.url().startsWith("edge://")),
  );
  await page.locator(".lib-row").first().waitFor({ timeout: 30_000 }); // the UI is up (the page can still be reloading before this)
  const ask = (method, params) =>
    page.evaluate(
      ([m, p]) =>
        new Promise((resolve, reject) => {
          const wv = window.chrome.webview;
          const id = 910000 + Math.floor(Math.random() * 1000);
          const on = (e) => {
            if (e.data?.id !== id) return;
            wv.removeEventListener("message", on);
            if (e.data.error !== undefined) reject(new Error(e.data.error));
            else resolve(e.data.result);
          };
          wv.addEventListener("message", on);
          wv.postMessage({ id, method: m, params: p });
        }),
      [method, params ?? null],
    );
  const callHost = (method, params) =>
    page.evaluate(
      ([m, p]) => window.chrome.webview.postMessage({ id: 900000 + Math.floor(Math.random() * 1000), method: m, params: p }),
      [method, params ?? null],
    );
  const close = async () => {
    await app.close().catch(() => {});
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    await sleep(1500);
  };
  return { proc, app, page, ask, callHost, close, dataDir };
}

/**
 * Records the page as a series of JPEG frames with their times, at 2× so a part of the window can be shown enlarged and still be sharp.
 * (A CDP screencast would be smoother but only delivers the window's own pixels, 1×; asking for a 2× screenshot in a loop gets about 15 frames per second.)
 * stop() writes frames.json: [{ file, ms }]
 */
export class Recorder {
  constructor(page, dir, { scale = 2, quality = 92 } = {}) {
    this.page = page;
    this.dir = dir;
    this.scale = scale;
    this.quality = quality;
    this.frames = [];
  }
  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    const size = await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const t = Date.now();
        const { data } = await this.cdp.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: this.quality,
          clip: { x: 0, y: 0, ...size, scale: this.scale },
        });
        const file = `f${String(this.frames.length).padStart(5, "0")}.jpg`;
        writeFileSync(join(this.dir, file), Buffer.from(data, "base64"));
        this.frames.push({ file, t });
      }
    })();
  }
  /** hold = how long the last frame stays on screen (ms) */
  async stop(hold = 2500) {
    this.running = false;
    await this.loop;
    const out = this.frames.map((f, i) => ({ file: f.file, ms: this.frames[i + 1] ? this.frames[i + 1].t - f.t : hold }));
    writeFileSync(join(this.dir, "frames.json"), JSON.stringify(out));
    console.log(`Recorded ${out.length} frames: ${this.dir}`);
    return out;
  }
}

/** A freehand stroke through the given points (positions as fractions of the image box) */
export async function stroke(page, box, points, steps = 3) {
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  const [x0, y0] = at(points[0]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const [x, y] = at(p);
    await page.mouse.move(x, y, { steps });
  }
  await page.mouse.up();
}

/** Points of an ellipse (fractions of the image box), for a hand-drawn circle with the pen */
export const ellipse = (cx, cy, rx, ry, n = 22, from = -0.3) =>
  Array.from({ length: n + 3 }, (_, i) => {
    const a = from * Math.PI + (i / n) * 2 * Math.PI;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });

/**
 * Draws marks on the open image and writes a note about them, through the real UI.
 *   tool: the key of the tool (c pin, r rectangle, a arrow, b pen); marks: one entry per place, { from, to } (to missing = a click; for the pen, { points });
 *   more than one entry = one note on several places (the note box stays open while the next mark is drawn)
 *   pace: { steps, type, after, between } = mouse move steps, ms per typed character, ms to rest afterwards, ms between two marks of one note
 *   target: what the marks are drawn on ("img.zoom-media" for a picture, "video" for a clip, where clicking the canvas first would toggle playback)
 */
export async function drawNote(page, { tool, marks, text, category, pace, target = "img.zoom-media" }) {
  if (target === "img.zoom-media") await page.locator(".stage").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press(tool);
  const box = await page.locator(target).boundingBox(); // the picture itself (the canvas is larger than it)
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  for (const [i, m] of marks.entries()) {
    if (m.points) await stroke(page, box, m.points, 2);
    else {
      const [x1, y1] = at(m.from);
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      if (m.to) {
        const [x2, y2] = at(m.to);
        await page.mouse.move(x2, y2, { steps: pace.steps });
      }
      await page.mouse.up();
    }
    if (i === 0) await page.locator(".composer-text").waitFor({ timeout: 8000 });
    await sleep(pace.between ?? 250);
  }
  if (category) await page.keyboard.press(`Alt+${category}`);
  await page.locator(".composer-text").pressSequentially(text, { delay: pace.type });
  await page.keyboard.press("Enter");
  await sleep(pace.after);
}

/** The toast shown when the first note is written in a project says where notes are stored (with the full path): wait for it to go, or remove it from the page */
export async function dismissToast(page) {
  await page
    .locator(".toast")
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove())));
}

/** A PNG of the page (or of a box on it) at the given scale (2 = twice the pixels, crisp: the page is drawn again at that scale, not stretched) */
export async function pageShot(page, file, scale = 1, box = null) {
  const cdp = await page.context().newCDPSession(page);
  const size = box ?? { x: 0, y: 0, ...(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))) };
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...size, scale } });
  writeFileSync(file, Buffer.from(data, "base64"));
  await cdp.detach();
  console.log(`Saved: ${file}`);
}

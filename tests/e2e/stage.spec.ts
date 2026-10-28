// The canvas and playback:
// opening and file info, the empty state, Fit / Fill / zoom / pan, the blurred surround, the play bar (play, progress, speed, loop, mute, skip forward and back),
// notes on the play bar and on the canvas, switching items, an item replaced in place, the toolbar

import { copyFileSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";
import { stripedPng } from "./png";

const row = (app: App, name: string) => app.page.locator(".lib-row", { hasText: name }).first();
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const label = (app: App) => app.page.locator(".zoom-label");
const hud = (app: App) => app.page.locator(".hud");
const menuItem = (app: App, text: string | RegExp) => app.page.locator(".menu .menu-item", { hasText: text });
const topMenu = (app: App, name: string) => app.page.locator(".menubar button", { hasText: name }).click();
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const toolBtn = (app: App, name: string) => app.page.locator(`.hdr-tools .tool-btn[aria-label="${name}"]`);
const playBtn = (app: App) => app.page.locator(".transport .icon-btn").first();
const rateBtn = (app: App) => app.page.locator(".transport .text-btn");
const loopBtn = (app: App) => app.page.locator(".transport .icon-btn").nth(1);
const muteBtn = (app: App) => app.page.locator(".transport .icon-btn").nth(2);
/** Clicks a button and moves the mouse away (while the pointer rests on the button, the tooltip bubble takes the title away and it can't be read) */
async function press(app: App, target: ReturnType<App["page"]["locator"]>) {
  await target.click();
  await app.page.mouse.move(1, 1);
}

async function open(app: App, name: string) {
  await row(app, name).click();
  await expect(app.page).toHaveTitle(name);
}

async function box(app: App, selector: string) {
  return (await app.page.locator(selector).boundingBox())!;
}

/** The canvas's current position and scale (ZoomView writes them straight onto transform) */
const view = (app: App) =>
  app.page.locator(".zoom-content").evaluate((el) => {
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec((el as HTMLElement).style.transform)!;
    return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
  });

/** Which point of the canvas (in item pixels) is under screen position (x, y) */
async function pointAt(app: App, x: number, y: number) {
  const vb = await box(app, ".zoom-view");
  const v = await view(app);
  return { x: (x - vb.x - v.x) / v.scale, y: (y - vb.y - v.y) / v.scale };
}

const video = (app: App) =>
  app.page.evaluate(() => {
    const v = document.querySelector("video")!;
    return {
      paused: v.paused,
      ended: v.ended,
      time: Math.round(v.currentTime * 1000) / 1000,
      rate: v.playbackRate,
      muted: v.muted,
      volume: Math.round(v.volume * 100),
      loop: v.loop,
    };
  });

/** Opens the fixture video (3 seconds, 15fps, 320×180) and waits until it can play */
async function openClip(app: App) {
  await open(app, "clip.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
}

async function seek(app: App, t: number) {
  await app.page.evaluate((seconds) => {
    document.querySelector("video")!.currentTime = seconds;
  }, t);
  await expect.poll(async () => (await video(app)).time).toBe(t);
}

/** The screen coordinates at fraction p of the play bar */
async function trackAt(app: App, p: number) {
  const b = await box(app, ".track");
  return [b.x + b.width * p, b.y + b.height / 2] as const;
}

/** Adds a few notes to a fixture notes file */
function addNotes(app: App, file: string, notes: Record<string, unknown>[]) {
  const path = join(app.project, ".sniptoss", "annotations", file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  for (const n of notes)
    data.annotations.push({
      status: "open",
      category: "change",
      author: "user",
      created_at: "2026-10-13T02:22:00Z",
      updated_at: "2026-10-13T02:22:00Z",
      replies: [],
      ...n,
    });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

// ---------- Opening, file info, empty state ----------

test("opening an image: the window title and the header show the file name followed by the image type, size in pixels and file size, with the full path on hover; the image only fades in and the dimensions are only written once it has loaded", async ({ app }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await app.page.route(/poster\.jpg/, async (route) => {
    await gate;
    await route.fallback();
  });
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(app.page.locator(".hdr-name")).toHaveText("hero.png");
  await expect(app.page.locator(".hdr-meta")).toHaveText("图片 · 640×360 · 26 KB");
  await expect(app.page.locator(".hdr-file")).toHaveAttribute("title", /assets[\\/]hero\.png$/);
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);

  // The image hasn't arrived yet: the canvas isn't shown and the dimensions aren't written yet
  await row(app, "poster.jpg").click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(app.page.locator(".hdr-meta")).toHaveText("图片 · 7 KB");
  await expect(app.page.locator(".zoom-content")).not.toHaveClass(/is-ready/);
  release();
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);
  await expect(app.page.locator(".hdr-meta")).toHaveText("图片 · 360×450 · 7 KB");

  await open(app, "clip.mp4");
  await expect(app.page.locator(".hdr-meta")).toHaveText("视频 · 320×180 · 26 KB");
});

test("with entries in the library but no item selected, the middle of the canvas asks you to pick one on the left and the header says no item is selected; while the list is still loading nothing is written", async ({ app }) => {
  const empty = join(app.temp, "empty");
  mkdirSync(empty);
  app.host.entries = [{ path: empty, pinned: false }];
  app.host.delays.library = 3000;
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".stage-header")).toBeVisible();
  await expect(app.page.locator(".stage > .stage-empty")).toHaveText("");
  await expect(app.page.locator(".welcome")).toHaveCount(0);
  await expect(app.page.locator(".stage > .stage-empty")).toHaveText("在左侧素材栏中选择一个素材开始批注", { timeout: 10_000 });
  await expect(app.page.locator(".hdr-meta")).toHaveText("未选择素材");
});

// ---------- Fit, Fill, zoom, pan ----------

/** The space left around the picture in the canvas area: left equals right, top equals bottom, and the narrowest side is margin */
async function expectFits(app: App, margin: number) {
  const v = await box(app, ".zoom-view");
  const c = await box(app, ".zoom-content");
  const left = c.x - v.x;
  const right = v.x + v.width - (c.x + c.width);
  const top = c.y - v.y;
  const bottom = v.y + v.height - (c.y + c.height);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(Math.min(left, top) - margin)).toBeLessThanOrEqual(1);
  return c;
}

test("Fit to Window by default: the whole picture is centered with 16 px at the narrowest side; a picture smaller than the canvas area is enlarged to just fit; it refits when the window changes; videos have no margin", async ({ app }) => {
  await app.page.setViewportSize({ width: 1920, height: 1080 });
  await app.open();
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);
  await expect(label(app)).toContainText("适合");
  const big = await expectFits(app, 16);
  expect(big.width).toBeGreaterThan(640); // There is no cap at 100%

  await app.page.setViewportSize({ width: 1100, height: 700 });
  await expect(async () => {
    const c = await expectFits(app, 16);
    expect(c.width).toBeLessThan(big.width - 100);
  }).toPass();
  await expect(label(app)).toContainText("适合");

  await openClip(app);
  await expect(async () => void (await expectFits(app, 0))).toPass();
});

test("very wide or very long images: Fit to Window still fits the whole picture (not held back by the 5% lower limit); zooming out after fitting never makes it larger", async ({ app }) => {
  writeFileSync(join(app.project, "assets", "wide.png"), stripedPng(20_000, 500));
  await app.open();
  await open(app, "wide.png");
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);
  await expect(label(app)).toContainText("适合");
  const v = await box(app, ".zoom-view");
  const c = await box(app, ".zoom-content");
  expect(c.x).toBeGreaterThanOrEqual(v.x);
  expect(c.x + c.width).toBeLessThanOrEqual(v.x + v.width);
  const fit = (await view(app)).scale;
  await focusStage(app);
  await app.page.keyboard.press("Control+-");
  await expect(label(app)).not.toContainText("适合");
  expect((await view(app)).scale).toBeLessThanOrEqual(fit);
});

test("Ctrl+wheel zooms around the mouse position (that point stays fixed) and the factor follows the scroll amount; it stops at 3200% and 5%", async ({ app }) => {
  await app.open();
  await focusStage(app);
  // Zoom in first until the picture overflows the canvas area on every side, otherwise "that point stays fixed" can't be seen (a direction that doesn't fill gets centered)
  for (let i = 0; i < 4; i++) await app.page.keyboard.press("Control+=");
  const vb = await box(app, ".zoom-view");
  const [mx, my] = [vb.x + 200, vb.y + 300];
  await app.page.mouse.move(mx, my);
  const before = await pointAt(app, mx, my);
  const s0 = (await view(app)).scale;
  await app.page.keyboard.down("Control");
  await app.page.mouse.wheel(0, -100);
  await expect.poll(async () => (await view(app)).scale).toBeGreaterThan(s0);
  const s1 = (await view(app)).scale;
  expect(s1 / s0).toBeCloseTo(Math.exp(0.25), 3);
  const after = await pointAt(app, mx, my);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await expect(label(app)).toHaveText(`${Math.round(s1 * 100)}%`);

  for (let i = 0; i < 3; i++) await app.page.mouse.wheel(0, -1000);
  await expect(label(app)).toHaveText("3200%");
  for (let i = 0; i < 4; i++) await app.page.mouse.wheel(0, 1000);
  await expect(label(app)).toHaveText("5%");
  await app.page.keyboard.up("Control");
});

test("the − and + zoom buttons, Ctrl -, Ctrl = and Ctrl +: each step multiplies by 0.8 / 1.25 with the center of the canvas area staying fixed; they stop at 3200% / 5%; Ctrl 0 returns to Fit", async ({
  app,
}) => {
  writeFileSync(join(app.project, "assets", "big.png"), stripedPng(2000, 1200));
  await app.open();
  await open(app, "big.png");
  await focusStage(app);
  await app.page.keyboard.press("Shift+0"); // 100%: the picture is larger than the canvas area, so the center point can be told apart
  await expect(label(app)).toHaveText("100%");
  // Move it aside first so the center isn't the middle of the picture (at the middle, being centered would also count as "not moving")
  await toolBtn(app, "抓手").click();
  const vb = await box(app, ".zoom-view");
  await app.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(vb.x + vb.width / 2 + 150, vb.y + vb.height / 2 + 80, { steps: 3 });
  await app.page.mouse.up();
  const center = async () => pointAt(app, vb.x + vb.width / 2, vb.y + vb.height / 2);
  const c0 = await center();
  expect(c0.x).toBeLessThan(900);
  await app.page.locator(".zoom-btn").last().click();
  await expect(label(app)).toHaveText("125%");
  const c1 = await center();
  expect(c1.x).toBeCloseTo(c0.x, 0);
  expect(c1.y).toBeCloseTo(c0.y, 0);
  await app.page.locator('.zoom-btn[title^="缩小"]').click();
  await expect(label(app)).toHaveText("100%");
  await app.page.keyboard.press("Control+-");
  await expect(label(app)).toHaveText("80%");
  await app.page.keyboard.press("Control+=");
  await expect(label(app)).toHaveText("100%");
  await app.page.keyboard.press("Control+Shift+Equal"); // Ctrl +
  await expect(label(app)).toHaveText("125%");
  for (let i = 0; i < 20; i++) await app.page.keyboard.press("Control+=");
  await expect(label(app)).toHaveText("3200%");
  for (let i = 0; i < 30; i++) await app.page.keyboard.press("Control+-");
  await expect(label(app)).toHaveText("5%");
  await app.page.keyboard.press("Control+0");
  await expect(label(app)).toContainText("适合");
});

test("zoom menu: clicking the zoom label opens it upward, the current zoom is checked and each entry goes where it says; the last entry toggles the blurred surround", async ({ app }) => {
  await app.open();
  await label(app).click();
  await expect(app.page.locator(".menu .menu-item")).toHaveText([
    "适合窗口Shift 1",
    "铺满窗口Shift 2",
    "50%",
    "100%Shift 0",
    "200%",
    "画面四周模糊铺满",
  ]);
  const labelBox = await box(app, ".zoom-label");
  const menuBox = await box(app, ".menu");
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(labelBox.y + 1);
  await expect(menuItem(app, "适合窗口").locator(".menu-icon svg")).toHaveCount(1);
  await expect(menuItem(app, "铺满窗口").locator(".menu-icon svg")).toHaveCount(0);
  await expect(menuItem(app, "画面四周模糊铺满").locator(".menu-icon svg")).toHaveCount(1);

  for (const [item, shown] of [
    ["100%", "100%"],
    ["铺满窗口", "铺满"],
    ["50%", "50%"],
    ["200%", "200%"],
    ["适合窗口", "适合"],
  ]) {
    if (!(await app.page.locator(".menu").isVisible())) await label(app).click();
    await menuItem(app, new RegExp(`^${item}`)).click();
    await expect(label(app)).toContainText(shown);
    await label(app).click();
    await expect(menuItem(app, new RegExp(`^${item}`)).locator(".menu-icon svg")).toHaveCount(1);
    await app.page.keyboard.press("Escape");
  }

  await label(app).click();
  await menuItem(app, "画面四周模糊铺满").click();
  await expect(app.page.locator(".ambient")).toHaveCount(0);
  await expect.poll(() => app.host.prefs?.backdrop).toBe("plain");
  await label(app).click();
  await expect(menuItem(app, "画面四周模糊铺满").locator(".menu-icon svg")).toHaveCount(0);
  await menuItem(app, "画面四周模糊铺满").click();
  await expect(app.page.locator(".ambient")).toHaveClass(/is-on/);
  // Back to the default: no longer written to the settings file (only changed items are stored, see storedPrefs in prefs.ts)
  await expect.poll(() => app.host.prefs?.backdrop).toBeUndefined();
});

test("Fill Window (Shift 2): covers the canvas area and starts at the center; when the window changes it refills, with the point under the center of the canvas area staying fixed", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Shift+2");
  await expect(label(app)).toContainText("铺满");
  const covers = async () => {
    const v = await box(app, ".zoom-view");
    const c = await box(app, ".zoom-content");
    expect(c.x).toBeLessThanOrEqual(v.x + 0.5);
    expect(c.y).toBeLessThanOrEqual(v.y + 0.5);
    expect(c.x + c.width).toBeGreaterThanOrEqual(v.x + v.width - 0.5);
    expect(c.y + c.height).toBeGreaterThanOrEqual(v.y + v.height - 0.5);
    return { width: v.width, cx: (v.x + v.width / 2 - c.x) / c.width, cy: (v.y + v.height / 2 - c.y) / c.height };
  };
  const first = await covers();
  expect(first.cx).toBeCloseTo(0.5, 2);
  expect(first.cy).toBeCloseTo(0.5, 2);
  // Shift it to the right and then change the window: the point under the center is still the one after the shift
  const vb = await box(app, ".zoom-view");
  await app.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await app.page.keyboard.down("Shift");
  await app.page.mouse.wheel(0, 100);
  await app.page.keyboard.up("Shift");
  await expect.poll(async () => (await covers()).cx).toBeGreaterThan(0.55);
  const moved = await covers();
  await app.page.setViewportSize({ width: 1200, height: 760 });
  await expect(async () => {
    const now = await covers();
    expect(now.width).toBeLessThan(moved.width);
    expect(now.cx).toBeCloseTo(moved.cx, 2);
    expect(now.cy).toBeCloseTo(moved.cy, 2);
  }).toPass();
  await expect(label(app)).toContainText("铺满");
});

test("filling with a wide picture (it only overflows left and right): the plain wheel pans left and right too (it used to do nothing); Shift+wheel works as before", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Shift+2");
  await expect(label(app)).toContainText("铺满");
  const vb = await box(app, ".zoom-view");
  const c0 = await box(app, ".zoom-content");
  expect(c0.height).toBeLessThanOrEqual(vb.height + 0.5);
  expect(c0.width).toBeGreaterThan(vb.width + 100);
  const x = async () => (await box(app, ".zoom-content")).x;
  await app.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await app.page.mouse.wheel(0, 40);
  await expect.poll(x).toBeCloseTo(c0.x - 40, 0);
  await app.page.mouse.wheel(0, -40);
  await expect.poll(x).toBeCloseTo(c0.x, 0);
  await app.page.keyboard.down("Shift");
  await app.page.mouse.wheel(0, 40);
  await app.page.keyboard.up("Shift");
  await expect.poll(x).toBeCloseTo(c0.x - 40, 0);
});

test("double-clicking the canvas: from Fit / Fill it zooms to 100% around the clicked point, and another double-click returns to Fit", async ({ app }) => {
  writeFileSync(join(app.project, "assets", "big.png"), stripedPng(2000, 1200)); // At 100% it is larger than the canvas area, so the clicked point staying fixed can be seen
  await app.open();
  await open(app, "big.png");
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);
  const c0 = await box(app, ".zoom-content");
  const [px, py] = [c0.x + c0.width * 0.25, c0.y + c0.height * 0.6];
  const p0 = await pointAt(app, px, py);
  await app.page.mouse.dblclick(px, py);
  await expect(label(app)).toHaveText("100%");
  const p1 = await pointAt(app, px, py);
  expect(p1.x).toBeCloseTo(p0.x, 0);
  expect(p1.y).toBeCloseTo(p0.y, 0);
  await app.page.mouse.dblclick(px, py);
  await expect(label(app)).toContainText("适合");
  await focusStage(app);
  await app.page.keyboard.press("Shift+2");
  await expect(label(app)).toContainText("铺满");
  await app.page.mouse.dblclick(px, py);
  await expect(label(app)).toHaveText("100%");
});

test("Hand tool drag: the picture follows the pointer and the cursor is a grab cursor while dragging; in a direction larger than the canvas area it can't be dragged out to blank space, in a direction that fits it stays centered; a move under 4 px isn't a drag", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Shift+2"); // Fill: wider than the canvas area horizontally, just fitting vertically
  await toolBtn(app, "抓手").click();
  const vb = await box(app, ".zoom-view");
  const [sx, sy] = [vb.x + vb.width / 2, vb.y + vb.height / 2];
  const v0 = await view(app);
  await app.page.mouse.move(sx, sy);
  await app.page.mouse.down();
  await app.page.mouse.move(sx + 3, sy);
  expect((await view(app)).x).toBe(v0.x);
  await app.page.mouse.move(sx + 20, sy + 30);
  await expect(app.page.locator(".zoom-view")).toHaveClass(/is-panning/);
  expect(await app.page.locator(".zoom-view").evaluate((el) => getComputedStyle(el).cursor)).toBe("grabbing");
  const v1 = await view(app);
  expect(v1.x).toBeCloseTo(v0.x + 20, 0);
  expect(v1.y).toBe(v0.y);
  await app.page.mouse.move(sx + 3000, sy);
  expect((await view(app)).x).toBe(0);
  await app.page.mouse.move(sx - 3000, sy);
  const c = await box(app, ".zoom-content");
  expect(c.x + c.width).toBeCloseTo(vb.x + vb.width, 0);
  await app.page.mouse.up();
  await expect(app.page.locator(".zoom-view")).not.toHaveClass(/is-panning/);
});

test("wheel panning: after zooming in, the wheel pans up and down, Shift+wheel pans left and right (a horizontal scroll amount from the browser is accepted too), and so does a horizontal touchpad swipe; at Fit to Window the wheel doesn't move the picture", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const vb = await box(app, ".zoom-view");
  await app.page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  const v0 = await view(app);
  await app.page.mouse.wheel(0, 100);
  await app.page.waitForTimeout(100);
  expect(await view(app)).toEqual(v0);

  for (let i = 0; i < 6; i++) await app.page.keyboard.press("Control+=");
  await expect(label(app)).not.toContainText("适合");
  let v = await view(app);
  await app.page.mouse.wheel(0, 100);
  await expect.poll(async () => (await view(app)).y).toBeCloseTo(v.y - 100, 0);
  expect((await view(app)).x).toBeCloseTo(v.x, 0);

  v = await view(app);
  await app.page.mouse.wheel(100, 0);
  await expect.poll(async () => (await view(app)).x).toBeCloseTo(v.x - 100, 0);

  await app.page.keyboard.down("Shift");
  v = await view(app);
  await app.page.mouse.wheel(0, 100);
  await expect.poll(async () => (await view(app)).x).toBeCloseTo(v.x - 100, 0);
  expect((await view(app)).y).toBeCloseTo(v.y, 0);
  // On Windows, scrolling with Shift held already arrives from the browser as horizontal (deltaX), so deltaY alone can't be read
  v = await view(app);
  await app.page.mouse.wheel(100, 0);
  await expect.poll(async () => (await view(app)).x).toBeCloseTo(v.x - 100, 0);
  await app.page.keyboard.up("Shift");
});

test("zooming doesn't change the on-screen size of the numbers on the canvas", async ({ app }) => {
  await app.open();
  const badge = app.page.locator(".annot-badge").first();
  const b0 = (await badge.boundingBox())!;
  await focusStage(app);
  for (let i = 0; i < 6; i++) await app.page.keyboard.press("Control+=");
  await expect(label(app)).not.toContainText("适合");
  let b = (await badge.boundingBox())!;
  expect(b.width).toBeCloseTo(b0.width, 0);
  expect(b.height).toBeCloseTo(b0.height, 0);
  for (let i = 0; i < 14; i++) await app.page.keyboard.press("Control+-");
  b = (await badge.boundingBox())!;
  expect(b.width).toBeCloseTo(b0.width, 0);
  expect(b.height).toBeCloseTo(b0.height, 0);
});

// ---------- Blurred surround ----------

const ambientSize = (app: App) => app.page.locator(".ambient canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
const ambientPainted = (app: App) =>
  app.page
    .locator(".ambient canvas")
    .evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.some((x, i) => i % 4 === 3 && x > 0));

test("blurred surround: the picture is shrunk to 64 px on its long side and drawn underneath, for images and videos alike; turning it off in the View menu removes the layer and saves to settings", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".ambient")).toHaveClass(/is-on/);
  expect(await ambientSize(app)).toEqual([64, 36]);
  expect(await ambientPainted(app)).toBe(true);

  await openClip(app);
  await expect(app.page.locator(".ambient")).toHaveClass(/is-on/);
  expect(await ambientSize(app)).toEqual([64, 36]);
  await expect.poll(() => ambientPainted(app)).toBe(true);

  await topMenu(app, "视图");
  await menuItem(app, "画面四周模糊铺满").click();
  await expect(app.page.locator(".ambient")).toHaveCount(0);
  await expect.poll(() => app.host.prefs?.backdrop).toBe("plain");
  await open(app, "hero.png");
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);
  await expect(app.page.locator(".ambient")).toHaveCount(0);
});

test("an image replaced in place (an agent exported it again): the blurred surround changes to match the new image", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".ambient")).toHaveClass(/is-on/);
  expect(await ambientSize(app)).toEqual([64, 36]);
  writeFileSync(join(app.project, "assets", "hero.png"), stripedPng(300, 600));
  await expect.poll(() => app.page.locator("img.zoom-media").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(300);
  await expect.poll(() => ambientSize(app)).toEqual([32, 64]);
});

// ---------- Play bar ----------

test("play / pause: the play bar button, Space, K and clicking the canvas all toggle it, and the button icon and tooltip follow; when playback ends it stops at the end and playing again starts from the beginning", async ({ app }) => {
  await app.open();
  await openClip(app);
  await expect(playBtn(app)).toHaveAttribute("title", "播放（空格）");
  await press(app, playBtn(app));
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  await expect(playBtn(app)).toHaveAttribute("title", "暂停（空格）");
  await press(app, playBtn(app));
  await expect.poll(async () => (await video(app)).paused).toBe(true);
  await expect(playBtn(app)).toHaveAttribute("title", "播放（空格）");

  await focusStage(app);
  await app.page.keyboard.press("k");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(true);
  await app.page.locator(".video-area").click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await video(app)).paused).toBe(false);

  await app.page.evaluate(() => (document.querySelector("video")!.currentTime = 2.7)); // Seek while playing, without waiting for it to settle at 2.7
  await expect.poll(async () => (await video(app)).ended, { timeout: 5000 }).toBe(true);
  expect((await video(app)).paused).toBe(true);
  await expect(playBtn(app)).toHaveAttribute("title", "播放（空格）");
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => {
    const s = await video(app);
    return !s.paused && s.time < 1;
  }).toBe(true);
});

test("holding Space down: only the first press counts, and it doesn't flip back and forth between play and pause", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  for (let i = 0; i < 4; i++) await app.page.keyboard.down("Space"); // From the second press on it is the system's key repeat
  await app.page.keyboard.up("Space");
  await app.page.waitForTimeout(200);
  expect((await video(app)).paused).toBe(false);
});

test("progress bar: pressing jumps there, dragging keeps jumping, and it still follows outside the bar, clamped between 0 and the end; playback that was running continues", async ({ app }) => {
  await app.open();
  await openClip(app);
  const [x25, y] = await trackAt(app, 0.25);
  const [x75] = await trackAt(app, 0.75);
  await app.page.mouse.move(x25, y);
  await app.page.mouse.down();
  await expect.poll(async () => (await video(app)).time).toBeCloseTo(0.75, 1);
  await app.page.mouse.move(x75, y + 200);
  await expect.poll(async () => (await video(app)).time).toBeCloseTo(2.25, 1);
  await app.page.mouse.move(x75 + 2000, y);
  await expect.poll(async () => (await video(app)).time).toBe(3);
  await app.page.mouse.move(x25 - 2000, y);
  await expect.poll(async () => (await video(app)).time).toBe(0);
  await app.page.mouse.up();

  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  const [x60] = await trackAt(app, 0.6);
  await app.page.mouse.click(x60, y);
  await expect.poll(async () => (await video(app)).time).toBeGreaterThanOrEqual(1.8);
  expect((await video(app)).paused).toBe(false);
});

test("the progress bar only reacts to the left button: right and middle clicks don't seek", async ({ app }) => {
  await app.open();
  await openClip(app);
  const [x80, y] = await trackAt(app, 0.8);
  await app.page.mouse.click(x80, y, { button: "right" });
  await app.page.keyboard.press("Escape");
  await app.page.mouse.click(x80, y, { button: "middle" });
  await app.page.waitForTimeout(200);
  expect((await video(app)).time).toBe(0);
});

test("timecode and hover tip: current time / total duration in mm:ss.mmm that advances during playback; the mouse over the progress bar shows the time at that point", async ({ app }) => {
  await app.open();
  await openClip(app);
  const timecode = app.page.locator(".timecode");
  await expect(timecode).toHaveText("00:00.000 / 00:03.000");
  await seek(app, 1.5);
  await expect(timecode).toHaveText("00:01.500 / 00:03.000");
  await app.page.mouse.move(...(await trackAt(app, 0.25)));
  await expect(app.page.locator(".track-tip")).toHaveText("00:00.750");
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect(timecode).not.toHaveText("00:01.500 / 00:03.000");
});

test("time bubble: it follows the mouse while dragging, follows the playhead on keyboard seeks and fades out a second after input stops; neither end sticks out of the play bar; it is one size larger than the timecode", async ({ app }) => {
  await app.open();
  await openClip(app);
  const tip = app.page.locator(".track-tip");
  const fontSize = (sel: string) => app.page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await fontSize(".track-tip")).toBeGreaterThan(await fontSize(".timecode"));

  // Keyboard: it follows the playhead and fades out after input stops
  await focusStage(app);
  await app.page.keyboard.press("Shift+ArrowRight");
  await expect(tip).toHaveClass(/is-on/);
  await expect(tip).toHaveText("00:01.000");
  await expect(tip).not.toHaveClass(/is-on/);
  // At the start and at the end: the bubble stays within the play bar
  const track = await box(app, ".track");
  await app.page.keyboard.press("Home");
  await expect(tip).toHaveText("00:00.000");
  expect((await tip.boundingBox())!.x).toBeGreaterThanOrEqual(track.x - 0.5);
  await app.page.keyboard.press("End");
  await expect(tip).toHaveText("00:03.000");
  const end = (await tip.boundingBox())!;
  expect(end.x + end.width).toBeLessThanOrEqual(track.x + track.width + 0.5);

  // Dragging: it stays on from press to release and shows the time under the mouse; after release and moving away it fades out a second later; the picture stays at the moment of release
  const [x25, y] = await trackAt(app, 0.25);
  const [x50] = await trackAt(app, 0.5);
  await app.page.mouse.move(x25, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x50, y - 40, { steps: 5 });
  await expect(tip).toHaveClass(/is-on/);
  await expect(tip).toHaveText("00:01.500");
  await app.page.mouse.up();
  await app.page.mouse.move(x50, y - 200);
  await expect(tip).not.toHaveClass(/is-on/);
  await expect.poll(async () => (await video(app)).time).toBe(1.5);
  await expect(app.page.locator(".timecode")).toHaveText("00:01.500 / 00:03.000");
});

test("dragging the progress bar: the video pauses while dragging, and playback that was running resumes on release", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  const [x25, y] = await trackAt(app, 0.25);
  const [x50] = await trackAt(app, 0.5);
  await app.page.mouse.move(x25, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x50, y, { steps: 5 });
  expect((await video(app)).paused).toBe(true);
  await app.page.mouse.up();
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  expect((await video(app)).time).toBeGreaterThanOrEqual(1.5);
});

test("when the release while dragging the progress bar is never received (for example the window was switched away mid-drag), a later move without the left button held counts as a release and no longer follows the mouse", async ({ app }) => {
  await app.open();
  await openClip(app);
  const [x25, y] = await trackAt(app, 0.25);
  const [x50] = await trackAt(app, 0.5);
  const [x75] = await trackAt(app, 0.75);
  await app.page.mouse.move(x25, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x50, y, { steps: 3 });
  await expect.poll(async () => (await video(app)).time).toBe(1.5);
  // The release is lost: by the next move the left button is no longer held
  await app.page.locator(".track").dispatchEvent("pointermove", { clientX: x75, clientY: y, buttons: 0, pointerId: 1, bubbles: true });
  await expect(app.page.locator(".track-tip")).not.toHaveClass(/is-on/);
  await app.page.locator(".track").dispatchEvent("pointermove", { clientX: x75, clientY: y, buttons: 1, pointerId: 1, bubbles: true });
  await app.page.waitForTimeout(200);
  expect((await video(app)).time).toBe(1.5);
  await app.page.mouse.up();
});

test("playback speed: . speeds up and , slows down, stopping at the ends; the button cycles (after 2× it goes back to 0.25×); the factor flashes in the middle of the canvas each time; switching items and coming back resets to 1×", async ({
  app,
}) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press(".");
  await expect(rateBtn(app)).toHaveText("1.5×");
  await expect(hud(app)).toHaveText("1.5×");
  await expect(hud(app)).toHaveClass(/is-on/);
  await app.page.keyboard.press(".");
  await app.page.keyboard.press(".");
  await expect(rateBtn(app)).toHaveText("2×");
  expect((await video(app)).rate).toBe(2);
  await expect(hud(app)).not.toHaveClass(/is-on/); // It closes after 600 ms
  await rateBtn(app).click();
  await expect(rateBtn(app)).toHaveText("0.25×");
  expect((await video(app)).rate).toBe(0.25);
  await focusStage(app);
  await app.page.keyboard.press(",");
  await expect(hud(app)).toHaveText("0.25×");
  expect((await video(app)).rate).toBe(0.25);
  await rateBtn(app).click();
  await expect(rateBtn(app)).toHaveText("0.5×");

  await open(app, "hero.png");
  await openClip(app);
  await expect(rateBtn(app)).toHaveText("1×");
  expect((await video(app)).rate).toBe(1);
});

test("a video replaced in place (an agent exported it again): the speed is kept and the play button matches the video's real state", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press(".");
  await app.page.keyboard.press(".");
  await app.page.keyboard.press("Space");
  await expect(playBtn(app)).toHaveAttribute("title", "暂停（空格）");
  // The replacement file has the same modification time as the original (Windows keeps the source's modification time when copying, and files from one checkout often share a modification time), and only the size changed: it must still be noticed
  const clip = join(app.project, "video", "clip.mp4");
  const before = statSync(clip);
  copyFileSync(join(ROOT, "packages", "web", "test", "fixtures", "60fps-faststart.mp4"), clip);
  utimesSync(clip, before.atime, before.mtime);
  await expect(app.page.locator(".timecode")).toContainText("/ 00:00.500");
  await expect(rateBtn(app)).toHaveText("2×");
  expect((await video(app)).rate).toBe(2);
  const s = await video(app);
  await expect(playBtn(app)).toHaveAttribute("title", s.paused ? "播放（空格）" : "暂停（空格）");
});

test("loop: Ctrl+L, the play bar button and the Playback menu all toggle it, flash Loop: on / off and save to settings; when on, playback restarts from the beginning after the end; nothing flashes when a video is opened", async ({
  app,
}) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press("Control+l");
  await expect(loopBtn(app)).toHaveAttribute("aria-pressed", "true");
  await expect(hud(app)).toHaveText("循环播放：开");
  await expect.poll(() => app.host.prefs?.loop).toBe(true);
  expect((await video(app)).loop).toBe(true);
  await press(app, loopBtn(app));
  await expect(loopBtn(app)).toHaveAttribute("aria-pressed", "false");
  await expect(hud(app)).toHaveText("循环播放：关");
  // Back to the default: no longer written to the settings file (only changed items are stored, see storedPrefs in prefs.ts)
  await expect.poll(() => app.host.prefs?.loop).toBeUndefined();
  await topMenu(app, "播放");
  await menuItem(app, "循环播放").click();
  await expect(loopBtn(app)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => app.host.prefs?.loop).toBe(true);

  await seek(app, 2.7);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => {
    const s = await video(app);
    return !s.paused && s.time < 1;
  }).toBe(true);

  await app.page.reload();
  await openClip(app);
  await expect(loopBtn(app)).toHaveAttribute("aria-pressed", "true");
  await app.page.waitForTimeout(300);
  await expect(hud(app)).not.toHaveClass(/is-on/);
});

test("mute: M and the speaker button toggle it, the icon, tooltip and settings follow, and it stays muted after a reopen; pressing ↑ while muted unmutes as well", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press("m");
  await expect(hud(app)).toHaveText("已静音");
  await expect(muteBtn(app)).toHaveAttribute("title", "取消静音（M）");
  await expect(muteBtn(app)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => app.host.prefs?.muted).toBe(true);
  expect((await video(app)).muted).toBe(true);
  await press(app, muteBtn(app));
  await expect(hud(app)).toHaveText("已取消静音");
  await expect(muteBtn(app)).toHaveAttribute("title", "静音（M）");
  expect((await video(app)).muted).toBe(false);
  await focusStage(app);
  await app.page.keyboard.press("m");
  await expect.poll(() => app.host.prefs?.muted).toBe(true);

  await app.page.reload();
  await openClip(app);
  expect((await video(app)).muted).toBe(true);
  await expect(app.page.locator(".volume-slider")).toHaveValue("0");
  await focusStage(app);
  await app.page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await video(app)).muted).toBe(false);
  await expect(hud(app)).toHaveText("音量 100%");
  // Back to the default: no longer written to the settings file (only changed items are stored, see storedPrefs in prefs.ts)
  await expect.poll(() => app.host.prefs?.muted).toBeUndefined();
});

test("skipping: Shift+← / → moves 1 second, J / L 5 seconds, Home / End jump to the ends, all clamped between 0 and the end; a paused video stays paused and a playing one keeps playing", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  const steps: [string, number][] = [
    ["Shift+ArrowRight", 1],
    ["l", 3],
    ["Shift+ArrowLeft", 2],
    ["j", 0],
    ["End", 3],
    ["Home", 0],
    ["Shift+ArrowLeft", 0],
  ];
  for (const [key, t] of steps) {
    await app.page.keyboard.press(key);
    await expect.poll(async () => (await video(app)).time, { message: key }).toBe(t);
    expect((await video(app)).paused).toBe(true);
  }
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  await app.page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await video(app)).time).toBeGreaterThanOrEqual(1);
  expect((await video(app)).paused).toBe(false);
});

// ---------- Notes on the play bar and on the canvas ----------

test("note marks on the play bar: an open note is drawn as a tick and one with an end time as a span; notes beyond the duration aren't drawn and ones crossing the end are cut off at the end; resolved notes are only drawn while selected", async ({ app }) => {
  addNotes(app, "video__clip.mp4.json", [
    { id: "pin001", body: "这一刻", anchor: { time: { start: 0.3 }, shape: { type: "point", x: 0.2, y: 0.2 } } },
    { id: "tail01", body: "跨过结尾", anchor: { time: { start: 2.5, end: 9 } } },
    { id: "late01", body: "超出时长", anchor: { time: { start: 4 } } },
    { id: "done02", status: "resolved", body: "已改的", anchor: { time: { start: 0.6, end: 0.9 } } },
  ]);
  await app.open();
  await openClip(app);
  const marks = app.page.locator(".track-mark");
  await expect(marks).toHaveCount(3);
  const spans = await marks.evaluateAll((els) =>
    els.map((e) => [parseFloat((e as HTMLElement).style.left), parseFloat((e as HTMLElement).style.width) || 0]).sort((a, b) => a[0] - b[0]),
  );
  const expected = [
    [10, 0],
    [50, 100 / 3],
    [250 / 3, 50 / 3],
  ];
  for (const [i, [left, width]] of expected.entries()) {
    expect(spans[i][0]).toBeCloseTo(left, 2);
    expect(spans[i][1]).toBeCloseTo(width, 2);
  }

  await card(app, "p0c7xe").click();
  await expect(app.page.locator(".track-mark.is-selected")).toHaveCount(1);
  // Resolved notes: only drawn on the play bar once they are shown in the notes panel and selected
  await topMenu(app, "视图");
  await app.page.getByRole("menuitemcheckbox", { name: /批注栏：显示已处理的批注/ }).click();
  await card(app, "done02").click();
  await expect(marks).toHaveCount(4);
  await expect(app.page.locator(".track-mark.is-selected")).toHaveCount(1);
  expect(await app.page.locator(".track-mark.is-selected").evaluate((e) => parseFloat((e as HTMLElement).style.left))).toBeCloseTo(20, 2);
});

test("clicking a note mark on the play bar selects that note (its card is highlighted and scrolled into view), pauses and jumps to its start time, and doesn't count as dragging the progress bar", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  const m = (await app.page.locator(".track-mark").boundingBox())!;
  await app.page.mouse.click(m.x + m.width * 0.9, m.y + m.height / 2);
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  await expect(card(app, "p0c7xe")).toBeInViewport();
  await expect(app.page.locator(".track-mark")).toHaveClass(/is-selected/);
  await expect.poll(() => video(app)).toMatchObject({ paused: true, time: 1.5 });
});

test("each video remembers where it stopped: switching away and back resumes at the last position; arriving from a note card jumps to the card's time", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 2.2);
  await open(app, "hero.png");
  await openClip(app);
  await expect.poll(async () => (await video(app)).time).toBe(2.2);

  await seek(app, 0.4);
  await open(app, "hero.png");
  await card(app, "p0c7xe").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect.poll(async () => (await video(app)).time).toBe(1.5);
  await app.page.waitForTimeout(300);
  expect((await video(app)).time).toBe(1.5);
});

test("a note with a time range is drawn on the canvas from 0.04 seconds before the start until the end, and not at other times", async ({ app }) => {
  await app.open();
  await openClip(app);
  const badges = app.page.locator(".annot-badge");
  for (const [t, n] of [
    [1.47, 1],
    [1.4, 0],
    [2.5, 1],
    [2.55, 0],
  ]) {
    await seek(app, t);
    await expect(badges, `${t} s`).toHaveCount(n);
  }
});

test("showing resolved notes on the canvas: they are drawn dimmed by default, and turning it off in the View menu stops drawing them and saves to settings", async ({ app }) => {
  addNotes(app, "assets__hero.png.json", [
    { id: "done03", status: "resolved", body: "右下角加了阴影", anchor: { shape: { type: "rect", x: 0.6, y: 0.6, w: 0.2, h: 0.2 } } },
  ]);
  await app.open();
  const dim = app.page.locator(".annot-badge.is-dim");
  await expect(dim).toHaveCount(1);
  await topMenu(app, "视图");
  await app.page.getByRole("menuitemcheckbox", { name: "在画面上显示已处理的批注" }).click();
  await expect(dim).toHaveCount(0);
  await expect(app.page.locator(".annot-badge")).toHaveCount(1);
  await expect.poll(() => app.host.prefs?.showResolved).toBe(false);
  await topMenu(app, "视图");
  await app.page.getByRole("menuitemcheckbox", { name: "在画面上显示已处理的批注" }).click();
  await expect(dim).toHaveCount(1);
});

test("with a mark picked on a video, the arrow keys move that mark and neither step frames nor change the volume", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 1.6);
  await app.page.locator(".annot-badge").click();
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  await app.page.waitForTimeout(200);
  const t = (await video(app)).time;
  const shape = () => app.annotations("video__clip.mp4.json")[0] as unknown as { anchor: { shapes?: { x: number; y: number }[] } };
  await app.page.keyboard.press("ArrowRight");
  await expect.poll(() => shape().anchor.shapes?.[0].x).toBeCloseTo(0.9 + 1 / 320, 4);
  await app.page.keyboard.press("ArrowDown");
  await expect.poll(() => shape().anchor.shapes?.[0].y).toBeCloseTo(0.9 + 1 / 180, 4);
  expect(await video(app)).toMatchObject({ time: t, volume: 100 });
});

// ---------- Switching items ----------

test("switching items resets zoom to Fit and speed to 1×", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+=");
  await app.page.keyboard.press("Control+=");
  await expect(label(app)).not.toContainText("适合");
  await app.page.keyboard.press("Control+ArrowDown");
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(label(app)).toContainText("适合");
  await app.page.keyboard.press("Control+ArrowUp");
  await expect(app.page).toHaveTitle("hero.png");
  await expect(label(app)).toContainText("适合");

  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press(".");
  await app.page.keyboard.press("Control+=");
  await expect(rateBtn(app)).toHaveText("1.5×");
  await open(app, "poster.jpg");
  await openClip(app);
  await expect(rateBtn(app)).toHaveText("1×");
  await expect(label(app)).toContainText("适合");
});

test("← / → on an image switch to the previous / next item in library order, collapsed folders expand automatically and it stops at the ends; on a video they step by frame", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(app.page.locator(".lib-row", { hasText: "clip.mp4" })).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("ArrowLeft");
  await app.page.waitForTimeout(200);
  await expect(app.page).toHaveTitle("hero.png");
  await app.page.keyboard.press("ArrowRight");
  await expect(app.page).toHaveTitle("poster.jpg");
  await app.page.keyboard.press("ArrowRight");
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(row(app, "clip.mp4")).toBeVisible();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await app.page.waitForTimeout(300); // The frame rate is read separately
  await app.page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await video(app)).time).toBeCloseTo(0.1, 2);
  await expect(app.page).toHaveTitle("clip.mp4");
  await app.page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await video(app)).time).toBeCloseTo(0.033, 2);
  await expect(app.page).toHaveTitle("clip.mp4");
});

test("when the window is hidden to the tray, a playing video stops", async ({ app }) => {
  await app.open();
  await openClip(app);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  await app.page.evaluate(() => (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit({ event: "windowHidden" }));
  await expect.poll(async () => (await video(app)).paused).toBe(true);
});

test("an item that can't be opened: Show in File Explorer on the canvas locates it; the drawing tools are disabled and the keys can't switch to them, while overall comments can still be written", async ({ app }) => {
  writeFileSync(join(app.project, "assets", "broken.png"), "不是图片");
  await app.open();
  await open(app, "broken.png");
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("无法打开这张图片");
  await alert.getByRole("button", { name: "在资源管理器中显示" }).click();
  await expect
    .poll(() => app.host.calls.some((c) => c.method === "reveal" && JSON.stringify(c.params).includes("broken.png")))
    .toBe(true);
  for (const name of ["图钉", "矩形", "画笔", "箭头"]) await expect(toolBtn(app, name)).toBeDisabled();
  for (const name of ["选择", "抓手"]) await expect(toolBtn(app, name)).toBeEnabled();
  await expect(app.page.locator(".hdr-tools .tool-text")).toBeEnabled();
  await focusStage(app);
  await app.page.keyboard.press("r");
  await expect(toolBtn(app, "选择")).toHaveClass(/is-on/);
  await expect(toolBtn(app, "矩形")).not.toHaveClass(/is-on/);
  // The context menu has no Add Note Here… either, while Add Overall Comment… can still be clicked
  const stage = (await app.page.locator(".stage").boundingBox())!;
  await app.page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height * 0.8, { button: "right" });
  await expect(menuItem(app, "添加整体意见…")).toBeEnabled();
  await expect(menuItem(app, "在此处添加批注…")).toHaveCount(0);
});

// ---------- Toolbar ----------

test("the six toolbar tools: clicking a button is the same as pressing its key, the current tool is highlighted, and the hover tip is the description followed by the key", async ({ app }) => {
  await app.open();
  const tools: [string, string, string][] = [
    ["矩形", "rect", "R"],
    ["图钉", "point", "C"],
    ["画笔", "pen", "B"],
    ["箭头", "arrow", "A"],
    ["抓手", "hand", "H"],
    ["选择", "select", "V"],
  ];
  for (const [name, id, key] of tools) {
    await toolBtn(app, name).click();
    await expect(app.page.locator(".stage")).toHaveClass(new RegExp(`tool-${id}\\b`));
    await expect(toolBtn(app, name)).toHaveClass(/is-on/);
    await expect(app.page.locator(".hdr-tools .tool-btn.is-on")).toHaveCount(1);
    await expect(toolBtn(app, name)).toHaveAttribute("data-tip", new RegExp(`^${name}：.+　${key}$`));
  }
  await focusStage(app);
  await app.page.keyboard.press("r");
  await expect(toolBtn(app, "矩形")).toHaveClass(/is-on/);
});

test("toolbar overall comment, undo and redo: undo / redo are disabled while their stacks are empty; clicking a button is the same as pressing its key", async ({ app }) => {
  await app.open();
  const undo = app.page.locator('.hdr-tools .tool-btn[aria-label="撤销"]');
  const redo = app.page.locator('.hdr-tools .tool-btn[aria-label="重做"]');
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(undo).toHaveAttribute("data-tip", "撤销　Ctrl Z");
  await expect(redo).toHaveAttribute("data-tip", "重做　Ctrl Shift Z");
  await app.page.locator(".hdr-tools .tool-text", { hasText: "整体意见" }).click();
  await app.page.locator(".composer-text").fill("整体再亮一点");
  await app.page.keyboard.press("Enter");
  const note = app.page.locator("[data-annot]", { hasText: "整体再亮一点" });
  await expect(note).toBeVisible();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(note).toHaveCount(0);
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect(note).toBeVisible();
  await expect(redo).toBeDisabled();
});

test("toolbar ends: collapse / expand the Library, Settings and Keyboard Shortcuts; Ctrl+,, ? and F1 open them too", async ({ app }) => {
  await app.open();
  const left = app.page.locator(".hdr-left .hdr-btn");
  await expect(left).toHaveAttribute("title", "隐藏素材栏（Ctrl B）");
  await left.click();
  await expect(app.page.locator(".layout")).toHaveClass(/left-collapsed/);
  await expect(left).toHaveAttribute("title", "显示素材栏（Ctrl B）");
  await left.click();
  await expect(app.page.locator(".layout")).not.toHaveClass(/left-collapsed/);

  await app.page.locator('.hdr-btn[title="设置（Ctrl ,）"]').click();
  await expect(app.page.locator(".settings")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".settings")).toHaveCount(0);
  await app.page.locator('.hdr-btn[title="快捷键一览（?）"]').click();
  await expect(app.page.locator(".sheet")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".sheet")).toHaveCount(0);

  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await expect(app.page.locator(".settings")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("?");
  await expect(app.page.locator(".sheet")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("F1");
  await expect(app.page.locator(".sheet")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".sheet")).toHaveCount(0);
});

// ---------- Double-click edge cases ----------

test("double-clicking a mark right after pausing a video opens editing and the video doesn't start playing again", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 1.5);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(async () => (await video(app)).paused).toBe(false);
  await app.page.locator(".video-area").click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await video(app)).paused).toBe(true);
  await app.page.waitForTimeout(250);
  await app.page.locator(".annot-badge").dblclick();
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await app.page.waitForTimeout(300);
  expect((await video(app)).paused).toBe(true);
  await expect(label(app)).toContainText("适合");
});

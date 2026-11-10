// How video times are shown (Settings → Annotations → Video time format, or a click on the time in the playback bar): seconds, timecode or
// frame numbers. Timecode and frames need a constant frame rate read from the file header; other videos stay in seconds. Notes keep
// seconds, record the frame rate (material.frame_rate), and the text for AI gives frames whatever the display is

import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeRegExp, expect, ROOT, test, type App } from "./harness";

const CLIP = "video__clip.mp4.json";
const readout = (app: App) => app.page.locator(".transport .timecode");
const composer = (app: App) => app.page.locator(".composer");
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const seek = (app: App, t: number) =>
  app.page.evaluate((seconds) => {
    document.querySelector("video")!.currentTime = seconds;
  }, t);
async function openVideo(app: App, name: string) {
  await app.page.locator(".lib-row", { hasText: name }).click();
  await expect(app.page).toHaveTitle(name);
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
}
const material = (app: App) => JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", CLIP), "utf8")).material;

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
});

test("clicking the time in the playback bar cycles seconds → timecode → frames (clip.mp4 is a constant 15 fps); the choice is remembered", async ({
  app,
}) => {
  await app.open();
  await openVideo(app, "clip.mp4");
  await seek(app, 1);
  await expect(readout(app)).toHaveText("00:01.000 / 00:03.000");
  await expect(readout(app)).toHaveAttribute("title", "单击切换秒、时间码、帧号（15 帧/秒）");

  await readout(app).click();
  await expect(readout(app)).toHaveText("00:00:01:00 / 00:00:03:00");
  await expect(app.page.locator(".hud")).toHaveText("时间码");
  await expect.poll(() => app.host.prefs?.timeFormat).toBe("timecode");

  await readout(app).click();
  await expect(readout(app)).toHaveText("15 / 45");
  // Stepping a frame moves the frame number by one
  await focusStage(app);
  await app.page.keyboard.press("ArrowRight");
  await expect(readout(app)).toHaveText("16 / 45");

  await readout(app).click();
  await expect(readout(app)).toHaveText(/^00:01\.\d{3} \/ 00:03\.000$/);
  await expect.poll(() => app.host.prefs?.timeFormat).toBeUndefined();
});

test("in frames, the note box and the card show frame numbers; the notes file keeps seconds and records the frame rate; Copy as Text gives both", async ({
  app,
}) => {
  app.host.prefs = { panelScope: "material", timeFormat: "frames" };
  await app.open();
  await openVideo(app, "clip.mp4");
  await seek(app, 1);
  await expect(readout(app)).toHaveText("15 / 45");
  await focusStage(app);
  await app.page.keyboard.press("t");
  await expect(composer(app).locator(".composer-time > .muted").first()).toHaveText("帧");
  await expect(composer(app).locator(".time-chip")).toHaveText("15");
  await app.page.locator(".composer-text").fill("这一帧闪了一下");
  await app.page.keyboard.press("Enter");
  await expect(composer(app)).toHaveCount(0);

  await expect(app.page.locator(".card", { hasText: "这一帧闪了一下" }).locator(".card-time")).toHaveText("第 15 帧");
  await expect.poll(() => material(app)?.frame_rate).toBe(15);
  const notes = JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", CLIP), "utf8")).annotations as { body: string; anchor: unknown }[];
  expect(notes.find((a) => a.body === "这一帧闪了一下")?.anchor).toEqual({ time: { start: 1 } });

  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect.poll(() => app.clipboard()).toContain("· 15 帧/秒");
  const text = (await app.clipboard())!;
  expect(text).toContain("1. 修改 · 00:01.000（第 15 帧）\n这一帧闪了一下");
  expect(text).toContain("帧号从视频开头的 0 数起");
  await expect.poll(() => app.review()).toContain("00:01.000（第 15 帧）");
});

test("Settings → Annotations → Video time format switches the display too", async ({ app }) => {
  await app.open();
  await openVideo(app, "clip.mp4");
  await seek(app, 2);
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^批注$/ }).click();
  const row = app.page.locator(".set-row", { has: app.page.locator(".set-label", { hasText: new RegExp(`^${escapeRegExp("视频时间格式")}$`) }) });
  await expect(row.locator(".seg.is-on")).toHaveText("秒");
  await row.locator(".seg", { hasText: "时间码" }).click();
  await app.page.keyboard.press("Escape");
  await expect(readout(app)).toHaveText("00:00:02:00 / 00:00:03:00");
});

test("a video whose frame rate varies stays in seconds even when frames are chosen: the time isn't a button and says why", async ({ app }) => {
  copyFileSync(join(ROOT, "packages", "web", "test", "fixtures", "vfr.mp4"), join(app.project, "video", "vfr.mp4"));
  app.host.prefs = { panelScope: "material", timeFormat: "frames" };
  await app.open();
  await openVideo(app, "vfr.mp4");
  await seek(app, 0.5);
  await expect(readout(app)).toHaveText(/^00:00\.500 \/ 00:0\d\.\d{3}$/);
  await expect(app.page.locator(".transport button.timecode")).toHaveCount(0);
  await expect(readout(app)).toHaveAttribute("title", "按秒显示：此视频的帧率不固定或无法读取");
});

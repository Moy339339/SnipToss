// Timestamped comments (an overall comment on a video comes in two kinds: about the whole picture of this frame, and about the whole video): a note with a time and no position is a kind of its own.
// Entry points: the video toolbar button, T, the menu Annotate → Add Timestamped Comment…, and the canvas context menu; none of them exist on images. They get their own section in the notes panel, sorted by time;
// Copy as Text follows the notes panel's sections (canvas marks → timestamped comments → overall comments); the filter menu only has this entry when a video is listed

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const CLIP = "video__clip.mp4.json";
const composer = (app: App) => app.page.locator(".composer");
const timedButton = (app: App) => app.page.locator(".hdr-tools .tool-text", { hasText: "时间点意见" });
const section = (app: App, kind: string) => app.page.locator(`.note-section.is-${kind}`);
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const topMenu = (app: App, name: string) => app.page.locator(".menubar button", { hasText: name }).click();
const seek = (app: App, t: number) =>
  app.page.evaluate((seconds) => {
    document.querySelector("video")!.currentTime = seconds;
  }, t);
async function openClip(app: App) {
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
}
/** Types the text in the note box and saves with Enter */
async function write(app: App, body: string) {
  await app.page.locator(".composer-text").fill(body);
  await app.page.keyboard.press("Enter");
  await expect(composer(app)).toHaveCount(0);
}
/** Finds a note on clip.mp4 by its exact text (with its anchor) */
const saved = (app: App, body: string) =>
  (
    JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", CLIP), "utf8")).annotations as {
      body: string;
      anchor: { time?: { start: number; end?: number }; shapes?: unknown[] };
    }[]
  ).find((a) => a.body === body);

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
});

test("on a video, T and the toolbar button record the current frame without a position; the notes panel gives them a section of their own, sorted by time and numbered separately", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 1);
  await focusStage(app);
  await app.page.keyboard.press("t");
  await expect(composer(app).locator(".composer-title")).toHaveText("时间点意见");
  await expect(composer(app).locator(".time-chip")).toHaveText("00:01.000");
  await write(app, "这里转场太突然");
  await expect.poll(() => saved(app, "这里转场太突然")?.anchor).toEqual({ time: { start: 1 } });

  await seek(app, 0.4);
  await timedButton(app).click();
  await expect(composer(app).locator(".time-chip")).toHaveText("00:00.400");
  await write(app, "开头字幕出现得太早");
  await expect.poll(() => saved(app, "开头字幕出现得太早")?.anchor).toEqual({ time: { start: 0.4 } });

  // Canvas marks (the preset p0c7xe) → timestamped comments, sorted by time: the one at 0.4 s is 1 and the one at 1 s is 2 (the reverse of the order they were written)
  await expect(section(app, "timed")).toContainText("时间点意见");
  await expect(section(app, "timed").locator(".note-section-count")).toHaveText("2");
  const timedCards = app.page.locator(".card").filter({ hasText: /开头字幕出现得太早|这里转场太突然/ });
  await expect(timedCards.locator(".card-body")).toHaveText([/开头字幕出现得太早/, /这里转场太突然/]);
  await expect(timedCards.locator(".card-num")).toHaveText(["1", "2"]);
  const order = await app.page.locator(".note-section").evaluateAll((els) => els.map((e) => e.className.match(/is-(\w+)/)![1]));
  expect(order).toEqual(["marked", "timed"]);
  // Nothing is drawn on the canvas (they have no position)
  await expect(app.page.locator(".annot-badge")).toHaveCount(0);
});

test("the Annotate menu and the canvas context menu can add one too; on an image there is no button, T doesn't open the note box and the menu entry is disabled", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 2);
  await topMenu(app, "批注");
  await app.page.getByRole("menuitem", { name: /添加时间点意见…/ }).click();
  await expect(composer(app).locator(".composer-title")).toHaveText("时间点意见");
  await expect(composer(app).locator(".time-chip")).toHaveText("00:02.000");
  await write(app, "菜单里加的");
  await app.page.locator(".stage").click({ button: "right", position: { x: 5, y: 5 } });
  await app.page.getByRole("menuitem", { name: /添加时间点意见…/ }).click();
  await expect(composer(app).locator(".composer-title")).toHaveText("时间点意见");
  await app.page.keyboard.press("Escape");

  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(timedButton(app)).toHaveCount(0);
  await expect(app.page.locator(".hdr-tools .tool-text", { hasText: "整体意见" })).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("t");
  await expect(composer(app)).toHaveCount(0);
  await topMenu(app, "批注");
  await expect(app.page.getByRole("menuitem", { name: /添加时间点意见…/ })).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".stage").click({ button: "right", position: { x: 5, y: 5 } });
  await expect(app.page.getByRole("menuitem", { name: /添加整体意见…/ })).toBeVisible();
  await expect(app.page.getByRole("menuitem", { name: /添加时间点意见…/ })).toHaveCount(0);
});

test("removing the time with × turns it into an overall comment that goes into the Overall section; Copy as Text follows the notes panel's sections", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 1);
  await focusStage(app);
  await app.page.keyboard.press("t");
  await write(app, "这一帧太暗");
  await focusStage(app);
  await app.page.keyboard.press("t");
  await composer(app).getByRole("button", { name: "改为整段视频" }).click();
  await expect(composer(app).locator(".composer-title")).toHaveText("整体意见");
  await write(app, "整体节奏偏慢");
  await expect.poll(() => saved(app, "整体节奏偏慢")?.anchor).toEqual({});
  await expect(section(app, "overall")).toContainText("整体意见");
  await expect(section(app, "timed").locator(".note-section-count")).toHaveText("1");

  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+A");
  await expect.poll(() => app.clipboard()).toContain("整体节奏偏慢");
  const text = (await app.clipboard())!;
  expect(text).toContain("### 时间点意见（针对视频的某一时刻或某一段，不指定位置）\n\n1. 修改 · 00:01.000\n这一帧太暗");
  expect(text).toContain("### 整体意见（针对整个文件，不指定位置）\n\n1. 修改\n整体节奏偏慢");
  expect(text.indexOf("这段水印去掉")).toBeLessThan(text.indexOf("### 时间点意见"));
  expect(text.indexOf("### 时间点意见")).toBeLessThan(text.indexOf("### 整体意见"));
});

test("filter menu: with a video listed it has Timestamped comment and can show only that; with only images it has no such entry, and filtering it out doesn't count as filtering", async ({ app }) => {
  await app.open();
  await openClip(app);
  await seek(app, 1);
  await focusStage(app);
  await app.page.keyboard.press("t");
  await write(app, "这一帧太暗");
  await app.page.locator(".panel-filter").click();
  const item = (name: string) => app.page.getByRole("menuitemcheckbox", { name });
  await expect(item("时间点意见")).toBeVisible();
  await item("时间点意见").click();
  await expect(section(app, "timed")).toHaveCount(0);
  await expect(app.page.locator(".filter-bar")).toContainText("仅显示画面标记、整体意见和旧版本上的批注");

  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(app.page.locator(".filter-bar")).toHaveCount(0);
  await expect(app.page.locator(".panel-filter")).not.toHaveClass(/is-on/);
  await app.page.locator(".panel-filter").click();
  await expect(item("画面标记")).toBeVisible();
  await expect(item("时间点意见")).toHaveCount(0);
});

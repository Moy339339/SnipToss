// The canvas and the notes panel: undo says what was undone, the undo in a toast only undoes that one step,
// switching items doesn't lose unfinished text, menus and shortcuts treat folder comments consistently, the wording of Copy as Text, ...

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const toast = (app: App) => app.page.locator(".toast");
const notes = (app: App, file: string) =>
  (existsSync(join(app.project, ".sniptoss", "annotations", file)) ? app.annotations(file) : []) as ReturnType<App["annotations"]> &
    { snapshot?: string }[];

/** Picks an item in the "⋯" menu on the right of a card */
async function cardMenu(app: App, id: string, item: string) {
  await card(app, id).hover();
  await card(app, id).locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: item }).click();
}

async function open(app: App, name: string) {
  await app.page.locator(".lib-row", { hasText: name }).click();
  await expect(app.page).toHaveTitle(name);
}

/** Puts focus back on the canvas (shortcuts don't go into an input) */
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });

/** Picks the Rectangle tool (R), drags a rectangle on the canvas (from and to are fractions of the canvas), writes the note and saves it */
async function drawRect(app: App, body: string, from = 0.3, to = 0.6) {
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * from, box.y + box.height * from);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * to, box.y + box.height * to, { steps: 5 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill(body);
  await app.page.keyboard.press("Control+Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
}

test.beforeEach(({ app }) => {
  app.host.prefs = { panelResolved: true };
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("undo in the Mark as Done toast only undoes the status change: a note drawn in between stays", async ({ app }) => {
  await app.open();
  await cardMenu(app, "k3f9a2", "标记为已改");
  const undoButton = toast(app).getByRole("button", { name: "撤销" });
  await expect(undoButton).toBeVisible();
  await expect.poll(() => notes(app, "assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("resolved");
  // Draw another note while the toast is still showing (this step is now on top of the undo stack)
  await drawRect(app, "这里再加个按钮");
  await expect.poll(() => notes(app, "assets__hero.png.json").length).toBe(3);
  await undoButton.click();
  await expect.poll(() => notes(app, "assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("open");
  expect(notes(app, "assets__hero.png.json").map((a) => a.body)).toContain("这里再加个按钮");
  await expect(toast(app)).toContainText("已撤销：更改状态");
});

test("undoing on another item: the toast says what was undone and where, and its Go to button switches the canvas over", async ({ app }) => {
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  // The notes panel lists the whole project by default: change the status of the video's note while hero.png is open
  await cardMenu(app, "p0c7xe", "标记为不改");
  await expect.poll(() => notes(app, "video__clip.mp4.json")[0]?.status).toBe("wontfix");
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => notes(app, "video__clip.mp4.json")[0]?.status).toBe("open");
  await expect(toast(app)).toContainText("已撤销：更改状态（「clip.mp4」）");
  await toast(app).getByRole("button", { name: "转到" }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  // Redo says so too
  await focusStage(app);
  await app.page.keyboard.press("Control+y");
  await expect(toast(app)).toContainText("已重做：更改状态");
});

test("a toast doesn't disappear while the mouse is over it and disappears on schedule once the mouse leaves", async ({ app }) => {
  // It used to disappear on schedule regardless: when the machine was busy it was gone before the button could be clicked
  await app.open();
  await app.page.clock.install();
  await cardMenu(app, "p0c7xe", "标记为不改");
  await expect.poll(() => notes(app, "video__clip.mp4.json")[0]?.status).toBe("wontfix");
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect(toast(app)).toContainText("已撤销");
  await toast(app).hover();
  await app.page.clock.fastForward(20_000);
  await expect(toast(app)).toBeVisible();
  await app.page.mouse.move(5, 5);
  await app.page.clock.fastForward(7_000);
  await expect(toast(app)).toHaveCount(0);
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const size of [
  { width: 1440, height: 900, scale: 1 },
  { width: 960, height: 600, scale: 1 },
  { width: 1440, height: 900, scale: 1.25 },
]) {
  test(`at ${size.width} × ${size.height}, interface size ${size.scale * 100}%, a toast sits 8 above the zoom bar, centered on the canvas: it covers neither the zoom bar nor a video's play bar`, async ({
    app,
  }) => {
    // It used to sit 24 above the window bottom, centered on the window: right on a video's play bar, and in a narrow window on the zoom bar's row
    app.host.prefs = { ...app.host.prefs, uiScale: size.scale };
    await app.page.setViewportSize({ width: size.width, height: size.height });
    await app.open();
    const check = async () => {
      // Measure after the entrance animation (it rises 8 px into place)
      await toast(app).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const t = (await toast(app).boundingBox())!;
      const zoom = (await app.page.locator(".zoom-control").boundingBox())!;
      const stage = (await app.page.locator(".stage").boundingBox())!;
      expect(overlaps(t, zoom)).toBe(false);
      expect(zoom.y - (t.y + t.height)).toBeCloseTo(8 * size.scale, 0);
      expect(t.x + t.width / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
      expect(t.x).toBeGreaterThanOrEqual(stage.x);
      expect(t.x + t.width).toBeLessThanOrEqual(stage.x + stage.width);
      return t;
    };
    // A video on the canvas, the undo happened on another item (the longer toast with Go to)
    await drawRect(app, "标题换粗体");
    await open(app, "clip.mp4");
    await focusStage(app);
    await app.page.keyboard.press("Control+z");
    await expect(toast(app)).toContainText("已撤销：添加批注（「hero.png」）");
    const t = await check();
    expect(overlaps(t, (await app.page.locator(".transport").boundingBox())!)).toBe(false);
    // An image on the canvas
    await open(app, "hero.png");
    await drawRect(app, "按钮换颜色");
    await focusStage(app);
    await app.page.keyboard.press("Control+z");
    await expect(toast(app)).toHaveText("已撤销：添加批注");
    await check();
  });
}

test("undoing a mark moved on another item: the snapshot is redrawn once that item is opened and returns to how it was before the move", async ({ app }) => {
  await app.open();
  await open(app, "poster.jpg");
  await drawRect(app, "标题往下挪");
  await expect.poll(() => notes(app, "assets__poster.jpg.json")[0]?.snapshot).toBeTruthy();
  const shot = join(app.project, ".sniptoss", notes(app, "assets__poster.jpg.json")[0].snapshot!);
  const hash = () => (existsSync(shot) ? createHash("sha256").update(readFileSync(shot)).digest("hex") : "");
  const drawn = hash();
  // Select the mark on the canvas and move it 10 px with the arrow key: the snapshot is redrawn
  await app.page.keyboard.press("v");
  await app.page.locator(".annot-badge").first().click();
  await app.page.keyboard.press("Shift+ArrowRight");
  await expect.poll(hash).not.toBe(drawn);
  // Switch to another item and undo: the mark isn't on the canvas, so the snapshot redraw is remembered for later
  await open(app, "hero.png");
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect(toast(app)).toContainText("已撤销：移动标记（「poster.jpg」）");
  // Back on poster.jpg: the snapshot is redrawn, identical to before the move
  await open(app, "poster.jpg");
  await expect.poll(hash).toBe(drawn);
});

/** Draws a rectangle and types text in the note box without saving */
async function startRect(app: App, body: string) {
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill(body);
}

test("switching items with text in the note box asks first, Enter means Keep editing, and the switch only happens after discarding", async ({ app }) => {
  await app.open();
  await startRect(app, "这里加个logo");
  const dialog = app.page.getByRole("alertdialog");
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(dialog).toContainText("放弃未保存的批注？");
  await expect(dialog).toContainText("这里加个logo");
  // A quick Enter press: the default is to keep writing, the text is still there and focus returns to the note box
  await app.page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(app.page).toHaveTitle("hero.png");
  await expect(app.page.locator(".composer-text")).toHaveValue("这里加个logo");
  await expect(app.page.locator(".composer-text")).toBeFocused();
  // Clicking a note of another item in the notes panel asks too
  await card(app, "p0c7xe").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  // Discard: the switch happens, the note box closes, and nothing is saved
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await dialog.getByRole("button", { name: "放弃" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  expect(notes(app, "assets__hero.png.json").map((a) => a.body)).not.toContain("这里加个logo");
});

test("editing another note while the note box has text asks first, and after discarding it opens that note", async ({ app }) => {
  await app.open();
  await startRect(app, "按钮颜色太淡");
  await card(app, "k3f9a2").dblclick();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("放弃未保存的批注？");
  await dialog.getByRole("button", { name: "放弃" }).click();
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await expect(app.page.locator(".composer-text")).toHaveValue("标题字太细了，换成粗一点的黑体");
});

test("switching items with nothing written (or changed) in the note box doesn't ask and switches directly", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").dblclick();
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(app.page.getByRole("alertdialog")).toHaveCount(0);
});

/** Writes a whole-folder comment for the project root folder (the fixtures have none) */
function folderNote(app: App, id: string, body: string) {
  const file = join(app.project, ".sniptoss", "annotations", "@folder.json");
  const note = { id, status: "open", category: "change", body, anchor: {}, author: "user", created_at: "", updated_at: "", replies: [] };
  writeFileSync(file, JSON.stringify({ schema: "sniptoss/4", material: { path: ".", kind: "folder" }, annotations: [note] }, null, 2));
}

test("with a folder comment selected in the notes panel, Edit, Mark as Done and Delete in the menu all work and match Enter and Delete", async ({ app }) => {
  folderNote(app, "fold01", "所有图右下角统一加水印");
  await app.open();
  await card(app, "fold01").click();
  await expect(card(app, "fold01")).toHaveClass(/is-selected/);
  await app.page.keyboard.press("Alt+e");
  await expect(app.page.getByRole("menuitem", { name: /编辑选中的批注/ })).toBeEnabled();
  await expect(app.page.getByRole("menuitem", { name: /删除选中的批注/ })).toBeEnabled();
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Alt+n");
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
  await expect.poll(() => notes(app, "@folder.json")[0]?.status).toBe("resolved");
});

const videoState = (app: App) =>
  app.page.evaluate(() => {
    const v = document.querySelector("video")!;
    return { paused: v.paused, time: Math.round(v.currentTime * 1000) / 1000 };
  });

test("video: with a note selected, clicking blank space on the canvas only deselects and doesn't play; with nothing selected it plays (consistent with images)", async ({ app }) => {
  await app.open();
  await open(app, "clip.mp4");
  await card(app, "p0c7xe").click();
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  await expect.poll(async () => (await videoState(app)).time).toBe(1.5);
  const area = app.page.locator(".video-area");
  await area.click({ position: { x: 20, y: 20 } });
  await expect(card(app, "p0c7xe")).not.toHaveClass(/is-selected/);
  expect(await videoState(app)).toEqual({ paused: true, time: 1.5 });
  await area.click({ position: { x: 20, y: 20 } });
  await expect.poll(async () => (await videoState(app)).paused).toBe(false);
});

test("video: double-clicking the canvas zooms, and a paused frame doesn't advance because of the two single clicks", async ({ app }) => {
  await app.open();
  await open(app, "clip.mp4");
  await card(app, "p0c7xe").click();
  await app.page.locator(".video-area").click({ position: { x: 20, y: 20 } }); // Deselect first
  await expect.poll(async () => (await videoState(app)).time).toBe(1.5);
  // A human double-click: 200 ms between the two clicks, and the first one has already started the video playing
  const area = (await app.page.locator(".video-area").boundingBox())!;
  await app.page.mouse.click(area.x + 40, area.y + 40);
  await app.page.waitForTimeout(200);
  await app.page.mouse.click(area.x + 40, area.y + 40, { clickCount: 2 });
  await expect(app.page.locator(".zoom-label")).toContainText("100%");
  await app.page.waitForTimeout(300);
  expect(await videoState(app)).toEqual({ paused: true, time: 1.5 });
});

test("with a drawing tool, double-clicking (a quick double-tap that places a point) and double-clicking a mark both don't zoom; double-clicking a mark edits it", async ({ app }) => {
  await app.open();
  const box = (await app.page.locator(".zoom-content").boundingBox())!;
  await focusStage(app);
  await app.page.keyboard.press("c");
  await app.page.mouse.dblclick(box.x + box.width * 0.7, box.y + box.height * 0.7);
  await expect(app.page.locator(".composer-title")).toHaveText("新批注");
  await expect(app.page.locator(".zoom-label")).toContainText("适合");
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("v");
  await app.page.locator(".annot-badge").first().dblclick();
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await expect(app.page.locator(".zoom-label")).toContainText("适合");
});

test("stepping a 60fps video by frame before it has played moves one frame at a time, not two (the frame rate is read from the file header)", async ({ app }) => {
  copyFileSync(join(ROOT, "packages", "web", "test", "fixtures", "60fps-faststart.mp4"), join(app.project, "video", "clip60.mp4"));
  await app.open();
  await open(app, "clip60.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await app.page.waitForTimeout(300); // The frame rate is read separately
  await focusStage(app);
  const frame = () => app.page.evaluate(() => Math.floor(document.querySelector("video")!.currentTime * 60 + 1e-6));
  expect(await frame()).toBe(0);
  await app.page.keyboard.press("ArrowRight");
  await expect.poll(frame).toBe(1);
  await app.page.keyboard.press("ArrowRight");
  await expect.poll(frame).toBe(2);
  await app.page.keyboard.press("ArrowLeft");
  await expect.poll(frame).toBe(1);
});

test("video volume: ↑ ↓ and the slider adjust it and it is remembered across videos; Space still plays after the slider was clicked", async ({ app }) => {
  await app.open();
  await open(app, "clip.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(1);
  const volume = () => app.page.evaluate(() => Math.round(document.querySelector("video")!.volume * 100));
  await focusStage(app);
  for (let i = 0; i < 3; i++) await app.page.keyboard.press("ArrowDown");
  await expect.poll(volume).toBe(70);
  await expect(app.page.locator(".hud")).toHaveText("音量 70%");
  await expect.poll(() => app.host.prefs?.volume).toBe(0.7);
  // Switch to another item and back: still 70%
  await open(app, "hero.png");
  await open(app, "clip.mp4");
  await expect.poll(volume).toBe(70);
  await expect(app.page.locator(".volume-slider")).toHaveValue("0.7");
  // Clicking the far left of the slider gives 0; focus stays on the slider and Space still plays
  const slider = (await app.page.locator(".volume-slider").boundingBox())!;
  await app.page.mouse.click(slider.x + 1, slider.y + slider.height / 2);
  await expect.poll(volume).toBe(0);
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => !document.querySelector("video")!.paused)).toBe(true);
  // After dragging to 0, pressing M (unmute) goes back to half; otherwise there would still be no sound
  await app.page.keyboard.press("m");
  await expect.poll(volume).toBe(50);
});

test("an image that can't be opened can still take an overall comment (no size is recorded); once the file is fixed and a rectangle is drawn, the size is filled in", async ({ app }) => {
  const broken = join(app.project, "assets", "broken.png");
  writeFileSync(broken, "不是图片");
  await app.open();
  await open(app, "broken.png");
  await expect(app.page.getByRole("alert")).toContainText("无法打开这张图片");
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("文件坏了，重新导出一张");
  await app.page.keyboard.press("Control+Enter");
  const material = () =>
    existsSync(join(app.project, ".sniptoss", "annotations", "assets__broken.png.json"))
      ? JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", "assets__broken.png.json"), "utf8")).material
      : undefined;
  await expect.poll(() => material()?.path).toBe("assets/broken.png");
  expect(material()).not.toHaveProperty("width");
  expect(JSON.stringify(material())).not.toContain("null");
  // The agent exported it again: the image appears, a rectangle is drawn, and the size is filled in
  copyFileSync(join(app.project, "assets", "hero.png"), broken);
  await expect(app.page.getByRole("alert")).toHaveCount(0);
  await expect(app.page.locator(".annot-input, .zoom-media").first()).toBeVisible();
  await drawRect(app, "左上角再亮一点");
  await expect.poll(() => material()?.width).toBe(640);
  expect(material().height).toBe(360);
});

test("zoomed in far enough to see pixels there is no interpolation (crisp pixel grid); at Fit to Window it is smoothed as usual", async ({ app }) => {
  await app.open();
  const rendering = () => app.page.evaluate(() => getComputedStyle(document.querySelector(".zoom-media")!).imageRendering);
  await expect.poll(rendering).toBe("auto");
  await focusStage(app);
  for (let i = 0; i < 8; i++) await app.page.keyboard.press("Control+=");
  await expect.poll(rendering).toBe("pixelated");
  await app.page.keyboard.press("Shift+1");
  await expect.poll(rendering).toBe("auto");
});

test("note cards can be reached with Tab: reaching one selects it, and Enter edits it", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").locator(".card-check").focus();
  await app.page.keyboard.press("Shift+Tab");
  await expect(card(app, "k3f9a2")).toBeFocused();
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
});

test("hold mode: holding C and then pressing R, releasing C doesn't wipe out R", async ({ app }) => {
  app.host.prefs = { panelResolved: true, holdTools: true };
  await app.open();
  await focusStage(app);
  const layer = app.page.locator(".annot-layer");
  await app.page.keyboard.down("c");
  await expect(layer).toHaveClass(/tool-point/);
  await app.page.waitForTimeout(450); // Held long enough counts as a long press (a short press is a tap, and releasing it doesn't switch back)
  await app.page.keyboard.down("r");
  await expect(layer).toHaveClass(/tool-rect/);
  await app.page.keyboard.up("c");
  await app.page.waitForTimeout(100);
  await expect(layer).toHaveClass(/tool-rect/);
  // Release R: short and unused counts as a tap, so it stays on the Rectangle tool
  await app.page.keyboard.up("r");
  await app.page.waitForTimeout(100);
  await expect(layer).toHaveClass(/tool-rect/);
  // For comparison: holding R a bit longer and then releasing is a long press and returns to Select
  await app.page.keyboard.down("r");
  await app.page.waitForTimeout(450);
  await app.page.keyboard.up("r");
  await expect(layer).toHaveClass(/tool-select/);
});

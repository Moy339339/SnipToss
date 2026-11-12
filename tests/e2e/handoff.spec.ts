// Handing notes to AI and "where the notes are stored" (the location must be visible and openable; editing only the text does not redraw the snapshot)

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const toast = (app: App) => app.page.locator(".toast");
type Note = ReturnType<App["annotations"]>[number] & { snapshot?: string };
const notes = (app: App, file: string): Note[] =>
  existsSync(join(app.project, ".sniptoss", "annotations", file)) ? app.annotations(file) : [];

/** Returns focus to the canvas (so shortcuts do not go into a text box) */
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });

/** Picks the Rectangle tool (R), drags a box on the canvas (from and to are fractions of the canvas), types a note and saves */
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
});

test("The first note in a project (.sniptoss was just created) shows no toast (it would block the work and the information is already visible); the bottom of the notes panel says where it is stored and a click opens it in File Explorer", async ({ app }) => {
  rmSync(join(app.project, ".sniptoss"), { recursive: true, force: true });
  await app.open();
  await expect(app.page.locator(".footer-link")).toHaveCount(0);
  await drawRect(app, "标题换粗体");
  const dataDir = join(app.project, ".sniptoss");
  const link = app.page.locator(".footer-link");
  await expect(link).toContainText("已保存到 project\\.sniptoss");
  await expect(toast(app)).toHaveCount(0);
  await link.click();
  expect(app.host.revealed.at(-1)).toBe(dataDir);
});

test("Show Snapshot in Folder on a note's context menu selects that note's snapshot in File Explorer", async ({ app }) => {
  await app.open();
  await drawRect(app, "标题换粗体");
  // Wait by the text: right after saving the note may not be on disk yet, and a poll callback that throws is not retried
  await expect.poll(() => notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")?.snapshot).toBeTruthy();
  const a = notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")!;
  const shot = a.snapshot!;
  await card(app, a.id).click({ button: "right" });
  await app.page.getByRole("menuitem", { name: "在文件夹中显示截图" }).click();
  expect(app.host.revealed.at(-1)).toBe(join(app.project, ".sniptoss", ...shot.split("/")));
});

test("Editing only a note's text without moving it does not redraw the snapshot (redrawing from the current canvas would overwrite the original snapshot once the item has been replaced)", async ({ app }) => {
  await app.open();
  await drawRect(app, "标题换粗体");
  await expect.poll(() => notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")?.snapshot).toBeTruthy();
  const a = notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")!;
  const shot = join(app.project, ".sniptoss", ...a.snapshot!.split("/"));
  const before = statSync(shot).mtimeMs;
  await card(app, a.id).dblclick();
  await app.page.locator(".composer-text").fill("标题换成粗黑体");
  await app.page.keyboard.press("Control+Enter");
  await expect.poll(() => notes(app, "assets__hero.png.json").find((n) => n.id === a.id)?.body).toBe("标题换成粗黑体");
  expect(statSync(shot).mtimeMs).toBe(before);
});

// ---------- Copy as Images ----------
// For web-based AI and chat apps. Notes on the same frame share an image: the UI draws the frame with their marks and numbers and stashes
// it with the shell, and the shell's HandoffImages adds the title and the notes area and puts the images on the clipboard;
// here we check which pages are handed to the shell and with what content (how numbers are kept apart is in handoff-badges.test.ts).

type Page = App["host"]["copiedImages"][number][number];
/** The picture the UI drew for a page: PNG bytes, with its width and height */
function picture(app: App, page: Page) {
  const png = app.host.stashed.get(page.image!)!;
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Replaces the clip's notes with one pinned note at each of these moments (written before the UI opens) */
function clipNotesAt(app: App, times: number[]) {
  const path = join(app.project, ".sniptoss", "annotations", "video__clip.mp4.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as { schema: string; annotations: unknown[] };
  file.schema = "sniptoss/5";
  file.annotations = times.map((t, i) => ({
    id: `t${String(i).padStart(5, "0")}`,
    status: "open",
    category: "change",
    body: `第 ${i + 1} 处`,
    anchor: { time: { start: t }, shapes: [{ type: "point", x: 0.2 + (i % 7) * 0.1, y: 0.3 + (i % 3) * 0.2 }] },
    author: "user",
    created_at: "2026-11-12T00:00:00Z",
    updated_at: "2026-11-12T00:00:00Z",
    replies: [],
  }));
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

test("Copy as Images at the bottom of the notes panel: with nothing checked it covers all listed open notes; notes on the same frame share one image, drawn from the item, with project / file, location and original text; the toast says how many images", async ({ app }) => {
  await app.open();
  await drawRect(app, "标题换粗体");
  await expect.poll(() => notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")?.snapshot).toBeTruthy();
  await app.page.getByRole("button", { name: "复制成图片" }).click();
  await expect(toast(app)).toContainText("（2 张图片），可粘贴到网页版 AI 或聊天软件");
  const pages = app.host.copiedImages.at(-1)!;
  // The default scope is the whole project: hero's two open notes (the existing one and the one just drawn) on one image, the video's on
  // another; the done note done01 is not handed over
  expect(pages.map((p) => p.notes.map((n) => n.body))).toEqual([["标题字太细了，换成粗一点的黑体", "标题换粗体"], ["这段水印去掉"]]);
  const hero = pages[0];
  expect(hero.title).toBe("project / assets/hero.png");
  // The numbers match the notes panel and the marks on the picture (the done overall comment is numbered separately, ADR-0008)
  expect(hero.notes.map((n) => n.number)).toEqual([1, 2]);
  expect(hero.notes[1].where).toMatch(/^区域 画面/);
  expect(hero.name).toBe("hero.png");
  // The picture is drawn now from the item, not taken from a note's snapshot
  expect(hero.snapshot).toBeNull();
  expect(picture(app, hero).width).toBeGreaterThanOrEqual(320);
  // The video's frame is read off screen at the note's moment; an image with a single note is named after it
  expect(pages[1]).toMatchObject({ title: "project / video/clip.mp4", name: "clip.mp4 第 1 条", snapshot: null });
  expect(pages[1].notes[0].where).toMatch(/^00:01\.500–00:02\.500 · 位置 画面右下/);
  expect(picture(app, pages[1]).width).toBeGreaterThanOrEqual(320);
  // The text on the clipboard is untouched (Copy as Images does not touch what Copy as Text put there)
  expect(await app.clipboard()).toBeNull();
});

test("Copy as Images from a note's context menu copies only that note; Ctrl+Shift+I does the same as the bottom button", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").click({ button: "right" });
  await app.page.getByRole("menuitem", { name: /复制批注成图片/ }).click();
  await expect(toast(app)).toContainText("已复制此条批注（1 张图片）");
  const only = app.host.copiedImages.at(-1)!;
  expect(only.map((p) => p.notes.map((n) => n.body))).toEqual([["标题字太细了，换成粗一点的黑体"]]);
  expect(only[0].name).toBe("hero.png 第 1 条");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+I");
  await expect.poll(() => app.host.copiedImages.length).toBe(2);
  expect(app.host.copiedImages.at(-1)!.length).toBe(2);
});

test("Copy as Images from a project's context menu in the library copies all open notes of the project", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "project" }).first().click({ button: "right" });
  await app.page.getByRole("menuitem", { name: /复制批注成图片/ }).click();
  await expect
    .poll(() => app.host.copiedImages.at(-1)?.map((i) => i.title))
    .toEqual(["project / assets/hero.png", "project / video/clip.mp4"]);
});

test("Copy as Images set to one image per note hands over each note with its own stored snapshot", async ({ app }) => {
  app.host.prefs = { copyImages: "each" };
  await app.open();
  await drawRect(app, "标题换粗体");
  await expect.poll(() => notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")?.snapshot).toBeTruthy();
  const mine = notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")!;
  await app.page.getByRole("button", { name: "复制成图片" }).click();
  await expect(toast(app)).toContainText("（3 张图片）");
  const pages = app.host.copiedImages.at(-1)!;
  expect(pages.map((p) => p.notes.map((n) => n.body))).toEqual([["标题字太细了，换成粗一点的黑体"], ["标题换粗体"], ["这段水印去掉"]]);
  expect(pages[1]).toMatchObject({ image: null, snapshot: `.sniptoss/${mine.snapshot}`, name: "hero.png 第 2 条" });
  expect(app.host.stashed.size).toBe(0);
});

test("Copy as Images with more frames than the limit puts several frames on one image", async ({ app }) => {
  // 12 moments: more than 10 images, so two frames share each image
  clipNotesAt(
    app,
    Array.from({ length: 12 }, (_, i) => 0.1 + i * 0.2),
  );
  await app.open();
  await app.page.locator(".lib-row", { hasText: /^video/ }).first().click({ button: "right" }); // the folder holds only the clip
  await app.page.getByRole("menuitem", { name: /复制批注成图片/ }).click();
  await expect(toast(app)).toContainText("（6 张图片）");
  await expect(toast(app)).not.toContainText("图片超过");
  const pages = app.host.copiedImages.at(-1)!;
  expect(pages.map((p) => p.notes.length)).toEqual([2, 2, 2, 2, 2, 2]);
  expect(pages.every((p) => p.title === "project / video/clip.mp4" && p.name === "clip.mp4")).toBe(true);
  // Two frames side by side: about twice as wide as the clip (320) plus the gap
  expect(picture(app, pages[0]).width).toBeGreaterThan(640);
});

test("Copy as Images says when there are more images than most AI accepts, and the limit can be lifted in Settings", async ({ app }) => {
  // 91 moments: even nine frames per image make 11 images
  clipNotesAt(
    app,
    Array.from({ length: 91 }, (_, i) => Math.round((0.02 + i * 0.03) * 1000) / 1000),
  );
  await app.open();
  const copy = async () => {
    await app.page.locator(".lib-row", { hasText: /^video/ }).first().click({ button: "right" }); // the folder holds only the clip
    await app.page.getByRole("menuitem", { name: /复制批注成图片/ }).click();
  };
  await copy();
  await expect(toast(app)).toContainText("（11 张图片）", { timeout: 60_000 });
  await expect(toast(app)).toContainText("图片超过 10 张，多数网页版 AI 无法一次接收");
  expect(app.host.copiedImages.at(-1)!.map((p) => p.notes.length)).toEqual([...Array<number>(10).fill(9), 1]);

  // Settings → Copying: the limit (shown only when notes are combined), then "No limit" = one image per frame
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: "复制批注" }).click();
  const limit = app.page.locator(".set-row", { hasText: "图片数量上限" });
  await app.page.locator(".set-row", { hasText: "复制成图片" }).first().getByRole("button", { name: "每条一张" }).click();
  await expect(limit).toHaveCount(0);
  await app.page.locator(".set-row", { hasText: "复制成图片" }).first().getByRole("button", { name: "合成一张" }).click();
  await limit.getByRole("button", { name: "不限" }).click();
  await expect.poll(() => app.host.prefs).toMatchObject({ copyImagesMax: 0 });
  await app.page.keyboard.press("Escape");
  await copy();
  await expect.poll(() => app.host.copiedImages.at(-1)?.length, { timeout: 60_000 }).toBe(91);
});

test("When the clipboard cannot be written during Copy as Text (the window is in the background), the toast explains it in plain words, stays, and Retry copies again", async ({ app }) => {
  await app.open();
  // The first clipboard write fails the way the browser fails it when the window is in the background (original English text)
  await app.page.evaluate(() => {
    const clip = navigator.clipboard as unknown as { writeText: (t: string) => Promise<void> };
    const real = clip.writeText;
    let fail = true;
    clip.writeText = async (t) => {
      if (!fail) return real(t);
      fail = false;
      throw new DOMException("Failed to execute 'writeText' on 'Clipboard': Document is not focused.", "NotAllowedError");
    };
  });
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toHaveAttribute("role", "alert");
  await expect(toast(app)).toContainText("窗口不在前台时无法写入剪贴板");
  await expect(toast(app)).not.toContainText("Document is not focused");
  await toast(app).getByRole("button", { name: "重试" }).click();
  await expect(toast(app)).toContainText("已复制");
  expect(await app.clipboard()).toContain("标题字太细了");
});

test("When Copy as Images fails, the toast explains it in plain words (details are in the log) and × dismisses it", async ({ app }) => {
  app.host.failMethods.add("copyImages");
  await app.open();
  await app.page.getByRole("button", { name: "复制成图片" }).click();
  await expect(toast(app)).toContainText("无法写入剪贴板，请稍后重试");
  await expect(toast(app)).not.toContainText("测试注入");
  await expect(toast(app).getByRole("button", { name: "重试" })).toBeVisible();
  await toast(app).getByRole("button", { name: "关闭" }).click();
  await expect(toast(app)).toHaveCount(0);
});

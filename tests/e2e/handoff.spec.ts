// Handing notes to AI and "where the notes are stored" (the location must be visible and openable; editing only the text does not redraw the snapshot)

import { existsSync, rmSync, statSync } from "node:fs";
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
// For web-based AI and chat apps. The shell's HandoffImages draws the images and puts them on the clipboard;
// here we check which notes are handed to the shell and with what content.

test("Copy as Images at the bottom of the notes panel: with nothing checked it covers all listed open notes, each with project / file, location, original text and snapshot; the toast says how many images", async ({ app }) => {
  await app.open();
  await drawRect(app, "标题换粗体");
  await expect.poll(() => notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")?.snapshot).toBeTruthy();
  const mine = notes(app, "assets__hero.png.json").find((n) => n.body === "标题换粗体")!;
  await app.page.getByRole("button", { name: "复制成图片" }).click();
  await expect(toast(app)).toContainText("（3 张图片），可粘贴到网页版 AI 或聊天软件");
  const items = app.host.copiedImages.at(-1)!;
  // The default scope is the whole project: hero's two open notes (the existing one and the one just drawn) plus the video's;
  // the done note done01 is not handed over
  expect(items.map((i) => i.body)).toEqual(["标题字太细了，换成粗一点的黑体", "标题换粗体", "这段水印去掉"]);
  const drawn = items[1];
  expect(drawn.title).toBe("project / assets/hero.png");
  expect(drawn.snapshot).toBe(`.sniptoss/${mine.snapshot}`);
  expect(drawn.where).toMatch(/^区域 画面/);
  // The number matches the notes panel: the 2nd on the canvas (the done overall comment is numbered separately, ADR-0008)
  expect(drawn.name).toBe("hero.png 第2条");
  expect(items[2]).toMatchObject({
    title: "project / video/clip.mp4",
    where: expect.stringMatching(/^00:01\.500–00:02\.500 · 位置 画面右下/),
  });
  // The text on the clipboard is untouched (Copy as Images does not touch what Copy as Text put there)
  expect(await app.clipboard()).toBeNull();
});

test("Copy as Images from a note's context menu copies only that note; Ctrl+Shift+I does the same as the bottom button", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").click({ button: "right" });
  await app.page.getByRole("menuitem", { name: /复制批注成图片/ }).click();
  expect(app.host.copiedImages.at(-1)!.map((i) => i.body)).toEqual(["标题字太细了，换成粗一点的黑体"]);
  await expect(toast(app)).toContainText("已复制此条批注（1 张图片）");
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

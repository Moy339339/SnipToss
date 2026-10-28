// Whether the menu bar, the shortcuts and the docs agree:
// F10 acts like a lone Alt press, Alt doesn't enter the menu bar while a dialog is open, Space and ← → on a library row go to the canvas,
// Ctrl+Enter saves even when the note box isn't focused, only shortcuts are shown on the right of menu items, ...

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const notes = (app: App, file: string) => app.annotations(file);
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("F10 acts like a lone Alt press: it enters the menu bar and shows the mnemonic letters without opening File; a letter then opens a menu; F10 closes an open menu", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const bar = app.page.locator(".menubar");
  await app.page.keyboard.press("F10");
  await expect(bar).toHaveClass(/is-armed/);
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await app.page.keyboard.press("e");
  await expect(menuItem(app, /^撤销/)).toBeVisible();
  await app.page.keyboard.press("F10");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await expect(bar).not.toHaveClass(/is-armed/);
  // F10 once more enters, and once more leaves
  await app.page.keyboard.press("F10");
  await expect(bar).toHaveClass(/is-armed/);
  await app.page.keyboard.press("F10");
  await expect(bar).not.toHaveClass(/is-armed/);
});

// The drop-down menu used to swallow the Alt key-down while the menu bar only recognized an Alt it saw both pressed and released, so Alt did nothing with a menu open
test("a lone Alt press with a menu open closes the menu and does not enter the menu bar (like Windows apps); this holds for menus opened by mouse, by keyboard and for context menus", async ({ app }) => {
  await app.open();
  const bar = app.page.locator(".menubar");
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await expect(menuItem(app, /^截图批注/)).toBeVisible();
  await app.page.keyboard.press("Alt");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await expect(bar).not.toHaveClass(/is-armed/);
  await focusStage(app);
  await app.page.keyboard.press("Alt");
  await app.page.keyboard.press("ArrowDown");
  await expect(menuItem(app, /^截图批注/)).toBeFocused();
  await app.page.keyboard.press("Alt");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await expect(bar).not.toHaveClass(/is-armed/);
  // With a menu open, Alt+letter still switches to that menu (it closes first, then Alt+letter opens it)
  await app.page.keyboard.press("Alt+e");
  await expect(menuItem(app, /^撤销/)).toBeVisible();
  await app.page.keyboard.press("Alt+n");
  await expect(menuItem(app, /^撤销/)).toHaveCount(0);
  await expect(app.page.locator(".menubar-menu")).toHaveCount(1);
  await app.page.keyboard.press("Escape");
  await app.page.locator(".stage").click({ button: "right", position: { x: 200, y: 200 } });
  await expect(app.page.locator(".menu")).toHaveCount(1);
  await app.page.keyboard.press("Alt");
  await expect(app.page.locator(".menu")).toHaveCount(0);
  await expect(bar).not.toHaveClass(/is-armed/);
});

// Alt+Space: the system menu takes the Space, so the UI only sees Alt pressed and released; that used to count as a lone Alt press and left File open behind the system menu
test("when the system window menu opens (Alt+Space, right-click on the title bar), our own menu closes and releasing Alt does not enter the menu bar", async ({ app }) => {
  await app.open();
  const bar = app.page.locator(".menubar");
  const systemMenu = () => app.page.evaluate(() => (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit({ event: "systemMenu" }));
  await focusStage(app);
  await app.page.keyboard.down("Alt");
  await systemMenu();
  await app.page.keyboard.up("Alt");
  await app.page.waitForTimeout(100);
  await expect(bar).not.toHaveClass(/is-armed/);
  await expect(app.page.locator(".menu")).toHaveCount(0);
  // A menu bar already entered, or a menu already open (the key arrives first, the system menu notification later), closes too
  await app.page.keyboard.press("Alt");
  await expect(bar).toHaveClass(/is-armed/);
  await systemMenu();
  await expect(bar).not.toHaveClass(/is-armed/);
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await expect(app.page.locator(".menubar-menu")).toHaveCount(1);
  await systemMenu();
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await app.page.locator(".stage").click({ button: "right", position: { x: 200, y: 200 } });
  await expect(app.page.locator(".menu")).toHaveCount(1);
  await systemMenu();
  await expect(app.page.locator(".menu")).toHaveCount(0);
});

test("a lone Alt press with a dialog open does not enter the menu bar (the menu bar is behind the dialog)", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await expect(app.page.locator(".overlay")).toBeVisible();
  await app.page.keyboard.press("Alt");
  await expect(app.page.locator(".menubar")).not.toHaveClass(/is-armed/);
  await app.page.keyboard.press("f");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
});

test("after clicking the video row (focus is in the library), Space still plays and → still steps by frame", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  const t = () => app.page.evaluate(() => document.querySelector("video")!.currentTime);
  await app.page.keyboard.press("ArrowRight");
  await expect.poll(t).toBeGreaterThan(0);
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => !document.querySelector("video")!.paused)).toBe(true);
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
  // On a folder row, ← → still collapse / expand
  await app.page.locator(".lib-row", { hasText: "video" }).first().click();
  await app.page.keyboard.press("ArrowLeft");
  await expect(app.page.locator(".lib-row", { hasText: "clip.mp4" })).toHaveCount(0);
  await app.page.keyboard.press("ArrowRight");
  await expect(app.page.locator(".lib-row", { hasText: "clip.mp4" })).toBeVisible();
});

test("with text in the note box but focus outside it (the canvas was clicked), Ctrl+Enter still saves", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("整体再亮一点");
  await focusStage(app);
  await expect(app.page.locator(".composer-text")).not.toBeFocused();
  await app.page.keyboard.press("Control+Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect.poll(() => notes(app, "assets__poster.jpg.json").map((a) => a.body)).toEqual(["整体再亮一点"]);
});

test("only shortcuts are shown on the right of menu items, with explanations in the hover tip; zoom shortcuts are written uniformly as Ctrl + / Ctrl -", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Alt+w");
  const top = app.page.getByRole("menuitemcheckbox", { name: "窗口置顶" });
  await expect(top).toBeVisible();
  await expect(top.locator(".menu-hint")).toHaveCount(0);
  await expect(top).toHaveAttribute("title", /并排/);
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Alt+v");
  await expect(menuItem(app, /^放大/).locator(".menu-hint")).toHaveText("Ctrl +");
  await expect(menuItem(app, /^恢复默认布局/).locator(".menu-hint")).toHaveCount(0);
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".zoom-btn").last()).toHaveAttribute("title", "放大（Ctrl +）");
});

test("a project without notes yet: File → Open Notes Folder is disabled (same as in the canvas context menu)", async ({ app }) => {
  const other = join(app.temp, "other");
  mkdirSync(other);
  copyFileSync(join(app.project, "assets", "poster.jpg"), join(other, "cover.jpg"));
  app.host.entries.push({ path: other, pinned: false });
  await app.open();
  await app.page.locator(".lib-row", { hasText: "cover.jpg" }).click();
  await focusStage(app);
  await app.page.keyboard.press("Alt+f");
  await expect(menuItem(app, /^打开批注文件夹/)).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await focusStage(app);
  await app.page.keyboard.press("Alt+f");
  await expect(menuItem(app, /^打开批注文件夹/)).toBeEnabled();
});

test("with only an empty folder in the library, File → Refresh List is enabled (files may have just been added to the folder and need a refresh)", async ({ app }) => {
  const empty = join(app.temp, "empty");
  mkdirSync(empty);
  app.host.entries = [{ path: empty, pinned: false }];
  await app.open();
  await app.page.keyboard.press("Alt+f");
  await expect(menuItem(app, /^刷新素材列表/)).toBeEnabled();
});

// ---------- Menu bar ----------

const row = (app: App, name: string) => app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${name.replace(/\./g, "\\.")}$`) }) });
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const toast = (app: App) => app.page.locator(".toast");
const openMenu = (app: App, name: string) => app.page.locator(".menubar-item", { hasText: name }).click();
const videoReady = (app: App) =>
  expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);

test("after picking a mark on the video, choosing Playback → Next Frame / Forward 1 Second from the keyboard still steps the video by frame / second and does not move the mark", async ({ app }) => {
  await app.open();
  await row(app, "clip.mp4").click();
  await videoReady(app);
  await app.page.evaluate(() => (document.querySelector("video")!.currentTime = 1.6));
  await expect(app.page.locator(".annot-badge")).toBeVisible();
  const before = readFileSync(join(app.project, ".sniptoss", "annotations", "video__clip.mp4.json"), "utf8");
  await app.page.locator(".annot-badge").click(); // Pick the mark on the canvas: a real arrow key press would move it
  const t = () => app.page.evaluate(() => document.querySelector("video")!.currentTime);
  const t0 = await t();
  for (const [name, more] of [
    [/^下一帧/, 0.001],
    [/^前进 1 秒/, 0.9],
  ] as const) {
    const from = await t();
    await app.page.keyboard.press("Alt+p");
    await menuItem(app, name).focus();
    await app.page.keyboard.press("Enter");
    await expect.poll(t).toBeGreaterThan(from + more);
  }
  expect(await t()).toBeGreaterThan(t0);
  await app.page.waitForTimeout(1000); // A moved mark is only written to disk 800 ms after the last move
  expect(readFileSync(join(app.project, ".sniptoss", "annotations", "video__clip.mp4.json"), "utf8")).toBe(before);
});

test("an item that can't be opened: the five zoom entries in View are disabled; when a video can't be opened, everything in Playback except Loop is disabled", async ({ app }) => {
  writeFileSync(join(app.project, "assets", "broken.png"), "不是图片");
  writeFileSync(join(app.project, "video", "broken.mp4"), "不是视频");
  await app.open();
  await row(app, "broken.png").click();
  await expect(app.page.getByRole("alert")).toContainText("无法打开这张图片");
  await openMenu(app, "视图");
  for (const name of ["适合窗口", "铺满窗口", "原始大小（100%）", "放大", "缩小"]) await expect(menuItem(app, name)).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await row(app, "broken.mp4").click();
  await expect(app.page.getByRole("alert")).toContainText("无法播放这个视频");
  await openMenu(app, "播放");
  for (const name of ["播放/暂停", "后退 5 秒", "前进 5 秒", "上一帧", "下一帧", "转到开头", "转到结尾", "减速", "加速"])
    await expect(menuItem(app, name)).toBeDisabled();
  await expect(app.page.getByRole("menuitemcheckbox", { name: "静音" })).toBeDisabled();
  await expect(app.page.getByRole("menuitemcheckbox", { name: "循环播放" })).toBeEnabled();
  await app.page.keyboard.press("Escape");
  // On a good video everything is clickable
  await row(app, "clip.mp4").click();
  await videoReady(app);
  await openMenu(app, "播放");
  await expect(menuItem(app, "下一帧")).toBeEnabled();
});

test("after a menu bar menu closes, keyboard focus returns to where it was: ↓ in the library still works", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  const list = app.page.locator(".lib-list");
  await expect(list).toBeFocused();
  // Hover over a menu item (focus follows), then press Esc
  await openMenu(app, "视图");
  await menuItem(app, "适合窗口").hover();
  await expect(menuItem(app, "适合窗口")).toBeFocused();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await expect(list).toBeFocused();
  // Open with the keyboard, then click an item
  await app.page.keyboard.press("Alt+f");
  await expect(app.page.locator(".menubar-menu .menu-item").first()).toBeFocused();
  await app.page.keyboard.press("Escape");
  await expect(list).toBeFocused();
  await openMenu(app, "文件");
  await menuItem(app, /^刷新素材列表/).click();
  await expect(list).toBeFocused();
  await app.page.keyboard.press("ArrowDown");
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "true");
});

test("after opening a menu with the keyboard, Space / Enter activate the current item; Tab does not move focus out of the menu", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const layout = app.page.locator(".layout");
  const left = app.page.getByRole("menuitemcheckbox", { name: /^素材栏\s*Ctrl B$/ });
  await app.page.keyboard.press("Alt+v");
  await expect(left).toBeFocused();
  await app.page.keyboard.press("Space");
  await expect(layout).toHaveClass(/left-collapsed/);
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  // Hover over it with the mouse, then press Space
  await openMenu(app, "视图");
  await left.hover();
  await app.page.keyboard.press("Space");
  await expect(layout).not.toHaveClass(/left-collapsed/);
  // Tab: the menu stays open and focus stays inside it
  await app.page.keyboard.press("Alt+v");
  await expect(left).toBeFocused();
  await app.page.keyboard.press("Tab");
  await expect(app.page.locator(".menubar-menu")).toBeVisible();
  expect(await app.page.evaluate(() => !!document.activeElement?.closest(".menubar-menu"))).toBe(true);
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
});

test("holding Alt, clicking the mouse and releasing Alt does not enter the menu bar", async ({ app }) => {
  await app.open();
  const bar = app.page.locator(".menubar");
  await app.page.keyboard.down("Alt");
  await focusStage(app);
  await app.page.keyboard.up("Alt");
  await expect(bar).not.toHaveClass(/is-armed/);
  // A lone Alt press still enters
  await app.page.keyboard.press("Alt");
  await expect(bar).toHaveClass(/is-armed/);
});

test("short window with Interface size at 125%: the menu doesn't cover the menu bar or leave the window, overflow scrolls inside the menu, and the last item can still be clicked", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.page.setViewportSize({ width: 960, height: 600 });
  await app.open();
  await openMenu(app, "视图");
  const menu = app.page.locator(".menubar-menu");
  await expect(menu).toBeVisible();
  await menu.evaluate((m) => Promise.all(m.getAnimations().map((a) => a.finished)));
  const bar = (await app.page.locator(".titlebar").boundingBox())!;
  const item = (await app.page.locator(".menubar-item", { hasText: "视图" }).boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(Math.abs(box.x - item.x)).toBeLessThanOrEqual(2);
  expect(await menu.evaluate((m) => m.scrollHeight > m.clientHeight)).toBe(true);
  // Keyboard to the last item: it scrolls into view
  await app.page.keyboard.press("End");
  const last = app.page.getByRole("menuitemcheckbox", { name: "批注栏：显示已处理的批注" });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await last.click();
  await expect.poll(() => app.host.prefs?.panelResolved).toBe(true);
});

test("when the note being edited is deleted from the menu, the note box closes with it instead of waiting to save another note", async ({ app }) => {
  await app.open();
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await openMenu(app, "编辑");
  await menuItem(app, "删除选中的批注").click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
  await expect.poll(() => app.annotations("assets__hero.png.json").some((a) => a.id === "k3f9a2")).toBe(false);
  await expect(app.page.locator(".composer")).toHaveCount(0);
});

test("with notes checked, the Copy as Images entry also says it copies the checked notes", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").locator(".card-check").click();
  await openMenu(app, "编辑");
  await expect(menuItem(app, "将勾选的 1 条批注复制成文字")).toBeVisible();
  await menuItem(app, "将勾选的 1 条批注复制成图片").click();
  await expect.poll(() => app.host.copiedImages.at(-1)?.length).toBe(1);
});

test("Previous / Next Item: the side at the end of the list is disabled", async ({ app }) => {
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await openMenu(app, "视图");
  await expect(menuItem(app, "上一个素材")).toBeDisabled();
  await menuItem(app, "下一个素材").click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await openMenu(app, "视图");
  await menuItem(app, "下一个素材").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await openMenu(app, "视图");
  await expect(menuItem(app, "下一个素材")).toBeDisabled();
  await menuItem(app, "上一个素材").click();
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("with the library showing only items with open notes and none left: Previous / Next Item are both disabled", async ({ app }) => {
  app.host.prefs = { libraryPending: true };
  for (const f of ["assets__hero.png.json", "video__clip.mp4.json"]) {
    const p = join(app.project, ".sniptoss", "annotations", f);
    const data = JSON.parse(readFileSync(p, "utf8"));
    for (const a of data.annotations) a.status = "resolved";
    writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  }
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".lib-list .list-empty")).toContainText("没有含待处理批注的素材");
  await openMenu(app, "视图");
  await expect(menuItem(app, "上一个素材")).toBeDisabled();
  await expect(menuItem(app, "下一个素材")).toBeDisabled();
});

test("Loop: Ctrl+L toggles it even on an image with no video open (same as the menu), with an on / off toast; Mute shows a check mark", async ({ app }) => {
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await focusStage(app);
  await app.page.keyboard.press("Control+l");
  await expect(toast(app)).toContainText("循环播放：开");
  await expect.poll(() => app.host.prefs?.loop).toBe(true);
  await openMenu(app, "播放");
  await expect(app.page.getByRole("menuitemcheckbox", { name: "循环播放" })).toHaveAttribute("aria-checked", "true");
  await app.page.getByRole("menuitemcheckbox", { name: "循环播放" }).click();
  await expect(toast(app)).toContainText("循环播放：关");
  await expect.poll(() => app.host.prefs?.loop).toBeFalsy();
  // On a video, Mute is a toggle with a check mark
  await row(app, "clip.mp4").click();
  await videoReady(app);
  await openMenu(app, "播放");
  const mute = app.page.getByRole("menuitemcheckbox", { name: "静音" });
  await expect(mute).toHaveAttribute("aria-checked", "false");
  await mute.click();
  await expect.poll(() => app.host.prefs?.muted).toBe(true);
  await openMenu(app, "播放");
  await expect(mute).toHaveAttribute("aria-checked", "true");
});

test("File → Exit sends a real quit (not hiding to the tray); unfinished text in the note box is still there next time", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("没写完的意见");
  await openMenu(app, "文件");
  await menuItem(app, "退出").click();
  await expect.poll(() => app.host.calls.filter((c) => c.method === "window").map((c) => (c.params as { action: string }).action)).toEqual(["quit"]);
  // After the process exits and starts again: sessionStorage is gone, only localStorage remains (the app saves its copy when the page unloads, and this clears it after that)
  await app.page.evaluate(() => window.addEventListener("pagehide", () => sessionStorage.clear()));
  await app.page.reload();
  await expect(app.page.locator(".composer-text")).toHaveValue("没写完的意见");
});

test("Window menu: Maximize ↔ Restore; Full Screen is checked and Maximize is disabled while in full screen; the Always on Top tip; Minimize is left to the shell", async ({ app }) => {
  await app.open();
  await openMenu(app, "窗口");
  await menuItem(app, "最大化").click();
  await openMenu(app, "窗口");
  await expect(menuItem(app, "还原")).toBeEnabled();
  await app.page.getByRole("menuitemcheckbox", { name: "全屏" }).click();
  await openMenu(app, "窗口");
  await expect(app.page.getByRole("menuitemcheckbox", { name: "全屏" })).toHaveAttribute("aria-checked", "true");
  await expect(menuItem(app, "最大化")).toBeDisabled();
  await app.page.getByRole("menuitemcheckbox", { name: "全屏" }).click();
  // Leaving full screen returns to the maximized state from before
  await openMenu(app, "窗口");
  await expect(menuItem(app, "还原")).toBeEnabled();
  await app.page.getByRole("menuitemcheckbox", { name: "窗口置顶" }).click();
  await expect(toast(app)).toContainText("窗口已置顶");
  await openMenu(app, "窗口");
  await expect(app.page.getByRole("menuitemcheckbox", { name: "窗口置顶" })).toHaveAttribute("aria-checked", "true");
  await app.page.getByRole("menuitemcheckbox", { name: "窗口置顶" }).click();
  await expect(toast(app)).toContainText("已取消窗口置顶");
  await openMenu(app, "窗口");
  await menuItem(app, "最小化").click();
  expect(app.host.calls.filter((c) => c.method === "window").map((c) => (c.params as { action: string }).action)).toEqual([
    "maximize",
    "fullscreen",
    "fullscreen",
    "topmost",
    "topmost",
    "minimize",
  ]);
});

// The tests below cover menu entries nobody has clicked yet: a menu item does the same thing as the shortcut and the toolbar button (each behavior is tested in its own section)

test("File menu: Screen Capture is handed to the shell and a failure explains why; Show in File Explorer / Open Notes Folder pass the matching path", async ({ app }) => {
  await app.open();
  await openMenu(app, "文件");
  await expect(menuItem(app, /^截图批注…/).locator(".menu-hint")).toHaveText("Ctrl Alt A");
  await menuItem(app, /^截图批注…/).click();
  await expect.poll(() => app.host.calls.some((c) => c.method === "captureStart")).toBe(true);
  app.allowLogErrors("Screen Capture");
  app.host.failMethods.add("captureStart");
  await openMenu(app, "文件");
  await menuItem(app, /^截图批注…/).click();
  await expect(toast(app)).toContainText("无法启动截图批注：captureStart 失败（测试注入）");
  await openMenu(app, "文件");
  await menuItem(app, "在资源管理器中显示当前素材").click();
  await expect.poll(() => app.host.revealed.at(-1)).toBe(join(app.project, "assets", "hero.png"));
  await openMenu(app, "文件");
  await menuItem(app, /^打开批注文件夹/).click();
  await expect.poll(() => app.host.revealed.at(-1)).toBe(join(app.project, ".sniptoss"));
});

test("File menu: no shortcut is shown on the right when the capture shortcut is unset; with an empty library only the items unrelated to files are enabled", async ({ app }) => {
  app.host.capture.hotkey = "";
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".menubar")).toBeVisible();
  await openMenu(app, "文件");
  await expect(menuItem(app, /^截图批注…/)).toBeEnabled();
  await expect(menuItem(app, /^截图批注…/).locator(".menu-hint")).toHaveCount(0);
  for (const name of [/^查找素材/, "在资源管理器中显示当前素材", /^打开批注文件夹/, /^刷新素材列表/, /^清空列表/])
    await expect(menuItem(app, name)).toBeDisabled();
  for (const name of [/^添加文件…/, /^添加文件夹…/, /^从剪贴板添加/, /^设置…/, "退出"]) await expect(menuItem(app, name)).toBeEnabled();
});

test("Edit menu: Undo / Redo are disabled when their stacks are empty, and after one step the menu item acts like Ctrl+Z; Edit Selected Note opens the note box; with two notes checked, Delete states the count and asks once; Find Note", async ({ app }) => {
  await app.open();
  const status = () => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status;
  await openMenu(app, "编辑");
  for (const name of [/^撤销/, /^重做/, /^编辑选中的批注/, /^删除选中的批注/]) await expect(menuItem(app, name)).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await openMenu(app, "批注");
  await menuItem(app, /^标记为已改/).click();
  await expect.poll(status).toBe("resolved");
  await openMenu(app, "编辑");
  await expect(menuItem(app, /^重做/)).toBeDisabled();
  await menuItem(app, /^撤销/).click();
  await expect(toast(app)).toContainText("已撤销：更改状态");
  await expect.poll(status).toBe("open");
  await openMenu(app, "编辑");
  await menuItem(app, /^重做/).click();
  await expect(toast(app)).toContainText("已重做：更改状态");
  await expect.poll(status).toBe("resolved");
  await openMenu(app, "编辑");
  await menuItem(app, /^撤销/).click();
  await expect.poll(status).toBe("open");
  // Edit the selected note
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await openMenu(app, "编辑");
  await menuItem(app, /^编辑选中的批注/).click();
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await expect(app.page.locator(".composer-text")).toHaveValue("标题字太细了，换成粗一点的黑体");
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  // Check two: Delete states the count and asks once
  await card(app, "k3f9a2").locator(".card-check").click();
  await card(app, "p0c7xe").locator(".card-check").click();
  await openMenu(app, "编辑");
  await menuItem(app, /^删除勾选的 2 条批注/).click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("删除勾选的 2 条批注？");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => app.annotations("video__clip.mp4.json").length).toBe(0);
  expect(app.annotations("assets__hero.png.json").some((a) => a.id === "k3f9a2")).toBe(false);
  // Find Note: with the notes panel collapsed it expands first, and focus goes to the search box
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => app.annotations("video__clip.mp4.json").length).toBe(1);
  await focusStage(app);
  await app.page.keyboard.press("Control+Alt+b");
  await expect(app.page.locator(".layout")).toHaveClass(/right-collapsed/);
  await openMenu(app, "编辑");
  await menuItem(app, /^查找批注/).click();
  await expect(app.page.locator(".layout")).not.toHaveClass(/right-collapsed/);
  await expect(app.page.locator(".panel-search input")).toBeFocused();
});

test("View menu: the five zoom entries act like their keys; the notes panel toggle is checked; with several items selected in the Library neither scope is checked, and picking one leaves the multi-selection", async ({ app }) => {
  await app.open();
  const label = app.page.locator(".zoom-label");
  await expect(app.page.locator(".zoom-content")).toHaveClass(/is-ready/);
  for (const [name, text] of [
    ["原始大小（100%）", "100%"],
    ["放大", "125%"],
    ["缩小", "100%"],
    ["铺满窗口", "铺满"],
    ["适合窗口", "适合"],
  ] as const) {
    await openMenu(app, "视图");
    await menuItem(app, name).click();
    await expect(label).toContainText(text);
  }
  // Notes panel
  const right = app.page.getByRole("menuitemcheckbox", { name: /^批注栏\s*Ctrl Alt B$/ });
  await openMenu(app, "视图");
  await expect(right).toHaveAttribute("aria-checked", "true");
  await right.click();
  await expect(app.page.locator(".layout")).toHaveClass(/right-collapsed/);
  await openMenu(app, "视图");
  await expect(right).toHaveAttribute("aria-checked", "false");
  await right.click();
  await expect(app.page.locator(".layout")).not.toHaveClass(/right-collapsed/);
  // Several items selected in the Library: the notes panel lists the selected items
  await row(app, "hero.png").click();
  await row(app, "clip.mp4").click({ modifiers: ["Control"] });
  const material = app.page.getByRole("menuitemcheckbox", { name: "批注栏：仅当前素材" });
  const project = app.page.getByRole("menuitemcheckbox", { name: "批注栏：整个项目" });
  await openMenu(app, "视图");
  await expect(material).toHaveAttribute("aria-checked", "false");
  await expect(project).toHaveAttribute("aria-checked", "false");
  await project.click();
  await openMenu(app, "视图");
  await expect(project).toHaveAttribute("aria-checked", "true");
  await app.page.keyboard.press("Escape");
  await expect(row(app, "clip.mp4")).not.toHaveAttribute("aria-selected", "true");
});

test("Annotate menu: the six tools switch and show a check mark; Overall Comment and Folder Comment open the matching note box; Previous / Next Note wrap around at the ends", async ({ app }) => {
  await app.open();
  for (const name of ["矩形", "图钉", "画笔", "箭头", "抓手", "选择"]) {
    const item = app.page.getByRole("menuitemcheckbox", { name: new RegExp(`^${name}`) });
    await openMenu(app, "批注");
    await item.click();
    await expect(app.page.locator(`.hdr-tools .tool-btn[aria-label="${name}"]`)).toHaveClass(/is-on/);
    await openMenu(app, "批注");
    await expect(item).toHaveAttribute("aria-checked", "true");
    await app.page.keyboard.press("Escape");
  }
  await openMenu(app, "批注");
  await menuItem(app, /^添加整体意见…/).click();
  await expect(app.page.locator(".composer-title")).toHaveText("整体意见");
  await app.page.keyboard.press("Escape");
  await openMenu(app, "批注");
  await menuItem(app, /^添加文件夹「assets」的意见…/).click();
  await expect(app.page.locator(".composer-title")).toHaveText("文件夹「assets」的意见");
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  // Previous / Next: the canvas follows across items, and it wraps around at the ends
  for (const [name, title, id] of [
    [/^下一条批注/, "hero.png", "k3f9a2"],
    [/^下一条批注/, "clip.mp4", "p0c7xe"],
    [/^下一条批注/, "hero.png", "k3f9a2"],
    [/^上一条批注/, "clip.mp4", "p0c7xe"],
  ] as const) {
    await openMenu(app, "批注");
    await menuItem(app, name).click();
    await expect(app.page).toHaveTitle(title);
    await expect(card(app, id)).toHaveClass(/is-selected/);
  }
});

test("Annotate menu: the three check entries and the three status entries are always present (enabled or disabled by the selected note's status, with an undo button in the toast)", async ({ app }) => {
  await app.open();
  const status = () => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status;
  const check = app.page.getByRole("menuitemcheckbox", { name: /^勾选选中的批注/ });
  await openMenu(app, "批注");
  await expect(check).toBeDisabled();
  await expect(menuItem(app, /^取消勾选/)).toBeDisabled();
  for (const name of [/^标记为已改/, /^标记为不改/, /^重新打开/]) await expect(menuItem(app, name)).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await openMenu(app, "批注");
  await expect(check).toHaveAttribute("aria-checked", "false");
  await check.click();
  await expect(app.page.locator(".panel-batch .batch-count")).toContainText("1");
  await openMenu(app, "批注");
  await expect(check).toHaveAttribute("aria-checked", "true");
  await expect(menuItem(app, /^取消勾选/).locator(".menu-hint")).toHaveText("已选 1 条");
  await menuItem(app, /^取消勾选/).click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
  await openMenu(app, "批注");
  await menuItem(app, "全部勾选").click();
  await expect(app.page.locator(".panel-batch .batch-count")).toContainText("2");
  await openMenu(app, "批注");
  await menuItem(app, /^取消勾选/).click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
  // The selected note is open: Done and Won't Fix are enabled, Reopen is disabled
  await openMenu(app, "批注");
  await expect(menuItem(app, /^标记为已改/).locator(".menu-hint")).toHaveText("D");
  await expect(menuItem(app, /^标记为不改/).locator(".menu-hint")).toHaveText("Shift D");
  await expect(menuItem(app, /^重新打开/)).toBeDisabled();
  await menuItem(app, /^标记为不改/).click();
  await expect(toast(app)).toContainText("已标记为不改");
  await expect(toast(app).getByRole("button", { name: "撤销" })).toBeVisible();
  await expect.poll(status).toBe("wontfix");
  await openMenu(app, "批注");
  await expect(menuItem(app, /^标记为不改/)).toBeDisabled();
  await menuItem(app, /^重新打开/).click();
  await expect(toast(app)).toContainText("已重新打开");
  await expect.poll(status).toBe("open");
});

test("Playback menu: everything except Loop is disabled on an image; on a video each entry acts like its key", async ({ app }) => {
  await app.open();
  await openMenu(app, "播放");
  await expect(menuItem(app, /^播放\/暂停/)).toBeDisabled();
  await expect(app.page.getByRole("menuitemcheckbox", { name: /^循环播放/ })).toBeEnabled();
  await app.page.keyboard.press("Escape");
  await row(app, "clip.mp4").click();
  await videoReady(app);
  const v = () =>
    app.page.evaluate(() => {
      const el = document.querySelector("video")!;
      return { t: el.currentTime, paused: el.paused, rate: el.playbackRate };
    });
  const pick = async (name: RegExp) => {
    await openMenu(app, "播放");
    await menuItem(app, name).click();
  };
  await pick(/^播放\/暂停/);
  await expect.poll(async () => (await v()).paused).toBe(false);
  await pick(/^播放\/暂停/);
  await expect.poll(async () => (await v()).paused).toBe(true);
  await pick(/^转到结尾/);
  await expect.poll(async () => (await v()).t).toBeGreaterThan(2.9);
  await pick(/^转到开头/);
  await expect.poll(async () => (await v()).t).toBe(0);
  await pick(/^前进 5 秒/);
  await expect.poll(async () => (await v()).t).toBeGreaterThan(2.9);
  await pick(/^后退 1 秒/);
  await expect.poll(async () => (await v()).t).toBeLessThan(2.1);
  await pick(/^后退 5 秒/);
  await expect.poll(async () => (await v()).t).toBe(0);
  await pick(/^前进 1 秒/);
  await expect.poll(async () => (await v()).t).toBeGreaterThan(0.9);
  const at = (await v()).t;
  await pick(/^下一帧/);
  await expect.poll(async () => (await v()).t).toBeGreaterThan(at);
  const next = (await v()).t;
  await pick(/^上一帧/);
  await expect.poll(async () => (await v()).t).toBeLessThan(next);
  await pick(/^加速/);
  await expect.poll(async () => (await v()).rate).toBe(1.5);
  await pick(/^减速/);
  await pick(/^减速/);
  await expect.poll(async () => (await v()).rate).toBe(0.5);
});

test("Help menu: Keyboard Shortcuts and Developer Tools", async ({ app }) => {
  await app.open();
  await openMenu(app, "帮助");
  await expect(menuItem(app, /^快捷键一览/).locator(".menu-hint")).toHaveText("? / F1");
  await menuItem(app, /^快捷键一览/).click();
  await expect(app.page.locator(".sheet")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".sheet")).toHaveCount(0);
  await openMenu(app, "帮助");
  await menuItem(app, "开发者工具").click();
  await expect.poll(() => app.host.calls.some((c) => c.method === "openDevTools")).toBe(true);
});

test("menu titles: a left press opens the menu, another click closes it, a right click doesn't open it, focus isn't stolen; hovering another title while a menu is open switches to it", async ({ app }) => {
  await app.open();
  const filter = app.page.getByPlaceholder("筛选素材");
  await filter.click();
  const menu = app.page.locator(".menubar-menu");
  const view = app.page.locator(".menubar-item", { hasText: "视图" });
  const edit = app.page.locator(".menubar-item", { hasText: "编辑" });
  await view.click({ button: "right" });
  await expect(menu).toHaveCount(0);
  await expect(filter).toBeFocused();
  await edit.hover();
  await expect(menu).toHaveCount(0);
  await view.click();
  await expect(menu).toBeVisible();
  await expect(filter).toBeFocused();
  // The top edge sits 4 px below the bottom of the title bar
  const bar = (await app.page.locator(".titlebar").boundingBox())!;
  // Wait for the opening animation to finish before measuring
  await expect.poll(async () => Math.abs((await menu.boundingBox())!.y - (bar.y + bar.height + 4))).toBeLessThanOrEqual(1);
  await edit.hover();
  await expect(menuItem(app, /^撤销/)).toBeVisible();
  await edit.click();
  await expect(menu).toHaveCount(0);
  await expect(filter).toBeFocused();
});

test("a menu closes on a click outside (the canvas, the empty area behind the menu bar), on a window resize, and on switching to another app; clicking a disabled item or a separator neither closes it nor does anything", async ({ app }) => {
  await app.open();
  const menu = app.page.locator(".menubar-menu");
  await openMenu(app, "文件");
  const stage = (await app.page.locator(".stage").boundingBox())!;
  await app.page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height - 20);
  await expect(menu).toHaveCount(0);
  await openMenu(app, "文件");
  const bar = (await app.page.locator(".menubar").boundingBox())!;
  await app.page.mouse.click(bar.x + bar.width - 10, bar.y + bar.height / 2);
  await expect(menu).toHaveCount(0);
  await openMenu(app, "文件");
  await app.page.setViewportSize({ width: 1200, height: 760 });
  await expect(menu).toHaveCount(0);
  await openMenu(app, "文件");
  await app.page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(menu).toHaveCount(0);
  // Disabled item: with nothing selected, Edit Selected Note is disabled
  await openMenu(app, "编辑");
  const calls = app.host.calls.length;
  await menuItem(app, /^编辑选中的批注/).click({ force: true });
  await app.page.locator(".menubar-menu .menu-sep").first().click({ force: true });
  await expect(menu).toBeVisible();
  await expect(app.page.locator(".composer")).toHaveCount(0);
  expect(app.host.calls.length).toBe(calls);
});

test("menu styling: menus without check items drop the left gutter; destructive items are red; separators are never first, last or adjacent", async ({ app }) => {
  await app.open();
  for (const [name, gutter] of [
    ["文件", false],
    ["编辑", false],
    ["视图", true],
    ["批注", true],
    ["播放", true],
    ["窗口", true],
    ["帮助", false],
  ] as const) {
    await openMenu(app, name);
    const menu = app.page.locator(".menubar-menu");
    if (gutter) await expect(menu).not.toHaveClass(/no-gutter/);
    else await expect(menu).toHaveClass(/no-gutter/);
    const seps = await menu.evaluate((m) => [...m.children].map((c) => c.classList.contains("menu-sep")));
    expect(seps[0]).toBe(false);
    expect(seps.at(-1)).toBe(false);
    expect(seps.some((s, i) => s && seps[i + 1])).toBe(false);
    await app.page.keyboard.press("Escape");
  }
  await openMenu(app, "文件");
  const [color, danger] = await menuItem(app, /^清空列表/).evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.color = "var(--danger)";
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, want];
  });
  expect(color).toBe(danger);
});

test("with a menu open, single-key shortcuts behind it have no effect (no tool switch, no playback) while Ctrl shortcuts work as usual", async ({ app }) => {
  await app.open();
  await row(app, "clip.mp4").click();
  await videoReady(app);
  await focusStage(app);
  await app.page.keyboard.press("Alt+v");
  await expect(app.page.locator(".menubar-menu")).toBeVisible();
  await app.page.keyboard.press("r");
  await app.page.keyboard.press("k");
  await expect(app.page.locator('.hdr-tools .tool-btn[aria-label="矩形"]')).not.toHaveClass(/is-on/);
  expect(await app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
  await app.page.keyboard.press("Control+b");
  await expect(app.page.locator(".layout")).toHaveClass(/left-collapsed/);
});

test("mnemonic letters are hidden normally, shown on a lone Alt press or when a menu is opened by keyboard, and hidden again when the mouse is used", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const key = app.page.locator(".menubar-key").first();
  await expect(key).toBeHidden();
  await app.page.keyboard.press("Alt");
  await expect(key).toBeVisible();
  await focusStage(app);
  await expect(key).toBeHidden();
  await app.page.keyboard.press("Alt+f");
  await expect(key).toBeVisible();
  await app.page.locator(".menubar-item", { hasText: "编辑" }).hover();
  await expect(key).toBeHidden();
});


// Items coming in:
// drag and drop, adding files / folders, what the app says after adding, the focus request the shell queues at startup,
// things opened from outside while the app is running, reloading for a new drive, removing and re-adding,
// changing which files are listed in Settings, F5, notes folder watching, debounced saving of the expanded state.
// The shell half (single instance, command line, context menu) is in tests/shell/ingest.spec.ts

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The row whose name is exactly `name` */
const row = (app: App, name: string) => app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${escape(name)}$`) }) });
const toast = (app: App) => app.page.locator(".toast");
const overlay = (app: App) => app.page.locator(".drop-overlay");
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const HERO = (app: App) => join(app.project, "assets", "hero.png");
const calls = (app: App, method: string) => app.host.calls.filter((c) => c.method === method);

/** A folder outside the project holding a few images (copies of hero.png) */
function outside(app: App, name: string, files: string[]) {
  const dir = join(app.temp, name);
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    copyFileSync(HERO(app), join(dir, f));
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Drops into the window: builds same-named Files in the page and puts them in a DataTransfer (the browser cannot get the paths of dropped files,
 * so this simulates the shell matching them by name against nextDrop).
 * on = the element to release the drop on
 */
async function dropFiles(app: App, paths: string[], on = ".stage") {
  app.host.nextDrop = paths;
  const names = paths.map((p) => p.split("\\").pop()!);
  const dt = await app.page.evaluateHandle((ns) => {
    const d = new DataTransfer();
    for (const n of ns) d.items.add(new File(["x"], n));
    (window as unknown as { __e2eOnDisk: string[] }).__e2eOnDisk = ns; // treat them as on disk (the fake WebView2 in harness.ts only accepts those)
    return d;
  }, names);
  await app.page.dispatchEvent(on, "dragenter", { dataTransfer: dt });
  await app.page.dispatchEvent(on, "dragover", { dataTransfer: dt });
  await app.page.dispatchEvent(on, "drop", { dataTransfer: dt });
}

/** Moves the test project to temp\挪过去\project and returns the new location */
function moveProject(app: App): string {
  const to = join(app.temp, "挪过去", "project");
  mkdirSync(join(app.temp, "挪过去"));
  renameSync(app.project, to);
  return to;
}

test.beforeEach(({ app }) => {
  app.host.prefs = { panelResolved: true };
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

// ---------- Drag and drop ----------

test("Dragging text or a URL into the window shows no \"Drop to add to the list\" overlay, and dropping it is not passed to the shell", async ({ app }) => {
  await app.open();
  const dt = await app.page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.setData("text/plain", "一段字");
    d.setData("text/uri-list", "https://example.com/a.png");
    return d;
  });
  await app.page.dispatchEvent(".stage", "dragenter", { dataTransfer: dt });
  await app.page.dispatchEvent(".stage", "dragover", { dataTransfer: dt });
  await expect(overlay(app)).toHaveCount(0);
  await app.page.dispatchEvent(".stage", "drop", { dataTransfer: dt });
  expect(calls(app, "addDropped")).toHaveLength(0);
  await expect(toast(app)).toHaveCount(0);
});

test("Dragging a file back and forth between the canvas and the library keeps the overlay from flickering; dragging out of the window removes it and adds nothing", async ({ app }) => {
  await app.open();
  const dt = await app.page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["x"], "a.png"));
    return d;
  });
  await app.page.dispatchEvent(".stage", "dragenter", { dataTransfer: dt });
  await expect(overlay(app)).toContainText("松开以添加到列表");
  // Entering the new element comes before leaving the old one (the browser's order): the overlay must not vanish in between
  await app.page.dispatchEvent(".lib-list", "dragenter", { dataTransfer: dt });
  await app.page.dispatchEvent(".stage", "dragleave", { dataTransfer: dt });
  await expect(overlay(app)).toBeVisible();
  await app.page.dispatchEvent(".lib-list", "dragleave", { dataTransfer: dt });
  await expect(overlay(app)).toHaveCount(0);
  expect(calls(app, "addDropped")).toHaveLength(0);
});

test("Dropping on the library adds the file to the list and opens it", async ({ app }) => {
  const dir = outside(app, "拖进来的", ["dropped.png"]);
  await app.open();
  await dropFiles(app, [join(dir, "dropped.png")], ".lib-list");
  await expect(row(app, "dropped.png")).toBeVisible();
  await expect(app.page).toHaveTitle("dropped.png");
});

test("Dropping a folder makes it a project, expands the folders along the way and selects the first item inside (subfolders before files)", async ({ app }) => {
  const dir = outside(app, "新片子", ["a.png", "子/b.png"]);
  await app.open();
  await dropFiles(app, [dir]);
  await expect(app.page.locator(".lib-row.is-project", { hasText: "新片子" })).toBeVisible();
  await expect(app.page).toHaveTitle("b.png");
  await expect(row(app, "子")).toHaveAttribute("aria-expanded", "true");
  await expect(row(app, "b.png")).toHaveClass(/is-selected/);
  await expect(toast(app)).toHaveCount(0); // one item added: nothing to say
});

test("Dropping two files at once says \"Added 2 items\" and opens the first", async ({ app }) => {
  const dir = outside(app, "两张", ["一.png", "二.png"]);
  await app.open();
  await dropFiles(app, [join(dir, "一.png"), join(dir, "二.png")]);
  await expect(toast(app)).toContainText("已添加 2 项");
  await expect(app.page).toHaveTitle("一.png");
  await expect(row(app, "二.png")).toBeVisible();
});

test("Dropping an image that is already in the list adds no row, says it is already in the list and selects it", async ({ app }) => {
  await app.open();
  await row(app, "poster.jpg").click();
  await dropFiles(app, [HERO(app)]);
  await expect(toast(app)).toContainText("该项已在列表中，已定位到它");
  await expect(app.page).toHaveTitle("hero.png");
  await expect(row(app, "hero.png")).toHaveCount(1);
});

test("Dropping unsupported files: one file gets a reason; supported files mixed in are still added; several failures are reported as a count", async ({ app }) => {
  const dir = outside(app, "杂", ["好.png"]);
  for (const n of ["说明.txt", "设计.psd", "汇报.pptx"]) writeFileSync(join(dir, n), "x");
  await app.open();
  await dropFiles(app, [join(dir, "说明.txt")]);
  await expect(toast(app)).toContainText("不支持此文件类型（.txt）：说明.txt");
  await expect(app.page).toHaveTitle("hero.png");
  await dropFiles(app, [join(dir, "设计.psd"), join(dir, "好.png")]);
  await expect(toast(app)).toContainText("不支持此文件类型（.psd）：设计.psd");
  await expect(app.page).toHaveTitle("好.png");
  await dropFiles(app, ["说明.txt", "设计.psd", "汇报.pptx"].map((n) => join(dir, n)));
  await expect(toast(app)).toContainText("3 项未能添加：不支持此文件类型（.txt）：说明.txt 等");
  expect(app.host.entries).toHaveLength(2);
});

test("Dropping text into the note box works normally and is not blocked as a file drop; file drops are still blocked (otherwise WebView2 would open the file)", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  const text = app.page.locator(".composer-text");
  await expect(text).toBeFocused();
  const prevented = (types: "text" | "file") =>
    text.evaluate((el, t) => {
      const d = new DataTransfer();
      if (t === "text") d.setData("text/plain", "拖进来的字");
      else d.items.add(new File(["x"], "a.png"));
      const over = new DragEvent("dragover", { dataTransfer: d, bubbles: true, cancelable: true });
      el.dispatchEvent(over);
      const drop = new DragEvent("drop", { dataTransfer: d, bubbles: true, cancelable: true });
      el.dispatchEvent(drop);
      return drop.defaultPrevented;
    }, types);
  expect(await prevented("text")).toBe(false);
  expect(await prevented("file")).toBe(true);
  await expect(overlay(app)).toHaveCount(0);
});

// ---------- Dialog entry points ----------

test("File → Add Files… / Add Folder… and right-clicking blank space in the library: a pick is added and opened, cancelling changes nothing", async ({ app }) => {
  const dir = outside(app, "菜单加的", ["m.png", "夹/n.png"]);
  await app.open();
  app.host.nextPickFiles = [join(dir, "m.png")];
  await app.page.getByRole("menuitem", { name: "文件" }).click();
  await app.page.getByRole("menuitem", { name: /^添加文件…/ }).click();
  await expect(app.page).toHaveTitle("m.png");
  // Folder dialog cancelled: libraryAdd is not called and the canvas stays as it was
  const before = calls(app, "libraryAdd").length;
  await app.page.getByRole("menuitem", { name: "文件" }).click();
  await app.page.getByRole("menuitem", { name: /^添加文件夹…/ }).click();
  await expect.poll(() => calls(app, "pickFolder").length).toBe(1);
  expect(calls(app, "libraryAdd")).toHaveLength(before);
  await expect(app.page).toHaveTitle("m.png");
  // Right-click blank space in the library
  app.host.nextPickFolder = join(dir, "夹");
  const list = (await app.page.locator(".lib-list").boundingBox())!;
  await app.page.mouse.click(list.x + 40, list.y + list.height - 12, { button: "right" });
  await app.page.locator(".menu .menu-item", { hasText: "添加文件夹…" }).click();
  await expect(app.page).toHaveTitle("n.png");
});

test("When the shell fails to add the file, the toast gives the reason and the list is unchanged", async ({ app }) => {
  await app.open();
  app.host.failMethods.add("libraryAdd");
  app.host.nextPickFiles = [HERO(app)];
  await app.page.keyboard.press("Control+o");
  await expect(toast(app)).toContainText("libraryAdd 失败");
  expect(app.host.entries).toHaveLength(1);
});

// ---------- Queued by the shell at startup (from the command line or the context menu) ----------

test("An item passed on the command line (queued focus request) is opened at startup, the folders along the way are expanded, and it is remembered as the last viewed", async ({ app }) => {
  const clip = join(app.project, "video", "clip.mp4");
  app.host.expanded = [];
  app.host.selected = HERO(app);
  app.host.pendingFocus = clip;
  await app.open();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => app.host.selected).toBe(clip);
});

test("A queued focus request that is no longer in the list still opens the last viewed item instead of an empty canvas", async ({ app }) => {
  app.host.selected = join(app.project, "assets", "poster.jpg");
  app.host.pendingFocus = join(app.temp, "没有这个.png");
  await app.open();
  await expect(app.page).toHaveTitle("poster.jpg");
});

// ---------- Something opened from outside while the app is running (libraryChanged) ----------

test("Opening a new file from the context menu while the app is running adds a row and opens it; one already listed is only selected; an unsupported one gets a reason and the canvas stays", async ({ app }) => {
  const dir = outside(app, "外面的", ["o.png"]);
  writeFileSync(join(dir, "说明.txt"), "x");
  await app.open();
  app.host.openFromOutside([join(dir, "o.png")]);
  await expect(row(app, "o.png")).toBeVisible();
  await expect(app.page).toHaveTitle("o.png");
  app.host.openFromOutside([HERO(app)]);
  await expect(app.page).toHaveTitle("hero.png");
  await expect(row(app, "hero.png")).toHaveCount(1);
  app.host.openFromOutside([join(dir, "说明.txt")]);
  await expect(toast(app)).toContainText("不支持此文件类型（.txt）：说明.txt");
  await expect(app.page).toHaveTitle("hero.png");
});

test("Opening a moved project from the context menu while the app is running says it was recognized and replaces the list entry in place", async ({ app }) => {
  app.host.entries = [{ path: app.project, pinned: true }];
  const to = moveProject(app);
  await app.open();
  app.host.openFromOutside([to]);
  await expect(toast(app)).toContainText(`已识别：「project」已移动到 ${to}`);
  expect(app.host.entries).toEqual([{ path: to, pinned: true }]);
  await expect(row(app, "hero.png")).toBeVisible();
});

test("A moved project opened from outside while the UI is still loading (queued by the shell) says it was recognized once loaded", async ({ app }) => {
  const to = moveProject(app);
  app.host.openFromOutside([to], false);
  await app.open();
  await expect(toast(app)).toContainText(`已识别：「project」已移动到 ${to}`);
  await expect(app.page).toHaveTitle("hero.png");
});

// ---------- New drive: the shell has to reload the page ----------

test("An item added on a new drive (the shell reloads the page) says nothing at that moment; after the reload it is opened and the files that were not added are reported", async ({ app }) => {
  const dir = outside(app, "新盘上的", ["v.png"]);
  writeFileSync(join(dir, "说明.txt"), "x");
  await app.open();
  app.host.reloadOnNextAdd = true;
  app.host.nextPickFiles = [join(dir, "v.png"), join(dir, "说明.txt")];
  await app.page.keyboard.press("Control+o");
  await expect.poll(() => calls(app, "libraryAdd").length).toBe(1);
  await app.page.waitForTimeout(300);
  await expect(toast(app)).toHaveCount(0);
  await app.page.reload();
  await expect(app.page).toHaveTitle("v.png");
  await expect(toast(app)).toContainText("不支持此文件类型（.txt）：说明.txt");
});

// ---------- Remove and re-add, settings changes, F5 ----------

test("Removing a folder, changing it on disk and adding it back lists its current contents (not the scan from before the removal, which would miss new files and keep deleted ones)", async ({ app }) => {
  const dir = outside(app, "另一个", ["旧.png"]);
  app.host.entries.push({ path: dir, pinned: false });
  await app.open();
  await expect(row(app, "旧.png")).toBeVisible();
  await app.page.locator(".lib-row.is-project", { hasText: "另一个" }).click({ button: "right" });
  await app.page.locator(".menu .menu-item", { hasText: "从列表中移除此项目" }).click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "移除" }).click();
  await expect(row(app, "旧.png")).toHaveCount(0);
  rmSync(join(dir, "旧.png"));
  copyFileSync(HERO(app), join(dir, "新.png"));
  app.host.nextPickFolder = dir;
  await app.page.keyboard.press("Control+Shift+O");
  await expect(row(app, "新.png")).toBeVisible();
  await expect(row(app, "旧.png")).toHaveCount(0);
});

test("Turning off Video and adding a skipped folder in Settings updates the list immediately without F5, and turning Video back on does the same", async ({ app }) => {
  await app.open();
  await expect(row(app, "clip.mp4")).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: "高级" }).click();
  const video = app.page.locator(".set-row", { hasText: "mp4 webm mov m4v" }).getByRole("switch");
  await video.click();
  await expect(row(app, "clip.mp4")).toHaveCount(0);
  await app.page.getByPlaceholder("输入名称后按 Enter").fill("assets");
  await app.page.getByPlaceholder("输入名称后按 Enter").press("Enter");
  await expect(row(app, "poster.jpg")).toHaveCount(0);
  await video.click();
  await expect(row(app, "clip.mp4")).toBeVisible();
  await expect(app.page.locator(".set-group", { hasText: "素材列表" })).not.toContainText("F5"); // the description no longer tells people to press F5
});

test("F5 when the shell pushed no change: new files appear, deleted ones disappear, and a deleted standalone entry turns gray", async ({ app }) => {
  const dir = outside(app, "单张", ["x.png"]);
  app.host.entries.push({ path: join(dir, "x.png"), pinned: false });
  app.host.muted = true; // rely on F5 only, not on the shell's watching
  await app.open();
  await expect(row(app, "x.png")).toBeVisible();
  copyFileSync(HERO(app), join(app.project, "assets", "新的.png"));
  rmSync(join(app.project, "assets", "poster.jpg"));
  rmSync(join(dir, "x.png"));
  await focusStage(app);
  await app.page.keyboard.press("F5");
  await expect(row(app, "新的.png")).toBeVisible();
  await expect(row(app, "poster.jpg")).toHaveCount(0);
  await expect(row(app, "x.png")).toContainText("找不到");
});

// ---------- Notes folder watching, expanded-state saving, snapshot cleanup ----------

test("When the project has no notes folder yet and an agent writes the first note, the UI picks it up too", async ({ app }) => {
  const name = join(app.project, ".sniptoss", "annotations", "assets__hero.png.json");
  const text = readFileSync(name, "utf8");
  rmSync(join(app.project, ".sniptoss"), { recursive: true });
  await app.open();
  await row(app, "hero.png").click();
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toHaveCount(0);
  mkdirSync(join(name, ".."), { recursive: true });
  writeFileSync(name, text);
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toBeVisible();
});

test("Expanding and collapsing several times in a row writes only once, and what is stored is the final state", async ({ app }) => {
  await app.open();
  await row(app, "assets").click();
  const before = calls(app, "libraryExpanded").length;
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft"]) await app.page.keyboard.press(key);
  await expect(row(app, "assets")).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => calls(app, "libraryExpanded").length).toBe(before + 1);
  await app.page.waitForTimeout(600);
  expect(calls(app, "libraryExpanded")).toHaveLength(before + 1);
  expect(app.host.expanded.map((p) => p.toLowerCase())).not.toContain(join(app.project, "assets").toLowerCase());
});

test("With an unreadable notes file in the project, unused snapshots are not cleaned up (the broken file may reference some of them)", async ({ app }) => {
  app.allowLogErrors("reading notes");
  app.host.snapshotMinAgeMs = 0;
  const snap = join(app.project, ".sniptoss", "snapshots", "zzzzzz.png");
  mkdirSync(join(snap, ".."), { recursive: true });
  copyFileSync(HERO(app), snap);
  writeFileSync(join(app.project, ".sniptoss", "annotations", "坏了.png.json"), "{ 坏了");
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await app.page.waitForTimeout(800);
  expect(existsSync(snap)).toBe(true);
  expect(calls(app, "pruneSnapshots")).toHaveLength(0);
});

// ---------- Settings → System ----------

test("System: the context menu description mentions only folders, images and videos (PDF and PPT are no longer registered); turning it on and off each shows a toast", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: "系统集成" }).click();
  const shellRow = app.page.locator(".set-row", { hasText: "资源管理器右键菜单" });
  await expect(shellRow).toContainText("图片、视频");
  await expect(shellRow).not.toContainText("PDF");
  await expect(shellRow).not.toContainText("PPT");
  const sw = shellRow.getByRole("switch");
  await sw.click();
  await expect(toast(app)).toContainText("已添加到资源管理器右键菜单");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(toast(app)).toContainText("已从资源管理器右键菜单移除");
  await expect(sw).toHaveAttribute("aria-checked", "false");
});

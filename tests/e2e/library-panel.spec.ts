// The library: the list itself:
// empty list, startup selection, grouping and sorting, subtitles, missing entries, click / arrow / double-click,
// multi-select and marquee select, keyboard, selection following, filtering.
// Context menus, removal, badges and footer stats are in library-menus.spec.ts; the side panel width and collapsing are in layout.spec.ts

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The row whose name is exactly `name` */
const row = (app: App, name: string) => app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${escape(name)}$`) }) });
const list = (app: App) => app.page.locator(".lib-list");
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
/** The names of the context menu items (without the gray text on the right) */
const menuLabels = (app: App) => app.page.locator(".menu .menu-label").allInnerTexts();
const menuItem = (app: App, label: string) =>
  app.page.locator(".menu .menu-item", { has: app.page.locator(".menu-label", { hasText: new RegExp(`^${escape(label)}$`) }) });
const HERO = (app: App) => join(app.project, "assets", "hero.png");

/** n images of 1×1 pixels in one folder (for large lists) */
function manyImages(dir: string, n: number) {
  mkdirSync(dir, { recursive: true });
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  for (let i = 0; i < n; i++) writeFileSync(join(dir, `img-${String(i).padStart(4, "0")}.png`), pixel);
}

/** Another project (without notes): a folder holding a few images */
function otherProject(app: App, name: string, files: string[]) {
  const dir = join(app.temp, name);
  mkdirSync(dir, { recursive: true });
  for (const f of files) copyFileSync(HERO(app), join(dir, f));
  return dir;
}

test("At startup, when the last viewed file has been deleted from its folder (an agent re-exported it under another name), the first item in the list is opened instead of an empty canvas", async ({ app }) => {
  app.host.selected = join(app.project, "assets", "v1-已经删了.png");
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
});

test("Before the scan result arrives, the project row does not say it has no annotatable items and the footer does not say the list is empty", async ({ app }) => {
  app.host.delays = { library: 600, scan: 1500 };
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".sidebar-footer")).toBeVisible();
  expect(await app.page.locator(".footer-stats").innerText()).not.toBe("列表为空");
  const project = app.page.locator(".lib-row.is-project");
  await expect(project).toBeVisible();
  expect(await project.innerText()).not.toContain("不含可批注的素材");
  await expect(app.page).toHaveTitle("hero.png", { timeout: 5000 });
  await expect(app.page.locator(".footer-stats")).toHaveText("1 个项目 · 2 张图片 · 1 个视频");
});

test("After a confirm dialog or context menu closes, keyboard focus returns to the list so ↓ and Delete keep working", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "project").click();
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("Delete");
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("从列表中移除此项目？");
  await app.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("ArrowDown");
  await expect(row(app, "assets")).toHaveAttribute("aria-selected", "true");
  // Context menu: choosing an item or closing it with Esc both return focus to the list
  await row(app, "assets").click({ button: "right" });
  await app.page.locator(".menu .menu-item", { hasText: "折叠" }).click();
  await expect(row(app, "assets")).toHaveAttribute("aria-expanded", "false");
  await expect(list(app)).toBeFocused();
  await row(app, "assets").click({ button: "right" });
  await expect(app.page.locator(".menu")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".menu")).toHaveCount(0);
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("ArrowRight");
  await expect(row(app, "assets")).toHaveAttribute("aria-expanded", "true");
});

test("Clicking another item while the composer has text and choosing Keep editing puts the library selection back on the open item", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("还没写完");
  await row(app, "poster.jpg").click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("放弃未保存的批注？");
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "false");
  await expect(app.page.locator(".composer-text")).toHaveValue("还没写完");
});

test("Ctrl+C on a missing entry shows its name in the toast", async ({ app }) => {
  app.host.entries.push({ path: join(app.project, "assets", "gone.png"), pinned: false });
  await app.open();
  await row(app, "gone.png").click();
  await app.page.keyboard.press("Control+c");
  await expect(app.page.locator(".toast")).toContainText("「gone.png」中没有待处理的批注");
});

test("The subtitle of an empty folder also lists the skipped folders, and ends with an ellipsis when more than 4 unsupported formats are found", async ({ app }) => {
  const empty = join(app.temp, "空的");
  mkdirSync(join(empty, "dist"), { recursive: true });
  copyFileSync(HERO(app), join(empty, "dist", "out.png"));
  for (const ext of ["pdf", "psd", "ai", "sketch", "fig", "pptx"]) writeFileSync(join(empty, `a.${ext}`), "x");
  app.host.entries.push({ path: empty, pinned: false });
  await app.open();
  const sub = app.page.locator(".lib-row.is-project", { hasText: "空的" }).locator(".lib-sub");
  await expect(sub).toHaveText("不含可批注的素材；另有 6 个文件暂不支持：ai、fig、pdf、pptx…；已跳过文件夹：dist");
});

test("A PDF that was added on its own earlier (now unsupported): the row says it is unsupported instead of doing nothing when clicked", async ({ app }) => {
  const dir = join(app.temp, "旧的");
  mkdirSync(dir);
  writeFileSync(join(dir, "brief.pdf"), "%PDF-1.4");
  app.host.entries.push({ path: join(dir, "brief.pdf"), pinned: false });
  await app.open();
  await expect(row(app, "brief.pdf").locator(".lib-sub")).toHaveText("暂不支持此文件类型（.pdf）");
});

test("Dragging the list's scrollbar neither resizes the side panel (the edge handle must not cover its right half) nor starts a marquee", async ({ app }) => {
  const big = join(app.temp, "big");
  manyImages(big, 2000);
  app.host.entries = [{ path: big, pinned: false }];
  await app.open();
  await row(app, "img-0000.png").click();
  const b = (await list(app).boundingBox())!;
  const width = (await app.page.locator("aside.sidebar").boundingBox())!.width;
  // The scrollbar is 8 wide and the thumb is drawn in the middle 4 pixels. The headless test browser does not respond to
  // scrollbar dragging (the list does not scroll, so that part needs a manual check);
  // here we only check what the press lands on and whether the drag starts a marquee
  const x = b.x + b.width - 4;
  expect(await app.page.evaluate(([pointX, pointY]) => document.elementFromPoint(pointX, pointY)?.className, [x, b.y + 4])).toContain("lib-list");
  await app.page.mouse.move(x, b.y + 4);
  await app.page.mouse.down();
  await app.page.mouse.move(x, b.y + 300, { steps: 8 });
  await expect(app.page.locator(".marquee")).toBeHidden();
  await app.page.mouse.up();
  expect((await app.page.locator("aside.sidebar").boundingBox())!.width).toBe(width);
  await app.page.mouse.move(b.x + 60, b.y + 400, { steps: 6 });
  await expect(app.page.locator(".marquee")).toBeHidden();
  // Still only one item selected (with a multi-selection the notes panel would show a Selected scope)
  await expect(app.page.locator(".scope-switch .seg", { hasText: "选中项" })).toHaveCount(0);
  await expect(app.page).toHaveTitle("img-0000.png");
});

test("With the setting to select the first item with open notes after adding a folder, adding a project that already has notes selects the item that has them", async ({ app }) => {
  const other = otherProject(app, "other", ["a-first.png", "b.png"]);
  mkdirSync(join(other, ".sniptoss", "annotations"), { recursive: true });
  const notes = JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", "assets__hero.png.json"), "utf8"));
  notes.material.path = "b.png";
  writeFileSync(join(other, ".sniptoss", "annotations", "b.png.json"), JSON.stringify(notes, null, 2));
  app.host.prefs = { initialSelect: "firstOpen" };
  await app.open();
  app.host.nextPickFolder = other;
  await app.page.keyboard.press("Control+Shift+O");
  await expect(app.page).toHaveTitle("b.png");
});

test("Opening a row's context menu from the keyboard (Shift+F10 or the menu key) shows the menu of the row under the cursor", async ({ app }) => {
  await app.open();
  await row(app, "project").click();
  await app.page.keyboard.press("Shift+F10");
  await expect(app.page.locator(".menu")).toBeVisible();
  expect(await menuLabels(app)).toContain("打开项目文件夹");
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("ArrowDown");
  await app.page.keyboard.press("ContextMenu");
  await expect(app.page.locator(".menu")).toBeVisible();
  expect(await menuLabels(app)).toContain("添加文件夹意见…");
  expect(await menuLabels(app)).not.toContain("全选");
});

test("F5 still refreshes and F1 still opens the shortcuts sheet while the cursor is in the filter box", async ({ app }) => {
  await app.open();
  await app.page.getByPlaceholder("筛选素材").click();
  const scans = () => app.host.calls.filter((c) => c.method === "scan").length;
  const before = scans();
  await app.page.keyboard.press("F5");
  await expect.poll(scans).toBe(before + 1);
  await app.page.keyboard.press("F1");
  await expect(app.page.locator(".sheet[role=dialog]")).toBeVisible();
});

test("Typing in the filter box and then clicking a row with the mouse shows no keyboard focus ring on the list", async ({ app }) => {
  await app.open();
  await app.page.getByPlaceholder("筛选素材").fill("o");
  await row(app, "poster.jpg").click();
  await expect(list(app)).toBeFocused();
  expect(await list(app).evaluate((el) => el.matches(":focus-visible"))).toBe(false);
});

// ---------- Empty list, startup ----------

test("An empty list shows \"No items yet\" in the library, no filter box and \"list is empty\" in the footer; cancelling the add dialog changes nothing, and the filter box appears once something is added", async ({ app }) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".lib-empty")).toContainText("暂无素材");
  await expect(app.page.locator(".lib-empty")).toContainText("从列表中移除不会删除文件");
  await expect(app.page.getByPlaceholder("筛选素材")).toHaveCount(0);
  await expect(app.page.locator(".footer-stats")).toHaveText("列表为空");
  await expect(app.page.locator(".welcome")).toBeVisible();
  await expect(app.page.locator(".lib-header-actions button")).toHaveCount(2);
  // Right-click on blank space: list actions are grayed out, adding works as usual
  await list(app).click({ button: "right", position: { x: 20, y: 200 } });
  for (const label of ["全选", "刷新", "全部折叠", "清空列表…"]) await expect(menuItem(app, label)).toBeDisabled();
  for (const label of ["添加文件…", "添加文件夹…", "从剪贴板添加"]) await expect(menuItem(app, label)).toBeEnabled();
  await app.page.keyboard.press("Escape");
  // Dialog cancelled: nothing is added
  app.host.nextPickFiles = [];
  await app.page.locator(".welcome").getByRole("button", { name: "添加文件", exact: true }).click();
  await expect.poll(() => app.host.calls.some((c) => c.method === "pickFiles")).toBe(true);
  expect(app.host.calls.some((c) => c.method === "libraryAdd")).toBe(false);
  await expect(app.page.locator(".lib-empty")).toBeVisible();
  // Add Files at the top of the library: adds and opens the file
  app.host.nextPickFiles = [HERO(app)];
  await app.page.locator(".lib-header-actions button").first().click();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(app.page.getByPlaceholder("筛选素材")).toBeVisible();
  await expect(app.page.locator(".sidebar .search-filter")).toBeVisible();
});

test("Startup restores the previous state: the last viewed item, expanded folders and collapsed projects are as before, and a collapsed project that contains the last viewed item expands automatically", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries = [
    { path: other, pinned: false },
    { path: app.project, pinned: false },
  ];
  app.host.expanded = [join(app.project, "assets")];
  app.host.collapsed = [app.project];
  app.host.selected = join(other, "x.png");
  await app.open();
  await expect(app.page).toHaveTitle("x.png");
  await expect(row(app, "project")).toHaveAttribute("aria-expanded", "false");
  await expect(row(app, "hero.png")).toHaveCount(0);
  await expect(row(app, "other")).toHaveAttribute("aria-expanded", "true");
  // The last viewed item is inside a collapsed project: expand it (the selected row must be visible); the assets folder that was expanded stays expanded
  app.host.selected = HERO(app);
  await app.page.reload();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(row(app, "project")).toHaveAttribute("aria-expanded", "true");
  await expect(row(app, "assets")).toHaveAttribute("aria-expanded", "true");
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
});

// ---------- Grouping, sorting, subtitles ----------

/** The library width on the next load (localStorage, Panels.tsx) */
const presetLeft = (app: App, width: number) =>
  app.page.addInitScript(
    (w) => localStorage.setItem("sniptoss.panels", JSON.stringify({ left: { width: w, collapsed: false }, right: { width: 320, collapsed: false } })),
    width,
  );
/** The project subtitle: the parent folder, with the user profile directory written as ~ */
const placeOf = (dir: string) => dir.replace(/^[a-z]:\\users\\[^\\]+(?=\\|$)/i, "~");

test("Grouping by project: entries sharing a notes folder form one group with the parent folder as subtitle (user directory written as ~); before the scan returns they are grouped provisionally by their folder", async ({ app }) => {
  await presetLeft(app, 520);
  app.host.entries = [
    { path: HERO(app), pinned: false },
    { path: join(app.project, "video", "clip.mp4"), pinned: false },
  ];
  app.host.delays = { scan: 1200 };
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".lib-row.is-project")).toHaveCount(2); // first by containing folder: assets and video
  await expect(app.page.locator(".lib-row.is-project")).toHaveCount(1, { timeout: 5000 });
  const project = app.page.locator(".lib-row.is-project");
  await expect(project.locator(".lib-name")).toHaveText("project");
  await expect(project.locator(".lib-sub")).toHaveText(placeOf(app.temp));
  await expect(row(app, "hero.png")).toBeVisible();
  await expect(row(app, "clip.mp4")).toBeVisible();
});

test("Project order and separator: pinned projects come first with a line between them and the rest; a newly added project goes after the pinned ones and before the rest; unpinning moves a project to the front of the regular area", async ({ app }) => {
  const pinned = otherProject(app, "pinned", ["p.png"]);
  const third = otherProject(app, "third", ["t.png"]);
  app.host.entries = [
    { path: pinned, pinned: true },
    { path: app.project, pinned: false },
  ];
  await app.open();
  const names = () => app.page.locator(".lib-row.is-project .lib-name").allInnerTexts();
  expect(await names()).toEqual(["pinned", "project"]);
  await expect(app.page.locator(".lib-sep")).toHaveCount(1);
  app.host.nextPickFolder = third;
  await app.page.keyboard.press("Control+Shift+O");
  await expect.poll(names).toEqual(["pinned", "third", "project"]);
  await row(app, "pinned").locator(".lib-pin").click();
  await expect(app.page.locator(".lib-sep")).toHaveCount(0);
  await expect.poll(names).toEqual(["pinned", "third", "project"]);
});

test("Folder tree: subfolders come before files, each sorted by name with numbers compared by value (file2 before file10), and Chinese names sorted by zh-CN rules (before English ones)", async ({ app }) => {
  await presetLeft(app, 520);
  const assets = join(app.project, "assets");
  for (const f of ["file2.png", "file10.png", "文件B.png", "文件A.png"]) copyFileSync(HERO(app), join(assets, f));
  for (const d of ["b-dir", "a-dir"]) {
    mkdirSync(join(assets, d));
    copyFileSync(HERO(app), join(assets, d, `${d[0]}.png`));
  }
  app.host.expanded = [assets, join(assets, "a-dir"), join(assets, "b-dir")];
  await app.open();
  const names = await app.page.locator(".lib-row .lib-name").allInnerTexts();
  expect(names.slice(names.indexOf("assets") + 1, names.indexOf("video"))).toEqual([
    "a-dir",
    "a.png",
    "b-dir",
    "b.png",
    "文件A.png",
    "文件B.png",
    "file2.png",
    "file10.png",
    "hero.png",
    "poster.jpg",
  ]);
  // Indentation: items inside a subfolder are one level deeper
  expect(await row(app, "a.png").getAttribute("aria-level")).toBe("4");
});

test("When the project subtitle does not fit, whole segments are dropped from the start (\"…\\parent\") without cutting a folder name in half, and it grows as the side panel is widened", async ({ app }) => {
  await presetLeft(app, 180);
  await app.open();
  const sub = app.page.locator(".lib-row.is-project .lib-sub");
  const full = placeOf(app.temp);
  const narrow = await sub.innerText();
  expect(narrow.startsWith("…\\")).toBe(true);
  expect(full.endsWith(narrow.slice(1))).toBe(true); // what is left is the complete trailing segments
  const b = (await app.page.locator(".sash-left").boundingBox())!;
  await app.page.mouse.move(b.x + b.width / 2, b.y + 200);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x + 340, b.y + 200, { steps: 6 });
  await app.page.mouse.up();
  await expect(sub).toHaveText(full);
});

test("With no annotatable items, the subtitle of a project row or a folder row added on its own says so, and also lists unsupported files when there are any", async ({ app }) => {
  const empty = join(app.temp, "empty");
  mkdirSync(empty);
  mkdirSync(join(app.project, "dist"));
  writeFileSync(join(app.project, "dist", "n.pdf"), "x");
  app.host.entries = [
    { path: app.project, pinned: false },
    { path: join(app.project, "dist"), pinned: false }, // the project scan skips dist, so it gets a row of its own
    { path: empty, pinned: false },
  ];
  await app.open();
  await expect(row(app, "empty").locator(".lib-sub")).toHaveText("不含可批注的素材");
  await expect(row(app, "dist").locator(".lib-sub")).toHaveText("不含可批注的素材；另有 1 个文件暂不支持：pdf");
});

test("A missing entry is struck through and grayed with a plain file icon; a click only selects it without opening; the first context menu item is Locate… and there is no Show in File Explorer; it recovers by itself when the file comes back", async ({ app }) => {
  const gone = join(app.project, "assets", "gone.png");
  app.host.entries.push({ path: gone, pinned: false });
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  const r = row(app, "gone.png");
  await expect(r).toHaveClass(/is-missing/);
  expect(await r.locator(".lib-name").evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  await expect(r.locator(".kind")).toHaveClass(/kind-missing/);
  await expect(r.locator(".lib-sub")).toHaveText("找不到：可能已被移动、重命名或删除（右键单击「定位…」）");
  await r.click();
  await expect(r).toHaveAttribute("aria-selected", "true");
  await expect(app.page).toHaveTitle("hero.png");
  await r.click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["定位…", "复制批注成文字", "复制批注成图片", "从列表中移除", "清空列表…"]);
  await app.page.keyboard.press("Escape");
  copyFileSync(HERO(app), gone);
  await expect(r).not.toHaveClass(/is-missing/, { timeout: 8000 });
  await r.click();
  await expect(app.page).toHaveTitle("gone.png");
});

test("Hover tooltips on project, folder and item rows show the full path", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  const tip = app.page.locator(".tooltip.is-on");
  for (const [name, path] of [
    ["project", app.project],
    ["assets", join(app.project, "assets")],
    ["hero.png", HERO(app)],
  ]) {
    await row(app, name).hover();
    await expect(tip).toBeVisible();
    expect((await tip.innerText()).replaceAll("\u200b", "")).toBe(path);
    await app.page.mouse.move(700, 450);
    await expect(tip).toHaveCount(0);
  }
});

// ---------- Click, double-click, multi-select, marquee select ----------

test("Clicking an item row selects only that row and opens it, and the shell records it as the last viewed", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "poster.jpg").click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect.poll(() => app.host.selected).toBe(join(app.project, "assets", "poster.jpg"));
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(1);
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "true");
});

test("Clicking a project or folder row: the first click selects it and, if the open item is not inside, opens the first item inside with open notes; only a click while it is already the sole selection collapses it", async ({ app }) => {
  copyFileSync(HERO(app), join(app.project, "assets", "a-first.png")); // sorts before hero and has no notes
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.selected = join(app.project, "video", "clip.mp4");
  await app.open();
  await expect(app.page).toHaveTitle("clip.mp4");
  const assets = row(app, "assets");
  await assets.click();
  await expect(app.page).toHaveTitle("hero.png"); // not a-first.png, which sorts first
  await expect(assets).toHaveAttribute("aria-selected", "true");
  await expect(assets).toHaveAttribute("aria-expanded", "true");
  await assets.click();
  await expect(assets).toHaveAttribute("aria-expanded", "false");
  await assets.click();
  await expect(assets).toHaveAttribute("aria-expanded", "true");
});

test("Clicking the arrow at the start of a row only expands or collapses; it changes neither the selection nor the canvas", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "poster.jpg").click();
  await expect(app.page).toHaveTitle("poster.jpg");
  const video = row(app, "video");
  await expect(video.locator(".lib-twisty")).not.toHaveClass(/is-open/);
  await video.locator(".lib-twisty").click();
  await expect(video).toHaveAttribute("aria-expanded", "true");
  await expect(video.locator(".lib-twisty")).toHaveClass(/is-open/);
  await expect(video).toHaveAttribute("aria-selected", "false");
  await expect(app.page).toHaveTitle("poster.jpg");
  await row(app, "project").locator(".lib-twisty").click();
  await expect(row(app, "project")).toHaveAttribute("aria-expanded", "false");
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(row(app, "poster.jpg")).toHaveCount(0);
});

test("Double-clicking an item row is the same as a single click and opens nothing", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "poster.jpg").dblclick();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(app.page.locator(".menu, [role=alertdialog]")).toHaveCount(0);
});

test("Ctrl+click adds or removes a row from the selection without changing the canvas; when the open item is not in the selection it gets a thin vertical line on its left", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "hero.png").click();
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  await expect(app.page).toHaveTitle("hero.png");
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "true");
  await expect(app.page.locator(".scope-switch .seg.is-on")).toHaveText(/选中项/);
  await row(app, "hero.png").click({ modifiers: ["Control"] });
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "false");
  await expect(row(app, "hero.png")).toHaveClass(/is-current/);
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "true");
});

test("Shift+click selects a range from the last clicked row without changing the canvas; if that row is hidden by a collapse, the range starts from the cursor row", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  await row(app, "assets").click();
  await expect(app.page).toHaveTitle("hero.png");
  await row(app, "clip.mp4").click({ modifiers: ["Shift"] });
  await expect(app.page).toHaveTitle("hero.png");
  for (const name of ["assets", "hero.png", "poster.jpg", "video", "clip.mp4"]) await expect(row(app, name)).toHaveAttribute("aria-selected", "true");
  await expect(row(app, "project")).toHaveAttribute("aria-selected", "false");
  // The anchor is inside a collapsed folder: the range starts from the cursor row
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  await row(app, "assets").locator(".lib-twisty").click();
  await row(app, "video").click({ modifiers: ["Shift"] });
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(2); // assets (the cursor) to video
});

test("Marquee select: rows inside the box are selected without changing the canvas; Ctrl+drag adds to the selection; on release, if the open item is not inside, the first item with open notes opens; starting on an arrow draws no marquee", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  const drag = async (from: string, to: string, ctrl = false) => {
    const a = (await row(app, from).boundingBox())!;
    const b = (await row(app, to).boundingBox())!;
    if (ctrl) await app.page.keyboard.down("Control");
    await app.page.mouse.move(a.x + 60, a.y + a.height / 2);
    await app.page.mouse.down();
    await app.page.mouse.move(b.x + 60, b.y + b.height / 2 + (a.y === b.y ? 6 : 0), { steps: 5 });
    await app.page.mouse.up();
    if (ctrl) await app.page.keyboard.up("Control");
  };
  await drag("hero.png", "video");
  for (const name of ["hero.png", "poster.jpg", "video"]) await expect(row(app, name)).toHaveAttribute("aria-selected", "true");
  for (const name of ["project", "assets", "clip.mp4"]) await expect(row(app, name)).toHaveAttribute("aria-selected", "false");
  await expect(app.page).toHaveTitle("hero.png");
  await expect(app.page.locator(".marquee")).toBeHidden();
  await drag("clip.mp4", "clip.mp4", true); // Ctrl+drag: adds to the existing selection
  await expect(row(app, "clip.mp4")).toHaveAttribute("aria-selected", "true");
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
  // Opening rule: open clip first, then marquee-select hero to poster
  await row(app, "clip.mp4").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await drag("poster.jpg", "hero.png");
  await expect(app.page).toHaveTitle("hero.png");
  // Starting on an arrow: no marquee
  const t = (await row(app, "video").locator(".lib-twisty").boundingBox())!;
  await app.page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(t.x + t.width / 2, t.y + 80, { steps: 5 });
  await expect(app.page.locator(".marquee")).toBeHidden();
  await app.page.mouse.up();
});

test("Dragging a marquee to the top edge of the list scrolls it up automatically, and rows that scroll out of view are still selected", async ({ app }) => {
  // The list scrolls a step per frame: on a machine without a GPU (CI runners draw a few frames a second) three screens take well over ten seconds
  test.setTimeout(90_000);
  const big = join(app.temp, "big");
  manyImages(big, 600);
  app.host.entries = [{ path: big, pinned: false }];
  await app.open();
  await row(app, "img-0000.png").click();
  await app.page.keyboard.press("End");
  await expect(row(app, "img-0599.png")).toBeInViewport();
  const top = await list(app).evaluate((el) => el.scrollTop);
  const l = (await list(app).boundingBox())!;
  const last = (await row(app, "img-0599.png").boundingBox())!;
  await app.page.mouse.move(last.x + 60, last.y + last.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(last.x + 60, l.y + 4, { steps: 5 });
  // Hold until it has scrolled three screens before releasing (rows scrolled out of view are no longer rendered,
  // which is what shows they are still selected). A fixed one-second wait is not enough: when frames render slowly it does not
  // scroll a full screen, every selected row is still rendered and the test fails
  await expect.poll(() => list(app).evaluate((el) => el.scrollTop), { timeout: 45_000 }).toBeLessThan(Math.max(0, top - 3 * l.height) + 1);
  await app.page.mouse.up();
  expect(await list(app).evaluate((el) => el.scrollTop)).toBeLessThan(top);
  const picked = app.page.locator(".scope-switch .seg.is-on");
  const n = Number(/素材栏中选中的 (\d+) 个素材/.exec((await picked.getAttribute("title"))!)![1]);
  expect(n).toBeGreaterThan(await app.page.locator(".lib-row.is-selected").count());
});

test("Clicking blank space clears a multi-selection and keeps only the open item; if the open item is in a collapsed folder, no row is selected", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "hero.png").click();
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  await list(app).click({ position: { x: 20, y: 500 } });
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(1);
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
  await row(app, "project").click({ modifiers: ["Control"] });
  await row(app, "assets").locator(".lib-twisty").click();
  await list(app).click({ position: { x: 20, y: 500 } });
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(0);
});

test("Ctrl+A selects the visible rows; if the open item is not among them it opens the first selected item with open notes; while filtering it selects only the filtered rows", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries = [
    { path: other, pinned: false },
    { path: app.project, pinned: false },
  ];
  await app.open();
  await row(app, "x.png").click();
  await app.page.keyboard.press("Control+a");
  const all = await app.page.locator(".lib-row").count();
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(all);
  await expect(app.page).toHaveTitle("x.png");
  await app.page.getByPlaceholder("筛选素材").fill("project");
  await list(app).focus();
  await app.page.keyboard.press("Control+a");
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(3);
  await expect(app.page).toHaveTitle("hero.png");
});

test("Esc with a project row or several rows selected goes back to selecting only the open item", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "project").click();
  await expect(row(app, "project")).toHaveAttribute("aria-selected", "true");
  await app.page.keyboard.press("Escape");
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
  await expect(row(app, "project")).toHaveAttribute("aria-selected", "false");
});

// ---------- Keyboard ----------

test("↑ ↓ Home End: landing on a project or folder row only selects it without changing the canvas, landing on an item row opens it, and the cursor does not wrap around at the ends", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "hero.png").click();
  await app.page.keyboard.press("ArrowUp");
  await expect(row(app, "assets")).toHaveAttribute("aria-selected", "true");
  await expect(app.page).toHaveTitle("hero.png");
  await app.page.keyboard.press("ArrowUp");
  await app.page.keyboard.press("ArrowUp");
  await expect(row(app, "project")).toHaveAttribute("aria-selected", "true");
  await app.page.keyboard.press("End");
  await expect(row(app, "video")).toHaveAttribute("aria-selected", "true");
  await app.page.keyboard.press("ArrowDown");
  await expect(row(app, "video")).toHaveAttribute("aria-selected", "true");
  await app.page.keyboard.press("ArrowUp");
  await expect(app.page).toHaveTitle("poster.jpg");
  await app.page.keyboard.press("Home");
  await expect(row(app, "project")).toHaveAttribute("aria-selected", "true");
});

test("→ ←: → expands a collapsed row or moves to the next row if already expanded; ← collapses an expanded row or jumps from an inner row to its parent; on an item row they are left to the canvas (an image switches items)", async ({ app }) => {
  const assets = join(app.project, "assets");
  mkdirSync(join(assets, "a-dir"));
  copyFileSync(HERO(app), join(assets, "a-dir", "y.png"));
  app.host.expanded = [assets];
  app.host.selected = join(assets, "poster.jpg"); // otherwise startup opens y.png inside a-dir and a-dir is already expanded
  await app.open();
  await row(app, "poster.jpg").click();
  await app.page.keyboard.press("ArrowDown"); // video (collapsed): only selects
  await expect(row(app, "video")).toHaveAttribute("aria-selected", "true");
  await app.page.keyboard.press("ArrowRight");
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "true");
  await expect(app.page).toHaveTitle("poster.jpg");
  await app.page.keyboard.press("ArrowRight");
  await expect(app.page).toHaveTitle("clip.mp4");
  // Subfolder: ← collapses it, another ← jumps to assets
  await row(app, "a-dir").locator(".lib-twisty").click();
  await row(app, "y.png").click();
  await app.page.keyboard.press("ArrowUp");
  await expect(row(app, "a-dir")).toHaveAttribute("aria-selected", "true");
  await app.page.keyboard.press("ArrowLeft");
  await expect(row(app, "a-dir")).toHaveAttribute("aria-expanded", "false");
  await app.page.keyboard.press("ArrowLeft");
  await expect(row(app, "assets")).toHaveAttribute("aria-selected", "true");
  // ← on an image row belongs to the canvas and switches to the previous item
  await row(app, "poster.jpg").click();
  await app.page.keyboard.press("ArrowLeft");
  await expect(app.page).toHaveTitle("hero.png");
});

test("Enter and Space act like a click; on the row of the open item, Space is left to the canvas (video playback)", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "poster.jpg").click();
  await app.page.keyboard.press("ArrowDown"); // the video row
  await app.page.keyboard.press("Enter");
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "true");
  await expect(app.page).toHaveTitle("clip.mp4");
  await app.page.keyboard.press("Enter"); // already the sole selection and expanded: collapses
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "false");
  await app.page.keyboard.press(" ");
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "true");
  await row(app, "clip.mp4").click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await app.page.keyboard.press(" ");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(false);
});

test("Shift+↑ ↓ selects a range from the anchor without changing the canvas; a press without Shift goes back to a single selection", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "assets").click();
  await expect(app.page).toHaveTitle("hero.png");
  await app.page.keyboard.press("Shift+ArrowDown");
  await app.page.keyboard.press("Shift+ArrowDown");
  for (const name of ["assets", "hero.png", "poster.jpg"]) await expect(row(app, name)).toHaveAttribute("aria-selected", "true");
  await expect(app.page).toHaveTitle("hero.png");
  await app.page.keyboard.press("Shift+ArrowUp");
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "false");
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(1);
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("Delete on a project row asks \"Remove this project from the list?\", on a standalone entry asks \"Remove from the list?\", and does nothing on files and folders inside the tree", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries.push({ path: join(other, "x.png"), pinned: false });
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  const dialog = app.page.getByRole("alertdialog");
  await row(app, "project").click();
  await app.page.keyboard.press("Delete");
  await expect(dialog).toContainText("从列表中移除此项目？");
  await app.page.keyboard.press("Escape");
  await row(app, "x.png").click();
  await app.page.keyboard.press("Delete");
  await expect(dialog).toContainText("从列表中移除？");
  await app.page.keyboard.press("Escape");
  await row(app, "hero.png").click();
  await app.page.keyboard.press("Delete");
  await row(app, "assets").click();
  await app.page.keyboard.press("Delete");
  await expect(dialog).toHaveCount(0);
  expect(app.host.entries).toHaveLength(2);
});

test("Ctrl+C copies the open notes of the cursor row (or of the selected rows in a multi-selection) as text, and says so when there are none", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  await row(app, "project").click();
  await app.page.keyboard.press("Control+c");
  await expect(app.page.locator(".toast")).toContainText("已复制「project」中 2 个素材的 2 条批注");
  expect(await app.clipboard()).toContain("标题字太细了");
  expect(await app.clipboard()).toContain("这段水印去掉");
  await row(app, "poster.jpg").click();
  await app.page.keyboard.press("Control+c");
  await expect(app.page.locator(".toast")).toContainText("「poster.jpg」中没有待处理的批注");
  await row(app, "hero.png").click();
  await app.page.keyboard.press("Control+c");
  await expect(app.page.locator(".toast")).toContainText("已复制「hero.png」的 1 条批注");
  expect(await app.clipboard()).not.toContain("这段水印去掉");
});

test("Selection following: Ctrl+↓ switches to the next item and the library follows; with a whole project selected the selection stays; a collapsed folder expands automatically", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "project").click();
  await focusStage(app);
  await app.page.keyboard.press("Control+ArrowDown");
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(row(app, "project")).toHaveAttribute("aria-selected", "true");
  await expect(app.page.locator(".scope-switch .seg.is-on")).toHaveText(/整个项目/);
  await row(app, "poster.jpg").click();
  await focusStage(app);
  await app.page.keyboard.press("Control+ArrowDown");
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "true");
  await expect(row(app, "clip.mp4")).toHaveAttribute("aria-selected", "true");
  await expect(row(app, "poster.jpg")).toHaveAttribute("aria-selected", "false");
});

test("When the last viewed item is far down a long list at startup, the list scrolls to make it visible and selects it", async ({ app }) => {
  const big = join(app.temp, "big");
  manyImages(big, 1500);
  app.host.entries = [{ path: big, pinned: false }];
  app.host.selected = join(big, "img-1200.png");
  await app.open();
  await expect(app.page).toHaveTitle("img-1200.png");
  await expect(row(app, "img-1200.png")).toBeInViewport();
  await expect(row(app, "img-1200.png")).toHaveAttribute("aria-selected", "true");
});

// ---------- Filtering ----------

test("Filtering searches by project name / path, case-insensitively; each row shows \"project / folder\"; no match shows \"No matching items\"; with the open-notes-only filter on, it searches only those", async ({ app }) => {
  await app.open();
  const search = app.page.getByPlaceholder("筛选素材");
  await search.fill("HERO");
  await expect(app.page.locator(".lib-row")).toHaveCount(1);
  await expect(row(app, "hero.png").locator(".lib-sub")).toHaveText("project / assets");
  await search.fill("project");
  await expect(app.page.locator(".lib-row")).toHaveCount(3);
  await search.fill("zzz");
  await expect(app.page.locator(".list-empty")).toHaveText("没有匹配的素材");
  await search.fill("  ");
  await expect(app.page.locator(".lib-row.is-project")).toHaveCount(1);
  await app.page.locator(".sidebar .search-filter").click();
  await search.fill("poster");
  await expect(app.page.locator(".list-empty")).toContainText("没有匹配的素材");
  await app.page.locator(".list-empty").getByRole("button", { name: "显示全部" }).click();
  await expect(row(app, "poster.jpg")).toBeVisible();
});

test("Rows in the filter results open when clicked, and their context menu has the two Copy items, Show in File Explorer and Clear Library but no Remove", async ({ app }) => {
  await app.open();
  const search = app.page.getByPlaceholder("筛选素材");
  await search.fill("poster");
  await row(app, "poster.jpg").click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await row(app, "poster.jpg").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "在资源管理器中显示", "清空列表…"]);
  await expect(app.page.locator(".menu .menu-item").first()).toBeDisabled();
  await menuItem(app, "在资源管理器中显示").click();
  expect(app.host.revealed.at(-1)).toBe(join(app.project, "assets", "poster.jpg"));
});

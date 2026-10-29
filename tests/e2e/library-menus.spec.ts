// The library: context menus and per-row actions:
// context menus of each kind of row, copying, folder comments, expand / collapse, pinning, opening folders, removing and clearing,
// hover buttons, note counts, footer stats, version tag

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";
import { IS_BETA, VERSION, VERSION_LABEL } from "./mock-host";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The row whose name is exactly `name` */
const row = (app: App, name: string) => app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${escape(name)}$`) }) });
const menu = (app: App) => app.page.locator(".menu");
const menuItem = (app: App, label: string) =>
  app.page.locator(".menu .menu-item", { has: app.page.locator(".menu-label", { hasText: new RegExp(`^${escape(label)}$`) }) });
/** The names of the context menu items (without the gray text on the right) */
const menuLabels = (app: App) => app.page.locator(".menu .menu-label").allInnerTexts();
const HERO = (app: App) => join(app.project, "assets", "hero.png");
/** Right-click on blank space in the list */
const blankMenu = (app: App) => app.page.locator(".lib-list").click({ button: "right", position: { x: 20, y: 500 } });

/** Writes a folder comment for a folder (rel is relative to the project; "." is the project folder itself) */
function folderNote(app: App, rel: string, body: string) {
  const note = { id: "fold01", status: "open", category: "change", body, anchor: {}, author: "user", created_at: "", updated_at: "", replies: [] };
  writeFileSync(
    join(app.project, ".sniptoss", "annotations", rel === "." ? "@folder.json" : `${rel.replaceAll("/", "__")}@folder.json`),
    JSON.stringify({ schema: "sniptoss/4", material: { path: rel, kind: "folder" }, annotations: [note] }, null, 2),
  );
}

/** Another project (without notes): a folder holding a few images */
function otherProject(app: App, name: string, files: string[]) {
  const dir = join(app.temp, name);
  mkdirSync(dir, { recursive: true });
  for (const f of files) copyFileSync(f.endsWith(".mp4") ? join(app.project, "video", "clip.mp4") : HERO(app), join(dir, f));
  return dir;
}

test("With only pinned projects (plus one unpinned file added on its own), Clear Library… in the menu bar is also grayed out, same as in the library", async ({ app }) => {
  mkdirSync(join(app.project, "dist"));
  copyFileSync(HERO(app), join(app.project, "dist", "out.png"));
  app.host.entries = [
    { path: app.project, pinned: true },
    { path: join(app.project, "dist", "out.png"), pinned: false },
  ];
  await app.open();
  await blankMenu(app);
  await expect(menuItem(app, "清空列表…")).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await expect(menuItem(app, "清空列表…")).toBeDisabled();
});

test("Footer stats list the kinds in a fixed order (images first), regardless of what the first item in the list is", async ({ app }) => {
  const films = otherProject(app, "片子", ["a.mp4"]);
  app.host.entries = [
    { path: films, pinned: true },
    { path: app.project, pinned: false },
  ];
  await app.open();
  await expect(app.page.locator(".footer-stats")).toHaveText("2 个项目 · 2 张图片 · 2 个视频");
});

test("Copying from a folder row's context menu does not count the folder comment as an item in the toast", async ({ app }) => {
  folderNote(app, "assets", "assets 里的图统一加圆角");
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "assets").click({ button: "right" });
  await expect(menuItem(app, "复制批注成文字").locator(".menu-hint")).toHaveText("2 条 · Ctrl C");
  await menuItem(app, "复制批注成文字").click();
  await expect(app.page.locator(".toast")).toContainText("已复制「assets」的 2 条批注");
});

test("With the project expanded, the project folder's own folder comment is still counted on the project row (no other row below counts it while expanded)", async ({ app }) => {
  folderNote(app, ".", "整个项目统一配色");
  await app.open();
  const project = row(app, "project");
  await expect(project).toHaveAttribute("aria-expanded", "true");
  await expect(project.locator(".badge")).toHaveText("1");
  await project.locator(".lib-twisty").click();
  await expect(project.locator(".badge")).toHaveText("3");
});

test("The right side of the library context menu shows only shortcuts and counts, and explanations go in hover tooltips", async ({ app }) => {
  await app.open();
  await row(app, "project").click({ button: "right" });
  await expect(menuItem(app, "置顶").locator(".menu-hint")).toHaveCount(0);
  await expect(menuItem(app, "置顶")).toHaveAttribute("title", "排在最前，清空列表时保留");
  await expect(menuItem(app, "复制批注成图片").locator(".menu-hint")).toHaveCount(0);
  await expect(menuItem(app, "复制批注成图片")).toHaveAttribute("title", "适用于网页版 AI、聊天软件");
  await expect(menuItem(app, "从列表中移除此项目").locator(".menu-hint")).toHaveText("Delete");
  await expect(menuItem(app, "从列表中移除此项目")).toHaveAttribute("title", "不删除文件和批注");
  await expect(menuItem(app, "清空列表…").locator(".menu-hint")).toHaveCount(0);
  await expect(menuItem(app, "清空列表…")).toHaveAttribute("title", "保留置顶的项目。不会删除任何文件和批注。");
});

test("Removing two selected projects together: the confirm dialog says \"these 2 items\" by the number of selected rows, not by the entries inside", async ({ app }) => {
  mkdirSync(join(app.project, "dist"));
  copyFileSync(HERO(app), join(app.project, "dist", "out.png"));
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries = [
    { path: app.project, pinned: false },
    { path: join(app.project, "dist", "out.png"), pinned: false },
    { path: other, pinned: false },
  ];
  await app.open();
  await row(app, "project").click();
  await row(app, "other").click({ modifiers: ["Control"] });
  await row(app, "other").click({ button: "right" });
  await expect(menuItem(app, "从列表中移除（2 项）")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Delete");
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("从列表中移除这 2 项？");
  await dialog.getByRole("button", { name: "移除" }).click();
  await expect.poll(() => app.host.entries).toEqual([]);
});

// ---------- Context menus of each kind of row ----------

test("Right-clicking a project row: the two Copy items, folder comment, collapse, pin, open project folder, open notes folder, remove project, clear library", async ({ app }) => {
  await app.open();
  await row(app, "project").click({ button: "right" });
  expect(await menuLabels(app)).toEqual([
    "复制批注成文字",
    "复制批注成图片",
    "添加文件夹意见…",
    "折叠",
    "置顶",
    "打开项目文件夹",
    "打开批注文件夹（.sniptoss）",
    "从列表中移除此项目",
    "清空列表…",
  ]);
  await menuItem(app, "打开项目文件夹").click();
  expect(app.host.revealed.at(-1)).toBe(app.project);
  await row(app, "project").click({ button: "right" });
  await menuItem(app, "打开批注文件夹（.sniptoss）").click();
  expect(app.host.revealed.at(-1)).toBe(join(app.project, ".sniptoss"));
});

test("Right-clicking an entry added on its own: a folder entry has folder comment and expand, a file entry has Show in File Explorer, and both have Remove from List", async ({ app }) => {
  mkdirSync(join(app.project, "dist"));
  copyFileSync(HERO(app), join(app.project, "dist", "out.png"));
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries.push({ path: join(app.project, "dist"), pinned: false }, { path: join(other, "x.png"), pinned: false });
  await app.open();
  await row(app, "dist").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "添加文件夹意见…", "展开", "在资源管理器中显示", "从列表中移除", "清空列表…"]);
  await app.page.keyboard.press("Escape");
  await row(app, "x.png").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "在资源管理器中显示", "从列表中移除", "清空列表…"]);
  await menuItem(app, "在资源管理器中显示").click();
  expect(app.host.revealed.at(-1)).toBe(join(other, "x.png"));
});

test("Right-clicking a folder or file row in the tree: there is no Remove; Show in File Explorer opens that folder or selects that file", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "assets").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "添加文件夹意见…", "折叠", "在资源管理器中显示", "清空列表…"]);
  await menuItem(app, "在资源管理器中显示").click();
  expect(app.host.revealed.at(-1)).toBe(join(app.project, "assets"));
  await row(app, "hero.png").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "在资源管理器中显示", "清空列表…"]);
  await menuItem(app, "在资源管理器中显示").click();
  expect(app.host.revealed.at(-1)).toBe(HERO(app));
  // No open notes: both Copy items are grayed out
  await row(app, "poster.jpg").click({ button: "right" });
  await expect(menuItem(app, "复制批注成文字")).toBeDisabled();
  await expect(menuItem(app, "复制批注成文字").locator(".menu-hint")).toHaveText("没有待处理的批注");
  await expect(menuItem(app, "复制批注成图片")).toBeDisabled();
});

test("Right-clicking blank space, the library header or the footer stats shows the whole-list actions; right-clicking the filter box shows the input's own menu", async ({ app }) => {
  await app.open();
  const expected = ["全选", "添加文件…", "添加文件夹…", "从剪贴板添加", "刷新", "全部折叠", "清空列表…"];
  await blankMenu(app);
  expect(await menuLabels(app)).toEqual(expected);
  await app.page.keyboard.press("Escape");
  await app.page.locator(".lib-header").click({ button: "right", position: { x: 40, y: 10 } });
  expect(await menuLabels(app)).toEqual(expected);
  await app.page.keyboard.press("Escape");
  await app.page.locator(".footer-stats").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(expected);
  await app.page.keyboard.press("Escape");
  await app.page.getByPlaceholder("筛选素材").click({ button: "right" });
  await expect(menu(app)).toHaveCount(0);
  await expect(app.page.locator(".lib-header")).toHaveAttribute("title", "右键单击可添加、刷新或清空列表");
});

test("Right-clicking a multi-selection: with only item rows there is no Remove; right-clicking an unselected row first selects only that row", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  await row(app, "hero.png").click();
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  await row(app, "poster.jpg").click({ button: "right" });
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "清空列表…"]);
  await app.page.keyboard.press("Escape");
  await row(app, "clip.mp4").click({ button: "right" });
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "false");
  await expect(row(app, "clip.mp4")).toHaveAttribute("aria-selected", "true");
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "在资源管理器中显示", "清空列表…"]);
});

test("The count beside the two Copy items reads \"1 note\" for one item and \"2 items 3 notes\" for several (folder comments count as notes, not as items); Copy as Images is handed to the shell", async ({ app }) => {
  folderNote(app, "assets", "assets 里的图统一加圆角");
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "hero.png").click({ button: "right" });
  await expect(menuItem(app, "复制批注成文字").locator(".menu-hint")).toHaveText("1 条 · Ctrl C");
  await app.page.keyboard.press("Escape");
  await row(app, "project").click({ button: "right" });
  await expect(menuItem(app, "复制批注成文字").locator(".menu-hint")).toHaveText("2 个素材 3 条 · Ctrl C");
  await menuItem(app, "复制批注成图片").click();
  await expect.poll(() => app.host.copiedImages.at(-1)?.length).toBe(3);
});

test("Add Folder Comment… opens the composer titled with that folder and saves into that folder's notes file", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "assets").click({ button: "right" });
  await menuItem(app, "添加文件夹意见…").click();
  await expect(app.page.locator(".composer-title")).toHaveText("文件夹「assets」的意见");
  await app.page.locator(".composer-text").fill("这一组统一换成暖色");
  await app.page.keyboard.press("Enter");
  await expect.poll(() => app.annotations("assets@folder.json").map((a) => a.body)).toEqual(["这一组统一换成暖色"]);
  await row(app, "project").click({ button: "right" });
  await menuItem(app, "添加文件夹意见…").click();
  await expect(app.page.locator(".composer-title")).toHaveText("文件夹「project」的意见");
});

test("Expand / Collapse: the menu label follows the state and the state is written to settings after a short delay", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  await row(app, "video").click({ button: "right" });
  await menuItem(app, "折叠").click();
  await expect(row(app, "video")).toHaveAttribute("aria-expanded", "false");
  await expect(row(app, "clip.mp4")).toHaveCount(0);
  await expect.poll(() => app.host.expanded.map((p) => p.toLowerCase())).not.toContain(join(app.project, "video").toLowerCase());
  await row(app, "video").click({ button: "right" });
  await menuItem(app, "展开").click();
  await expect(row(app, "clip.mp4")).toBeVisible();
  await row(app, "project").click({ button: "right" });
  await menuItem(app, "折叠").click();
  await expect.poll(() => app.host.collapsed.map((p) => p.toLowerCase())).toContain(app.project.toLowerCase());
});

test("Pin to Top: hovering shows the pin and × (covering the note count); pinned projects move to the front with an always-lit pin and a separator line, and unpinning removes the separator", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries.push({ path: other, pinned: false });
  await app.open();
  const names = () => app.page.locator(".lib-row.is-project .lib-name").allInnerTexts();
  expect(await names()).toEqual(["project", "other"]);
  const o = row(app, "other");
  const pin = o.locator(".lib-pin");
  await expect(pin).toHaveAttribute("title", "置顶：排在最前，清空列表时保留");
  await expect(o.locator(".lib-actions")).toBeHidden();
  await o.hover();
  await expect(o.locator(".lib-actions")).toBeVisible();
  await pin.click();
  await expect.poll(names).toEqual(["other", "project"]);
  expect(app.host.calls.filter((c) => c.method === "libraryPin").at(-1)?.params).toEqual({ paths: [other], pinned: true });
  await expect(o).toHaveClass(/is-pinned/);
  await expect(app.page.locator(".lib-sep")).toHaveCount(1);
  await app.page.mouse.move(700, 450);
  await expect(pin).toBeVisible(); // a pinned entry always shows its pin
  await expect(o.locator(".lib-act").last()).toBeHidden();
  // On a hovered project row the note count is covered by the buttons
  const p = row(app, "project");
  await expect(p.locator(".badge")).toBeHidden(); // expanded: the rows below have their own counts
  await p.locator(".lib-twisty").click();
  await app.page.mouse.move(700, 450);
  await expect(p.locator(".badge")).toBeVisible();
  await p.hover();
  await expect(p.locator(".badge")).toBeHidden();
  // Unpin from the context menu
  await o.click({ button: "right" });
  await menuItem(app, "取消置顶").click();
  await expect(app.page.locator(".lib-sep")).toHaveCount(0);
  await expect(o).not.toHaveClass(/is-pinned/);
});

test("A failure to open the project folder is reported in a toast", async ({ app }) => {
  app.host.failMethods.add("reveal");
  await app.open();
  await row(app, "project").click({ button: "right" });
  await menuItem(app, "打开项目文件夹").click();
  await expect(app.page.locator(".toast")).toContainText("reveal 失败（测试注入）");
});

// ---------- Remove and clear ----------

test("Removing a project or entry asks first (no files or notes are deleted); Esc, a click outside and × cancel, Enter removes, and the default focus is on Remove", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries.push({ path: other, pinned: false });
  await app.open();
  const dialog = app.page.getByRole("alertdialog");
  const o = row(app, "other");
  await o.hover();
  await expect(o.locator(".lib-act").last()).toHaveAttribute("title", "从列表中移除此项目（不删除文件，Delete）");
  await o.locator(".lib-act").last().click();
  await expect(dialog).toContainText("从列表中移除此项目？");
  await expect(dialog).toContainText("「other」将从列表中移除。");
  await expect(dialog).toContainText("不会删除任何文件和批注。");
  await expect(dialog.getByRole("button", { name: "移除" })).toBeFocused();
  await app.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await o.hover();
  await o.locator(".lib-act").last().click();
  await app.page.mouse.click(720, 850); // click outside the dialog (on the backdrop)
  await expect(dialog).toHaveCount(0);
  await o.hover();
  await o.locator(".lib-act").last().click();
  await dialog.locator(".confirm-close").click();
  await expect(dialog).toHaveCount(0);
  expect(app.host.entries).toHaveLength(2);
  await o.hover();
  await o.locator(".lib-act").last().click();
  await app.page.keyboard.press("Enter");
  await expect(o).toHaveCount(0);
  expect(app.host.calls.filter((c) => c.method === "libraryRemove").at(-1)?.params).toEqual({ paths: [other] });
});

test("Removing a multi-selection in which only one entry can be removed (a project plus a file inside it) uses the singular wording", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await row(app, "project").click();
  await row(app, "hero.png").click({ modifiers: ["Control"] });
  await app.page.keyboard.press("Delete");
  await expect(app.page.getByRole("alertdialog")).toContainText("从列表中移除此项目？");
});

test("Removing the item shown on the canvas clears the canvas to the \"choose an item in the library\" prompt without selecting another one, and the shell forgets the last viewed item", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries.push({ path: other, pinned: false });
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  await row(app, "project").click({ button: "right" });
  await menuItem(app, "从列表中移除此项目").click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "移除" }).click();
  await expect(app.page.locator(".stage-empty")).toContainText("在左侧素材栏中选择一个素材开始批注");
  await expect(app.page).toHaveTitle("超级批注");
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toHaveCount(0);
  await expect.poll(() => app.host.selected).toBeNull();
});

test("Clear Library… says how many projects are removed and how many pinned ones are kept; cancelling changes nothing; the menu bar has the same item", async ({ app }) => {
  const other = otherProject(app, "other", ["x.png"]);
  app.host.entries.push({ path: other, pinned: true });
  await app.open();
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await menuItem(app, "清空列表…").click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("清空素材列表？");
  await expect(dialog).toContainText("将移除 1 个项目，保留 1 个置顶项目。");
  await app.page.keyboard.press("Escape");
  expect(app.host.entries).toHaveLength(2);
  await blankMenu(app);
  await menuItem(app, "清空列表…").click();
  await dialog.getByRole("button", { name: "清空", exact: true }).click();
  await expect.poll(() => app.host.entries.map((e) => e.path)).toEqual([other]);
});

test("Collapse All collapses every project and expanded folder and writes the state to settings", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  await blankMenu(app);
  await menuItem(app, "全部折叠").click();
  await expect(row(app, "project")).toHaveAttribute("aria-expanded", "false");
  await expect(app.page.locator(".lib-row")).toHaveCount(1);
  await expect.poll(() => app.host.expanded).toEqual([]);
  await expect.poll(() => app.host.collapsed.map((p) => p.toLowerCase())).toEqual([app.project.toLowerCase()]);
});

test("F5, the context menu's Refresh and the menu bar's Refresh List all rescan every entry; with an empty list the last two are grayed out", async ({ app }) => {
  await app.open();
  const scans = () => app.host.calls.filter((c) => c.method === "scan");
  const n = scans().length;
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("F5");
  await expect.poll(() => scans().length).toBe(n + 1);
  await blankMenu(app);
  await menuItem(app, "刷新").click();
  await expect.poll(() => scans().length).toBe(n + 2);
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await menuItem(app, "刷新素材列表").click();
  await expect.poll(() => scans().length).toBe(n + 3);
  expect(scans().at(-1)?.params).toEqual({ paths: [app.project] });
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".lib-empty")).toBeVisible();
  await blankMenu(app);
  await expect(menuItem(app, "刷新")).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".menubar button", { hasText: "文件" }).click();
  await expect(menuItem(app, "刷新素材列表")).toBeDisabled();
});

// ---------- Note counts, footer stats, version tag ----------

test("Note counts: an item row shows its open note count and nothing for 0; a collapsed folder shows the total and an expanded one only its own comments; marking done or an agent editing the file updates them at once", async ({ app }) => {
  folderNote(app, "assets", "assets 里的图统一加圆角");
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  const badge = (name: string) => row(app, name).locator(".badge");
  await expect(badge("hero.png")).toHaveText("1");
  await expect(badge("poster.jpg")).toHaveCount(0);
  await expect(badge("assets")).toHaveText("1"); // expanded: only the folder comment is left
  await row(app, "assets").locator(".lib-twisty").click();
  await expect(badge("assets")).toHaveText("2");
  await row(app, "project").locator(".lib-twisty").click();
  await expect(badge("project")).toHaveText("3");
  await row(app, "project").locator(".lib-twisty").click();
  await row(app, "assets").locator(".lib-twisty").click();
  // Mark as done in the notes panel: one fewer right away
  const card = app.page.locator('[data-annot$="|k3f9a2"]');
  await card.hover();
  await card.locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
  await expect(badge("hero.png")).toHaveCount(0);
  // An agent edits the notes file (the shell pushes "notes changed"): the count follows
  const file = join(app.project, ".sniptoss", "annotations", "video__clip.mp4.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.annotations[0].status = "resolved";
  writeFileSync(file, JSON.stringify(data, null, 2));
  await expect(badge("clip.mp4")).toHaveCount(0, { timeout: 8000 });
});

test("Footer stats read \"N projects · a images · b videos\"; a project without items shows only the project count", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".footer-stats")).toHaveText("1 个项目 · 2 张图片 · 1 个视频");
  const empty = join(app.temp, "empty");
  mkdirSync(empty);
  app.host.entries = [{ path: empty, pinned: false }];
  await app.page.reload();
  await expect(app.page.locator(".footer-stats")).toHaveText("1 个项目");
});

test("The version tag reads the version (\"Beta N\" during the beta, \"v1.0.0\" once released) and its tooltip gives the product name, version and the build times of the UI and the app; on a mismatch it reads \"≠ app Beta M\" and asks to reinstall", async ({ app }) => {
  await app.open();
  const tag = app.page.locator(".app-version");
  await expect(tag).toHaveText(VERSION_LABEL);
  const label = VERSION_LABEL.replace(/\./g, "\\.");
  const title = `^超级批注 ${label}${IS_BETA ? "（测试版）" : ""} · 版本 ${VERSION.replace(/\./g, "\\.")}\\n界面构建于 .+\\n程序 ${label} · 构建于 .+$`;
  await expect(tag).toHaveAttribute("title", new RegExp(title));
  app.host.appInfoPatch = { version: "1.0.0-beta.1" };
  await app.page.reload();
  await expect(tag).toHaveText(`${VERSION_LABEL} ≠ 程序 Beta 1`);
  await expect(tag).toHaveAttribute("title", /\n界面与程序版本不一致。请退出程序后重新安装超级批注$/);
});

test("A Mac package also has a build number (appInfo.build): the About page writes the version \"x.y.z (build)\", the tooltip of the version tag leaves the version line out (the label carries the number already), and the tag itself still reads the version", async ({ app }) => {
  app.host.appInfoPatch = { build: "44" };
  await app.open();
  const tag = app.page.locator(".app-version");
  await expect(tag).toHaveText(VERSION_LABEL);
  await expect(tag).not.toHaveClass(/is-mismatch/);
  const short = VERSION.replace(/-.*$/, "");
  const label = VERSION_LABEL.replace(/\./g, "\\.");
  await expect(tag).toHaveAttribute("title", new RegExp(`^超级批注 ${label}${IS_BETA ? "（测试版）" : ""}\\n界面构建于 .+\\n程序 ${label} · 构建于 .+$`));
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^关于$/ }).click();
  await expect(app.page.locator(".set-desc", { hasText: `版本 ${short} (44) · ` })).toBeVisible();
});

// The notes panel and Copy as Text:
// scope switching, grouping, the empty state, cards (click, double-click, right-click, hover buttons, ⋯), checking, the Copy as Text button and its content, toasts, where notes are saved, side panel width

import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO = "标题字太细了，换成粗一点的黑体";
const CLIP = "这段水印去掉";
const DONE = "右下角水印删掉";
const FOLDER = "assets 里的图统一加圆角";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const row = (app: App, name: string) => app.page.locator(".lib-row", { hasText: name }).first();
const seg = (app: App, label: string) => app.page.locator(".scope-switch .seg", { hasText: label });
const toast = (app: App) => app.page.locator(".toast");
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const checkItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitemcheckbox", { name });
const topMenu = (app: App, name: string) => app.page.locator(".menubar button", { hasText: name }).click();
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const batchCount = (app: App) => app.page.locator(".panel-batch .batch-count");
const status = (app: App, file: string, id: string) => app.annotations(file).find((a) => a.id === id)?.status;

/** "Resolved notes" in the funnel menu of the notes panel (it used to be a separate check button at the top right and is now part of the filter menu) */
async function toggleResolved(app: App) {
  await app.page.locator(".panel-filter").click();
  await checkItem(app, "已处理的批注").click();
}

async function open(app: App, name: string) {
  await row(app, name).click();
  await expect(app.page).toHaveTitle(name);
}

/**
 * Clicks a button that only appears while hovering a card (matched by the start of its title). Occasionally, when the machine is busy, the action bar is clicked
 * before the hover has taken effect and the click is blocked by the title row (a yellow bar used to pop up about a second after an item opened
 * and push the cards down; ADR-0008 removed it): if the click can't land, move the mouse away, hover again and retry
 */
async function clickAct(app: App, id: string, title: string, how: "click" | "dblclick" = "click") {
  await expect(async () => {
    await app.page.mouse.move(5, 5);
    await card(app, id).hover();
    await card(app, id).locator(`.act[title^="${title}"]`)[how]({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Picks an item in the "⋯" menu on the right of a card */
async function cardMenu(app: App, id: string, item: string) {
  await clickAct(app, id, "更多");
  await menuItem(app, item).click();
}

/** Writes a whole-folder comment for a folder (the fixtures have none) */
function folderNote(app: App, rel: string, body: string) {
  const note = {
    id: "fold01",
    status: "open",
    category: "change",
    body,
    anchor: {},
    author: "user",
    created_at: "",
    updated_at: "",
    replies: [],
  };
  writeFileSync(
    join(app.project, ".sniptoss", "annotations", `${rel}@folder.json`),
    JSON.stringify({ schema: "sniptoss/4", material: { path: rel, kind: "folder" }, annotations: [note] }, null, 2),
  );
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("scope: Project by default; the first segment is labeled for this image and its number is the open count; a click switches scope and saves it to settings, so it survives a reopen; the menu switches it too", async ({
  app,
}) => {
  await app.open();
  await expect(app.page.locator(".scope-switch .seg.is-on")).toHaveText(/整个项目/);
  await expect(seg(app, "这张图片").locator(".seg-count")).toHaveText("1");
  await expect(seg(app, "整个项目").locator(".seg-count")).toHaveText("2");
  await expect(card(app, "p0c7xe")).toBeVisible();

  await seg(app, "这张图片").click();
  await expect(seg(app, "这张图片")).toHaveClass(/is-on/);
  await expect(card(app, "p0c7xe")).toHaveCount(0);
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect.poll(() => app.host.prefs?.panelScope).toBe("material");
  await app.page.reload();
  await expect(seg(app, "这张图片")).toHaveClass(/is-on/);
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect(card(app, "p0c7xe")).toHaveCount(0);

  await topMenu(app, "视图");
  await expect(checkItem(app, /批注栏：仅当前素材/)).toHaveAttribute("aria-checked", "true");
  await checkItem(app, /批注栏：整个项目/).click();
  await expect(card(app, "p0c7xe")).toBeVisible();
  // Back to the default: no longer written to the settings file (only changed items are stored, see storedPrefs in prefs.ts)
  await expect.poll(() => app.host.prefs?.panelScope).toBeUndefined();
});

test("scope: with an empty library both segments are disabled, and so are the menu entries", async ({ app }) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(seg(app, "整个项目")).toBeDisabled();
  await expect(seg(app, "这个素材")).toBeDisabled();
  await topMenu(app, "视图");
  await expect(checkItem(app, /批注栏：仅当前素材/)).toBeDisabled();
  await expect(checkItem(app, /批注栏：整个项目/)).toBeDisabled();
});

test("multi-selection in the Library adds a lit Selected segment on top; when the selection is exactly the whole project, Project is lit instead; clicking empty space, Esc, or another segment leaves it", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  const picked = seg(app, "选中项");
  await expect(picked).toHaveClass(/is-on/);
  await expect(picked.locator(".seg-count")).toHaveText("1");
  await expect(picked).toHaveAttribute("title", /素材栏中选中的 2 个素材/);
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect(card(app, "p0c7xe")).toHaveCount(0);

  // Click Project on top: leaves the multi-selection, and only the row shown on the canvas stays selected in the Library
  await seg(app, "整个项目").click();
  await expect(picked).toHaveCount(0);
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(1);
  await expect(card(app, "p0c7xe")).toBeVisible();

  // Esc leaves it
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  await expect(picked).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(picked).toHaveCount(0);
  // Clicking empty space in the Library leaves it
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  await expect(picked).toBeVisible();
  const list = (await app.page.locator(".lib-list").boundingBox())!;
  await app.page.mouse.click(list.x + list.width / 2, list.y + list.height - 10);
  await expect(picked).toHaveCount(0);
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveCount(1);

  // Clicking the project row selects the whole project: Project is lit and no third segment appears
  await row(app, "project").click();
  await expect(seg(app, "整个项目")).toHaveClass(/is-on/);
  await expect(picked).toHaveCount(0);
});

test("showing resolved notes too: not listed by default; after checking Resolved notes in the funnel menu, done notes appear dimmed with a Done tag and the choice is saved to settings; the menu bar has the same toggle", async ({ app }) => {
  await app.open();
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect(card(app, "done01")).toHaveCount(0);
  await app.page.locator(".panel-filter").click();
  await expect(checkItem(app, "已处理的批注")).toHaveAttribute("aria-checked", "false");
  await checkItem(app, "已处理的批注").click();
  await expect(card(app, "done01")).toHaveClass(/status-resolved/);
  await expect(card(app, "done01").locator(".status-tag")).toHaveText("已改");
  await expect.poll(() => app.host.prefs?.panelResolved).toBe(true);
  // Showing resolved notes doesn't count as filtering: the funnel isn't lit and there's no "Showing only ..." row
  await expect(app.page.locator(".panel-filter")).not.toHaveClass(/is-on/);
  await expect(app.page.locator(".filter-bar")).toHaveCount(0);
  await app.page.locator(".panel-filter").click();
  await expect(checkItem(app, "已处理的批注")).toHaveAttribute("aria-checked", "true");
  await app.page.keyboard.press("Escape");

  await topMenu(app, "视图");
  const item = checkItem(app, /批注栏：显示已处理的批注/);
  await expect(item).toHaveAttribute("aria-checked", "true");
  await item.click();
  await expect(card(app, "done01")).toHaveCount(0);
  // Back to the default: no longer written to the settings file (only changed items are stored, see storedPrefs in prefs.ts)
  await expect.poll(() => app.host.prefs?.panelResolved).toBeUndefined();
});

test("several items are listed in groups: the group title is the file name + subfolder + count, and the group open on the canvas is marked; clicking the title switches items but clicking its checkbox doesn't; a single item is listed flat", async ({
  app,
}) => {
  await app.open();
  const groups = app.page.locator(".annot-group");
  await expect(groups).toHaveCount(2);
  const hero = groups.nth(0).locator(".group-head");
  await expect(hero.locator(".group-name")).toHaveText("hero.png");
  await expect(hero.locator(".group-hint")).toHaveText("assets");
  await expect(hero.locator(".group-count")).toHaveText("1");
  await expect(hero).toHaveClass(/is-current/);
  const clip = groups.nth(1).locator(".group-head");
  await expect(clip.locator(".group-name")).toHaveText("clip.mp4");

  await clip.locator(".card-check").click();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(batchCount(app)).toHaveText("已选 1 条");
  await clip.locator(".group-name").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(clip).toHaveClass(/is-current/);
  await expect(hero).not.toHaveClass(/is-current/);

  await seg(app, "这个视频").click();
  await expect(groups).toHaveCount(0);
  await expect(card(app, "p0c7xe")).toBeVisible();
});

test("folder comments are listed first under Project in a group of their own; This image doesn't list them but a line on top says how many the containing folder has, and clicking it switches to Project", async ({
  app,
}) => {
  folderNote(app, "assets", FOLDER);
  await app.open();
  const first = app.page.locator(".annot-group").first().locator(".group-head");
  await expect(first).toHaveClass(/is-folder/);
  await expect(first.locator(".group-name")).toHaveText("assets");
  await expect(first.locator(".group-hint")).toHaveText("文件夹意见");
  await expect(card(app, "fold01")).toBeVisible();
  // The card of a folder comment no longer carries an Overall tag (the group title already says it)
  await expect(card(app, "fold01").locator(".tag")).toHaveCount(0);
  // The group title's checkbox checks all comments on this folder
  await first.locator(".card-check").click();
  await expect(card(app, "fold01").locator(".card-check")).toHaveAttribute("aria-checked", "true");

  await seg(app, "这张图片").click();
  await expect(card(app, "fold01")).toHaveCount(0);
  const hint = app.page.locator(".folder-hint");
  await expect(hint).toContainText("所在文件夹的意见 1 条");
  await expect(hint).toContainText("查看整个项目");
  await hint.click();
  await expect(seg(app, "整个项目")).toHaveClass(/is-on/);
  await expect(card(app, "fold01")).toBeVisible();

  // Once the folder comment is resolved, This image no longer mentions it
  await cardMenu(app, "fold01", "标记为已改");
  await expect.poll(() => status(app, "assets@folder.json", "fold01")).toBe("resolved");
  await seg(app, "这张图片").click();
  await expect(hint).toHaveCount(0);
});

test("the summary row at the bottom says how many other items have no open notes; with resolved notes shown it says they have no notes; it says nothing while searching", async ({ app }) => {
  await app.open();
  const rest = app.page.locator(".group-rest");
  await expect(rest).toHaveText("另有 1 个素材没有待处理的批注");
  await toggleResolved(app);
  await expect(rest).toHaveText("另有 1 个素材暂无批注");
  await focusStage(app);
  await app.page.keyboard.press("Control+f");
  // Wait for the search box to get focus before typing (when the machine is busy the box isn't there yet and the text would go elsewhere)
  await expect(app.page.locator(".panel-search input")).toBeFocused();
  await app.page.locator(".panel-search input").fill("标题");
  await expect(card(app, "p0c7xe")).toHaveCount(0);
  await expect(rest).toHaveCount(0);
});

test("empty states: no notes shows \"No notes yet\" plus how to draw; all resolved shows the all-resolved line; with several items the open group gets a line; with no item selected nothing is written", async ({
  app,
}) => {
  app.host.prefs = { panelScope: "material" };
  await app.open();
  await open(app, "poster.jpg");
  const empty = app.page.locator(".panel-empty");
  await expect(empty).toContainText("暂无批注");
  await expect(empty).toContainText("使用上方工具在画面上标记位置，或添加一条整体意见");
  await expect(app.page.locator(".panel-dock")).toHaveCount(0);

  await open(app, "hero.png");
  await cardMenu(app, "k3f9a2", "标记为已改");
  await expect(empty).toHaveText("此素材的批注已全部处理");

  // Project: the poster.jpg group open on the canvas gets a line
  await seg(app, "整个项目").click();
  await open(app, "poster.jpg");
  await expect(app.page.locator(".annot-group", { has: app.page.locator(".group-head.is-current") }).locator(".group-empty")).toHaveText(
    "暂无批注",
  );
});

test("the notes panel is blank when no item is selected", async ({ app }) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".panel-body")).toBeVisible();
  await expect(app.page.locator(".panel-body")).toHaveText("");
  await expect(app.page.locator(".panel-dock")).toHaveCount(0);
  await expect(app.page.locator(".panel-footer")).toHaveCount(0);
});

test("an unreadable notes file: only the red bar on top explains it, without also saying notes are unsupported or that there are no notes yet (both lines used to appear)", async ({ app }) => {
  writeFileSync(join(app.project, ".sniptoss", "annotations", "assets__poster.jpg.json"), "{ 坏了");
  app.host.prefs = { panelScope: "material" };
  await app.open();
  await open(app, "poster.jpg");
  await expect(app.page.locator(".panel-body .error")).toContainText("assets__poster.jpg.json");
  await expect(app.page.locator(".panel-empty")).toHaveCount(0);
  await expect(app.page.locator(".panel-body")).not.toContainText("暂不支持");
  // Project: the open group doesn't say "No notes yet" either
  await seg(app, "整个项目").click();
  await expect(app.page.locator(".group-head.is-current .group-name")).toHaveText("poster.jpg");
  await expect(app.page.locator(".group-empty")).toHaveCount(0);
});

test("card: number, category, the Overall section, the Done tag, replies, the video range; hovering the number shows the 6-character ID", async ({ app }) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  const k = card(app, "k3f9a2");
  await expect(k.locator(".card-num")).toHaveText("1");
  await expect(k.locator(".card-num")).toHaveAttribute("title", "批注编号 k3f9a2（批注文件和命令行中用它指代此条）");
  await expect(k.locator(".chip")).toHaveText("修改");
  await expect(k.locator(".tag", { hasText: "整体意见" })).toHaveCount(0);
  // Overall comments form their own section, numbered from 1 with a gray square number; the section title says Overall so the card no longer does (ADR-0008)
  const d = card(app, "done01");
  await expect(d.locator(".card-num")).toHaveText("1");
  await expect(d.locator(".card-num")).toHaveClass(/is-plain/);
  await expect(k.locator(".card-num")).not.toHaveClass(/is-plain/);
  await expect(d.locator(".chip")).toHaveText("删除");
  await expect(d.locator(".tag", { hasText: "整体意见" })).toHaveCount(0);
  await expect(app.page.locator(".annot-group", { has: d }).locator(".note-section.is-overall .note-section-title")).toHaveText("整体意见");
  await expect(d.locator(".status-tag")).toHaveText("已改");
  await expect(d.locator(".reply")).toContainText("codex");
  await expect(d.locator(".reply")).toContainText("已删");
  await expect(card(app, "p0c7xe").locator(".card-time")).toHaveText("00:01.500–00:02.500");
  await expect(card(app, "p0c7xe").locator(".card-body")).toContainText(CLIP);
});

test("clicking a card of another item switches the canvas to it and selects the note, and the video jumps to its start time and pauses; the Library follows by selecting that item", async ({ app }) => {
  await app.open();
  await card(app, "p0c7xe").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  await expect(app.page.locator(`.annot-badge[data-id="p0c7xe"]`)).toBeVisible();
  const video = app.page.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.abs(v.currentTime - 1.5) < 0.05)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(app.page.locator('.lib-row[aria-selected="true"]')).toHaveText(/clip\.mp4/);
});

test("double-clicking a card edits it; double-clicking the checkbox or a hover button doesn't count", async ({ app }) => {
  await app.open();
  const k = card(app, "k3f9a2");
  await k.locator(".card-check").dblclick();
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await clickAct(app, "k3f9a2", "更多", "dblclick");
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await k.locator(".card-body").dblclick();
  await expect(app.page.locator(".composer")).toBeVisible();
  await expect(app.page.locator(".composer-text")).toHaveValue(HERO);
});

test("right-clicking a card first selects it and switches to its item, then opens the same menu as on the canvas", async ({ app }) => {
  await app.open();
  await card(app, "p0c7xe").click({ button: "right" });
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  for (const name of [/^复制批注成文字/, /^复制批注成图片/, /^勾选/, /^编辑批注/, /^标记为已改/, /^标记为不改/, /^删除批注/])
    await expect(menuItem(app, name)).toBeVisible();
  await menuItem(app, /^标记为不改/).click();
  await expect.poll(() => status(app, "video__clip.mp4.json", "p0c7xe")).toBe("wontfix");
});

test("the copy button on a card copies only that note and the toast says so; copying again says it was copied before", async ({ app }) => {
  await app.open();
  const k = card(app, "k3f9a2");
  await clickAct(app, "k3f9a2", "将此条批注复制成文字");
  await expect(toast(app)).toContainText("已复制此条批注（文字），可粘贴到 Claude Code 或 Codex 的对话中");
  const text = (await app.clipboard())!;
  expect(text).toContain(HERO);
  expect(text).not.toContain(CLIP);
  await expect(k.locator(".card-handed")).toBeVisible();
  await clickAct(app, "k3f9a2", "将此条批注复制成文字");
  await expect(toast(app)).toContainText("此批注已于");
});

test("the ⋯ menu: check, edit, change status, delete; the action bar stays while the menu is open", async ({ app }) => {
  await app.open();
  const k = card(app, "k3f9a2");
  await clickAct(app, "k3f9a2", "更多");
  for (const name of [/^复制批注成文字/, /^复制批注成图片/, /^勾选/, /^编辑批注/, /^标记为已改/, /^标记为不改/, /^删除批注/])
    await expect(menuItem(app, name)).toBeVisible();
  // The mouse moves away while the menu is still open: the action bar stays
  await app.page.mouse.move(5, 5);
  await expect.poll(() => k.locator(".card-actions").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  await menuItem(app, /^勾选/).click();
  await expect(k.locator(".card-check")).toHaveAttribute("aria-checked", "true");
  await cardMenu(app, "k3f9a2", "取消勾选");
  await expect(k.locator(".card-check")).toHaveAttribute("aria-checked", "false");
  await cardMenu(app, "k3f9a2", "编辑批注");
  await expect(app.page.locator(".composer-text")).toHaveValue(HERO);
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  // A resolved note only offers Reopen
  await cardMenu(app, "k3f9a2", "标记为已改");
  await toggleResolved(app);
  await clickAct(app, "k3f9a2", "更多");
  await expect(menuItem(app, /^重新打开/)).toBeVisible();
  await expect(menuItem(app, /^标记为已改/)).toHaveCount(0);
  await expect(menuItem(app, /^标记为不改/)).toHaveCount(0);
});

test("checking: clicking the checkbox doesn't select the card; Shift+click checks a range (across items, in the order of the notes panel); X toggles the selected note", async ({ app }) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  await card(app, "k3f9a2").locator(".card-check").click();
  await expect(card(app, "k3f9a2")).not.toHaveClass(/is-selected/);
  await expect(batchCount(app)).toHaveText("已选 1 条");
  await card(app, "p0c7xe")
    .locator(".card-check")
    .click({ modifiers: ["Shift"] });
  await expect(batchCount(app)).toHaveText("已选 3 条");
  await expect(card(app, "done01").locator(".card-check")).toHaveAttribute("aria-checked", "true");
  // Shift+click on a checked note: everything from the last clicked note to this one is unchecked
  await card(app, "done01")
    .locator(".card-check")
    .click({ modifiers: ["Shift"] });
  await expect(batchCount(app)).toHaveText("已选 1 条");
  await expect(card(app, "k3f9a2").locator(".card-check")).toHaveAttribute("aria-checked", "true");

  await card(app, "done01").click();
  await expect(card(app, "done01")).toHaveClass(/is-selected/);
  await app.page.keyboard.press("x");
  await expect(card(app, "done01").locator(".card-check")).toHaveAttribute("aria-checked", "true");
  await expect(batchCount(app)).toHaveText("已选 2 条");
  await app.page.keyboard.press("x");
  await expect(batchCount(app)).toHaveText("已选 1 条");
});

test("a group title's checkbox checks / unchecks the whole group and shows a mixed state when partly checked; it is disabled when the group has no notes", async ({ app }) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  const heroHead = app.page.locator(".group-head", { hasText: "hero.png" });
  const box = heroHead.locator(".card-check");
  await box.click();
  await expect(batchCount(app)).toHaveText("已选 2 条");
  await expect(box).toHaveAttribute("aria-checked", "true");
  await card(app, "done01").locator(".card-check").click();
  await expect(box).toHaveAttribute("aria-checked", "mixed");
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await box.click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);

  await open(app, "poster.jpg");
  await expect(app.page.locator(".group-head.is-current .card-check")).toBeDisabled();
});

test("Select all: reads Select all when nothing is checked, one click checks everything (across items, including folder comments) and another unchecks it; partly checked shows a mixed state; the Check All / Uncheck All menu entries", async ({
  app,
}) => {
  folderNote(app, "assets", FOLDER);
  await app.open();
  const all = app.page.locator(".dock-all");
  await expect(all).toHaveText("全选");
  await all.click();
  await expect(batchCount(app)).toHaveText("已选 3 条");
  await expect(all).toHaveAttribute("aria-checked", "true");
  await all.click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
  await card(app, "p0c7xe").locator(".card-check").click();
  await expect(all).toHaveAttribute("aria-checked", "mixed");

  await topMenu(app, "批注");
  await menuItem(app, /^全部勾选/).click();
  await expect(batchCount(app)).toHaveText("已选 3 条");
  await topMenu(app, "批注");
  await menuItem(app, /^取消勾选/).click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
});

test("when checks are cleared: on a scope change and on switching items in a single-item scope; not when switching among the items of a multi-item list; checks on notes that are no longer visible are dropped and stay unchecked when shown again", async ({
  app,
}) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  // Switching among several listed items: the check stays
  await card(app, "k3f9a2").locator(".card-check").click();
  await open(app, "clip.mp4");
  await expect(batchCount(app)).toHaveText("已选 1 条");
  // Scope change: cleared
  await seg(app, "这个视频").click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
  // Switching items in a single-item scope: cleared
  await card(app, "p0c7xe").locator(".card-check").click();
  await expect(batchCount(app)).toHaveText("已选 1 条");
  await open(app, "hero.png");
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);

  // Hiding resolved notes: the checked done01 no longer counts, and it is not checked again when shown (it used to stay checked sometimes and sometimes not)
  await seg(app, "整个项目").click();
  await card(app, "done01").locator(".card-check").click();
  await card(app, "k3f9a2").locator(".card-check").click();
  await expect(batchCount(app)).toHaveText("已选 2 条");
  await toggleResolved(app);
  await expect(batchCount(app)).toHaveText("已选 1 条");
  await toggleResolved(app);
  await expect(card(app, "done01")).toBeVisible();
  await expect(card(app, "done01").locator(".card-check")).toHaveAttribute("aria-checked", "false");
  await expect(batchCount(app)).toHaveText("已选 1 条");
  // Esc is the last level
  await focusStage(app);
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
});

test("the Copy as Text button is disabled when there is nothing to copy (and so are the menu entries) with the reason in its tooltip; checking resolved notes makes it usable; the button shows Copied without changing width, and copying again restarts the timer", async ({
  app,
}) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  const copy = app.page.locator(".dock-copy");
  await expect(copy).toHaveAttribute("title", /^复制成文字（Ctrl Shift A）：.+。未勾选时复制这 2 个素材的全部 2 条待处理批注，勾选后仅复制勾选的批注$/);
  await app.page.locator(".dock-all").click();
  await app.page.locator(".panel-batch").getByRole("button", { name: /已改/ }).first().click();
  await expect.poll(() => status(app, "video__clip.mp4.json", "p0c7xe")).toBe("resolved");
  // With resolved notes shown: after marking they are still visible and still checked (like checked messages in a mail client after "mark as read"); once unchecked there is nothing left to copy
  await expect(batchCount(app)).toHaveText("已选 3 条");
  await expect(copy).toBeEnabled();
  await app.page.locator(".dock-all").click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
  await expect(copy).toBeDisabled();
  await expect(app.page.locator(".dock-images")).toBeDisabled();
  await expect(copy).toHaveAttribute("title", "没有待处理的批注；勾选已处理的批注后也可复制");
  await topMenu(app, "编辑");
  await expect(menuItem(app, /^复制批注成文字/)).toBeDisabled();
  await expect(menuItem(app, /^复制批注成图片/)).toBeDisabled();
  await app.page.keyboard.press("Escape");

  await card(app, "done01").locator(".card-check").click();
  await expect(copy).toBeEnabled();
  await expect(copy).toHaveAttribute("title", /^复制成文字（Ctrl Shift A）：.+。复制勾选的 1 条$/);
  const width = (await copy.boundingBox())!.width;
  // After the fake clock is installed time still advances in real time (it can only be fast-forwarded): when the machine is busy a few hundred extra milliseconds pass between steps, so leave enough margin in the fast-forward amounts
  await app.page.clock.install();
  await copy.click();
  const label = copy.locator(".dock-copy-label span:not(.is-hidden)");
  await expect(label).toHaveText("已复制");
  expect(Math.abs((await copy.boundingBox())!.width - width)).toBeLessThan(1);
  await app.page.clock.fastForward(1000);
  await copy.click();
  // Without a timer restart the label would revert 1.6 s after the first copy, and by now more than 1.8 s have passed
  await app.page.clock.fastForward(800);
  await expect(label).toHaveText("已复制");
  await app.page.clock.fastForward(1000);
  await expect(label).toHaveText("复制成文字");
});

test("what gets copied: with nothing checked, all listed open notes (done ones are left out), by scope; with checks, the checked notes, including resolved ones marked as resolved; the toast says how many were handed over", async ({
  app,
}) => {
  app.host.prefs = { panelResolved: true };
  await app.open();
  // app.open() only waits for the Library to appear, so the notes may not be loaded yet
  await expect(card(app, "p0c7xe")).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("已复制 2 个素材的 2 条批注（文字），可粘贴到 Claude Code 或 Codex 的对话中");
  let text = (await app.clipboard())!;
  expect(text).toContain(HERO);
  expect(text).toContain(CLIP);
  expect(text).not.toContain(DONE);
  // The notes in the fixtures predate the item file's modification time, but the item's content is unchanged (the fingerprint matches): they don't count as written on an earlier version (ADR-0008)
  expect(text).not.toContain("写在旧版本上");

  await seg(app, "这张图片").click();
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("已复制这张图片的 1 条批注");
  text = (await app.clipboard())!;
  expect(text).toContain(HERO);
  expect(text).not.toContain(CLIP);

  // Check only one resolved note
  await seg(app, "整个项目").click();
  await card(app, "done01").locator(".card-check").click();
  await app.page.locator(".dock-copy").click();
  await expect(toast(app)).toContainText("已复制勾选的 1 条批注");
  text = (await app.clipboard())!;
  expect(text).toContain("以下批注已处理");
  expect(text).toContain(DONE);
  expect(text).not.toContain(HERO);
  // Then check an open note as well
  await card(app, "k3f9a2").locator(".card-check").click();
  await app.page.locator(".dock-copy").click();
  await expect(toast(app)).toContainText("已复制勾选的 2 条批注");
  text = (await app.clipboard())!;
  expect(text).toContain("其中 1 条已处理");
  expect(text).toContain("（已处理：已改）");
  expect(text).toContain(HERO);
  expect(text).not.toContain(CLIP);
});

test("Copy as Text toast: with no item selected it explains why nothing was copied", async ({ app }) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".panel")).toBeVisible();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("请先在左侧素材栏中选择素材");
  expect(await app.clipboard()).toBeNull();
});

test("Copy as Text toast: everything listed in the notes panel is resolved", async ({ app }) => {
  app.host.prefs = { panelScope: "material" };
  await app.open();
  await cardMenu(app, "k3f9a2", "标记为已改");
  await expect.poll(() => status(app, "assets__hero.png.json", "k3f9a2")).toBe("resolved");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("这张图片没有待处理的批注");
  await seg(app, "整个项目").click();
  await cardMenu(app, "p0c7xe", "标记为已改");
  await expect.poll(() => status(app, "video__clip.mp4.json", "p0c7xe")).toBe("resolved");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("批注栏中列出的素材均没有待处理的批注");
  expect(await app.clipboard()).toBeNull();
});

test("copying from the Library context menu: a folder row copies the items inside it and an item row copies itself; the text is the same as from the notes panel", async ({ app }) => {
  await app.open();
  await row(app, "assets").click({ button: "right" });
  await menuItem(app, /^复制批注成文字/).click();
  await expect.poll(() => app.clipboard()).toContain(HERO);
  expect(await app.clipboard()).not.toContain(CLIP);
  await row(app, "clip.mp4").click({ button: "right" });
  await menuItem(app, /^复制批注成文字/).click();
  await expect(toast(app)).toContainText("已复制「clip.mp4」的 1 条批注");
  const text = (await app.clipboard())!;
  expect(text).toContain(CLIP);
  expect(text).not.toContain(HERO);
  expect(text).toContain("请按以下批注修改素材。");
});

test("[ ] step through the notes visible in the notes panel: the canvas follows across items and it wraps around at the ends; the menu entries are disabled when there are no notes", async ({ app }) => {
  await app.open();
  await expect(card(app, "p0c7xe")).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("]");
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);
  await app.page.keyboard.press("]");
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  const video = app.page.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.abs(v.currentTime - 1.5) < 0.05)).toBe(true);
  await app.page.keyboard.press("]");
  await expect(app.page).toHaveTitle("hero.png");
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);
  await app.page.keyboard.press("[");
  await expect(app.page).toHaveTitle("clip.mp4");

  await seg(app, "这个视频").click();
  await open(app, "poster.jpg");
  await topMenu(app, "批注");
  await expect(menuItem(app, /^上一条批注/)).toBeDisabled();
  await expect(menuItem(app, /^下一条批注/)).toBeDisabled();
});

test("a late change notification carrying just-superseded content isn't treated as an external change: the UI doesn't roll back and doesn't show the updated-externally toast", async ({ app }) => {
  // This used to happen occasionally when copying twice in a row for an AI: the shell read the file while it still had old content
  // (what was first loaded, or what the UI itself wrote last), and by the time the notification arrived the UI had already written a newer version
  app.host.prefs = { panelResolved: true };
  app.host.muted = true;
  await app.open();
  await expect(card(app, "k3f9a2")).toBeVisible();
  const original = app.host.readAnnotations(app.project);
  await cardMenu(app, "k3f9a2", "标记为已改");
  await expect.poll(() => status(app, "assets__hero.png.json", "k3f9a2")).toBe("resolved");
  const stale = app.host.readAnnotations(app.project);
  await cardMenu(app, "k3f9a2", "重新打开");
  await expect.poll(() => status(app, "assets__hero.png.json", "k3f9a2")).toBe("open");
  await expect(toast(app)).toContainText("已重新打开");
  const emit = (annotations: unknown) =>
    app.page.evaluate(
      (p) => (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit(p),
      { event: "annotationsChanged", home: app.project, annotations },
    );
  // What the UI itself wrote last
  await emit(stale);
  await app.page.waitForTimeout(400);
  await expect(card(app, "k3f9a2")).not.toHaveClass(/status-resolved/);
  await expect(toast(app)).not.toContainText("已在外部更新");
  // What was first loaded
  await emit(original);
  await app.page.waitForTimeout(400);
  await expect(toast(app)).not.toContainText("已在外部更新");
  // A change that really came from elsewhere is synced as usual
  const theirs = app.host
    .readAnnotations(app.project)
    .map((f) => (f.name === "assets__hero.png.json" ? { ...f, text: f.text.replace("右下角水印删掉", "右下角水印删掉了") } : f));
  await emit(theirs);
  await expect(toast(app)).toContainText("批注文件已在外部更新，已同步");
  await expect(card(app, "done01")).toContainText("右下角水印删掉了");
});

test("a late change notification carrying an older version the UI never saw (an agent wrote another version in between) is recognized by its sequence number: no roll back, and the agent's write-back is not overwritten (ADR-0005 item 8)", async ({ app }) => {
  // Seen with concurrent writes: between the shell reading the file and the notification arriving, the UI had already learned of a newer version from a rejected write.
  // That old notification used to be taken as "changed elsewhere again", so the note the UI hadn't touched took the old version from the notification
  // and the next write overwrote the status and reply the agent had just written back
  app.host.prefs = { panelResolved: true };
  app.host.muted = true;
  await app.open();
  await expect(card(app, "k3f9a2")).toBeVisible();
  const file = join(app.project, ".sniptoss", "annotations", "assets__hero.png.json");
  const agent = (statusTo: string, body: string) => {
    const data = JSON.parse(readFileSync(file, "utf8")) as { annotations: { id: string; status: string; updated_at: string; replies?: unknown[] }[] };
    const a = data.annotations.find((x) => x.id === "k3f9a2")!;
    a.status = statusTo;
    a.updated_at = new Date().toISOString();
    a.replies = [...(a.replies ?? []), { author: "agent", body, at: a.updated_at }];
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  };
  agent("resolved", "第一版");
  // The shell reads the file at this point (the notification hasn't reached the UI yet)
  const seq = app.host.observe();
  const stale = app.host.readAnnotations(app.project);
  agent("wontfix", "第二版");
  // The UI edits another note: the write is rejected and the second version is fetched from disk and merged in
  await cardMenu(app, "done01", "重新打开");
  await expect.poll(() => status(app, "assets__hero.png.json", "done01")).toBe("open");
  await expect(card(app, "k3f9a2")).toHaveClass(/status-wontfix/);
  // The notification for the first version only arrives now
  await app.page.evaluate(
    (p) => (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit(p),
    { event: "annotationsChanged", home: app.project, seq, annotations: stale },
  );
  await app.page.waitForTimeout(400);
  await expect(card(app, "k3f9a2")).toHaveClass(/status-wontfix/);
  await expect(toast(app)).not.toContainText("已在外部更新");
  // Write again: the agent's second version is still there
  await cardMenu(app, "done01", "标记为已改");
  await expect.poll(() => status(app, "assets__hero.png.json", "done01")).toBe("resolved");
  const k3 = app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")!;
  expect(k3.status).toBe("wontfix");
  expect((k3.replies as { body: string }[]).map((r) => r.body).slice(-2)).toEqual(["第一版", "第二版"]);
});

test("an item disappears from disk: the notes panel still lists its notes, and copying and switching scope from the menu still work (the menu entries used to be disabled while the buttons worked)", async ({ app }) => {
  await app.open();
  await open(app, "clip.mp4");
  renameSync(join(app.project, "video"), join(app.project, "video-old"));
  await expect(app.page.locator(".group-head.is-missing", { hasText: "clip.mp4" })).toBeVisible();
  await expect(app.page.locator(".dock-copy")).toBeEnabled();
  await topMenu(app, "编辑");
  await expect(menuItem(app, /^复制批注成文字/)).toBeEnabled();
  await menuItem(app, /^复制批注成文字/).click();
  await expect.poll(() => app.clipboard()).toContain(CLIP);
  await topMenu(app, "视图");
  await expect(checkItem(app, /批注栏：整个项目/)).toBeEnabled();
});

test("reading the notes fails: the toast stays, and clicking Reload reads them again", async ({ app }) => {
  app.host.failMethods.add("readHomes");
  app.allowLogErrors("reading notes");
  await app.open();
  await expect(toast(app)).toContainText("读取批注失败");
  await expect(card(app, "k3f9a2")).toHaveCount(0);
  app.host.failMethods.delete("readHomes");
  await toast(app).getByRole("button", { name: "重新读取" }).click();
  await expect(card(app, "k3f9a2")).toBeVisible();
});

test("the save location at the bottom of the notes panel: with notes it reads Saved to project\\.sniptoss and a click opens it in File Explorer", async ({
  app,
}) => {
  await app.open();
  const link = app.page.locator(".footer-link");
  await expect(link).toHaveText("已保存到 project\\.sniptoss");
  await link.click();
  await expect.poll(() => app.host.revealed.at(-1)).toBe(join(app.project, ".sniptoss"));
});

test("a project without notes yet: the bottom says that notes are saved automatically", async ({ app }) => {
  rmSync(join(app.project, ".sniptoss"), { recursive: true, force: true });
  await app.open();
  await expect(app.page.locator(".panel-footer")).toHaveText("批注自动保存到素材所在项目的 .sniptoss 文件夹");
  await expect(app.page.locator(".footer-link")).toHaveCount(0);
});

test("toasts: only one at a time, a new one replaces the old; a toast without a button disappears after 3.2 seconds", async ({ app }) => {
  await app.open();
  await app.page.clock.install();
  await clickAct(app, "k3f9a2", "将此条批注复制成文字");
  await expect(toast(app)).toContainText("已复制此条批注");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toHaveCount(1);
  await expect(toast(app)).toContainText("已复制 2 个素材的 2 条批注");
  // The fake clock still follows real time (it can only be fast-forwarded), so a few hundred extra milliseconds may pass between steps: present at 2 s and gone 1.5 s later means it disappears at about 3.2 s
  await app.page.mouse.move(5, 5);
  await app.page.clock.fastForward(2000);
  await expect(toast(app)).toBeVisible();
  await app.page.clock.fastForward(1500);
  await expect(toast(app)).toHaveCount(0);
});

test("notes panel width: dragging the edge resizes it (240–640) and dragging too narrow collapses it; double-clicking the edge restores 320; the width is remembered; Ctrl+Alt+B and the toolbar button collapse / expand it", async ({
  app,
}) => {
  await app.open();
  const panel = app.page.locator("aside.panel");
  const sash = app.page.locator(".sash-right");
  const layout = app.page.locator(".layout");
  const width = async () => Math.round((await panel.boundingBox())!.width);
  expect(await width()).toBe(320);
  const dragSash = async (dx: number) => {
    const b = (await sash.boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await app.page.mouse.move(x, y);
    await app.page.mouse.down();
    await app.page.mouse.move(x + dx, y, { steps: 6 });
    await app.page.mouse.up();
  };
  await dragSash(-100);
  await expect.poll(width).toBe(420);
  await dragSash(-400);
  await expect.poll(width).toBe(640);
  await dragSash(500);
  await expect(layout).toHaveClass(/right-collapsed/);
  await sash.dblclick();
  await expect(layout).not.toHaveClass(/right-collapsed/);
  await expect.poll(width).toBe(320);

  await dragSash(-60);
  await expect.poll(width).toBe(380);
  await app.page.reload();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  await expect.poll(width).toBe(380);

  await focusStage(app);
  await app.page.keyboard.press("Control+Alt+b");
  await expect(layout).toHaveClass(/right-collapsed/);
  await app.page.locator('.hdr-btn[title^="显示批注栏"]').click();
  await expect(layout).not.toHaveClass(/right-collapsed/);
  await expect.poll(width).toBe(380);
});

test("the bottom row fits in the default width of 320: the Select all label isn't squeezed into an ellipsis by the two buttons (the Copy as Text label became 8 px wider after a rename)", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".dock-copy .dock-copy-label > :not(.is-hidden)")).toHaveText("复制成文字");
  await expect(app.page.locator(".dock-images")).toHaveText("复制成图片");
  const text = app.page.locator(".dock-all-text");
  await expect(text).toHaveText("全选");
  expect(await text.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

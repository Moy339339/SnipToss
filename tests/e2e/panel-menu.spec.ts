// Right-clicking blank space in the notes panel (it used to show nothing; it should also let you clear all listed notes in one step).
// It acts on the batch currently listed in the notes panel: copy and check work like the buttons at the bottom; Delete All Notes… deletes everything listed, asks first and can be undone,
// and leaves alone whatever isn't listed (resolved notes that are hidden, filtered-out notes, notes missing from the search results).
// The menu bar's Edit → Delete All Notes… does the same thing; right-clicking a card still opens that note's own menu

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO_NOTES = "assets__hero.png.json";
const heroFile = (app: App) => join(app.project, ".sniptoss", "annotations", HERO_NOTES);
const card = (app: App, id: string) => app.page.locator(`.card[data-annot$="|${id}"]`);
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const ids = (app: App) => app.annotations(HERO_NOTES).map((a) => a.id);

/** Adds one more pin (pt0001) and an open overall comment (ov0001) to hero.png: 3 open notes, plus the done note done01 (not listed by default) */
function moreNotes(app: App) {
  const json = JSON.parse(readFileSync(heroFile(app), "utf8"));
  const base = json.annotations[0];
  json.annotations.push(
    { ...base, id: "pt0001", body: "按钮颜色和品牌色不一致", anchor: { shape: { type: "point", x: 0.6, y: 0.5 } } },
    { ...base, id: "ov0001", category: "add", body: "整体色调往暖调一点", anchor: {} },
  );
  writeFileSync(heroFile(app), JSON.stringify(json, null, 2) + "\n");
}

/** Right-clicks the blank space below the cards in the notes panel */
async function blankMenu(app: App) {
  const body = (await app.page.locator(".panel-body").boundingBox())!;
  await app.page.mouse.click(body.x + body.width / 2, body.y + body.height - 12, { button: "right" });
  await expect(app.page.locator(".menu")).toBeVisible();
}

test.beforeEach(({ app }) => {
  app.host.prefs = { panelScope: "material" };
  moreNotes(app);
});

test("right-clicking blank space: Copy as Text / Images, Check All / Uncheck All and Delete All Notes… (which states the count); after checking, copying hands over the checked notes; right-clicking a card still opens that note's menu", async ({ app }) => {
  await app.open();
  await expect(card(app, "ov0001")).toBeVisible();
  await blankMenu(app);
  await expect(menuItem(app, /^复制批注成文字/)).toBeEnabled();
  await expect(menuItem(app, /^复制批注成图片/)).toBeEnabled();
  await expect(menuItem(app, "取消勾选")).toBeDisabled();
  await expect(menuItem(app, /^删除全部批注…/)).toContainText("3 条");

  await menuItem(app, "全部勾选").click();
  await expect(app.page.locator(".panel-batch .batch-count")).toHaveText("已选 3 条");
  await blankMenu(app);
  await expect(menuItem(app, "全部勾选")).toBeDisabled();
  await expect(menuItem(app, /^取消勾选/)).toContainText("已选 3 条");
  await menuItem(app, /^将勾选的 3 条批注复制成文字/).click();
  const text = (await app.clipboard())!;
  expect(text).toContain("标题字太细了");
  expect(text).toContain("整体色调往暖调一点");
  await blankMenu(app);
  await menuItem(app, /^取消勾选/).click();
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);

  // Copy as Images: hands over the listed open notes
  await blankMenu(app);
  await menuItem(app, /^复制批注成图片/).click();
  await expect.poll(() => app.host.copiedImages.length).toBe(1);
  expect(app.host.copiedImages[0]).toHaveLength(3);

  // Right-click on a card: that note's menu, without Delete All
  await card(app, "pt0001").click({ button: "right" });
  await expect(menuItem(app, "编辑批注")).toBeVisible();
  await expect(menuItem(app, /^删除全部批注/)).toHaveCount(0);
  await app.page.keyboard.press("Escape");
});

test("Delete All Notes… asks first (stating how many will be deleted and how many unlisted ones are kept); after confirming, everything listed is deleted while the unlisted done note stays; one undo step restores them", async ({ app }) => {
  await app.open();
  await blankMenu(app);
  await menuItem(app, /^删除全部批注…/).click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("删除批注栏中列出的全部 3 条批注？");
  await expect(dialog).toContainText("这 3 条批注将被删除。");
  // done01 is done and the notes panel doesn't show resolved notes: it isn't deleted, and the dialog says so
  await expect(dialog).toContainText("另有 1 条未列出");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => ids(app)).toEqual(["done01"]);
  await expect(app.page.locator(".toast")).toContainText("已删除 3 条批注");
  await expect(app.page.locator(".card")).toHaveCount(0);

  await app.page.keyboard.press("Control+z");
  await expect.poll(() => ids(app).sort()).toEqual(["done01", "k3f9a2", "ov0001", "pt0001"]);
});

test("while searching only the matches are deleted; with a single note listed the confirm dialog names it; Esc deletes nothing; the menu bar's Edit → Delete All Notes… does the same; with nothing listed everything is disabled", async ({ app }) => {
  await app.open();
  await app.page.keyboard.press("Control+f");
  await app.page.keyboard.type("标题字");
  await expect(app.page.locator(".card")).toHaveCount(1);

  await app.page.locator(".menubar button", { hasText: "编辑" }).click();
  await menuItem(app, /^删除全部批注…/).click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("删除批注栏中列出的全部 1 条批注？");
  await expect(dialog).toContainText("「标题字太细了，换成粗一点的黑体」将被删除。");
  await expect(dialog).toContainText("另有 3 条未列出");
  await app.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(ids(app)).toHaveLength(4);

  await blankMenu(app);
  await menuItem(app, /^删除全部批注…/).click();
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => ids(app).sort()).toEqual(["done01", "ov0001", "pt0001"]);

  // No search results: everything in the menu is disabled, and so is the menu bar entry
  await app.page.locator(".panel-search input").fill("不存在的字");
  await blankMenu(app);
  await expect(menuItem(app, /^复制批注成文字/)).toBeDisabled();
  await expect(menuItem(app, "全部勾选")).toBeDisabled();
  await expect(menuItem(app, /^删除全部批注…/)).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".menubar button", { hasText: "编辑" }).click();
  await expect(menuItem(app, /^删除全部批注…/)).toBeDisabled();
});

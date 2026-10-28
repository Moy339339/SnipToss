// Notes panel search (with many notes, scrolling would be the only way to find one). It searches note text and replies; while searching, "listed" means the matches, and Select all and Copy as Text only act on those.

import { join } from "node:path";
import { expect, test, type App } from "./harness";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const cards = (app: App) => app.page.locator(".panel-body .card");
const search = (app: App) => app.page.locator(".panel-search input");

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("Ctrl+F searches notes: only matches are listed with the matched text highlighted; Copy as Text hands over only the matches; Esc clears the search", async ({ app }) => {
  await app.open();
  await expect(cards(app)).toHaveCount(2); // Project: one open note of hero.png and one of clip.mp4
  await app.page.keyboard.press("Control+f");
  await expect(search(app)).toBeFocused();
  await search(app).fill("黑体");
  await expect(cards(app)).toHaveCount(1);
  await expect(card(app, "k3f9a2").locator("mark.hit")).toHaveText("黑体");
  // The counts on the scope segments don't change
  await expect(app.page.locator(".scope-switch .seg.is-on .seg-count")).toHaveText("2");

  await app.page.locator(".dock-copy").click();
  await expect.poll(() => app.clipboard()).toContain("标题字太细了");
  expect(await app.clipboard()).not.toContain("这段水印去掉");

  await search(app).press("Escape");
  await expect(search(app)).toHaveValue("");
  await expect(search(app)).toBeFocused();
  await expect(cards(app)).toHaveCount(2);
});

test("search covers replies; when matches exist only among resolved notes, a line says so and a click shows them", async ({ app }) => {
  await app.open();
  await search(app).fill("已删"); // The reply of the done note on hero.png
  await expect(cards(app)).toHaveCount(0);
  const empty = app.page.locator(".panel-empty");
  await expect(empty).toContainText("没有与「已删」匹配的批注");
  await expect(empty).toContainText("已处理的批注中有 1 条匹配");
  await empty.getByRole("button", { name: "显示已处理的批注" }).click();
  await expect(card(app, "done01")).toBeVisible();
  await expect(card(app, "done01").locator(".reply mark.hit")).toHaveText("已删");
});

test("several space-separated words must all match; Enter selects the first match (switching items if it belongs to another one)", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  await search(app).fill("水印 去掉");
  await expect(cards(app)).toHaveCount(1);
  await search(app).press("Enter");
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(card(app, "p0c7xe")).toHaveClass(/is-selected/);
  await search(app).fill("水印 黑体");
  await expect(app.page.locator(".panel-empty")).toContainText("没有与「水印 黑体」匹配的批注");
});

// An item is gone (deleted, renamed, moved away; "deleted or renamed while open" is one of the edge cases):
// otherwise its notes would vanish from the notes panel while the file and REVIEW.md still showed them to agents, leaving the user unable to see or delete them,
// and the notes panel would go completely empty when the open item disappeared.

import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const toast = (app: App) => app.page.locator(".toast");
const missingGroup = (app: App, name: string) => app.page.locator(".group-head.is-missing", { hasText: name });
const heroNotes = (app: App) =>
  existsSync(join(app.project, ".sniptoss", "annotations", "assets__hero.png.json")) ? app.annotations("assets__hero.png.json") : [];

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelResolved: true };
});

test("the open item is deleted: a toast says its notes are kept; the notes panel stays on this project and the notes form their own group labeled as item not found", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  rmSync(join(app.project, "assets", "hero.png"));
  await expect(toast(app)).toContainText("找不到「hero.png」");
  await expect(toast(app)).toContainText("其 1 条待处理批注仍保留");
  await expect(app.page.locator(".lib-row", { hasText: "hero.png" })).toHaveCount(0);
  await expect(missingGroup(app, "hero.png")).toContainText("找不到素材");
  await expect(card(app, "k3f9a2")).toBeVisible();
  // REVIEW.md says so too, so agents don't assume the file is still there
  const review = join(app.project, ".sniptoss", "REVIEW.md");
  await expect.poll(() => existsSync(review) && readFileSync(review, "utf8")).toMatch(/## assets\/hero\.png .*未找到该文件/);
  // Click the card: it only selects that note and does not try to open the missing item
  await card(app, "k3f9a2").click();
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);
  await expect(app.page).toHaveTitle("超级批注");
  // Changing the status works as usual
  await card(app, "k3f9a2").hover();
  await card(app, "k3f9a2").locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
  await expect.poll(() => heroNotes(app).find((a) => a.id === "k3f9a2")?.status).toBe("resolved");
});

test("the item's folder is renamed: the notes do not disappear; deleting the whole group asks for confirmation first and can be undone", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  renameSync(join(app.project, "assets"), join(app.project, "assets-old"));
  // poster.jpg moved with the folder, so the canvas is cleared; the two notes of hero.png are listed in the item-not-found group
  await expect(missingGroup(app, "hero.png")).toBeVisible();
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect(card(app, "done01")).toBeVisible();
  // The count of the Project scope includes them (1 open note of hero.png + 1 of clip.mp4)
  await expect(app.page.locator(".seg", { hasText: "整个项目" }).locator(".seg-count")).toHaveText("2");
  // Clicking the group title opens nothing
  await missingGroup(app, "hero.png").click({ position: { x: 60, y: 10 } });
  await expect(app.page).toHaveTitle("超级批注");
  // Edit: explains that the mark position can't be changed
  await card(app, "k3f9a2").dblclick();
  await expect(toast(app)).toContainText("找不到素材，无法修改标记位置");
  // Delete the whole group
  await missingGroup(app, "hero.png").locator(".act").click();
  await app.page.getByRole("menuitem", { name: "删除这些批注…" }).click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("删除此素材的 2 条批注？");
  await expect(dialog).toContainText("assets/hero.png");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => heroNotes(app).length).toBe(0);
  await expect(missingGroup(app, "hero.png")).toHaveCount(0);
  await app.page.locator(".panel-body").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      heroNotes(app)
        .map((a) => a.id)
        .sort(),
    )
    .toEqual(["done01", "k3f9a2"]);
  await expect(missingGroup(app, "hero.png")).toBeVisible();
});

test("an item only removed from the library (the file is still on disk): no \"not found\" notice and it is not treated as missing", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page).toHaveTitle("hero.png");
  // Turn off the image type: hero.png leaves the library, but the file is still there
  app.host.prefs = { ...app.host.prefs, kinds: { image: false, video: true } };
  await app.page.keyboard.press("F5");
  await expect(app.page.locator(".lib-row", { hasText: "hero.png" })).toHaveCount(0);
  await app.page.waitForTimeout(500);
  await expect(toast(app)).toHaveCount(0);
  await expect(app.page.locator(".group-head.is-missing")).toHaveCount(0);
});

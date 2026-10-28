// The copy scope follows one rule: if any notes are checked, copy those; otherwise copy all open notes the notes panel currently lists.
// Only right-clicking a single note or a single library row hands over just that one.
// The blank-canvas menu, the multi-selection in the library and the project row's count must all agree with that rule
// (the count includes the group of items that cannot be found).

import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO = "标题字太细了，换成粗一点的黑体";
const CLIP = "这段水印去掉";
const FOLDER = "assets 里的图统一加圆角";

const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const row = (app: App, name: string) => app.page.locator(".lib-row", { hasText: name }).first();

/** Writes a whole-folder comment for a folder (the fixture has none) */
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

/** Right-click on blank canvas (the margin around the content) */
async function stageBlankMenu(app: App) {
  const box = (await app.page.locator(".stage").boundingBox())!;
  await app.page.mouse.click(box.x + 6, box.y + box.height - 6, { button: "right" });
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("Ctrl+Shift+A copies all open notes the notes panel lists (the whole project by default) or only the checked ones; the canvas context menu copies only the item on the canvas", async ({ app }) => {
  await app.open();
  await row(app, "poster.jpg").click();
  await expect(app.page).toHaveTitle("poster.jpg");
  // poster.jpg has no notes of its own, but the notes panel lists the whole project, so the whole project is copied
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+Shift+A");
  await expect.poll(() => app.clipboard()).toContain(HERO);
  expect(await app.clipboard()).toContain(CLIP);
  // Right-click on the canvas: covers only poster.jpg itself (same as right-clicking its library row); with no open notes the item is grayed out
  await stageBlankMenu(app);
  await expect(app.page.getByRole("menuitem", { name: /复制批注成文字/ })).toBeDisabled();
  await app.page.keyboard.press("Escape");

  // Check one note: only that one is copied
  await card(app, "k3f9a2").locator(".card-check").click();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+Shift+A");
  await expect.poll(() => app.clipboard()).not.toContain(CLIP);
  expect(await app.clipboard()).toContain(HERO);
});

test("Copying from the context menu with several library rows selected copies what the notes panel lists, including the comments of the folder they are in", async ({ app }) => {
  folderNote(app, "assets", FOLDER);
  await app.open();
  await row(app, "hero.png").click();
  await row(app, "poster.jpg").click({ modifiers: ["Control"] });
  // The notes panel lists the two selected items plus the assets folder's comment
  await expect(card(app, "fold01")).toBeVisible();
  await row(app, "poster.jpg").click({ button: "right" });
  const copy = app.page.getByRole("menuitem", { name: /复制批注成文字/ });
  await expect(copy).toContainText("2 条");
  await copy.click();
  await expect.poll(() => app.clipboard()).toContain(FOLDER);
  expect(await app.clipboard()).toContain(HERO);
  expect(await app.clipboard()).not.toContain(CLIP);
});

test("The project row in the library counts and copies the group of missing items too, just like the Project scope in the notes panel", async ({ app }) => {
  await app.open();
  await row(app, "poster.jpg").click();
  renameSync(join(app.project, "video"), join(app.project, "video-old"));
  await expect(app.page.locator(".group-head.is-missing", { hasText: "clip.mp4" })).toBeVisible();
  await expect(app.page.locator(".scope-switch .seg", { hasText: "整个项目" }).locator(".seg-count")).toHaveText("2");

  await row(app, "project").click({ button: "right" });
  const copy = app.page.getByRole("menuitem", { name: /复制批注成文字/ });
  await expect(copy).toContainText("2 条");
  await copy.click();
  await expect.poll(() => app.clipboard()).toContain(CLIP);
  expect(await app.clipboard()).toContain(HERO);

  // Collapse the project: the total on the row is also 2
  await app.page.keyboard.press("Escape");
  await row(app, "project").locator(".lib-twisty").click();
  await expect(row(app, "project").locator(".badge")).toHaveText("2");
});

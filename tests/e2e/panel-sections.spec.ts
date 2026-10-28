// Notes panel sections, collapsing and filtering, and hiding marks on the canvas (sections must be clear, with an obvious separation; they can be collapsed,
// showing only the notes on the canvas or only the overall comments; marks that are too close together overlap; all marks can be hidden to see the original image).
// Rules: filtered-out and collapsed notes don't count as "listed" (Select all, copying with nothing checked and [ ] all ignore them);
// hiding marks only changes how things are viewed: it isn't written to the notes file, doesn't affect copying, and is remembered only for the current run; a hidden mark is still drawn while selected

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO_NOTES = "assets__hero.png.json";
const card = (app: App, id: string) => app.page.locator(`.card[data-annot$="|${id}"]`);
const section = (app: App, kind: string) => app.page.locator(`.note-section.is-${kind}`);
const badge = (app: App, id: string) => app.page.locator(`.annot-badge[data-id="${id}"]`);
const shape = (app: App, id: string) => app.page.locator(`.annot-shape[data-id="${id}"]`);
const checkItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitemcheckbox", { name });
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const heroFile = (app: App) => join(app.project, ".sniptoss", "annotations", HERO_NOTES);

/** Adds one more pin (pt0001, the 2nd on the canvas) and an open overall comment (ov0001, the 2nd overall comment: done01 is done but still counts for numbering) to hero.png */
function moreNotes(app: App) {
  const json = JSON.parse(readFileSync(heroFile(app), "utf8"));
  const base = json.annotations[0];
  json.annotations.push(
    { ...base, id: "pt0001", body: "按钮颜色和品牌色不一致", anchor: { shape: { type: "point", x: 0.6, y: 0.5 } } },
    { ...base, id: "ov0001", category: "add", body: "整体色调往暖调一点", anchor: {} },
  );
  writeFileSync(heroFile(app), JSON.stringify(json, null, 2) + "\n");
}

/** Opens the funnel menu of the notes panel and picks an item */
async function filterMenu(app: App, name: string) {
  await app.page.locator(".panel-filter").click();
  await checkItem(app, name).click();
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
  moreNotes(app);
});

test("each section has a title row (name + count) and a click collapses it: its cards aren't listed, Select all doesn't check them, copying with nothing checked doesn't hand them over, and checked ones are unchecked; another click expands it", async ({ app }) => {
  await app.open();
  await expect(section(app, "marked").locator(".note-section-title")).toHaveText("画面标记");
  await expect(section(app, "marked").locator(".note-section-count")).toHaveText("2");
  await expect(section(app, "overall").locator(".note-section-title")).toHaveText("整体意见");
  // The done note done01 isn't listed, and the count only counts listed notes
  await expect(section(app, "overall").locator(".note-section-count")).toHaveText("1");
  await expect(section(app, "marked")).toHaveAttribute("aria-expanded", "true");

  // Check the overall comment, then collapse its section: the check is dropped, the card isn't listed, and the count is still shown
  await card(app, "ov0001").locator(".card-check").click();
  await expect(app.page.locator(".panel-batch .batch-count")).toHaveText("已选 1 条");
  await section(app, "overall").click();
  await expect(section(app, "overall")).toHaveAttribute("aria-expanded", "false");
  await expect(card(app, "ov0001")).toHaveCount(0);
  await expect(section(app, "overall").locator(".note-section-count")).toHaveText("1");
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);

  // Select all checks only the two visible notes
  await app.page.locator(".dock-all").click();
  await expect(app.page.locator(".panel-batch .batch-count")).toHaveText("已选 2 条");
  await app.page.locator(".dock-all").click();
  // Copying with nothing checked: only the visible notes are handed over
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  const text = (await app.clipboard())!;
  expect(text).toContain("标题字太细了");
  expect(text).toContain("按钮颜色和品牌色不一致");
  expect(text).not.toContain("整体色调往暖调一点");

  // ] only steps among the visible notes
  await app.page.keyboard.press("]");
  await app.page.keyboard.press("]");
  await app.page.keyboard.press("]");
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);

  // The keyboard can collapse / expand: the title is a button; Tab to it and press Enter (that presses the button, not Edit Selected Note)
  await section(app, "overall").focus();
  await app.page.keyboard.press("Shift+Tab");
  await app.page.keyboard.press("Tab");
  await expect(section(app, "overall")).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect(card(app, "ov0001")).toBeVisible();
});

test("after collapsing the Canvas marks section, clicking a mark on the canvas expands that section and selects the card", async ({ app }) => {
  await app.open();
  await section(app, "marked").click();
  await expect(card(app, "pt0001")).toHaveCount(0);
  await badge(app, "pt0001").click();
  await expect(section(app, "marked")).toHaveAttribute("aria-expanded", "true");
  await expect(card(app, "pt0001")).toHaveClass(/is-selected/);
});

test("filtering: removing Overall comment in the funnel menu hides that section, lights the funnel, shows a Showing only … Clear filter bar on top and saves to settings; the last remaining type is disabled; copying only hands over what is listed; Clear filter restores everything", async ({
  app,
}) => {
  await app.open();
  await expect(app.page.locator(".filter-bar")).toHaveCount(0);
  await filterMenu(app, "整体意见");
  await expect(section(app, "overall")).toHaveCount(0);
  await expect(card(app, "ov0001")).toHaveCount(0);
  await expect(app.page.locator(".panel-filter")).toHaveClass(/is-on/);
  await expect(app.page.locator(".filter-bar-text")).toHaveText("仅显示画面标记和旧版本上的批注");
  await expect.poll(() => app.host.prefs?.panelHidden).toEqual(["overall"]);

  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  expect(await app.clipboard()).not.toContain("整体色调往暖调一点");

  // Remove earlier versions too: only Canvas marks is left and it is disabled (the notes panel can't be filtered down to nothing)
  await filterMenu(app, "旧版本上的批注");
  await app.page.locator(".panel-filter").click();
  await expect(checkItem(app, "画面标记")).toBeDisabled();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".filter-bar-text")).toHaveText("仅显示画面标记");

  await app.page.locator(".filter-bar-clear").click();
  await expect(section(app, "overall")).toBeVisible();
  await expect(app.page.locator(".filter-bar")).toHaveCount(0);
  // Back to the default: not written to the settings file
  await expect.poll(() => app.host.prefs?.panelHidden).toBeUndefined();
});

test("when filtering leaves nothing for this item, it says no notes match the filter and offers Clear filter; for other items under Project it says they have no notes matching the filter", async ({ app }) => {
  app.host.prefs = { panelScope: "material", panelHidden: ["marked", "earlier"] };
  // Drop the overall comments of hero.png
  const json = JSON.parse(readFileSync(heroFile(app), "utf8"));
  json.annotations = json.annotations.filter((a: { id: string }) => a.id !== "ov0001");
  writeFileSync(heroFile(app), JSON.stringify(json, null, 2) + "\n");
  await app.open();
  const empty = app.page.locator(".panel-empty");
  await expect(empty).toContainText("没有符合筛选条件的批注");
  await empty.getByRole("button", { name: "清除筛选" }).click();
  await expect(card(app, "k3f9a2")).toBeVisible();

  await filterMenu(app, "画面标记");
  await app.page.locator(".scope-switch .seg", { hasText: "整个项目" }).click();
  // clip.mp4 only has canvas marks (filtered out) and poster.jpg has no notes
  await expect(app.page.locator(".group-rest")).toHaveText("另有 2 个素材没有符合筛选条件的批注");
});

test("Shift+H hides all marks on the canvas: the zoom bar says the marks are hidden and the View menu entry is unchecked; selecting a note draws only that one; pressing again brings them back. Nothing is written to the notes file and copying works as usual", async ({ app }) => {
  await app.open();
  await expect(badge(app, "pt0001")).toBeVisible();
  await expect(shape(app, "k3f9a2")).toHaveCount(1);
  const before = readFileSync(heroFile(app), "utf8");

  await focusStage(app);
  await app.page.keyboard.press("Shift+H");
  await expect(badge(app, "pt0001")).toHaveCount(0);
  // It only changes how things are viewed: the notes file is untouched
  expect(readFileSync(heroFile(app), "utf8")).toBe(before);
  await expect(badge(app, "k3f9a2")).toHaveCount(0);
  await expect(shape(app, "k3f9a2")).toHaveCount(0);
  const toggle = app.page.locator(".zoom-marks");
  await expect(toggle).toHaveClass(/is-on/);
  await expect(toggle).toHaveText("标记已隐藏");
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  await expect(checkItem(app, /显示画面标记/)).toHaveAttribute("aria-checked", "false");
  await app.page.keyboard.press("Escape");

  // Select a note: only it is drawn
  await card(app, "pt0001").click();
  await expect(badge(app, "pt0001")).toBeVisible();
  await expect(badge(app, "k3f9a2")).toHaveCount(0);

  // Copying still hands over all open notes
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  expect(await app.clipboard()).toContain("标题字太细了");

  // One click on the zoom bar brings them back
  await toggle.click();
  await expect(badge(app, "k3f9a2")).toBeVisible();
  await expect(toggle).not.toHaveClass(/is-on/);
});

test("hiding a single mark: the eye shown on hover over a card and the Hide Mark context menu entry; a hidden mark's card always shows a crossed-out eye; overall comments don't have this option", async ({ app }) => {
  await app.open();
  await card(app, "pt0001").hover();
  await card(app, "pt0001").locator(".act-mark").click();
  // Clicking the eye doesn't select the card (the action bar stops propagation), and the mark isn't drawn
  await expect(card(app, "pt0001")).not.toHaveClass(/is-selected/);
  await expect(badge(app, "pt0001")).toHaveCount(0);
  await expect(badge(app, "k3f9a2")).toBeVisible();
  await expect(card(app, "pt0001").locator(".card-mark-hidden")).toBeVisible();

  // Right-click: Show Mark
  await card(app, "pt0001").click({ button: "right" });
  await app.page.getByRole("menuitem", { name: "显示标记" }).click();
  await expect(badge(app, "pt0001")).toBeVisible();
  await expect(card(app, "pt0001").locator(".card-mark-hidden")).toHaveCount(0);

  // Right-click a mark on the canvas: Hide Mark
  await badge(app, "k3f9a2").click({ button: "right" });
  await app.page.getByRole("menuitem", { name: "隐藏标记" }).click();
  // The right-click selected it, and a selected mark is still drawn; it is only hidden once deselected
  await app.page.keyboard.press("Escape");
  await expect(badge(app, "k3f9a2")).toHaveCount(0);

  // Overall comment: no eye, and no such entry in the context menu
  await card(app, "ov0001").hover();
  await expect(card(app, "ov0001").locator(".act-mark")).toHaveCount(0);
  await card(app, "ov0001").click({ button: "right" });
  await expect(app.page.getByRole("menuitem", { name: /标记$/ })).toHaveCount(0);
});

test("pointing at a card lights its mark on the canvas; the selected mark is drawn on top", async ({ app }) => {
  await app.open();
  await card(app, "pt0001").hover();
  await expect(badge(app, "pt0001")).toHaveClass(/is-hover/);
  await expect(badge(app, "k3f9a2")).not.toHaveClass(/is-hover/);
  await app.page.mouse.move(5, 5);
  await expect(badge(app, "pt0001")).not.toHaveClass(/is-hover/);

  // Select the 1st: its number is last in the DOM (so it covers the others)
  await card(app, "k3f9a2").click();
  const ids = await app.page.locator(".annot-badge").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
  expect(ids[ids.length - 1]).toBe("k3f9a2");
});

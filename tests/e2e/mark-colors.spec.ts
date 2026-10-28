// Changing the color of a single mark. The notes file's `color` is only written for marks that were recolored; no `color` = use the mark color from Settings.
// Changing back to the Settings color drops `color`. Entry points: press 1–6 after selecting (acts on the checked notes when some are checked),
// the "Color" swatch row in the right-click menu of a mark / card, menu bar "Annotate → Mark Color".
// The mark and its number on the canvas, the number in the notes panel, the play bar, snapshots and Copy as Images all use the note's own color;
// overall comments and notes on old versions have no mark to recolor

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO_NOTES = "assets__hero.png.json";
const ORANGE = "rgb(255, 106, 61)";
const BLUE = "rgb(91, 140, 255)";
const YELLOW = "rgb(255, 194, 51)";
const GREEN = "rgb(61, 220, 132)";
const card = (app: App, id: string) => app.page.locator(`.card[data-annot$="|${id}"]`);
const badge = (app: App, id: string) => app.page.locator(`.annot-badge[data-id="${id}"]`);
/** The rectangle's stroke (not the dark casing underneath) */
const rectLine = (app: App, id: string) => app.page.locator(`.annot-shape[data-id="${id}"] rect:not(.annot-casing):not(.annot-hit)`);
const swatch = (app: App, name: string) => app.page.getByRole("menuitemradio", { name, exact: true });
const bg = (el: ReturnType<typeof badge>) => el.evaluate((e) => getComputedStyle(e).backgroundColor);
const heroFile = (app: App) => join(app.project, ".sniptoss", "annotations", HERO_NOTES);
const heroNotes = (app: App) =>
  (JSON.parse(readFileSync(heroFile(app), "utf8")) as { annotations: { id: string; color?: string; snapshot?: string }[] }).annotations;
const colorOf = (app: App, id: string) => heroNotes(app).find((a) => a.id === id)?.color;

/** Adds one more pin to hero.png (pt0001, the 2nd on the canvas) and an open overall comment (ov0001); `extra` is merged into the pin note */
function moreNotes(app: App, extra: Record<string, unknown> = {}) {
  const json = JSON.parse(readFileSync(heroFile(app), "utf8"));
  const base = json.annotations[0];
  json.annotations.push(
    { ...base, id: "pt0001", body: "按钮颜色和品牌色不一致", anchor: { shape: { type: "point", x: 0.6, y: 0.5 } }, ...extra },
    { ...base, id: "ov0001", category: "add", body: "整体色调往暖调一点", anchor: {} },
  );
  writeFileSync(heroFile(app), JSON.stringify(json, null, 2) + "\n");
}

/** Pixel color at a point (0–1) of a snapshot. Decodes the PNG in the page (createImageBitmap is not subject to the CSP's img-src) */
async function shotPixel(app: App, rel: string, x: number, y: number): Promise<string> {
  const b64 = readFileSync(join(app.project, ".sniptoss", rel)).toString("base64");
  return app.page.evaluate(
    async ({ data, px, py }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      const [r, gr, b] = g.getImageData(Math.round(px * bmp.width), Math.round(py * bmp.height), 1, 1).data;
      return `rgb(${r}, ${gr}, ${b})`;
    },
    { data: b64, px: x, py: y },
  );
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
});

test("right-clicking a pin shows the Color swatch row with the default orange lit; picking blue turns the pin on the canvas and its number in the notes panel blue, other marks stay; the file records color and the snapshot is redrawn in blue; undo / redo; picking orange again drops color", async ({
  app,
}) => {
  moreNotes(app);
  await app.open();
  await expect(bg(badge(app, "pt0001"))).resolves.toBe(ORANGE);

  await badge(app, "pt0001").click({ button: "right" });
  await expect(app.page.getByRole("group", { name: "颜色" })).toBeVisible();
  await expect(swatch(app, "橙色（默认）")).toHaveAttribute("aria-checked", "true");
  await expect(swatch(app, "蓝色")).toHaveAttribute("aria-checked", "false");
  await swatch(app, "蓝色").click();
  await expect(app.page.locator(".menu")).toHaveCount(0);

  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(BLUE);
  await expect.poll(() => bg(card(app, "pt0001").locator(".card-num"))).toBe(BLUE);
  // Other marks keep following Settings
  await expect.poll(() => bg(badge(app, "k3f9a2"))).toBe(ORANGE);
  await expect(rectLine(app, "k3f9a2")).toHaveAttribute("stroke", "#ff6a3d");
  await expect.poll(() => colorOf(app, "pt0001")).toBe("#5b8cff");
  expect(colorOf(app, "k3f9a2")).toBeUndefined();
  // The mark in the snapshot is blue too (the pin's center is solid mark color)
  await expect.poll(() => heroNotes(app).find((a) => a.id === "pt0001")?.snapshot).toBe("snapshots/pt0001.png");
  await expect.poll(() => existsSync(join(app.project, ".sniptoss", "snapshots", "pt0001.png"))).toBe(true);
  await expect.poll(() => shotPixel(app, "snapshots/pt0001.png", 0.6, 0.5)).toBe(BLUE);

  // Undo: back to orange, the field is dropped, the snapshot is redrawn; redo makes it blue again
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(ORANGE);
  await expect.poll(() => colorOf(app, "pt0001")).toBeUndefined();
  await expect.poll(() => shotPixel(app, "snapshots/pt0001.png", 0.6, 0.5)).toBe(ORANGE);
  await app.page.keyboard.press("Control+Shift+z");
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(BLUE);
  await expect.poll(() => colorOf(app, "pt0001")).toBe("#5b8cff");

  // The card in the notes panel has the same swatch row in its context menu: blue is lit; picking the default orange drops color (it follows Settings from then on)
  await card(app, "pt0001").click({ button: "right" });
  await expect(swatch(app, "蓝色")).toHaveAttribute("aria-checked", "true");
  await swatch(app, "橙色（默认）").click();
  await expect.poll(() => colorOf(app, "pt0001")).toBeUndefined();
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(ORANGE);

  // An overall comment has no mark: its context menu has no swatch row
  await card(app, "ov0001").click({ button: "right" });
  await expect(app.page.getByRole("menuitem", { name: "编辑批注" })).toBeVisible();
  await expect(app.page.getByRole("group", { name: "颜色" })).toHaveCount(0);
});

test("number keys 1–6 switch the selected note to the nth color (pressing the Settings color drops color); with several checked they act on the checked notes in one undo step; ignored for overall comments and inside text inputs", async ({
  app,
}) => {
  moreNotes(app);
  await app.open();
  await card(app, "k3f9a2").click();
  await app.page.keyboard.press("5");
  await expect(rectLine(app, "k3f9a2")).toHaveAttribute("stroke", "#5b8cff");
  await expect.poll(() => colorOf(app, "k3f9a2")).toBe("#5b8cff");
  expect(colorOf(app, "pt0001")).toBeUndefined();
  // With a single note the change is visible on the canvas, so no toast
  await expect(app.page.locator(".toast")).toHaveCount(0);
  await app.page.keyboard.press("1");
  await expect.poll(() => colorOf(app, "k3f9a2")).toBeUndefined();
  await expect(rectLine(app, "k3f9a2")).toHaveAttribute("stroke", "#ff6a3d");

  // Check two and press 3: both turn yellow, the toast says how many, one undo restores both
  await card(app, "k3f9a2").locator(".card-check").click();
  await card(app, "pt0001").locator(".card-check").click();
  await app.page.keyboard.press("3");
  await expect.poll(() => [colorOf(app, "k3f9a2"), colorOf(app, "pt0001")]).toEqual(["#ffc233", "#ffc233"]);
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(YELLOW);
  await expect(app.page.locator(".toast")).toContainText("已更改 2 条标记的颜色");
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => [colorOf(app, "k3f9a2"), colorOf(app, "pt0001")]).toEqual([undefined, undefined]);

  // The checked notes include an overall comment: only the notes with marks are recolored
  await card(app, "ov0001").locator(".card-check").click();
  await app.page.keyboard.press("4");
  await expect.poll(() => colorOf(app, "pt0001")).toBe("#3ddc84");
  expect(heroNotes(app).find((a) => a.id === "ov0001")?.color).toBeUndefined();
  // The first Esc deselects, the second clears the checks
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);

  // Only an overall comment selected: number keys do nothing
  await card(app, "ov0001").click();
  const before = readFileSync(heroFile(app), "utf8");
  await app.page.keyboard.press("2");
  await app.page.waitForTimeout(200);
  expect(readFileSync(heroFile(app), "utf8")).toBe(before);

  // Focus in the search box: digits are text
  await card(app, "pt0001").click();
  await app.page.keyboard.press("Control+f");
  await app.page.keyboard.press("6");
  await expect(app.page.locator(".panel-search input")).toHaveValue("6");
  expect(colorOf(app, "pt0001")).toBe("#3ddc84");
});

test("after the mark color changes in Settings, marks that were not recolored follow it and recolored ones stay; the swatches label the default, and picking it drops color", async ({ app }) => {
  app.host.prefs = { panelScope: "material", markColor: "#3ddc84" };
  moreNotes(app, { color: "#5b8cff" });
  await app.open();
  await expect.poll(() => bg(badge(app, "k3f9a2"))).toBe(GREEN);
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(BLUE);

  await badge(app, "pt0001").click({ button: "right" });
  await expect(swatch(app, "绿色（默认）")).toBeVisible();
  await expect(swatch(app, "橙色")).toBeVisible();
  await expect(swatch(app, "蓝色")).toHaveAttribute("aria-checked", "true");
  await app.page.keyboard.press("Escape");

  // The right-click selected it: pressing 4 (green = the Settings color) drops the individual color
  await app.page.keyboard.press("4");
  await expect.poll(() => colorOf(app, "pt0001")).toBeUndefined();
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(GREEN);
});

test("menu bar Annotate → Mark Color is disabled when nothing recolorable is selected; End on the keyboard lands on the lit swatch, ← → move between swatches (without switching menus), Enter picks; with several checked it says how many", async ({
  app,
}) => {
  moreNotes(app);
  await app.open();
  const menu = () => app.page.locator(".menubar button", { hasText: "批注" }).click();
  await menu();
  await expect(app.page.getByRole("group", { name: "标记颜色" })).toBeVisible();
  await expect(swatch(app, "蓝色")).toBeDisabled();
  await app.page.keyboard.press("Escape");

  await card(app, "pt0001").click();
  await menu();
  await expect(swatch(app, "蓝色")).toBeEnabled();
  await app.page.keyboard.press("End");
  await expect(swatch(app, "橙色（默认）")).toBeFocused();
  await app.page.keyboard.press("ArrowRight");
  await app.page.keyboard.press("ArrowRight");
  await expect(swatch(app, "黄色")).toBeFocused();
  await app.page.keyboard.press("ArrowLeft");
  await expect(swatch(app, "红色")).toBeFocused();
  // Still the Annotate menu (← → did not switch menus)
  await expect(app.page.getByRole("group", { name: "标记颜色" })).toBeVisible();
  // The swatch's hover tip shows the shortcut
  await expect(swatch(app, "红色")).toHaveAttribute("data-tip", "红色　2");
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".menu")).toHaveCount(0);
  await expect.poll(() => colorOf(app, "pt0001")).toBe("#ff4d6d");

  await card(app, "k3f9a2").locator(".card-check").click();
  await card(app, "pt0001").locator(".card-check").click();
  await menu();
  await expect(app.page.getByRole("group", { name: "勾选的 2 条批注的标记颜色" })).toBeVisible();
  // The two notes have different colors: no swatch is lit
  await expect(app.page.locator(".menu-swatch.is-on")).toHaveCount(0);
  await swatch(app, "紫色").click();
  await expect.poll(() => [colorOf(app, "k3f9a2"), colorOf(app, "pt0001")]).toEqual(["#b07cff", "#b07cff"]);
});

test("the position on the video play bar and the number circle in Copy as Images follow the note's color", async ({ app }) => {
  moreNotes(app, { color: "#5b8cff" });
  await app.open();
  // Copy as Images: each note hands over its own color (wait for the notes to be listed first: right after opening, they are sometimes not loaded yet)
  await expect(card(app, "pt0001")).toBeVisible();
  await app.page.keyboard.press("Control+Shift+i");
  await expect.poll(() => app.host.copiedImages.length).toBe(1);
  const byNumber = Object.fromEntries(app.host.copiedImages[0].filter((it) => it.number > 0).map((it) => [it.number, it.color]));
  expect(byNumber).toEqual({ 1: "#ff6a3d", 2: "#5b8cff" });

  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).first().click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await card(app, "p0c7xe").click();
  await app.page.keyboard.press("6");
  await expect.poll(() => bg(app.page.locator(".track-mark").first())).toBe("rgb(176, 124, 255)");
  await expect.poll(() => bg(badge(app, "p0c7xe"))).toBe("rgb(176, 124, 255)");
});

// ---------- Each place of a multi-place note can be recolored on its own (so the comment can say which place to change, by color) ----------

type Place = { type: string; x: number; y: number; color?: string };
const places = (app: App, id: string) =>
  (
    JSON.parse(readFileSync(heroFile(app), "utf8")) as { annotations: { id: string; color?: string; anchor: { shapes?: Place[] } }[] }
  ).annotations.find((a) => a.id === id)!;
const placeBadge = (app: App, id: string, part: number) => app.page.locator(`.annot-badge[data-id="${id}"][data-part="${part}"]`);

/** Adds a note with two places to hero.png (mp0001: two pins, left at 0.3 and right at 0.7) */
function twoPlaces(app: App) {
  const json = JSON.parse(readFileSync(heroFile(app), "utf8"));
  json.annotations.push({
    ...json.annotations[0],
    id: "mp0001",
    body: "这两个按钮都改成圆角",
    anchor: {
      shapes: [
        { type: "point", x: 0.3, y: 0.5 },
        { type: "point", x: 0.7, y: 0.5 },
      ],
    },
  });
  writeFileSync(heroFile(app), JSON.stringify(json, null, 2) + "\n");
}

test("multi-place note: right-clicking one place and picking its mark color changes only that place; the file records a color for every place, the snapshot shows the two colors, Copy as Text writes each place's color; the card's Color changes the whole note and drops the per-place colors; undoable", async ({
  app,
}) => {
  twoPlaces(app);
  await app.open();
  await placeBadge(app, "mp0001", 1).click({ button: "right" });
  await expect(app.page.getByRole("group", { name: "这处标记的颜色" })).toBeVisible();
  await expect(app.page.getByRole("group", { name: "颜色", exact: true })).toHaveCount(0);
  await expect(swatch(app, "橙色（默认）")).toHaveAttribute("aria-checked", "true");
  // Number keys change the place picked with a left click; this right-click row shows no number keys
  await expect(swatch(app, "黄色")).toHaveAttribute("data-tip", "黄色");
  await swatch(app, "黄色").click();

  await expect.poll(() => bg(placeBadge(app, "mp0001", 1))).toBe(YELLOW);
  await expect.poll(() => bg(placeBadge(app, "mp0001", 0))).toBe(ORANGE);
  await expect.poll(() => places(app, "mp0001").anchor.shapes!.map((s) => s.color)).toEqual(["#ff6a3d", "#ffc233"]);
  expect(places(app, "mp0001").color).toBeUndefined(); // The first place has the Settings color: nothing is recorded for the whole note
  // The snapshot is redrawn: the pin's center is solid mark color
  await expect.poll(() => heroNotes(app).find((a) => a.id === "mp0001")?.snapshot).toBe("snapshots/mp0001.png");
  await expect.poll(() => shotPixel(app, "snapshots/mp0001.png", 0.7, 0.5)).toBe(YELLOW);
  expect(await shotPixel(app, "snapshots/mp0001.png", 0.3, 0.5)).toBe(ORANGE);

  // Copy as Text: each place is prefixed with its color, so it matches phrases like "the yellow one" in the comment
  await card(app, "mp0001").click({ button: "right" });
  await app.page.locator(".menu .menu-item", { hasText: "复制批注成文字" }).click();
  await expect.poll(() => app.clipboard()).toMatch(/2 处：（橙色）位置 画面左侧居中[^；]+；（黄色）位置 画面右侧居中/);

  // The card's Color applies to the whole note: with differing place colors no swatch is lit; picking blue makes both places blue and drops the per-place colors
  await card(app, "mp0001").click({ button: "right" });
  await expect(app.page.getByRole("group", { name: "颜色", exact: true })).toBeVisible();
  await expect(app.page.locator(".menu-swatch.is-on")).toHaveCount(0);
  await swatch(app, "蓝色").click();
  await expect.poll(() => Promise.all([bg(placeBadge(app, "mp0001", 0)), bg(placeBadge(app, "mp0001", 1))])).toEqual([BLUE, BLUE]);
  await expect.poll(() => places(app, "mp0001").color).toBe("#5b8cff");
  expect(places(app, "mp0001").anchor.shapes!.map((s) => s.color)).toEqual([undefined, undefined]);
  // Undo: back to each place's own color
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => places(app, "mp0001").anchor.shapes!.map((s) => s.color)).toEqual(["#ff6a3d", "#ffc233"]);
  await expect.poll(() => bg(placeBadge(app, "mp0001", 1))).toBe(YELLOW);
});

test("multi-place note: after clicking one place on the canvas, a number key changes only that place; changing back to the same color as the other place drops the per-place colors; selecting the note from the notes panel and pressing a number key changes the whole note", async ({
  app,
}) => {
  twoPlaces(app);
  await app.open();
  await placeBadge(app, "mp0001", 0).click();
  await app.page.keyboard.press("4");
  await expect.poll(() => places(app, "mp0001").anchor.shapes!.map((s) => s.color)).toEqual(["#3ddc84", "#ff6a3d"]);
  await expect.poll(() => bg(placeBadge(app, "mp0001", 0))).toBe(GREEN);
  expect(places(app, "mp0001").color).toBe("#3ddc84"); // The whole note records the first place's color (older versions draw with it)
  // Press 1 again (orange, same as the other place): it is taken back, neither per-place nor whole-note colors are recorded
  await app.page.keyboard.press("1");
  await expect.poll(() => places(app, "mp0001").anchor.shapes!.map((s) => s.color)).toEqual([undefined, undefined]);
  expect(places(app, "mp0001").color).toBeUndefined();

  // Selected from the notes panel (not by clicking a place on the canvas): number keys change the whole note
  await card(app, "mp0001").click();
  await app.page.keyboard.press("5");
  await expect.poll(() => places(app, "mp0001").color).toBe("#5b8cff");
  await expect.poll(() => Promise.all([bg(placeBadge(app, "mp0001", 0)), bg(placeBadge(app, "mp0001", 1))])).toEqual([BLUE, BLUE]);
});

test("with the composer open, right-clicking one place and picking its mark color changes only that place, and every place records a color once saved", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await app.media();
  for (const x of [0.3, 0.7]) await app.page.mouse.click(box.x + box.width * x, box.y + box.height * 0.35);
  const drafts = app.page.locator(".annot-badge.is-draft");
  await expect(drafts).toHaveCount(2);
  const pin = (await drafts.nth(1).boundingBox())!;
  await app.page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2, { button: "right" });
  await expect(app.page.getByRole("group", { name: "这处标记的颜色" })).toBeVisible();
  await swatch(app, "黄色").click();
  await expect.poll(() => bg(drafts.nth(1))).toBe(YELLOW);
  await expect.poll(() => bg(drafts.nth(0))).toBe(ORANGE);
  await app.page.locator(".composer-text").fill("橙色那处改圆角，黄色那处去掉");
  await app.page.locator(".composer-text").press("Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect.poll(() => heroNotes(app).find((a) => (a as { body?: string }).body === "橙色那处改圆角，黄色那处去掉")?.id).toBeTruthy();
  const id = heroNotes(app).find((a) => (a as { body?: string }).body === "橙色那处改圆角，黄色那处去掉")!.id;
  expect(places(app, id).anchor.shapes!.map((s) => s.color)).toEqual(["#ff6a3d", "#ffc233"]);
  await expect.poll(() => bg(placeBadge(app, id, 1))).toBe(YELLOW);
});

// Clicking a mark gave no hint that it could be recolored: after selecting it, only keys 1–6 and the right-click menu worked, a left click did nothing,
// and clicking the places being drawn while the composer was open did nothing at all. Now a click on a mark pops up a row of colors next to it (MarkColorBar), as in Screen Capture
const colorBar = (app: App) => app.page.locator(".mark-colors");
const barSwatch = (app: App, name: string) => colorBar(app).getByRole("radio", { name, exact: true });

test("clicking a mark on the canvas rings its number in blue and pops up a color row beside it (the current color lit); picking a color applies it and the bar stays; clicking elsewhere or Esc closes it; with a multi-place note only the clicked place changes", async ({
  app,
}) => {
  moreNotes(app);
  twoPlaces(app);
  await app.open();
  await badge(app, "pt0001").click();
  await expect(colorBar(app)).toBeVisible();
  await expect(app.page.getByRole("radiogroup", { name: "标记颜色" })).toBeVisible();
  await expect(badge(app, "pt0001")).toHaveClass(/is-picked/);
  await expect(barSwatch(app, "橙色（默认）")).toHaveAttribute("aria-checked", "true");
  await expect(barSwatch(app, "蓝色")).toHaveAttribute("data-tip", "蓝色　5");
  // Next to the number: directly above it (when there is room), horizontally centered on it
  const [bar, pin] = [(await colorBar(app).boundingBox())!, (await badge(app, "pt0001").boundingBox())!];
  expect(bar.y + bar.height).toBeLessThanOrEqual(pin.y);
  expect(Math.abs(bar.x + bar.width / 2 - (pin.x + pin.width / 2))).toBeLessThan(2);

  await barSwatch(app, "蓝色").click();
  await expect.poll(() => bg(badge(app, "pt0001"))).toBe(BLUE);
  await expect.poll(() => colorOf(app, "pt0001")).toBe("#5b8cff");
  await expect(colorBar(app)).toBeVisible();
  await expect(barSwatch(app, "蓝色")).toHaveAttribute("aria-checked", "true");
  // Number keys change it too; picking the default drops color
  await app.page.keyboard.press("1");
  await expect.poll(() => colorOf(app, "pt0001")).toBeUndefined();
  await app.page.keyboard.press("Escape");
  await expect(colorBar(app)).toHaveCount(0);
  await expect(badge(app, "pt0001")).not.toHaveClass(/is-picked/);

  // Multi-place note: only the clicked place changes; screen readers announce "这处标记的颜色" (the mark color of this place)
  await placeBadge(app, "mp0001", 1).click();
  await expect(app.page.getByRole("radiogroup", { name: "这处标记的颜色" })).toBeVisible();
  await barSwatch(app, "黄色").click();
  await expect.poll(() => places(app, "mp0001").anchor.shapes!.map((s) => s.color)).toEqual(["#ff6a3d", "#ffc233"]);
  // Clicking elsewhere (the notes panel) closes it
  await card(app, "k3f9a2").click();
  await expect(colorBar(app)).toHaveCount(0);

  // The frame's stroke can be clicked too (not just the number; click a quarter of the way along the top edge to avoid the handles): a frame at the top edge has no room above, so the bar opens below the number
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Escape");
  await expect(card(app, "k3f9a2")).not.toHaveClass(/is-selected/);
  const line = (await rectLine(app, "k3f9a2").boundingBox())!;
  await app.page.mouse.click(line.x + line.width * 0.25, line.y + 1);
  await expect(colorBar(app)).toBeVisible();
  await expect(badge(app, "k3f9a2")).toHaveClass(/is-picked/);
  const [bar2, num] = [(await colorBar(app).boundingBox())!, (await badge(app, "k3f9a2").boundingBox())!];
  const stage = (await app.page.locator(".zoom-view").boundingBox())!;
  expect(bar2.y).toBeGreaterThanOrEqual(stage.y);
  expect(bar2.y >= num.y + num.height || bar2.y + bar2.height <= num.y).toBe(true);
  // Dragging a mark to move it does not open the bar
  await app.page.keyboard.press("Escape");
  const p = (await badge(app, "pt0001").boundingBox())!;
  await app.page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(p.x + p.width / 2 + 30, p.y + p.height / 2 + 10, { steps: 4 });
  await app.page.mouse.up();
  await expect(colorBar(app)).toHaveCount(0);
});

test("with a drawing tool, clicking an existing mark picks it for recoloring without dropping a new pin or opening the composer; dragging away draws as usual", async ({ app }) => {
  moreNotes(app);
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const pin = (await badge(app, "pt0001").boundingBox())!;
  // Over a mark the cursor is a pointer (a click recolors it); moving away restores the drawing cursor
  await app.page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await expect(app.page.locator(".annot-input")).toHaveClass(/is-over-mark/);
  await expect.poll(() => app.page.locator(".annot-input").evaluate((e) => getComputedStyle(e).cursor)).toBe("pointer");
  await app.page.mouse.move(pin.x + pin.width / 2 + 80, pin.y + 60);
  await expect(app.page.locator(".annot-input")).not.toHaveClass(/is-over-mark/);
  await app.page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await expect(colorBar(app)).toBeVisible();
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect(app.page.locator(".annot-badge.is-draft")).toHaveCount(0);
  await barSwatch(app, "绿色").click();
  await expect.poll(() => colorOf(app, "pt0001")).toBe("#3ddc84");

  // Rectangle tool: dragging away from the pin draws a frame (opens the composer as usual)
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("r");
  await app.page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(pin.x + 120, pin.y + 80, { steps: 5 });
  await app.page.mouse.up();
  await expect(app.page.locator(".composer")).toBeVisible();
  await expect(colorBar(app)).toHaveCount(0);
});

test("with the composer open, clicking the places being drawn opens the color bar and the composer stays; Esc closes only the bar; it works with the Select tool too; every place records a color once saved", async ({
  app,
}) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await app.media();
  // The second pin goes above the first: the note box's top edge sits on the first pin's row, and a click there lands on the box (a pixel or two off while it opens)
  for (const [x, y] of [
    [0.3, 0.6],
    [0.7, 0.4],
  ])
    await app.page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  const drafts = app.page.locator(".annot-badge.is-draft");
  await expect(drafts).toHaveCount(2);
  await app.page.locator(".composer-text").fill("左边那处改圆角，右边那处去掉");

  // With the Pin tool, clicking the second place picks it instead of dropping another pin
  const second = (await drafts.nth(1).boundingBox())!;
  await app.page.mouse.click(second.x + second.width / 2, second.y + second.height / 2);
  await expect(app.page.getByRole("radiogroup", { name: "这处标记的颜色" })).toBeVisible();
  await expect(drafts).toHaveCount(2);
  await expect(drafts.nth(1)).toHaveClass(/is-picked/);
  await barSwatch(app, "黄色").click();
  await expect.poll(() => bg(drafts.nth(1))).toBe(YELLOW);
  await expect.poll(() => bg(drafts.nth(0))).toBe(ORANGE);
  // Esc closes the color bar; the note being written stays
  await app.page.keyboard.press("Escape");
  await expect(colorBar(app)).toHaveCount(0);
  await expect(app.page.locator(".composer")).toBeVisible();
  await expect(app.page.locator(".composer-text")).toHaveValue("左边那处改圆角，右边那处去掉");

  // Switch to the Select tool and click the first place: the bar opens all the same (the places being drawn take no mouse events, they are hit-tested by position)
  await app.page.keyboard.press("v");
  const first = (await drafts.nth(0).boundingBox())!;
  await app.page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await expect(app.page.locator(".zoom-view")).toHaveClass(/is-over-mark/);
  await app.page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await expect(colorBar(app)).toBeVisible();
  await expect(drafts.nth(0)).toHaveClass(/is-picked/);
  await barSwatch(app, "绿色").click();
  await expect.poll(() => bg(drafts.nth(0))).toBe(GREEN);
  await expect(app.page.locator(".composer")).toBeVisible();

  // Click back into the text box and keep writing: the color bar closes, and once saved each place records its own color
  await app.page.locator(".composer-text").click();
  await expect(colorBar(app)).toHaveCount(0);
  await app.page.locator(".composer-text").press("Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect.poll(() => heroNotes(app).find((a) => (a as { body?: string }).body === "左边那处改圆角，右边那处去掉")?.id).toBeTruthy();
  const id = heroNotes(app).find((a) => (a as { body?: string }).body === "左边那处改圆角，右边那处去掉")!.id;
  expect(places(app, id).anchor.shapes!.map((s) => s.color)).toEqual(["#3ddc84", "#ffc233"]);
  // The picked state does not linger after saving: writing a new note does not open a color bar for its first place
  await app.page.keyboard.press("c");
  await app.page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
  await expect(app.page.locator(".composer")).toBeVisible();
  await expect(colorBar(app)).toHaveCount(0);
});

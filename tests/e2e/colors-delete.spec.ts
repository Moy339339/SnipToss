// More mark colors and getting rid of marks:
// black and white presets (keys 7, 8; the number on a light color turns dark), the color picker behind the hue disc at the end of every color row,
// the recent custom colors (kept by the shell, shared with Screen Capture), deleting the clicked mark from the color bar,
// a click on blank canvas dropping a new note that has nothing written, and dragging the composer by its title row

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type App } from "./harness";

const HERO_NOTES = "assets__hero.png.json";
type Shape = { type: string; color?: string };
type Note = { id: string; body: string; color?: string; anchor: { shape?: Shape; shapes?: Shape[] } };
const heroNotes = (app: App): Note[] => JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", HERO_NOTES), "utf8")).annotations;
const note = (app: App, id: string) => heroNotes(app).find((a) => a.id === id);
const byBody = (app: App, body: string) => heroNotes(app).find((a) => a.body === body);
const badge = (app: App, id: string, part = 0) => app.page.locator(`.annot-badge[data-id="${id}"][data-part="${part}"]`);
const card = (app: App, id: string) => app.page.locator(`.card[data-annot$="|${id}"]`);
const colorBar = (app: App) => app.page.locator(".mark-colors");
const barSwatch = (app: App, name: string) => colorBar(app).getByRole("radio", { name, exact: true });
const hueDisc = (app: App) => colorBar(app).getByRole("button", { name: "自定义颜色…" });
const picker = (app: App) => app.page.getByRole("dialog", { name: "自定义颜色…" });
const digits = (app: App) => picker(app).getByRole("textbox", { name: "色号" });
const composer = (app: App) => app.page.locator(".composer");
const draftBadges = (app: App) => app.page.locator(".annot-badge.is-draft");
const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) =>
  [box.x + box.width * fx, box.y + box.height * fy] as const;
const bg = (el: ReturnType<typeof badge>) => el.evaluate((e) => getComputedStyle(e).backgroundColor);
/** How light an element's text color is (0–255): drawn on a canvas, so any color syntax the style uses comes out as RGB */
const inkLightness = (el: ReturnType<typeof badge>) =>
  el.evaluate((e) => {
    const g = document.createElement("canvas").getContext("2d")!;
    g.fillStyle = getComputedStyle(e).color;
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    return (r + gr + b) / 3;
  });

/** Waits for the opening animation (it scales and slides the box a little, which would throw off measured positions) */
const settled = (l: Locator) => l.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => {}));

/** A point on the canvas (fractions of it) clear of the composer, for "a click on blank canvas" */
async function blankSpot(app: App, box: { x: number; y: number; width: number; height: number }) {
  const c = await composer(app).boundingBox();
  for (const [fx, fy] of [[0.05, 0.95], [0.95, 0.95], [0.05, 0.05], [0.95, 0.05]] as const) {
    const [x, y] = at(box, fx, fy);
    if (!c || x < c.x - 8 || x > c.x + c.width + 8 || y < c.y - 8 || y > c.y + c.height + 8) return [x, y] as const;
  }
  throw new Error("No blank spot clear of the composer");
}

async function drag(app: App, from: readonly [number, number], to: readonly [number, number]) {
  await app.page.mouse.move(...from);
  await app.page.mouse.down();
  await app.page.mouse.move(...to, { steps: 8 });
  await app.page.mouse.up();
}

/** Turns the rectangle note k3f9a2 of hero.png into a note with two places (the rectangle + a pin) */
function twoPlaces(app: App) {
  const file = join(app.project, ".sniptoss", "annotations", HERO_NOTES);
  const json = JSON.parse(readFileSync(file, "utf8"));
  const a = json.annotations[0];
  a.anchor = { shapes: [a.anchor.shape ?? a.anchor.shapes[0], { type: "point", x: 0.7, y: 0.6 }] };
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
});

test("presets 7 and 8 are black and white; the number on a white mark is dark (on the canvas and in the notes panel), on black it stays white", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").click();
  await app.page.keyboard.press("8");
  await expect.poll(() => note(app, "k3f9a2")?.color).toBe("#ffffff");
  await expect.poll(() => bg(badge(app, "k3f9a2"))).toBe("rgb(255, 255, 255)");
  expect(await inkLightness(badge(app, "k3f9a2"))).toBeLessThan(80);
  expect(await inkLightness(card(app, "k3f9a2").locator(".card-num"))).toBeLessThan(80);
  await app.page.keyboard.press("7");
  await expect.poll(() => note(app, "k3f9a2")?.color).toBe("#000000");
  await expect.poll(() => bg(badge(app, "k3f9a2"))).toBe("rgb(0, 0, 0)");
  expect(await inkLightness(badge(app, "k3f9a2"))).toBeGreaterThan(240);
  // The swatches name them and give their keys
  await badge(app, "k3f9a2").click({ button: "right" });
  await expect(app.page.getByRole("menuitemradio", { name: "黑色", exact: true })).toHaveAttribute("data-tip", "黑色　7");
  await expect(app.page.getByRole("menuitemradio", { name: "白色", exact: true })).toHaveAttribute("data-tip", "白色　8");
});

test("the hue disc on the color bar opens the color picker on the mark's color; Esc closes only the picker; typed digits + Enter recolor the mark and become a recent color, offered in every color row", async ({
  app,
}) => {
  await app.open();
  await badge(app, "k3f9a2").click();
  await expect(colorBar(app)).toBeVisible();
  await hueDisc(app).click();
  await expect(picker(app)).toBeVisible();
  await settled(picker(app));
  await expect(digits(app)).toBeFocused();
  await expect(digits(app)).toHaveValue("FF6A3D");
  // Placed next to what opened it, inside the window
  const [p, disc] = [(await picker(app).boundingBox())!, (await hueDisc(app).boundingBox())!];
  expect(p.y + p.height <= disc.y || p.y >= disc.y + disc.height, JSON.stringify({ p, disc })).toBe(true);
  await app.page.keyboard.press("Escape");
  await expect(picker(app)).toHaveCount(0);
  await expect(colorBar(app)).toBeVisible();
  expect(note(app, "k3f9a2")?.color).toBeUndefined();

  await hueDisc(app).click();
  await digits(app).fill("#17a998");
  await app.page.keyboard.press("Enter");
  await expect(picker(app)).toHaveCount(0);
  await expect.poll(() => note(app, "k3f9a2")?.color).toBe("#17a998");
  expect(app.host.recentColors).toEqual(["#17a998"]);
  await expect.poll(() => bg(badge(app, "k3f9a2"))).toBe("rgb(23, 169, 152)");
  // The bar shows it among the recent colors, lit
  await expect(barSwatch(app, "#17a998（最近使用）")).toHaveAttribute("aria-checked", "true");

  // The right-click menu has it too (and its own hue disc); a color picked there from the picker applies the same way
  await app.page.keyboard.press("Escape");
  await badge(app, "k3f9a2").click({ button: "right" });
  await expect(app.page.getByRole("menuitemradio", { name: "#17a998（最近使用）", exact: true })).toHaveAttribute("aria-checked", "true");
  await app.page.getByRole("menuitem", { name: "自定义颜色…" }).click();
  await expect(app.page.locator(".menu")).toHaveCount(0);
  await expect(picker(app)).toBeVisible();
  await digits(app).fill("8B5A2B");
  await picker(app).getByRole("button", { name: "确定" }).click();
  await expect.poll(() => note(app, "k3f9a2")?.color).toBe("#8b5a2b");
  expect(app.host.recentColors).toEqual(["#8b5a2b", "#17a998"]);
});

test("a color picked on the capture overlay (the shell adds it to the recent colors) shows up in the open UI's color rows at once; at most 4 are kept, newest first", async ({ app }) => {
  app.host.recentColors = ["#111111"];
  await app.open();
  await badge(app, "k3f9a2").click();
  await expect(barSwatch(app, "#111111（最近使用）")).toBeVisible();
  for (const c of ["#222222", "#333333", "#444444", "#555555"]) app.host.addRecentColor(c);
  await expect(colorBar(app).locator(".menu-swatch:not(.is-custom)")).toHaveCount(8 + 4);
  await expect(barSwatch(app, "#555555（最近使用）")).toBeVisible();
  await expect(barSwatch(app, "#111111（最近使用）")).toHaveCount(0);
});

test("the color picker: dragging in the field and along the hue strip changes the color as it goes, arrow keys nudge it, OK uses it; in Settings it sets the default mark color", async ({
  app,
}) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^批注$/ }).click();
  await app.page.getByRole("button", { name: "自定义颜色…" }).click();
  await expect(picker(app)).toBeVisible();
  await settled(picker(app));
  const field = (await picker(app).getByRole("slider", { name: "饱和度和亮度" }).boundingBox())!;
  // The top-right corner of the field is the pure hue (orange's hue, fully saturated, full brightness)
  await drag(app, at(field, 0.5, 0.5), at(field, 1, 0));
  await expect(digits(app)).toHaveValue(/^FF[0-9A-F]{2}00$/);
  // Along the hue strip: the middle is cyan
  const strip = (await picker(app).getByRole("slider", { name: "色相" }).boundingBox())!;
  await drag(app, at(strip, 0.1, 0.5), at(strip, 0.5, 0.5));
  await expect(digits(app)).toHaveValue("00FFFF");
  // The hue strip has the keyboard after the drag: ← moves the hue a little
  await app.page.keyboard.press("ArrowLeft");
  await expect(digits(app)).not.toHaveValue("00FFFF");
  await digits(app).fill("3355AA");
  await picker(app).getByRole("button", { name: "确定" }).click();
  await expect(picker(app)).toHaveCount(0);
  // Settings stays open (Esc in the picker was not needed), and the mark color is the custom one
  await expect(app.page.locator(".settings")).toBeVisible();
  await expect.poll(() => app.host.prefs?.markColor).toBe("#3355aa");
  await expect.poll(() => bg(badge(app, "k3f9a2"))).toBe("rgb(51, 85, 170)");
  // Esc with the picker open closes the picker, not Settings
  await app.page.getByRole("button", { name: "自定义颜色…" }).click();
  await expect(picker(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(picker(app)).toHaveCount(0);
  await expect(app.page.locator(".settings")).toBeVisible();
});

test("Delete on the color bar: one of several places goes alone (no question, undoable); a note's only place deletes the note after asking; the Delete key does the same", async ({ app }) => {
  twoPlaces(app);
  await app.open();
  await badge(app, "k3f9a2", 1).click();
  await expect(colorBar(app)).toBeVisible();
  const remove = colorBar(app).getByRole("button", { name: "删除这处标记" });
  await expect(remove).toHaveAttribute("data-tip", "删除这处标记　Delete");
  await remove.click();
  await expect(colorBar(app)).toHaveCount(0);
  await expect.poll(() => note(app, "k3f9a2")?.anchor.shapes?.length).toBe(1);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => note(app, "k3f9a2")?.anchor.shapes?.length).toBe(2);
  // A place taken away is an edit of the note, not a move
  await expect(app.page.locator(".toast")).toContainText("已撤销：编辑批注");

  // The Delete key while the bar is open
  await badge(app, "k3f9a2", 1).click();
  await expect(colorBar(app)).toBeVisible();
  await app.page.keyboard.press("Delete");
  await expect.poll(() => note(app, "k3f9a2")?.anchor.shapes?.length).toBe(1);

  // Now it is the only place: Delete removes the whole note, after confirming
  await badge(app, "k3f9a2").click();
  await colorBar(app).getByRole("button", { name: "删除这条批注" }).click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
  await expect.poll(() => note(app, "k3f9a2")).toBeUndefined();
  await expect(badge(app, "k3f9a2")).toHaveCount(0);
});

test("a click on a handle of the selected mark (no drag) also pops up its color bar, as a click on its edge does", async ({ app }) => {
  await app.open();
  await badge(app, "k3f9a2").click(); // selected: the handles show
  await expect(colorBar(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(colorBar(app)).toHaveCount(0);
  const handle = app.page.locator(".annot-handle.handle-n").first();
  await expect(handle).toBeVisible();
  await handle.click();
  await expect(colorBar(app)).toBeVisible();
  // While the bar is open, a click on a handle keeps it (it used to close it)
  await handle.click();
  await expect(colorBar(app)).toBeVisible();
});

test("while writing a note: Delete on the bar of one of its places removes that place and the composer stays; for its only place it drops the new note", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await app.media();
  await app.page.mouse.click(...at(box, 0.3, 0.6));
  await app.page.mouse.click(...at(box, 0.7, 0.4));
  await expect(draftBadges(app)).toHaveCount(2);
  const second = (await draftBadges(app).nth(1).boundingBox())!;
  await app.page.mouse.click(second.x + second.width / 2, second.y + second.height / 2);
  await colorBar(app).getByRole("button", { name: "删除这处标记" }).click();
  await expect(draftBadges(app)).toHaveCount(1);
  await expect(composer(app)).toBeVisible();
  const first = (await draftBadges(app).boundingBox())!;
  await app.page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await colorBar(app).getByRole("button", { name: "删除这条批注" }).click();
  await expect(composer(app)).toHaveCount(0);
  await expect(draftBadges(app)).toHaveCount(0);
});

test("a click on blank canvas while a new note's composer is still empty drops the note with its mark (Select and drawing tools alike); with text written the composer stays", async ({
  app,
}) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = await app.media();
  await drag(app, at(box, 0.1, 0.5), at(box, 0.3, 0.75));
  await expect(composer(app)).toBeVisible();
  await expect(draftBadges(app)).toHaveCount(1);
  // A click (no drag) with the Rectangle tool on blank canvas
  await app.page.mouse.click(...(await blankSpot(app, box)));
  await expect(composer(app)).toHaveCount(0);
  await expect(draftBadges(app)).toHaveCount(0);

  // The same with the Select tool (the rectangle is dragged out on blank space)
  await app.page.keyboard.press("v");
  await drag(app, at(box, 0.1, 0.5), at(box, 0.3, 0.75));
  await expect(composer(app)).toBeVisible();
  await app.page.mouse.click(...(await blankSpot(app, box)));
  await expect(composer(app)).toHaveCount(0);

  // With text written a stray click loses nothing
  await drag(app, at(box, 0.1, 0.5), at(box, 0.3, 0.75));
  await app.page.locator(".composer-text").fill("这里改圆角");
  await app.page.mouse.click(...(await blankSpot(app, box)));
  await expect(composer(app)).toBeVisible();
  await expect(app.page.locator(".composer-text")).toHaveValue("这里改圆角");
  // The click took focus out of the input box and the composer gives it back: a plain Enter saves, as the hint under it says
  // (page.keyboard, not locator.press, which would focus the box itself first)
  await expect(app.page.locator(".composer-text")).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect.poll(() => !!byBody(app, "这里改圆角")).toBe(true);
});

for (const scale of [1, 1.25]) {
  test(`the composer can be dragged by its title row and stays there while more places are marked (interface size ${scale * 100}%)`, async ({ app }) => {
    app.host.prefs = { panelScope: "material", ...(scale === 1 ? {} : { uiScale: scale }) };
    await app.open();
    await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
    await app.page.keyboard.press("c");
    const box = await app.media();
    await app.page.mouse.click(...at(box, 0.15, 0.3));
    await expect(composer(app)).toBeVisible();
    await expect(app.page.locator(".composer-grip")).toHaveAttribute("data-tip", "拖动可移动");
    await settled(composer(app));
    const before = (await composer(app).boundingBox())!;
    const title = (await app.page.locator(".composer-title").boundingBox())!;
    const from = [title.x + 40, title.y + title.height / 2] as const;
    await drag(app, from, [from[0] - 60, from[1] + 90]);
    const after = (await composer(app).boundingBox())!;
    // The box follows the pointer (screen pixels, whatever the interface size)
    expect(Math.abs(after.x - (before.x - 60))).toBeLessThan(3);
    expect(Math.abs(after.y - (before.y + 90))).toBeLessThan(3);
    await expect(app.page.locator(".composer-text")).toBeFocused();
    // Another place (top right, clear of the box that was dragged down-left): the box stays where it was put
    await app.page.mouse.click(...at(box, 0.85, 0.15));
    await expect(draftBadges(app)).toHaveCount(2);
    const still = (await composer(app).boundingBox())!;
    expect(Math.abs(still.x - after.x)).toBeLessThan(1);
    expect(Math.abs(still.y - after.y)).toBeLessThan(1);
    // Dragged far off: it stays inside the canvas area
    const t2 = (await app.page.locator(".composer-title").boundingBox())!;
    await drag(app, [t2.x + 40, t2.y + t2.height / 2], [t2.x + 4000, t2.y + 4000]);
    const stage = (await app.page.locator(".stage").boundingBox())!;
    const clamped = (await composer(app).boundingBox())!;
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(stage.y + stage.height);
  });
}

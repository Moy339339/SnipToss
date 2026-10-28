// One note marking several places (docs/adr/0009-several-places.md): when many places need the same change, the same sentence doesn't have to be written several times.
// With the note box open, keep drawing outside the box (any mark tool works); everything counts as this one note with the same number; undo the last place, right-click to remove one place; each saved place can be moved on its own; handed over as "N places: …"

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";

const HERO = "assets__hero.png.json";
const LOCALES = join(ROOT, "i18n", "locales");

type Shape = { type: string; x?: number; y?: number; w?: number; h?: number };
type Note = { id: string; body: string; anchor: { shapes?: Shape[]; shape?: Shape } };
const fileOf = (app: App) => JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", HERO), "utf8"));
const notes = (app: App): Note[] => fileOf(app).annotations;
const byBody = (app: App, body: string) => notes(app).find((a) => a.body === body);

const composer = (app: App) => app.page.locator(".composer");
const draftBadges = (app: App) => app.page.locator(".annot-badge.is-draft");
const media = (app: App) => app.media();
const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) =>
  [box.x + box.width * fx, box.y + box.height * fy] as const;
const toolBtn = (app: App, name: string) => app.page.locator(`.hdr-tools .tool-btn[aria-label="${name}"]`);
const menuRow = (app: App, label: string) =>
  app.page.locator(".menu .menu-item", { has: app.page.locator(".menu-label", { hasText: label }) });
async function drag(app: App, from: readonly [number, number], to: readonly [number, number]) {
  await app.page.mouse.move(...from);
  await app.page.mouse.down();
  await app.page.mouse.move(...to, { steps: 8 });
  await app.page.mouse.up();
}
async function save(app: App, body: string) {
  await app.page.locator(".composer-text").fill(body);
  await app.page.locator(".composer-text").press("Enter");
  await expect(composer(app)).toHaveCount(0);
  await expect.poll(() => !!byBody(app, body)).toBe(true);
  return byBody(app, body)!;
}
/** The number of the saved note at its part-th place on the canvas */
const badge = (app: App, id: string, part: number) => app.page.locator(`.annot-badge[data-id="${id}"][data-part="${part}"]`);

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("clicking three pins in a row: with the note box open, further clicks outside the box all share one number, the box doesn't move and focus returns to the input; it saves as one note, draws all three places and the notes panel says 3 marks", async ({
  app,
}) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.2, 0.5));
  await expect(composer(app)).toBeVisible();
  // The pin used to be invisible while the note box was open (a draft has no number of its own, and the pin is the number)
  await expect(draftBadges(app)).toHaveText(["2"]);
  // Clicking the same spot again (a quick double-tap): it doesn't stack another pin
  await app.page.mouse.click(...at(box, 0.2, 0.5));
  await expect(draftBadges(app)).toHaveCount(1);
  await expect(app.page.locator(".composer-text")).toHaveAttribute("placeholder", "输入批注内容（可继续标记更多位置）");
  // This hint fits on one line in every language (it used to wrap onto two lines)
  const hints = readdirSync(LOCALES).map(
    (f) => (JSON.parse(readFileSync(join(LOCALES, f), "utf8")) as Record<string, string>)["composer.placeholderMarks"],
  );
  const overflow = await app.page.locator(".composer-text").evaluate((el: HTMLTextAreaElement, all: string[]) => {
    const css = getComputedStyle(el);
    const room = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = css.font;
    return all.filter((s) => ctx.measureText(s).width > room);
  }, hints);
  expect(overflow).toEqual([]);
  await expect(app.page.locator(".composer-places")).toHaveCount(0);
  // Where the note box is placed (its top-left corner; the outer frame scales with the opening animation, so it isn't compared)
  const placed = () => composer(app).evaluate((el: HTMLElement) => [el.style.left, el.style.top, el.offsetWidth, el.offsetHeight]);
  const where = await placed();

  await app.page.locator(".composer-text").fill("这三个按钮都改成圆角");
  // The next clicks go above the first place: the box's top edge sits exactly at the row of the first place (a pixel or two off before and after the opening animation finishes), and clicking the same row occasionally hits the box
  await app.page.mouse.click(...at(box, 0.5, 0.35));
  await app.page.mouse.click(...at(box, 0.8, 0.35));
  await expect(draftBadges(app)).toHaveText(["2", "2", "2"]);
  await expect(app.page.locator(".composer-places")).toContainText("3 处");
  expect(await placed()).toEqual(where);
  await expect(app.page.locator(".composer-text")).toBeFocused();
  await expect(app.page.locator(".composer-text")).toHaveValue("这三个按钮都改成圆角");

  await app.page.locator(".composer-text").press("Enter");
  await expect(composer(app)).toHaveCount(0);
  await expect.poll(() => byBody(app, "这三个按钮都改成圆角")?.anchor.shapes?.length).toBe(3);
  const a = byBody(app, "这三个按钮都改成圆角")!;
  expect(a.anchor.shapes!.map((s) => [s.type, Math.round(s.x! * 10) / 10])).toEqual([
    ["point", 0.2],
    ["point", 0.5],
    ["point", 0.8],
  ]);
  expect(fileOf(app).schema).toBe("sniptoss/5");
  await expect(app.page.locator(`.annot-badge[data-id="${a.id}"]`)).toHaveText(["2", "2", "2"]);
  await expect(app.page.locator(`[data-annot$="|${a.id}"] .tag`)).toHaveText("3 处");
  await expect(app.page.locator(`[data-annot$="|k3f9a2"] .tag`)).toHaveCount(0);
});

test("tools can be mixed: rectangles, arrows (switched from the toolbar) and rectangles dragged on blank space with the Select tool are all added to this note; Alt+Z undoes the last place and does nothing when only one is left", async ({
  app,
}) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = await media(app);
  await drag(app, at(box, 0.1, 0.5), at(box, 0.25, 0.7));
  await expect(composer(app)).toBeVisible();
  // Tools work as usual while the note box is open (they used to be forced to Select), and switching from the toolbar works too
  await expect(app.page.locator(".annot-layer")).toHaveClass(/tool-rect/);
  // Both go above the first place: the note box's top edge sits on that row, and a stroke started there lands on the box (a pixel or two off while it opens)
  await toolBtn(app, "箭头").click();
  await drag(app, at(box, 0.6, 0.25), at(box, 0.7, 0.4));
  await toolBtn(app, "选择").click();
  await drag(app, at(box, 0.75, 0.22), at(box, 0.9, 0.4));
  await expect(draftBadges(app)).toHaveCount(3);
  await expect(app.page.locator(".composer-places")).toContainText("3 处");

  await app.page.keyboard.press("Alt+z");
  await expect(draftBadges(app)).toHaveCount(2);
  await app.page.locator(".composer-undo-place").click();
  await expect(draftBadges(app)).toHaveCount(1);
  await expect(app.page.locator(".composer-places")).toHaveCount(0);
  await app.page.keyboard.press("Alt+z");
  await expect(draftBadges(app)).toHaveCount(1);
  // Dragging another one with the Select tool: it is added all the same
  await drag(app, at(box, 0.6, 0.1), at(box, 0.8, 0.3));
  const a = await save(app, "框和箭头");
  expect(a.anchor.shapes!.map((s) => s.type)).toEqual(["rect", "rect"]);
  expect(a.anchor.shapes![0].x!).toBeCloseTo(0.1, 2);
  expect(a.anchor.shapes![1].x!).toBeCloseTo(0.6, 2);
});

test("right-clicking one place of the note being written: Remove This Mark removes only that place; with one place left there is only Discard This Note (same as Esc)", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await media(app);
  for (const x of [0.2, 0.5, 0.8]) await app.page.mouse.click(...at(box, x, 0.6));
  await expect(draftBadges(app)).toHaveCount(3);
  // Right-click the pin of the middle place
  const pin = (await draftBadges(app).nth(1).boundingBox())!;
  await app.page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2, { button: "right" });
  await expect(menuRow(app, "移除这处标记")).toHaveAttribute("title", "只去掉这一处，批注和其余几处保留");
  await menuRow(app, "移除这处标记").click();
  await expect(draftBadges(app)).toHaveCount(2);
  const a = await save(app, "两边的");
  expect(a.anchor.shapes!.map((s) => Math.round(s.x! * 10) / 10)).toEqual([0.2, 0.8]);

  // Only one place left: there is no Remove This Mark, and Discard This Note throws the whole note away
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  await app.page.mouse.click(...at(box, 0.5, 0.3));
  const one = (await draftBadges(app).boundingBox())!;
  await app.page.mouse.click(one.x + one.width / 2, one.y + one.height / 2, { button: "right" });
  await expect(menuRow(app, "移除这处标记")).toHaveCount(0);
  await menuRow(app, "放弃这条批注").click();
  await expect(composer(app)).toHaveCount(0);
  await expect(draftBadges(app)).toHaveCount(0);
});

test("a saved multi-place note: dragging one place moves only that place; right-clicking a place and choosing Remove This Mark removes it (Ctrl+Z restores it); with one place left the menu has no such entry", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = await media(app);
  await drag(app, at(box, 0.1, 0.5), at(box, 0.25, 0.7));
  await drag(app, at(box, 0.6, 0.5), at(box, 0.75, 0.7));
  const a = await save(app, "两个框");
  const [first, second] = a.anchor.shapes!;
  await app.page.keyboard.press("v");

  // Click the second place to select it, then drag it: only it moves
  const b1 = (await badge(app, a.id, 1).boundingBox())!;
  await app.page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await expect(app.page.locator(".annot-handle")).toHaveCount(16); // 8 handles for each of the two rectangles
  await drag(app, [b1.x + b1.width / 2, b1.y + b1.height / 2], [b1.x + b1.width / 2 + 64, b1.y + b1.height / 2]);
  await expect.poll(() => byBody(app, "两个框")!.anchor.shapes![1].x).toBeGreaterThan(second.x! + 0.05);
  expect(byBody(app, "两个框")!.anchor.shapes![0]).toEqual(first);
  // Arrow keys move the picked place too
  await app.page.keyboard.press("ArrowDown");
  await expect.poll(() => Math.round((byBody(app, "两个框")!.anchor.shapes![1].y! - second.y!) * 360)).toBe(1);
  expect(byBody(app, "两个框")!.anchor.shapes![0]).toEqual(first);

  // Right-click the first place: only it is removed
  const b0 = (await badge(app, a.id, 0).boundingBox())!;
  await app.page.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2, { button: "right" });
  await menuRow(app, "移除这处标记").click();
  await expect.poll(() => byBody(app, "两个框")!.anchor.shapes!.length).toBe(1);
  await expect(app.page.locator(`.annot-badge[data-id="${a.id}"]`)).toHaveCount(1);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => byBody(app, "两个框")!.anchor.shapes!.length).toBe(2);
  await expect.poll(() => byBody(app, "两个框")!.anchor.shapes![0]).toEqual(first);

  // A note with a single place (k3f9a2, read in from the old pizhu/3 format): no such entry, and Delete Note is still there
  const k = (await badge(app, "k3f9a2", 0).boundingBox())!;
  await app.page.mouse.click(k.x + k.width / 2, k.y + k.height / 2, { button: "right" });
  await expect(menuRow(app, "删除批注")).toHaveCount(1);
  await expect(menuRow(app, "移除这处标记")).toHaveCount(0);
});

test("double-clicking to edit an existing note (read in from an old format): further marks are added to it and keep its own number; it is saved back as shapes without a leftover shape", async ({ app }) => {
  await app.open();
  const k = (await badge(app, "k3f9a2", 0).boundingBox())!;
  await app.page.mouse.dblclick(k.x + k.width / 2, k.y + k.height / 2);
  await expect(composer(app)).toBeVisible();
  await toolBtn(app, "图钉").click();
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.5, 0.7));
  await expect(draftBadges(app)).toHaveText(["1", "1"]);
  await app.page.locator(".composer-text").press("Enter");
  await expect(composer(app)).toHaveCount(0);
  await expect.poll(() => notes(app).find((x) => x.id === "k3f9a2")!.anchor.shapes?.length).toBe(2);
  const k3 = notes(app).find((x) => x.id === "k3f9a2")!;
  expect(k3.anchor.shape).toBeUndefined();
  expect(k3.anchor.shapes!.map((s) => s.type)).toEqual(["rect", "point"]);
  expect(fileOf(app).schema).toBe("sniptoss/5");
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveText(["1", "1"]);
});

test("Copy as Text writes \"3 places: …; …; …\" and opens by saying the comment applies to every place (ADR-0009)", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await media(app);
  for (const x of [0.2, 0.5, 0.8]) await app.page.mouse.click(...at(box, x, 0.5));
  const a = await save(app, "三处都换成品牌蓝");
  await app.page.locator(`[data-annot$="|${a.id}"]`).click({ button: "right" });
  await menuRow(app, "复制批注成文字").click();
  await expect.poll(() => app.clipboard()).toContain("三处都换成品牌蓝");
  const text = (await app.clipboard())!;
  expect(text).toContain("标了几处的批注，意见对每一处都适用。");
  expect(text).toMatch(
    /\d\. 修改 · 3 处：位置 画面左侧居中（横 20%、纵 50%），x=\d+ y=\d+ px；位置 画面中央（横 50%、纵 50%），x=\d+ y=\d+ px；位置 画面右侧居中（横 80%、纵 50%），x=\d+ y=\d+ px\n三处都换成品牌蓝/,
  );
});

test("an overall comment has no marks: nothing can be drawn on the canvas while its note box is open (so it can't quietly turn into a note pinned somewhere)", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  await app.page.keyboard.press("n");
  await expect(composer(app)).toBeVisible();
  await expect(app.page.locator(".annot-layer")).toHaveClass(/tool-select/);
  const box = await media(app);
  await drag(app, at(box, 0.1, 0.5), at(box, 0.3, 0.7));
  await expect(draftBadges(app)).toHaveCount(0);
  await expect(app.page.locator(".annot-shape.is-draft")).toHaveCount(0);
});

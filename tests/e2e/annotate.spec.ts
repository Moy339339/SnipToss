// Drawing notes:
// first half = drawing tools (Pin, Rectangle, Pen, Arrow, starting outside the frame, middle-button pan, Hand),
// the composer (category, Save / Cancel, position, Enter on a button), video time

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO = "assets__hero.png.json";
const CLIP = "video__clip.mp4.json";

type Shape = {
  type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  points?: number[][];
  breaks?: number[];
  from?: number[];
  to?: number[];
};
type Note = { id: string; body: string; category: string; anchor: { shapes?: Shape[]; shape?: Shape; time?: { start: number; end?: number } } };
/** All notes in a notes file (with their anchor) */
const notes = (app: App, file: string): Note[] =>
  JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", file), "utf8")).annotations;
const byBody = (app: App, file: string, body: string) => notes(app, file).find((a) => a.body === body);
/**
 * Position of the box note (k3f9a2) in the test material: until the app rewrites the file it is in the old format (pizhu/3 `shape`);
 * afterwards it is the first of `shapes`
 */
const k3 = (app: App) => {
  const a = notes(app, HERO).find((x) => x.id === "k3f9a2")!.anchor;
  return (a.shapes?.[0] ?? a.shape)!;
};

const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const composer = (app: App) => app.page.locator(".composer");
/** Where the canvas content (the material itself) is on screen */
const media = async (app: App) => (await app.page.locator(".zoom-media").boundingBox())!;
/** A relative position on the content → screen coordinates */
const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) =>
  [box.x + box.width * fx, box.y + box.height * fy] as const;
async function drag(app: App, from: readonly [number, number], to: readonly [number, number], steps = 8) {
  await app.page.mouse.move(...from);
  await app.page.mouse.down();
  await app.page.mouse.move(...to, { steps });
  await app.page.mouse.up();
}
/** Types the body, saves with Enter and waits for it to reach disk */
async function save(app: App, body: string, file = HERO) {
  await app.page.locator(".composer-text").fill(body);
  await app.page.locator(".composer-text").press("Enter");
  await expect(composer(app)).toHaveCount(0);
  await expect.poll(() => !!byBody(app, file, body)).toBe(true);
  return byBody(app, file, body)!;
}
/** How far a normalized coordinate is from a whole pixel once multiplied back to pixels */
const offGrid = (v: number, size: number) => Math.abs(v * size - Math.round(v * size));

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("Pin (C): a click drops a pin snapped to a whole pixel and opens the composer; a click outside the frame drops nothing", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("c");
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.37, 0.41));
  await expect(composer(app)).toBeVisible();
  const pin = await save(app, "这里加个角标");
  expect(pin.anchor.shapes?.[0]?.type).toBe("point");
  expect(offGrid(pin.anchor.shapes![0].x!, 640)).toBeLessThan(0.05);
  expect(offGrid(pin.anchor.shapes![0].y!, 360)).toBeLessThan(0.05);
  await expect(app.page.locator(`.annot-badge.is-pin[data-id="${pin.id}"]`)).toBeVisible();
  // Click outside the frame (in the blank margin of the canvas area): no point, no composer
  const input = (await app.page.locator(".annot-input").boundingBox())!;
  expect(box.y - input.y).toBeGreaterThan(6);
  await app.page.mouse.click(box.x + box.width / 2, box.y - 4);
  await app.page.waitForTimeout(150);
  await expect(composer(app)).toHaveCount(0);
});

test("When a new note is slow to write and another card is clicked before it finishes, the selection does not jump back to the new note and Delete asks about the clicked one", async ({ app }) => {
  await app.open();
  app.host.delays.writeAnnotation = 1500;
  await focusStage(app);
  await app.page.keyboard.press("c");
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.8, 0.75));
  await app.page.locator(".composer-text").fill("慢慢存的这条");
  await app.page.locator(".composer-text").press("Enter");
  await expect(composer(app)).toHaveCount(0);
  // The new note is selected as soon as it is submitted (without waiting for the write)
  await expect(app.page.locator(".card.is-selected")).toContainText("慢慢存的这条", { timeout: 500 });
  // The write is not finished; click another note
  const other = app.page.locator('[data-annot$="|k3f9a2"]');
  await other.locator(".card-body").click();
  await expect(other).toHaveClass(/is-selected/);
  await expect.poll(() => !!byBody(app, HERO, "慢慢存的这条"), { timeout: 10_000 }).toBe(true);
  await app.page.waitForTimeout(300);
  await expect(other).toHaveClass(/is-selected/);
  await app.page.keyboard.press("Delete");
  await expect(app.page.getByRole("alertdialog")).toContainText("标题字太细了");
  await app.page.keyboard.press("Escape");
});

test("Rectangle (R): dragging shows a dashed preview and a readout that disappears on release; a too-small drag is dropped as a slip", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = await media(app);
  const readout = app.page.locator(".annot-readout");
  await app.page.mouse.move(...at(box, 0.2, 0.2));
  await app.page.mouse.down();
  await app.page.mouse.move(...at(box, 0.5, 0.6), { steps: 6 });
  await expect(readout).toHaveClass(/is-on/);
  await expect(readout).toContainText("×");
  await app.page.mouse.up();
  await expect(readout).not.toHaveClass(/is-on/);
  const rect = await save(app, "整块换成浅色");
  const s = rect.anchor.shapes![0];
  expect(s.type).toBe("rect");
  for (const [v, size] of [
    [s.x!, 640],
    [s.y!, 360],
    [s.w!, 640],
    [s.h!, 360],
  ] as const)
    expect(offGrid(v, size)).toBeLessThan(0.05);
  // Diagonal under 6 screen pixels: no composer
  await focusStage(app);
  await app.page.keyboard.press("r");
  const [x, y] = at(box, 0.7, 0.7);
  await drag(app, [x, y], [x + 3, y + 3], 2);
  await app.page.waitForTimeout(150);
  await expect(composer(app)).toHaveCount(0);
});

test("The readout flips to the upper left of the pointer near the bottom-right corner of the canvas area so it stays fully visible, and flips back away from the edge", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("r");
  const view = (await app.page.locator(".zoom-view").boundingBox())!;
  const readout = app.page.locator(".annot-readout");
  const inside = async () => {
    const r = (await readout.boundingBox())!;
    return r.x >= view.x && r.y >= view.y && r.x + r.width <= view.x + view.width && r.y + r.height <= view.y + view.height;
  };
  await app.page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await app.page.mouse.down();
  // Drag to the bottom-right corner of the canvas area (drawing continues outside the material and is clipped on release)
  await app.page.mouse.move(view.x + view.width - 6, view.y + view.height - 6, { steps: 6 });
  await expect(readout).toHaveClass(/is-on/);
  await expect(readout).toHaveClass(/flip-x/);
  await expect(readout).toHaveClass(/flip-y/);
  expect(await inside()).toBe(true);
  await app.page.mouse.move(view.x + view.width / 2 + 40, view.y + view.height / 2 + 40, { steps: 4 });
  await expect(readout).not.toHaveClass(/flip-x/);
  await expect(readout).not.toHaveClass(/flip-y/);
  expect(await inside()).toBe(true);
  await app.page.mouse.up();
});

test("Pen (B): a freehand stroke is stored as a series of points with no readout while dragging; a stroke of only one or two points does not count", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("b");
  const box = await media(app);
  const [x, y] = at(box, 0.3, 0.5);
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  for (let i = 1; i <= 10; i++) await app.page.mouse.move(x + i * 8, y + (i % 2) * 6);
  await expect(app.page.locator(".annot-readout")).not.toHaveClass(/is-on/);
  await app.page.mouse.up();
  const pen = await save(app, "这条线描粗");
  expect(pen.anchor.shapes?.[0]?.type).toBe("path");
  expect(pen.anchor.shapes![0].points!.length).toBeGreaterThanOrEqual(3);
  // A press in place (1 pixel of jitter): no composer
  await focusStage(app);
  await app.page.keyboard.press("b");
  await drag(app, at(box, 0.6, 0.6), [at(box, 0.6, 0.6)[0] + 1, at(box, 0.6, 0.6)[1]], 1);
  await app.page.waitForTimeout(150);
  await expect(composer(app)).toHaveCount(0);
});

test("Arrow (A): the readout reports the end point and length, and the start is where the number sits; a too-short arrow is dropped", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("a");
  const box = await media(app);
  const readout = app.page.locator(".annot-readout");
  await app.page.mouse.move(...at(box, 0.3, 0.3));
  await app.page.mouse.down();
  await app.page.mouse.move(...at(box, 0.6, 0.5), { steps: 6 });
  await expect(readout).toContainText("长");
  await app.page.mouse.up();
  const arrow = await save(app, "指向的这个按钮放大");
  const s = arrow.anchor.shapes![0];
  expect(s.type).toBe("arrow");
  expect(offGrid(s.from![0], 640)).toBeLessThan(0.05);
  expect(offGrid(s.to![1], 360)).toBeLessThan(0.05);
  // The number is drawn next to the start (the arrow's tail)
  const badge = (await app.page.locator(`.annot-badge[data-id="${arrow.id}"]`).boundingBox())!;
  const [fx, fy] = at(box, s.from![0], s.from![1]);
  expect(Math.hypot(badge.x + badge.width / 2 - fx, badge.y + badge.height / 2 - fy)).toBeLessThan(40);
  // Under 8 screen pixels: no composer
  await focusStage(app);
  await app.page.keyboard.press("a");
  const [x, y] = at(box, 0.7, 0.7);
  await drag(app, [x, y], [x + 4, y + 3], 2);
  await app.page.waitForTimeout(150);
  await expect(composer(app)).toHaveCount(0);
});

test("Starting a stroke outside the frame keeps only the part inside (a rectangle dragged in from outside has its top-left corner at 0, 0)", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = await media(app);
  await drag(app, [box.x - 4, box.y - 4], at(box, 0.4, 0.4));
  const rect = await save(app, "左上角这块裁掉");
  expect(rect.anchor.shapes![0].x).toBe(0);
  expect(rect.anchor.shapes![0].y).toBe(0);
});

test("Dragging with the middle button under a drawing tool pans the canvas and draws nothing", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Shift+2"); // fill: the content is larger than the canvas area, so it can be dragged
  await app.page.keyboard.press("r");
  const content = app.page.locator(".zoom-content");
  const before = await content.evaluate((el) => getComputedStyle(el).transform);
  const box = await media(app);
  const [x, y] = at(box, 0.5, 0.5);
  await app.page.mouse.move(x, y);
  await app.page.mouse.down({ button: "middle" });
  await app.page.mouse.move(x + 60, y + 40, { steps: 6 });
  await app.page.mouse.up({ button: "middle" });
  await expect.poll(() => content.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
  await expect(composer(app)).toHaveCount(0);
  expect(notes(app, HERO)).toHaveLength(2);
});

test("H: a tap switches to the Hand tool; holding it is a temporary Hand that returns to the previous tool on release; H in a text box just types", async ({ app }) => {
  await app.open();
  const layer = app.page.locator(".annot-layer");
  await focusStage(app);
  await app.page.keyboard.press("r");
  await expect(layer).toHaveClass(/tool-rect/);
  await app.page.keyboard.press("h");
  await expect(layer).toHaveClass(/tool-hand/);
  await app.page.keyboard.press("r");
  await app.page.keyboard.down("h");
  await app.page.waitForTimeout(450);
  await expect(layer).toHaveClass(/tool-hand/);
  await app.page.keyboard.up("h");
  await expect(layer).toHaveClass(/tool-rect/);
  // H while writing a note goes into the text box
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").press("h");
  await expect(app.page.locator(".composer-text")).toHaveValue("h");
});

test("With auto-compose off in Settings, a finished mark leaves a draft card in the notes panel; Enter or a click on the card starts writing and Esc discards it", async ({ app }) => {
  app.host.prefs = { autoCompose: false };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = await media(app);
  await drag(app, at(box, 0.2, 0.2), at(box, 0.4, 0.5));
  await expect(composer(app)).toHaveCount(0);
  const draft = app.page.locator(".card-draft");
  await expect(draft).toContainText("已绘制标记。单击此处或按 Enter 填写批注");
  await app.page.keyboard.press("Enter");
  await expect(composer(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(composer(app)).toHaveCount(0);
  await expect(draft).toHaveCount(0);
  // Draw another one and click the card to write
  await focusStage(app);
  await app.page.keyboard.press("r");
  await drag(app, at(box, 0.5, 0.2), at(box, 0.7, 0.5));
  await draft.click();
  await save(app, "从草稿卡片写的");
  // Drawing again while the draft is still unwritten adds to that same note under the same number (ADR-0009);
  // dragging on blank space with the Select tool does the same
  await focusStage(app);
  await app.page.keyboard.press("r");
  await drag(app, at(box, 0.1, 0.6), at(box, 0.2, 0.7));
  await expect(draft).toHaveCount(1);
  await app.page.keyboard.press("r");
  await drag(app, at(box, 0.3, 0.6), at(box, 0.4, 0.7));
  await app.page.keyboard.press("v");
  await drag(app, at(box, 0.6, 0.6), at(box, 0.8, 0.9));
  await expect(draft).toHaveCount(1);
  await expect(app.page.locator(".annot-badge.is-draft")).toHaveText(["3", "3", "3"]);
  await app.page.keyboard.press("Enter");
  const a = await save(app, "画了三处，记成一条");
  expect(a.anchor.shapes!.map((s) => [s.type, Math.round(s.x! * 10) / 10])).toEqual([
    ["rect", 0.1],
    ["rect", 0.3],
    ["rect", 0.6],
  ]);
  expect(a.anchor.shapes![2].w!).toBeCloseTo(0.2, 2);
});

test("Choosing a drawing tool on a video pauses it (on by default)", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  const paused = () => app.page.evaluate(() => document.querySelector("video")!.paused);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await app.page.keyboard.press("r");
  await expect.poll(paused).toBe(true);
});

test("Choosing a drawing tool on a video does not pause it when the setting is off", async ({ app }) => {
  app.host.prefs = { pauseOnAnnotate: false };
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  const paused = () => app.page.evaluate(() => document.querySelector("video")!.paused);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(paused).toBe(false);
  await app.page.keyboard.press("r");
  await app.page.waitForTimeout(300);
  expect(await paused()).toBe(false);
});

test("The composer sits next to the mark without covering it: right of a mark drawn on the left, left of one drawn on the right", async ({ app }) => {
  await app.open();
  const box = await media(app);
  for (const [from, to, side] of [
    [at(box, 0.05, 0.3), at(box, 0.25, 0.6), "right"],
    [at(box, 0.75, 0.3), at(box, 0.95, 0.6), "left"],
  ] as const) {
    await focusStage(app);
    await app.page.keyboard.press("r");
    await drag(app, from, to);
    const c = (await composer(app).boundingBox())!;
    if (side === "right") expect(c.x).toBeGreaterThanOrEqual(to[0] + 6);
    else expect(c.x + c.width).toBeLessThanOrEqual(from[0] - 6);
    await app.page.keyboard.press("Escape");
  }
});

test("Composer category: Alt+1 to 4 switch it, button tooltips show the shortcut, and it starts from the default category in Settings", async ({ app }) => {
  app.host.prefs = { defaultCategory: "question" };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  const on = app.page.locator(".composer .seg.is-on");
  await expect(on).toHaveText("疑问");
  await app.page.locator(".composer-text").press("Alt+Digit3");
  await expect(on).toHaveText("新增");
  await expect(app.page.locator(".composer .seg", { hasText: "新增" })).toHaveAttribute("title", "新增（Alt 3）");
  await save(app, "这里新增一个按钮");
  expect(byBody(app, HERO, "这里新增一个按钮")!.category).toBe("add");
});

test("Composer: Save is disabled while empty; Cancel and Esc close it and leave nothing behind", async ({ app }) => {
  await app.open();
  const count = notes(app, HERO).length;
  await focusStage(app);
  await app.page.keyboard.press("n");
  await expect(app.page.locator(".composer .btn-primary")).toBeDisabled();
  await app.page.locator(".composer-text").fill("先写着");
  await expect(app.page.locator(".composer .btn-primary")).toBeEnabled();
  await app.page.locator(".composer").getByRole("button", { name: "取消" }).click();
  await expect(composer(app)).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("又写了点");
  await app.page.locator(".composer-text").press("Escape");
  await expect(composer(app)).toHaveCount(0);
  await expect(app.page.getByRole("alertdialog")).toHaveCount(0);
  await app.page.waitForTimeout(200);
  expect(notes(app, HERO)).toHaveLength(count);
});

test("Tabbing to a button in the composer and pressing Enter activates that button (Cancel does not save, Save does)", async ({ app }) => {
  await app.open();
  const count = notes(app, HERO).length;
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("Tab 过去再按 Enter");
  await app.page.keyboard.press("Tab");
  await expect(app.page.locator(".composer").getByRole("button", { name: "取消" })).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect(composer(app)).toHaveCount(0);
  await app.page.waitForTimeout(200);
  expect(notes(app, HERO)).toHaveLength(count);
  // Shift+Tab to a category button and press Enter: switches the category without saving
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("按到类别上");
  for (let i = 0; i < 3; i++) await app.page.keyboard.press("Shift+Tab");
  await expect(app.page.locator(".composer .seg", { hasText: "删除" })).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".composer .seg.is-on")).toHaveText("删除");
  await expect(composer(app)).toBeVisible();
  // Click Add with the mouse, then press Enter: a mouse click does not count as moving focus to the button, so Enter saves
  await app.page.locator(".composer .seg", { hasText: "新增" }).click();
  await app.page.keyboard.press("Enter");
  await expect.poll(() => byBody(app, HERO, "按到类别上")?.category).toBe("add");
});

test("Video note time: clicking the time sets it to the current position; Set as range swaps the order automatically and × turns it back into a single time", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  const seek = (t: number) =>
    app.page.evaluate((seconds) => {
      document.querySelector("video")!.currentTime = seconds;
    }, t);
  await seek(1);
  await focusStage(app);
  await app.page.keyboard.press("c");
  await app.page.mouse.click(...at(await media(app), 0.5, 0.5));
  const chips = app.page.locator(".composer .time-chip");
  await expect(chips).toHaveText(["00:01.000"]);
  // Click "Set as range" without moving the video: the hint asks to seek to the end position first
  await app.page.locator(".composer").getByRole("button", { name: "设为时间段" }).click();
  await expect(app.page.locator(".composer-hint-line")).toContainText("请先将视频定位到时间段的结束位置");
  // Seek to 2 seconds and click the time: the start becomes 2 seconds
  await seek(2);
  await chips.first().click();
  await expect(chips).toHaveText(["00:02.000"]);
  // Seek back to 0.5 seconds and set the end: it is earlier than the start, so the two are swapped automatically
  await seek(0.5);
  await app.page.locator(".composer").getByRole("button", { name: "设为时间段" }).click();
  await expect(chips).toHaveText(["00:00.500", "00:02.000"]);
  await app.page.locator(".composer").getByRole("button", { name: "改回单一时刻" }).click();
  await expect(chips).toHaveText(["00:00.500"]);
  const pin = await save(app, "这一刻的字幕错了", CLIP);
  expect(pin.anchor.time).toEqual({ start: 0.5 });
});

test("Alt+O (Set as range) in an overall comment on the whole video shows its hint", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await focusStage(app);
  await app.page.keyboard.press("n");
  await expect(app.page.locator(".composer .composer-time")).toContainText("整段视频");
  await app.page.locator(".composer-text").press("Alt+o");
  await expect(app.page.locator(".composer-hint-line")).toContainText("请先将视频定位到时间段的结束位置");
});

// ---------- Second half: what gets stored, editing, moving, deleting, the context menu ----------

/** The whole notes file (including `material`) */
const fileOf = (app: App, file: string) => JSON.parse(readFileSync(join(app.project, ".sniptoss", file), "utf8"));
const exists = (app: App, rel: string) => {
  try {
    readFileSync(join(app.project, ".sniptoss", rel));
    return true;
  } catch {
    return false;
  }
};
/** Width and height of a PNG (IHDR) */
const pngSize = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
/** A point on the top edge of k3f9a2 (the rectangle on hero.png), clear of the middle and end handles: click or drag it with the Select tool */
const heroRectEdge = async (app: App) => {
  const box = await media(app);
  return at(box, 0.1333 + 0.4 * 0.3, 0.0796);
};
/**
 * Screen coordinates of an element's center (marks do not receive the mouse under a drawing tool, so click by coordinates;
 * the stage looks beneath by position)
 */
const centerOf = async (app: App, selector: string) => {
  const b = (await app.page.locator(selector).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as const;
};
const menuItems = (app: App) =>
  app.page.getByRole("menu").getByRole("menuitem").or(app.page.getByRole("menu").getByRole("menuitemcheckbox"));

test("Saving a new note writes every field to the notes file, the snapshot and REVIEW.md, selects the note, and undoes in one step", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = await media(app);
  await drag(app, at(box, 0.5, 0.5), at(box, 0.7, 0.8));
  const a = await save(app, "  这块加个阴影  ".trim());
  const all = notes(app, HERO);
  expect(a.id).toMatch(/^[a-z0-9]{6}$/);
  expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
  const raw = fileOf(app, `annotations/${HERO}`);
  expect(raw.schema).toBe("sniptoss/5");
  expect(raw.material).toMatchObject({ path: "assets/hero.png", kind: "image", width: 640, height: 360 });
  const saved = raw.annotations.find((x: Note) => x.id === a.id);
  expect(saved).toMatchObject({ status: "open", category: "change", author: "tester", replies: [], snapshot: `snapshots/${a.id}.png` });
  expect(saved.created_at).toBe(saved.updated_at);
  expect(exists(app, `snapshots/${a.id}.png`)).toBe(true);
  await expect.poll(() => app.review()).toContain("这块加个阴影");
  expect(exists(app, "sniptoss.cmd")).toBe(false); // no write-back script is placed in the project any more
  await expect(app.page.locator(`[data-annot$="|${a.id}"]`)).toHaveClass(/is-selected/);
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => notes(app, HERO).some((x) => x.id === a.id)).toBe(false);
});

test("Author: the name in Settings is used; otherwise the Windows user name; if neither exists it is \"user\"", async ({ app }) => {
  app.host.prefs = { author: "小王" };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  expect((await save(app, "署名用设置里的")) && fileOf(app, `annotations/${HERO}`).annotations.at(-1).author).toBe("小王");
  app.host.prefs = { ...app.host.prefs, author: "" };
  app.host.appInfoPatch = { userName: "" };
  await app.page.reload();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await save(app, "没有署名");
  expect(fileOf(app, `annotations/${HERO}`).annotations.at(-1).author).toBe("user");
});

test("Per-note snapshot: scaled to the long edge set in Settings, in the chosen format; overall comments get one too, folder comments do not", async ({ app }) => {
  app.host.prefs = { snapshotMax: 320 };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  const whole = await save(app, "整体偏暗");
  await expect.poll(() => exists(app, `snapshots/${whole.id}.png`)).toBe(true);
  expect(pngSize(readFileSync(join(app.project, ".sniptoss", "snapshots", `${whole.id}.png`)))).toEqual([320, 180]);
  // Folder comment: no snapshot
  await focusStage(app);
  await app.page.keyboard.press("Shift+N");
  await app.page.locator(".composer-text").fill("这个文件夹的图都统一圆角");
  await app.page.locator(".composer-text").press("Enter");
  await expect.poll(() => exists(app, "annotations/assets@folder.json")).toBe(true);
  expect(fileOf(app, "annotations/assets@folder.json").annotations[0].snapshot).toBeUndefined();
});

test("With the snapshot format set to JPEG, snapshots are saved as .jpg", async ({ app }) => {
  app.host.prefs = { snapshotFormat: "jpeg" };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  const whole = await save(app, "存成 JPEG");
  await expect.poll(() => exists(app, `snapshots/${whole.id}.jpg`)).toBe(true);
  const head = readFileSync(join(app.project, ".sniptoss", "snapshots", `${whole.id}.jpg`));
  expect([head[0], head[1]]).toEqual([0xff, 0xd8]);
});

test("Folder comment (Shift+N): the title shows the folder name, there is no time row, it is stored in <folder>@folder.json, and a video is not paused", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Shift+N");
  await expect(app.page.locator(".composer-title")).toHaveText("文件夹「assets」的意见");
  await save(app, "统一加 4 像素圆角", "assets@folder.json");
  expect(fileOf(app, "annotations/assets@folder.json").material.kind).toBe("folder");
  // Writing a folder comment on a video does not pause it
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await focusStage(app);
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(false);
  await app.page.keyboard.press("Shift+N");
  await expect(app.page.locator(".composer-title")).toHaveText("文件夹「video」的意见");
  await expect(app.page.locator(".composer .composer-time")).toHaveCount(0);
  expect(await app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(false);
});

test("Writing a folder comment while the notes panel lists only this item: after saving it switches to the Project scope and selects the new note", async ({ app }) => {
  app.host.prefs = { panelScope: "material" };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Shift+N");
  const a = await save(app, "整组换成深色背景", "assets@folder.json");
  await expect(app.page.locator(".scope-switch .seg.is-on")).toContainText("整个项目");
  await expect(app.page.locator(`[data-annot$="|${a.id}"]`)).toHaveClass(/is-selected/);
});

test("Saving a note with a time on a video jumps back to that moment (the frame that was captured)", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await app.page.evaluate(() => {
    document.querySelector("video")!.currentTime = 1;
  });
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = await media(app);
  await drag(app, at(box, 0.2, 0.2), at(box, 0.5, 0.5));
  await app.page.evaluate(() => {
    document.querySelector("video")!.currentTime = 2.2;
  });
  await save(app, "这一帧的水印", CLIP);
  await expect.poll(() => app.page.evaluate(() => Math.round(document.querySelector("video")!.currentTime * 10) / 10)).toBe(1);
  expect(await app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
});

test("Mark appearance: the number is the position within the canvas section (overall comments are numbered separately), pins are teardrops, the color follows Settings, and resolved marks are dimmed", async ({ app }) => {
  app.host.prefs = { markColor: "#3ddc84" };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("c");
  await app.page.mouse.click(...at(await media(app), 0.8, 0.6));
  const pin = await save(app, "第三条");
  const badge = app.page.locator(`.annot-badge[data-id="${pin.id}"]`);
  await expect(badge).toHaveText("2"); // hero.png already has one canvas mark; its resolved overall comment is numbered separately (ADR-0008)
  await expect(badge).toHaveClass(/is-pin/);
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveCSS("background-color", "rgb(61, 220, 132)");
  // Mark as done: dimmed (first go back to the Select tool; marks do not receive the mouse under a drawing tool)
  await app.page.keyboard.press("v");
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await app.page.keyboard.press("d");
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveClass(/is-dim/);
});

test("Select tool: the first press only selects (handles appear, the card highlights), dragging after that moves the mark, and a move undoes in one step", async ({ app }) => {
  await app.open();
  const before = k3(app);
  const edge = await heroRectEdge(app);
  // Drag while not selected: only selects, does not move
  await drag(app, edge, [edge[0] + 40, edge[1] + 20]);
  await expect(app.page.locator(".annot-handle")).toHaveCount(8);
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toHaveClass(/is-selected/);
  expect(k3(app)).toEqual(before);
  // Drag while selected: moves
  await drag(app, edge, [edge[0] + 40, edge[1] + 20]);
  await expect.poll(() => k3(app).x).toBeGreaterThan(before.x!);
  const moved = k3(app);
  expect(moved.w).toBe(before.w);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => k3(app)).toEqual(before);
});

test("Resizing with handles: a rectangle has 8 handles, dragging the bottom-right one enlarges it, dragging past the opposite corner flips it and keeps it positive; a pin has no handles", async ({ app }) => {
  await app.open();
  const before = k3(app);
  await app.page.mouse.click(...(await heroRectEdge(app)));
  const se = (await app.page.locator(".annot-handle.handle-se").boundingBox())!;
  await drag(app, [se.x + se.width / 2, se.y + se.height / 2], [se.x + 50, se.y + 30]);
  await expect.poll(() => k3(app).w).toBeGreaterThan(before.w!);
  // Drag the top-left handle past the bottom-right corner
  const nw = (await app.page.locator(".annot-handle.handle-nw").boundingBox())!;
  const box = await media(app);
  await drag(app, [nw.x + nw.width / 2, nw.y + nw.height / 2], at(box, 0.95, 0.6));
  await expect.poll(() => k3(app).x).toBeGreaterThan(before.x! + before.w!);
  const s = k3(app);
  expect(s.w).toBeGreaterThan(0);
  expect(s.h).toBeGreaterThan(0);
  // Pin: no handles once selected
  await focusStage(app);
  await app.page.keyboard.press("c");
  await app.page.mouse.click(...at(box, 0.2, 0.8));
  const pin = await save(app, "图钉没有手柄");
  await app.page.keyboard.press("v");
  await app.page.locator(`.annot-badge[data-id="${pin.id}"]`).click();
  await expect(app.page.locator(".annot-handle")).toHaveCount(0);
});

test("Arrow keys nudge a mark by 1 pixel; holding a key writes to disk only once; a note selected from the notes panel does not count (← → still switch items)", async ({ app }) => {
  await app.open();
  const x0 = k3(app).x!;
  await app.page.mouse.click(...(await heroRectEdge(app)));
  const writes = () => app.host.calls.filter((c) => c.method === "writeAnnotation").length;
  const w0 = writes();
  await app.page.keyboard.down("ArrowRight");
  for (let i = 0; i < 4; i++) await app.page.keyboard.down("ArrowRight"); // held down: key repeat
  await app.page.keyboard.up("ArrowRight");
  await expect.poll(() => Math.round((k3(app).x! - x0) * 640)).toBe(5);
  expect(writes() - w0).toBe(1);
  // Clicked from the notes panel: → goes to the next item
  await app.page.locator('[data-annot$="|k3f9a2"]').click();
  await app.page.keyboard.press("ArrowRight");
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("Deleting a note: the card's ⋯ menu, the canvas context menu and the Edit menu all ask first and Esc cancels; after deleting, neither the JSON nor REVIEW.md has it, and it undoes in one step", async ({ app }) => {
  await app.open();
  const dialog = app.page.getByRole("alertdialog");
  // The card's ⋯ menu
  await app.page.locator('[data-annot$="|k3f9a2"]').hover();
  await app.page.locator('[data-annot$="|k3f9a2"] .act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: "删除批注" }).click();
  await expect(dialog).toContainText("删除此批注？");
  await expect(dialog).toContainText("标题字太细了，换成粗一点的黑体");
  await app.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Right-click on the canvas
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click({ button: "right" });
  await app.page.getByRole("menuitem", { name: "删除批注" }).click();
  await expect(dialog).toBeVisible();
  await app.page.keyboard.press("Escape");
  // The Edit menu
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await app.page.locator(".menubar button", { hasText: "编辑" }).click();
  await app.page.getByRole("menuitem", { name: /^删除选中的批注/ }).click();
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => notes(app, HERO).some((x) => x.id === "k3f9a2")).toBe(false);
  await expect.poll(() => app.review()).toMatch(/^# 待处理批注（\d+ 条）/);
  await expect.poll(() => app.review()).not.toContain("标题字太细了");
  await expect(app.page.locator(".annot-handle")).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => notes(app, HERO).some((x) => x.id === "k3f9a2")).toBe(true);
});

test("Editing a note: the title is \"Edit Note\", the original mark is hidden while editing, and after changing category and text the id, status and creation time stay the same", async ({ app }) => {
  await app.open();
  const before = fileOf(app, `annotations/${HERO}`).annotations.find((x: Note) => x.id === "k3f9a2");
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".composer-title")).toHaveText("编辑批注");
  await expect(app.page.locator('.annot-badge[data-id="k3f9a2"]')).toHaveCount(0);
  await app.page.locator(".composer-text").press("Alt+Digit2");
  await app.page.locator(".composer-text").fill("标题换成思源黑体 Bold");
  await app.page.locator(".composer-text").press("Enter");
  await expect.poll(() => byBody(app, HERO, "标题换成思源黑体 Bold")?.id).toBe("k3f9a2");
  const after = fileOf(app, `annotations/${HERO}`).annotations.find((x: Note) => x.id === "k3f9a2");
  expect(after).toMatchObject({ status: before.status, created_at: before.created_at, category: "remove" });
  expect(after.updated_at).not.toBe(before.updated_at);
});

test("After clicking a number on the canvas with the mouse, Enter edits and Space plays instead of pressing that number's button", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await app.page.locator('[data-annot$="|p0c7xe"]').click(); // jumps to 1.5 seconds and the mark appears
  await app.page.locator('.annot-badge[data-id="p0c7xe"]').click();
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(false);
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
  // A button reached with Tab: Enter still presses that button (Tab to Cancel in a confirm dialog and Enter cancels; keyboard.spec covers it)
});

test("Esc backs out one level at a time: close the composer, return to the Select tool, deselect, then clear the checked notes", async ({ app }) => {
  await app.open();
  const layer = app.page.locator(".annot-layer");
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.keyboard.press("Escape");
  await expect(composer(app)).toHaveCount(0);
  await app.page.keyboard.press("r");
  await app.page.keyboard.press("Escape");
  await expect(layer).toHaveClass(/tool-select/);
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click();
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toHaveClass(/is-selected/);
  // Clicking a mark opened the color bar: Esc closes it first and the note stays selected
  await expect(app.page.locator(".mark-colors")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".mark-colors")).toHaveCount(0);
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toHaveClass(/is-selected/);
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).not.toHaveClass(/is-selected/);
  await app.page.locator('[data-annot$="|k3f9a2"] .card-check').click();
  await expect(app.page.locator(".panel-batch")).toBeVisible();
  await focusStage(app);
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".panel-batch")).toHaveCount(0);
});

test("Right-clicking a mark selects it first and the menu lists what can be done with it and the shortcuts; right-click also works under a drawing tool", async ({ app }) => {
  await app.open();
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click({ button: "right" });
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toHaveClass(/is-selected/);
  const names = await menuItems(app).allInnerTexts();
  const text = names.join(" / ");
  for (const item of ["复制批注成文字", "复制批注成图片", "勾选", "编辑批注", "标记为已改", "标记为不改", "删除批注"])
    expect(text).toContain(item);
  await app.page.keyboard.press("Escape");
  // Under a drawing tool the marks are covered by a transparent input layer: the stage looks beneath by position
  await focusStage(app);
  await app.page.keyboard.press("r");
  const pos = await centerOf(app, '.annot-badge[data-id="k3f9a2"]');
  await app.page.mouse.click(...pos, { button: "right" });
  await expect(app.page.getByRole("menuitem", { name: "编辑批注" })).toBeVisible();
  // On the box's edge (not the number): under a drawing tool or the Hand tool it is still recognized as this note
  for (const key of ["r", "h"]) {
    await app.page.keyboard.press("Escape"); // close the menu
    await app.page.keyboard.press("Escape"); // back to the Select tool
    await focusStage(app);
    await app.page.keyboard.press(key);
    await app.page.mouse.click(...(await heroRectEdge(app)), { button: "right" });
    await expect(app.page.getByRole("menuitem", { name: "编辑批注" })).toBeVisible();
  }
  // The inside of an unselected box does not count as a hit (same as the Select tool: only the edge counts)
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Escape");
  await focusStage(app);
  await app.page.keyboard.press("Escape"); // deselect
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).not.toHaveClass(/is-selected/);
  const box = await media(app);
  await app.page.keyboard.press("r");
  await app.page.mouse.click(...at(box, 0.1333 + 0.2, 0.0796 + 0.05), { button: "right" });
  await expect(app.page.getByRole("menuitem", { name: "在此处添加批注" })).toBeVisible();
});

const menuLabels = (app: App) => app.page.locator(".menu .menu-label").allInnerTexts();
const menuRow = (app: App, label: string) => app.page.locator(".menu .menu-item", { has: app.page.locator(".menu-label", { hasText: label }) });

test("Right-clicking blank canvas shows only the five items that concern this file: two Copy items, Add Note Here, Add Overall Comment and Show in File Explorer", async ({ app }) => {
  await app.open();
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.8, 0.85), { button: "right" });
  // Items unrelated to this file (such as a folder comment for the folder it sits in) are left out; only useful ones are listed.
  // The folder comment and Open Notes Folder are not here (Shift N, the Annotate and File menus and the library row all have them)
  expect(await menuLabels(app)).toEqual(["复制批注成文字", "复制批注成图片", "在此处添加批注…", "添加整体意见…", "在资源管理器中显示"]);
  await menuRow(app, "在资源管理器中显示").click();
  expect(app.host.revealed.at(-1)).toBe(join(app.project, "assets", "hero.png"));
});

test("The blank-canvas context menu: every item has an icon, the right side shows only a count or shortcut, and the explanation goes in the hover tooltip", async ({ app }) => {
  await app.open();
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.8, 0.85), { button: "right" });
  // Every item has an icon (not just the first two with the rest left blank)
  const items = app.page.locator(".menu .menu-item");
  expect(await app.page.locator(".menu .menu-item .menu-icon svg").count()).toBe(await items.count());
  // The gray text on the right is only a count or a shortcut, never descriptive text such as "this image" or the web-based AI hint
  for (const hint of await app.page.locator(".menu .menu-hint").allInnerTexts()) expect(hint).toMatch(/^(\d+ 条|N)$/);
  await expect(menuRow(app, "复制批注成文字").locator(".menu-hint")).toHaveText("1 条");
  await expect(menuRow(app, "复制批注成图片").locator(".menu-hint")).toHaveCount(0);
  await app.page.mouse.move(5, 5); // the item the mouse rests on has its title taken over by the tooltip bubble
  await expect(menuRow(app, "复制批注成文字")).toHaveAttribute("title", "适用于 Claude Code、Codex 等能读取本机文件的 AI：含每条批注的内容、位置，以及素材和截图在本机的路径");
  await expect(menuRow(app, "复制批注成图片")).toHaveAttribute("title", "适用于网页版 AI、聊天软件");
  await expect(menuRow(app, "添加整体意见…")).toHaveAttribute("title", "针对整份素材的批注，不指定位置");
});

test("Copying from the blank-canvas context menu copies only this item's open notes, even when the notes panel lists the whole project and other notes are checked (same as right-clicking its library row)", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".scope-switch .seg.is-on")).toContainText("整个项目");
  // Check the video's note: the bottom button hands over the checked notes, while the canvas context menu still hands over only this image's
  await app.page.locator('[data-annot$="|p0c7xe"] .card-check').click();
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.8, 0.85), { button: "right" });
  await menuRow(app, "复制批注成文字").click();
  await expect.poll(() => app.clipboard()).toContain("标题字太细了，换成粗一点的黑体");
  expect(await app.clipboard()).not.toContain("这段水印去掉");
  await expect(app.page.locator(".toast")).toContainText("已复制「hero.png」的 1 条批注");
  // Copy as Images: likewise only this item
  await app.page.mouse.click(...at(box, 0.8, 0.85), { button: "right" });
  await menuRow(app, "复制批注成图片").click();
  await expect.poll(() => app.host.copiedImages.length).toBe(1);
  expect(app.host.copiedImages[0].map((x) => x.body)).toEqual(["标题字太细了，换成粗一点的黑体"]);
  // This item has no open notes: both items are grayed out and say so
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  const poster = await media(app);
  await app.page.mouse.click(...at(poster, 0.5, 0.5), { button: "right" });
  await expect(menuRow(app, "复制批注成文字")).toBeDisabled();
  await expect(menuRow(app, "复制批注成文字").locator(".menu-hint")).toHaveText("没有待处理的批注");
  await expect(menuRow(app, "复制批注成图片")).toBeDisabled();
});

test("Add Note Here… on the blank-canvas context menu drops a pixel-aligned pin at the clicked spot and opens the composer; the item is absent outside the frame or where drawing is not possible", async ({ app }) => {
  // The composer opens even if auto-compose is off in Settings: choosing it from the menu means the user wants to write
  app.host.prefs = { autoCompose: false };
  await app.open();
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.37, 0.41), { button: "right" });
  await menuRow(app, "在此处添加批注…").click();
  await expect(composer(app)).toBeVisible();
  const pin = await save(app, "右键加的图钉");
  expect(pin.anchor.shapes?.[0]?.type).toBe("point");
  expect(pin.anchor.shapes![0].x!).toBeCloseTo(0.37, 2);
  expect(pin.anchor.shapes![0].y!).toBeCloseTo(0.41, 2);
  expect(offGrid(pin.anchor.shapes![0].x!, 640)).toBeLessThan(0.05);
  expect(offGrid(pin.anchor.shapes![0].y!, 360)).toBeLessThan(0.05);
  await expect(app.page.locator(`.annot-badge.is-pin[data-id="${pin.id}"]`)).toBeVisible();
  // Right-click outside the frame (in the blank margin of the canvas area): this item is missing and the others are unchanged
  await app.page.mouse.click(box.x + box.width / 2, box.y - 4, { button: "right" });
  await expect(menuRow(app, "添加整体意见…")).toBeVisible();
  await expect(menuRow(app, "在此处添加批注…")).toHaveCount(0);
  await app.page.keyboard.press("Escape");
  // Right-click on the zoom control: missing there too
  await app.page.locator(".zoom-control").click({ button: "right" });
  await expect(menuRow(app, "在此处添加批注…")).toHaveCount(0);
});

test("Add Note Here… on a video records the moment of the right-click (the video keeps playing while the menu is open) and stops on that frame", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await app.page.evaluate(() => {
    document.querySelector("video")!.currentTime = 1;
  });
  await expect.poll(() => app.page.evaluate(() => Math.round(document.querySelector("video")!.currentTime * 10) / 10)).toBe(1);
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.6, 0.3), { button: "right" });
  // The video moved on while the menu was open
  await app.page.evaluate(() => {
    document.querySelector("video")!.currentTime = 2.2;
  });
  await menuRow(app, "在此处添加批注…").click();
  const a = await save(app, "右键时那一帧的水印", CLIP);
  expect(a.anchor.time?.start).toBeCloseTo(1, 2);
  await expect.poll(() => app.page.evaluate(() => Math.round(document.querySelector("video")!.currentTime * 10) / 10)).toBe(1);
  expect(await app.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
});

test("Choosing Add Note Here… halfway through writing a note first asks whether to discard the unfinished one", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("写了一半的整体意见");
  const box = await media(app);
  await app.page.mouse.click(...at(box, 0.7, 0.7), { button: "right" });
  await menuRow(app, "在此处添加批注…").click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("写了一半的整体意见");
});

test("The mark context menu: the right side shows only a count or shortcut, purposes go in hover tooltips, and the status and delete items have icons", async ({ app }) => {
  await app.open();
  await app.page.locator('.annot-badge[data-id="k3f9a2"]').click({ button: "right" });
  await app.page.mouse.move(5, 5);
  await expect(menuRow(app, "复制批注成文字").locator(".menu-hint")).toHaveText("1 条");
  await expect(menuRow(app, "复制批注成文字")).toHaveAttribute("title", "适用于 Claude Code、Codex 等能读取本机文件的 AI：含每条批注的内容、位置，以及素材和截图在本机的路径");
  await expect(menuRow(app, "复制批注成图片").locator(".menu-hint")).toHaveCount(0);
  await expect(menuRow(app, "复制批注成图片")).toHaveAttribute("title", "适用于网页版 AI、聊天软件");
  for (const label of ["编辑批注", "标记为已改", "标记为不改", "删除批注"]) await expect(menuRow(app, label).locator(".menu-icon svg")).toHaveCount(1);
});

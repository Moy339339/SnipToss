// Drawings without notes (docs/annotation-format.md, "Drawings"): a mark whose note box is left without a word stays as a drawing with no
// number; Esc / Cancel drop it instead. A click on it pops up the color row with Delete, a double-click (or "Add Note…") turns it into a
// note, and it goes into the snapshots of the notes on the same frame; the text for AI says what unnumbered lines are

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO = "assets__hero.png.json";
const CLIP = "video__clip.mp4.json";
const notesFile = (app: App, file = HERO) => JSON.parse(readFileSync(join(app.project, ".sniptoss", "annotations", file), "utf8"));
const drawings = (app: App, file = HERO): { id: string; shape: { type: string; color?: string }; time?: { start: number } }[] =>
  notesFile(app, file).drawings ?? [];
const composer = (app: App) => app.page.locator(".composer");
const ghosts = (app: App) => app.page.locator(".annot-badge.is-ghost");
const colorBar = (app: App) => app.page.locator(".mark-colors");
const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) =>
  [box.x + box.width * fx, box.y + box.height * fy] as const;
async function drag(app: App, from: readonly [number, number], to: readonly [number, number]) {
  await app.page.mouse.move(...from);
  await app.page.mouse.down();
  await app.page.mouse.move(...to, { steps: 8 });
  await app.page.mouse.up();
}
/** A drawing on hero.png: a rectangle from (0.1, 0.5) to (0.3, 0.75) */
function seed(app: App, extra: Record<string, unknown> = {}, file = HERO) {
  const path = join(app.project, ".sniptoss", "annotations", file);
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.drawings = [{ id: "draw01", shape: { type: "rect", x: 0.1, y: 0.5, w: 0.2, h: 0.25 }, created_at: "2026-11-09T00:00:00Z", ...extra }];
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelScope: "material" };
});

test("a mark left without a word stays as a drawing: no number, saved under drawings and not as a note; the first time, a hint says so; Esc drops a mark instead", async ({
  app,
}) => {
  app.host.onboarded = false;
  app.host.prefs = { panelScope: "material", onboarding: ["tour", "hint.copy", "hint.video"] };
  await app.open();
  const notes = notesFile(app).annotations.length;
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("b");
  const box = await app.media();
  await drag(app, at(box, 0.6, 0.6), at(box, 0.8, 0.8));
  await expect(composer(app)).toBeVisible();
  await app.page.mouse.click(...at(box, 0.05, 0.95));
  await expect(composer(app)).toHaveCount(0);
  await expect(ghosts(app)).toHaveCount(1);
  await expect.poll(() => drawings(app).map((d) => d.shape.type)).toEqual(["path"]);
  expect(notesFile(app).annotations).toHaveLength(notes);
  await expect(app.page.locator(".hint")).toContainText("未填写内容的标记保留为涂鸦");
  await expect.poll(() => app.host.prefs?.onboarding).toContain("hint.drawing");

  // Esc (and Cancel) throw the mark away: nothing stays
  await app.page.keyboard.press("r");
  await drag(app, at(box, 0.1, 0.1), at(box, 0.3, 0.3));
  await expect(composer(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(composer(app)).toHaveCount(0);
  await drag(app, at(box, 0.1, 0.1), at(box, 0.3, 0.3));
  await composer(app).getByRole("button", { name: "取消" }).click();
  await expect(composer(app)).toHaveCount(0);
  await expect(ghosts(app)).toHaveCount(1);
  expect(drawings(app)).toHaveLength(1);
});

test("a click on a drawing pops up the color row next to it: a color changes only it, its Delete removes it and Ctrl+Z brings it back; the Delete key works too", async ({
  app,
}) => {
  seed(app);
  await app.open();
  const box = await app.media();
  await expect(ghosts(app)).toHaveCount(1);
  await app.page.mouse.click(...at(box, 0.1, 0.62));
  await expect(colorBar(app)).toBeVisible();
  await colorBar(app).getByRole("radio", { name: "黄色", exact: true }).click();
  await expect.poll(() => drawings(app)[0]?.shape.color).toBe("#ffc233");
  // The note on the same item keeps its own color
  expect(notesFile(app).annotations[0].color).toBeUndefined();

  await app.page.mouse.click(...at(box, 0.1, 0.62));
  await colorBar(app).getByRole("button", { name: "删除这个涂鸦" }).click();
  await expect(ghosts(app)).toHaveCount(0);
  await expect.poll(() => drawings(app)).toEqual([]);
  expect("drawings" in notesFile(app)).toBe(false);
  await app.page.keyboard.press("Control+z");
  await expect(ghosts(app)).toHaveCount(1);
  await expect.poll(() => drawings(app).length).toBe(1);

  await app.page.mouse.click(...at(box, 0.1, 0.62));
  await app.page.keyboard.press("Delete");
  await expect(ghosts(app)).toHaveCount(0);
  await expect.poll(() => drawings(app)).toEqual([]);
});

test("double-clicking a drawing opens the note box with its shape: saving turns it into a numbered note in the same step, leaving keeps the drawing", async ({
  app,
}) => {
  seed(app, { shape: { type: "rect", x: 0.1, y: 0.5, w: 0.2, h: 0.25, color: "#3ddc84" } });
  await app.open();
  const box = await app.media();
  await app.page.mouse.dblclick(...at(box, 0.1, 0.62));
  await expect(composer(app)).toBeVisible();
  await expect(app.page.locator(".annot-badge.is-draft")).toHaveCount(1);
  // While writing, the drawing is the note's mark: it isn't drawn a second time
  await expect(ghosts(app)).toHaveCount(0);
  await app.page.keyboard.press("Escape");
  await expect(ghosts(app)).toHaveCount(1);
  expect(drawings(app)).toHaveLength(1);

  await app.page.mouse.dblclick(...at(box, 0.1, 0.62));
  await app.page.locator(".composer-text").fill("这个框里的按钮改大");
  await app.page.keyboard.press("Enter");
  await expect(composer(app)).toHaveCount(0);
  // Its color stays: with one place it is written as the note's color (normalizePlaceColors)
  const saved = () => notesFile(app).annotations.find((a: { body: string }) => a.body === "这个框里的按钮改大");
  await expect.poll(() => saved()?.anchor).toEqual({ shapes: [{ type: "rect", x: 0.1, y: 0.5, w: 0.2, h: 0.25 }] });
  expect(saved().color).toBe("#3ddc84");
  expect(drawings(app)).toEqual([]);
  await expect(ghosts(app)).toHaveCount(0);
  await expect(app.page.locator(".annot-badge:not(.is-ghost)")).toHaveCount(2);
  // One step: Ctrl+Z gives the drawing back and takes the note away
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => drawings(app).length).toBe(1);
  expect(notesFile(app).annotations.some((a: { body: string }) => a.body === "这个框里的按钮改大")).toBe(false);
});

test("right-clicking a drawing: its color row, Add Note… and Delete Drawing", async ({ app }) => {
  seed(app);
  await app.open();
  const box = await app.media();
  await app.page.mouse.click(...at(box, 0.1, 0.62), { button: "right" });
  const menu = app.page.locator(".menu");
  await expect(menu.getByRole("menuitem", { name: /补写批注/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /删除涂鸦/ })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "黄色", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: /删除涂鸦/ }).click();
  await expect.poll(() => drawings(app)).toEqual([]);
});

test("switching to another item with an empty note box keeps the mark as a drawing on the item it was drawn on", async ({ app }) => {
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = await app.media();
  await drag(app, at(box, 0.6, 0.1), at(box, 0.8, 0.3));
  await expect(composer(app)).toBeVisible();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect.poll(() => drawings(app).length).toBe(1);
});

test("a note's snapshot is retaken with the drawing in it, and Copy as Text says what unnumbered lines are", async ({ app }) => {
  await app.open();
  // A note with a snapshot: a pin with words
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const box = await app.media();
  await app.page.mouse.click(...at(box, 0.2, 0.2));
  await app.page.locator(".composer-text").fill("带截图的批注");
  await app.page.keyboard.press("Enter");
  const withShot = () => notesFile(app).annotations.find((a: { body: string }) => a.body === "带截图的批注");
  await expect.poll(() => withShot()?.snapshot).toBeTruthy();
  const shotPath = () => join(app.project, ".sniptoss", withShot().snapshot);
  const before = statSync(shotPath()).mtimeMs;
  await app.page.keyboard.press("a");
  await drag(app, at(box, 0.7, 0.9), at(box, 0.5, 0.7));
  await app.page.mouse.click(...at(box, 0.05, 0.95));
  await expect.poll(() => drawings(app).length).toBe(1);
  await expect.poll(() => statSync(shotPath()).mtimeMs).toBeGreaterThan(before);

  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+Shift+a");
  await expect.poll(() => app.clipboard()).toContain("截图上没有编号的线条、箭头和框是用户另外画的");
});

test("on a video a drawing belongs to its frame: shown when paused there, not on other frames", async ({ app }) => {
  seed(app, { time: { start: 1 } }, CLIP);
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  const seek = (t: number) =>
    app.page.evaluate((s) => {
      document.querySelector("video")!.currentTime = s;
    }, t);
  await seek(1);
  await expect(ghosts(app)).toHaveCount(1);
  await seek(2);
  await expect(ghosts(app)).toHaveCount(0);
});

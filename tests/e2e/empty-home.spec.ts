// The .sniptoss folder exists only while it holds something: once the last note is gone the app removes it (only the files it wrote),
// undo brings it back with the note and its snapshot, and a folder found empty when read is removed too

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const HERO_NOTES = "assets__hero.png.json";
const data = (app: App, ...rel: string[]) => join(app.project, ".sniptoss", ...rel);
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });

/** Leaves the project with a single open note (k3f9a2 on hero.png, with a snapshot), or with none at all (an emptied notes file) */
function onlyOneNote(app: App, keep: boolean) {
  rmSync(data(app, "annotations", "video__clip.mp4.json"));
  const file = data(app, "annotations", HERO_NOTES);
  const json = JSON.parse(readFileSync(file, "utf8"));
  const note = { ...json.annotations.find((a: { id: string }) => a.id === "k3f9a2"), snapshot: "snapshots/k3f9a2.png" };
  json.annotations = keep ? [note] : [];
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  mkdirSync(data(app, "snapshots"), { recursive: true });
  writeFileSync(data(app, "snapshots", "k3f9a2.png"), "snapshot");
}

test("deleting the last note removes the .sniptoss folder; undo brings back the note, its snapshot and REVIEW.md", async ({ app }) => {
  app.host.prefs = { panelScope: "material" };
  onlyOneNote(app, true);
  await app.open();
  await expect(app.page.locator(".card")).toHaveCount(1);

  const body = (await app.page.locator(".panel-body").boundingBox())!;
  await app.page.mouse.click(body.x + body.width / 2, body.y + body.height - 12, { button: "right" });
  await menuItem(app, /^删除全部批注…/).click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
  await expect(app.page.locator(".card")).toHaveCount(0);
  await expect.poll(() => existsSync(data(app))).toBe(false);

  await app.page.keyboard.press("Control+z");
  await expect.poll(() => app.annotations(HERO_NOTES).map((a) => a.id)).toEqual(["k3f9a2"]);
  await expect(app.page.locator(".card")).toHaveCount(1);
  expect(existsSync(data(app, "snapshots", "k3f9a2.png"))).toBe(true);
  await expect.poll(() => app.review()).toContain("标题字太细了");
});

test("a notes folder found empty when read is removed; files the app did not write stay, and then so does the folder", async ({ app }) => {
  onlyOneNote(app, false);
  writeFileSync(data(app, "REVIEW.md"), "# old\n");
  writeFileSync(data(app, "project.json"), '{ "language": "zh-CN" }\n');
  await app.open();
  await expect.poll(() => existsSync(data(app))).toBe(false);

  // The same again with a file of the user's own inside: only the app's files go
  mkdirSync(data(app, "annotations"), { recursive: true });
  writeFileSync(data(app, "annotations", HERO_NOTES), '{ "schema": "sniptoss/5", "material": { "path": "assets/hero.png", "kind": "image" }, "annotations": [] }\n');
  writeFileSync(data(app, "REVIEW.md"), "# old\n");
  writeFileSync(data(app, "mine.txt"), "mine");
  await app.page.reload();
  await expect.poll(() => (existsSync(data(app)) ? readdirSync(data(app)) : null)).toEqual(["mine.txt"]);
});

const DRAWING = { id: "draw01", shape: { type: "rect", x: 0.1, y: 0.5, w: 0.2, h: 0.25 }, created_at: "2026-11-09T00:00:00Z" };
const heroFile = (app: App) => JSON.parse(readFileSync(data(app, "annotations", HERO_NOTES), "utf8")) as { annotations: unknown[]; drawings?: unknown[] };
function addDrawing(app: App) {
  writeFileSync(data(app, "annotations", HERO_NOTES), JSON.stringify({ ...heroFile(app), drawings: [DRAWING] }, null, 2) + "\n");
}
async function deleteAll(app: App) {
  const body = (await app.page.locator(".panel-body").boundingBox())!;
  await app.page.mouse.click(body.x + body.width / 2, body.y + body.height - 12, { button: "right" });
  await menuItem(app, /^删除全部批注…/).click();
}

test("Delete All Notes… takes the drawings of an item left with no notes along (the dialog says so), so the folder goes; one undo brings back both", async ({
  app,
}) => {
  app.host.prefs = { panelScope: "material" };
  onlyOneNote(app, true);
  addDrawing(app);
  await app.open();
  await deleteAll(app);
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("没有文字的 1 处涂鸦也会一并删除。");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => existsSync(data(app))).toBe(false);

  await app.page.keyboard.press("Control+z");
  await expect.poll(() => (existsSync(data(app, "annotations", HERO_NOTES)) ? heroFile(app) : null)).toMatchObject({
    annotations: [{ id: "k3f9a2" }],
    drawings: [{ id: "draw01" }],
  });
});

test("with only drawings left on the item, Delete All Notes… is still available and asks about the drawings; then the folder goes", async ({
  app,
}) => {
  app.host.prefs = { panelScope: "material" };
  onlyOneNote(app, false);
  addDrawing(app);
  await app.open();
  await deleteAll(app);
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("删除 1 处涂鸦？");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect(app.page.locator(".toast")).toContainText("已删除 1 处涂鸦");
  await expect.poll(() => existsSync(data(app))).toBe(false);
});

test("drawings stay when a note that isn't listed remains on the item: Delete All Notes… removes only what is listed", async ({ app }) => {
  app.host.prefs = { panelScope: "material" };
  rmSync(data(app, "annotations", "video__clip.mp4.json"));
  addDrawing(app); // hero.png keeps its open note k3f9a2 and the done note done01, which the panel doesn't list
  await app.open();
  await deleteAll(app);
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).not.toContainText("涂鸦");
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect.poll(() => heroFile(app).annotations).toHaveLength(1);
  expect(heroFile(app).drawings).toHaveLength(1);
  expect(existsSync(data(app))).toBe(true);
});

// Unreadable notes files and notes files written by a newer version (docs/adr/0006-format-versioning.md):
// the UI must say which file it is and refuse edits, and must never overwrite the unreadable one with a blank file;
// once the file is fixed the UI recovers by itself.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const POSTER = "assets__poster.jpg.json";
const posterFile = (app: App) => join(app.project, ".sniptoss", "annotations", POSTER);
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);

function posterJson(schema: string, id: string) {
  return JSON.stringify({
    schema,
    material: { path: "assets/poster.jpg", kind: "image" },
    annotations: [
      {
        id,
        status: "open",
        category: "change",
        body: "海报的字再大一点",
        anchor: {},
        author: "user",
        created_at: "",
        updated_at: "",
        replies: [],
      },
    ],
  });
}

async function openPoster(app: App) {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
}

/** Picks the Rectangle tool (R), drags a box in the middle of the canvas, types the note and saves */
async function drawRect(app: App, body: string) {
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  await expect(app.page.locator(".annot-layer")).toHaveClass(/tool-rect/);
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill(body);
  await app.page.keyboard.press("Control+Enter");
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("A broken notes file: the notes panel says which file and why, drawing is blocked for the item, and everything recovers once the file is fixed", async ({ app }) => {
  writeFileSync(posterFile(app), "{ 坏了");
  await openPoster(app);
  const error = app.page.locator(".panel-body .error");
  await expect(error).toContainText(POSTER);
  await expect(error).toContainText("不是合法的 JSON");
  // Cannot draw: R does not switch to the Rectangle tool
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  await expect(app.page.locator(".annot-layer")).not.toHaveClass(/tool-rect/);
  expect(readFileSync(posterFile(app), "utf8")).toBe("{ 坏了");
  // REVIEW.md (the first file an agent reads) lists the unreadable file at the top, and the notes of other items are listed as usual
  const review = () => (existsSync(join(app.project, ".sniptoss", "REVIEW.md")) ? readFileSync(join(app.project, ".sniptoss", "REVIEW.md"), "utf8") : "");
  await expect.poll(review).toContain(`> - .sniptoss/annotations/${POSTER}：不是合法的 JSON`);
  expect(review()).toContain("k3f9a2");
  // Other items work as usual
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(card(app, "k3f9a2")).toBeVisible();
  // The agent fixes the file: the message disappears, the note appears, and REVIEW.md no longer says it is unreadable
  writeFileSync(posterFile(app), posterJson("sniptoss/4", "fix001"));
  await expect(error).toHaveCount(0);
  await expect(card(app, "fix001")).toBeVisible();
  await expect.poll(review).not.toContain("无法读取");
  expect(review()).toContain("fix001");
});

test("When the file on disk turns out to be unreadable only at write time (no notification yet), the new note is rolled back with a reason and the file on disk is left untouched", async ({ app }) => {
  app.allowLogErrors("saving notes");
  await openPoster(app);
  app.host.muted = true;
  writeFileSync(posterFile(app), "{ 坏了");
  await drawRect(app, "这里加个logo");
  await expect(app.page.locator(".toast")).toContainText("保存失败");
  await expect(app.page.locator(".toast")).toContainText(POSTER);
  // The error handling must not parse the broken file again and throw a second time (which would leave the unsaved note on screen and show no toast)
  await expect(app.page.locator(".annot-badge:not(.is-draft)")).toHaveCount(0); // not saved: the canvas only has the unsaved one from the composer
  await expect(app.page.locator("[data-annot]", { hasText: "这里加个logo" })).toHaveCount(0);
  expect(readFileSync(posterFile(app), "utf8")).toBe("{ 坏了");
  // From then on drawing is blocked for the item and the notes panel states why
  await expect(app.page.locator(".panel-body .error")).toContainText(POSTER);
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  await expect(app.page.locator(".annot-layer")).not.toHaveClass(/tool-rect/);
});

test("A notes file written by a newer version is shown as usual but is read-only: marking a note as done is refused and the file on disk is untouched", async ({ app }) => {
  const text = posterJson("sniptoss/6", "new001");
  writeFileSync(posterFile(app), text);
  await openPoster(app);
  await expect(card(app, "new001")).toContainText("海报的字再大一点");
  await expect(app.page.locator(".panel-body .error")).toContainText("sniptoss/6");
  await card(app, "new001").hover();
  await card(app, "new001").locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
  await expect(app.page.locator(".toast")).toContainText("由更高版本的超级批注写入");
  await expect(card(app, "new001")).toHaveClass(/status-open/);
  expect(readFileSync(posterFile(app), "utf8")).toBe(text);
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  await expect(app.page.locator(".annot-layer")).not.toHaveClass(/tool-rect/);
});

test("Control: a normal item can be drawn on and the note is written to disk", async ({ app }) => {
  await openPoster(app);
  await drawRect(app, "这里加个logo");
  await expect.poll(() => (existsSync(posterFile(app)) ? app.annotations(POSTER).map((a) => a.body) : [])).toEqual(["这里加个logo"]);
});

test("Loading a project removes snapshots no note uses (left by deleted notes or format changes) and keeps those in use or not named by the app", async ({ app }) => {
  // Otherwise .sniptoss/snapshots would only ever grow
  app.host.snapshotMinAgeMs = 0;
  const shots = join(app.project, ".sniptoss", "snapshots");
  mkdirSync(shots, { recursive: true });
  const hero = join(app.project, ".sniptoss", "annotations", "assets__hero.png.json");
  const data = JSON.parse(readFileSync(hero, "utf8"));
  data.annotations[0].snapshot = "snapshots/k3f9a2.png";
  writeFileSync(hero, JSON.stringify(data, null, 2));
  for (const name of ["k3f9a2.png", "k3f9a2.jpg", "gone01.png", "我的笔记.png"]) writeFileSync(join(shots, name), "x");
  await app.open();
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect.poll(() => readdirSync(shots).sort()).toEqual(["k3f9a2.png", "我的笔记.png"]);
});

test("A notes file name clash (assets__poster.jpg in the project root and assets/poster.jpg both map to assets__poster.jpg.json) is not merged into the other file and is reported clearly", async ({ app }) => {
  // Otherwise it would be treated as "changed elsewhere" and three-way merged:
  // the notes of two items end up in one file whose material becomes whichever wrote last
  copyFileSync(join(app.project, "assets", "poster.jpg"), join(app.project, "assets__poster.jpg"));
  writeFileSync(posterFile(app), posterJson("sniptoss/4", "root01").replace('"assets/poster.jpg"', '"assets__poster.jpg"'));
  await app.open();
  await app.page.locator(".lib-row", { hasText: /^poster\.jpg/ }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await drawRect(app, "撞名的这张");
  await expect(app.page.locator(".toast")).toContainText("已属于「assets__poster.jpg」");
  await expect(app.page.locator(".composer-text")).toHaveValue("撞名的这张");
  const onDisk = JSON.parse(readFileSync(posterFile(app), "utf8"));
  expect(onDisk.material.path).toBe("assets__poster.jpg");
  expect(onDisk.annotations.map((a: { id: string }) => a.id)).toEqual(["root01"]);
  app.allowLogErrors("saving notes");
});

// When saving notes goes wrong: the disk can't be written, the snapshot can't be written, REVIEW.md can't be written, the notes file is deleted externally, reading notes fails, an agent writes back while a menu is open.
// Principles: what wasn't saved isn't shown as saved in the UI; text the user wrote isn't lost; toasts describe what really happened.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const ANN = (app: App, name: string) => join(app.project, ".sniptoss", "annotations", name);
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const toast = (app: App) => app.page.locator(".toast");

async function openPoster(app: App) {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
}

/** Picks the Rectangle tool (R), drags a rectangle in the middle of the canvas, writes the note and saves it */
async function drawRect(app: App, body: string) {
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill(body);
  await app.page.keyboard.press("Control+Enter");
}

const posterNotes = (app: App) => (existsSync(ANN(app, "assets__poster.jpg.json")) ? app.annotations("assets__poster.jpg.json") : []);

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelResolved: true };
});

test("when writing to disk fails while saving a new note, the note box comes back with the text just written, the toast stays until dismissed, and no extra step lands on the undo stack", async ({ app }) => {
  app.allowLogErrors("saving notes");
  await openPoster(app);
  app.host.failWrites = /annotations\//;
  await drawRect(app, "这里加个logo");
  await expect(toast(app)).toContainText("保存失败");
  // An error toast is persistent: screen readers announce it immediately, only the × closes it, and it carries an actionable button (Open Log Folder when the cause is unknown)
  await expect(toast(app)).toHaveAttribute("role", "alert");
  await expect(toast(app).getByRole("button", { name: "关闭" })).toBeVisible();
  await toast(app).getByRole("button", { name: "打开日志" }).click();
  expect(app.host.revealed).toContain("@logs");
  await expect(toast(app)).toContainText("保存失败"); // The toast stays after clicking Open Log Folder, so the log can be read alongside it
  await expect(app.page.locator(".composer-text")).toHaveValue("这里加个logo");
  await expect(app.page.locator(".annot-badge:not(.is-draft)")).toHaveCount(0); // Not saved: the only mark on the canvas is the unsaved one in the note box
  expect(posterNotes(app)).toEqual([]);
  // Once the disk works again, just save again
  app.host.failWrites = null;
  await app.page.locator(".composer-text").press("Control+Enter");
  await expect.poll(() => posterNotes(app).map((a) => a.body)).toEqual(["这里加个logo"]);
  // One undo removes this note (the failed attempt didn't stay on the undo stack)
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => posterNotes(app).length).toBe(0);
});

test("when writing the snapshot fails, the note is still saved but no path to a nonexistent snapshot is recorded", async ({ app }) => {
  await openPoster(app);
  app.host.failWrites = /snapshots\//;
  await drawRect(app, "这里加个logo");
  await expect.poll(() => posterNotes(app).map((a) => a.body)).toEqual(["这里加个logo"]);
  expect(posterNotes(app)[0]).not.toHaveProperty("snapshot");
  await expect(toast(app)).toContainText("截图未能生成");
});

test("when the note was written and only REVIEW.md fails, the UI doesn't claim the note wasn't saved and the note stays", async ({ app }) => {
  app.allowLogErrors("REVIEW.md");
  await openPoster(app);
  app.host.failWrites = /REVIEW\.md$/;
  await drawRect(app, "这里加个logo");
  await expect.poll(() => posterNotes(app).map((a) => a.body)).toEqual(["这里加个logo"]);
  await expect(toast(app)).toContainText("REVIEW.md");
  await expect(toast(app)).not.toContainText("没存上");
  await expect(app.page.locator(".annot-badge")).toHaveCount(1);
});

/** Card "⋯" → Mark as Done. A bar at the top that appeared about a second after an item opened could push the card down and retract the action bar: if the click can't land, hover again and retry */
async function markResolved(app: App, id: string) {
  await expect(async () => {
    await app.page.mouse.move(5, 5);
    await card(app, id).hover();
    await card(app, id).locator('.act[title^="更多"]').click({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
}

test("another program keeps modifying the same notes file: after merge-and-rewrite still collides for 10 seconds the write is abandoned with a clear reason; the other side's changes are kept and the next save works as usual", async ({ app }) => {
  // It used to give up after 3 collisions, which several agents writing back in quick succession could easily use up: it is now time-based, 10 seconds (SAVE_RETRY_MS in annotationStore)
  test.setTimeout(60_000);
  app.allowLogErrors("saving notes");
  await app.open();
  const file = ANN(app, "assets__hero.png.json");
  let n = 0;
  app.host.beforeWriteAnnotation = (full) => {
    if (full !== file) return;
    const data = JSON.parse(readFileSync(full, "utf8"));
    data.annotations[1].replies.push({ author: "codex", body: `第 ${++n} 次`, at: new Date().toISOString() });
    writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
  };
  const started = Date.now();
  await markResolved(app, "k3f9a2");
  await expect(toast(app)).toContainText("批注文件持续被其他程序修改，本次更改未能保存", { timeout: 20_000 });
  expect(Date.now() - started).toBeGreaterThan(9_000);
  expect(n).toBeGreaterThan(3);
  expect(app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("open");
  await expect(card(app, "k3f9a2")).not.toHaveClass(/status-resolved/);
  // The other side stops: marking again saves, and all the replies it wrote are there
  app.host.beforeWriteAnnotation = null;
  await markResolved(app, "k3f9a2");
  await expect.poll(() => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("resolved");
  expect(app.annotations("assets__hero.png.json").find((a) => a.id === "done01")?.replies).toHaveLength(1 + n);
});

test("when the notes file is deleted externally, the UI drops those notes", async ({ app }) => {
  await app.open();
  await expect(card(app, "k3f9a2")).toBeVisible();
  rmSync(ANN(app, "assets__hero.png.json"));
  await expect(card(app, "k3f9a2")).toHaveCount(0);
  await expect(card(app, "done01")).toHaveCount(0);
});

test("when the notes file is deleted externally while a change is being written, the edited note is kept in a new file, the notes the user did not touch stay deleted, and nothing is reported as failed", async ({
  app,
}) => {
  await app.open();
  await expect(card(app, "k3f9a2")).toBeVisible();
  await expect(card(app, "done01")).toBeVisible();
  const file = ANN(app, "assets__hero.png.json");
  // The other side deletes the file after the UI has decided to write and before the shell compares: the write finds nothing where it expected
  // its last-read content, hands that back, and the UI merges (their delete + my edit)
  let deleted = false;
  app.host.beforeWriteAnnotation = (full) => {
    if (full !== file || deleted) return;
    deleted = true;
    rmSync(full);
  };
  await markResolved(app, "k3f9a2");
  await expect.poll(() => (existsSync(file) ? app.annotations("assets__hero.png.json").map((a) => `${a.id}:${a.status}`) : [])).toEqual(["k3f9a2:resolved"]);
  expect(deleted).toBe(true);
  await expect(card(app, "k3f9a2")).toHaveClass(/status-resolved/);
  await expect(card(app, "done01")).toHaveCount(0); // deleted by them, never touched here: stays deleted
  // The only toast is the usual confirmation (with Undo); error toasts are role=alert
  await expect(toast(app)).toContainText("已标记为已改");
  await expect(app.page.locator('.toast[role="alert"]')).toHaveCount(0);
  await expect(toast(app)).not.toContainText("未能保存");
});

test("when reading notes fails, the UI explains why, and F5 reads them again", async ({ app }) => {
  app.host.failMethods.add("readHomes");
  await app.open();
  await expect(toast(app)).toContainText("读取批注失败");
  await expect(card(app, "k3f9a2")).toHaveCount(0);
  app.host.failMethods.delete("readHomes");
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("F5");
  await expect(card(app, "k3f9a2")).toBeVisible();
});

// The canvas context menu keeps the note as it was at the moment of the right-click in its state (the card's ⋯ menu reads the latest on every re-render, so it doesn't have this problem)
test("when an agent writes back a note while the canvas context menu is open, changing its status from the menu afterwards doesn't overwrite the agent's reply", async ({ app }) => {
  await app.open();
  await app.page.locator(".annot-badge").first().click({ button: "right" });
  const wontfix = app.page.getByRole("menuitem", { name: "标记为不改" });
  await expect(wontfix).toBeVisible();
  const r = spawnSync(process.execPath, [CLI, "resolve", "k3f9a2", "-m", "改好了", "--root", app.project], { encoding: "utf8" });
  expect(r.status).toBe(0);
  await expect(card(app, "k3f9a2")).toHaveClass(/status-resolved/); // It synced in while the menu is still open
  await wontfix.click();
  await expect
    .poll(() => {
      const a = app.annotations("assets__hero.png.json").find((x) => x.id === "k3f9a2")!;
      return `${a.status}:${a.replies.length}`;
    })
    .toBe("wontfix:1");
  expect(readFileSync(ANN(app, "assets__hero.png.json"), "utf8")).toContain("改好了");
});

test("the first note on a large file (fingerprinting takes seconds): the note box shows Saving…, and pressing save twice saves only one note (it used to save two identical ones)", async ({ app }) => {
  app.host.delays = { sha256: 1500 };
  await openPoster(app);
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill("只要一条");
  await app.page.keyboard.press("Control+Enter");
  await expect(app.page.locator(".composer .btn-primary")).toHaveText("正在保存…");
  await expect(app.page.locator(".composer .btn-primary")).toBeDisabled();
  await app.page.keyboard.press("Control+Enter");
  await app.page.locator(".composer .btn-primary").click({ force: true });
  await expect(app.page.locator(".composer")).toHaveCount(0, { timeout: 5000 });
  await expect.poll(() => posterNotes(app).map((a) => a.body)).toEqual(["只要一条"]);
  await app.page.waitForTimeout(1800); // If the second save had gone through too, it would have finished writing by now
  expect(posterNotes(app).map((a) => a.body)).toEqual(["只要一条"]);
});

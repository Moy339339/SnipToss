// The core flows: startup, status changes reaching disk, syncing after an agent writes back, write races, Copy as Text, video, undo.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);

/** An agent writing back through the command line (the same CLI that .sniptoss/sniptoss.cmd called) */
function agent(app: App, ...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", app.project], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Command line failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** Clicks an item in the card's ⋯ menu */
async function cardMenu(app: App, id: string, item: string) {
  await card(app, id).hover();
  await card(app, id).locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: item }).click();
}

test.beforeEach(({ app }) => {
  app.host.prefs = { panelResolved: true }; // the notes panel lists resolved notes too
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")]; // both folders in the tree are expanded
});

test("Startup lists the items, opens the first one and shows its notes in the notes panel", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".lib-row", { hasText: "hero.png" })).toBeVisible();
  await expect(app.page.locator(".lib-row", { hasText: "clip.mp4" })).toBeVisible();
  await expect(app.page).toHaveTitle("hero.png");
  await expect(card(app, "k3f9a2")).toContainText("标题字太细了");
  await expect(card(app, "done01")).toHaveClass(/status-resolved/);
});

test("Marking a note as done in the notes panel is written to the notes file and REVIEW.md", async ({ app }) => {
  await app.open();
  await cardMenu(app, "k3f9a2", "标记为已改");
  await expect(card(app, "k3f9a2")).toHaveClass(/status-resolved/);
  await expect.poll(() => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("resolved");
  await expect.poll(() => app.review()).toMatch(/^# 待处理批注（\d+ 条）/);
  await expect.poll(() => app.review()).not.toContain("标题字太细了");
});

test("When an agent writes back through the command line, the UI syncs by itself", async ({ app }) => {
  await app.open();
  agent(app, "resolve", "k3f9a2", "-m", "改好了");
  await expect(card(app, "k3f9a2")).toHaveClass(/status-resolved/);
  await expect(app.page.locator(".toast")).toContainText("外部更新");
});

test("Write race: when an agent writes back while the UI edits the same file, both changes survive (ADR-0005)", async ({ app }) => {
  await app.open();
  await card(app, "done01").hover();
  await card(app, "done01").locator('.act[title^="更多"]').click();
  const reopen = app.page.getByRole("menuitem", { name: "重新打开" });
  await expect(reopen).toBeVisible();
  agent(app, "resolve", "k3f9a2", "-m", "改好了");
  await reopen.click(); // before the UI receives the sync notification (300 ms debounce)
  await expect.poll(() => app.annotations("assets__hero.png.json").map((a) => `${a.id}:${a.status}:${a.replies.length}`).sort()).toEqual([
    "done01:open:1",
    "k3f9a2:resolved:1",
  ]);
  await expect(card(app, "k3f9a2")).toHaveClass(/status-resolved/);
  await expect(card(app, "done01")).toHaveClass(/status-open/);
});

test("Undo reverts only the user's own step: a status an agent wrote back in between is kept", async ({ app }) => {
  await app.open();
  await cardMenu(app, "done01", "重新打开");
  await expect.poll(() => app.annotations("assets__hero.png.json").find((a) => a.id === "done01")?.status).toBe("open");
  agent(app, "resolve", "k3f9a2", "-m", "改好了");
  await expect(card(app, "k3f9a2")).toHaveClass(/status-resolved/);
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } }); // focus returns to the canvas so Ctrl+Z does not go into a text box
  await app.page.keyboard.press("Control+z");
  await expect.poll(() => app.annotations("assets__hero.png.json").map((a) => `${a.id}:${a.status}`).sort()).toEqual(["done01:resolved", "k3f9a2:resolved"]);
});

test("Undo keeps at most 200 steps: after 201 status changes and 200 undos the state is back to just after the 1st change and the Undo button is disabled", async ({ app }) => {
  test.setTimeout(120_000);
  await app.open();
  await card(app, "k3f9a2").click();
  const status = () => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status;
  // D toggles between done and open: every press is one step
  for (let i = 1; i <= 201; i++) {
    await app.page.keyboard.press("d");
    await expect.poll(status).toBe(i % 2 ? "resolved" : "open");
  }
  const undo = app.page.locator(".stage-header").getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeEnabled();
  for (let i = 1; i <= 200; i++) await app.page.keyboard.press("Control+z");
  // Step 1 has been pushed out: its effect (done) stays and there is nothing left to undo
  await expect(undo).toBeDisabled({ timeout: 60_000 }); // the 200 undos queue up and write to disk one by one
  await expect.poll(status).toBe("resolved");
});

test("Copy as Text contains the note text, the file's location in the project and its full path, and does not tell the AI to mark notes as done", async ({ app }) => {
  await app.open();
  await app.page.getByRole("button", { name: "复制成文字", exact: true }).click();
  const text = await app.clipboard();
  expect(text).toContain("标题字太细了");
  expect(text).toContain(`文件：assets/hero.png（完整路径：${join(app.project, "assets", "hero.png")}）`);
  expect(text).toContain("位置 画面右下（横 90%、纵 90%）");
  expect(text).not.toContain("resolve");
});

test("A video loads when opened and the notes panel lists its timed notes", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect.poll(() => app.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(1);
  await expect(card(app, "p0c7xe")).toContainText("这段水印去掉");
});

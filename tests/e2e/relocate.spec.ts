// Items that moved: after a folder is moved away, are the notes lost or left with a gap?
// Notes live in the project's own .sniptoss and move with the project; what breaks is the old location stored in the library. Right-click → Locate… points it at the new location,
// and dragging it in again is recognized as the same entry; a missing drive and a missing file are reported differently, and when only one file is moved away its notes are still read

import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const toast = (app: App) => app.page.locator(".toast");
const row = (app: App, name: string) => app.page.locator(".lib-row", { hasText: name });

test.beforeEach(({ app }) => {
  app.host.prefs = { panelResolved: true };
});

/** Moves the test project to temp\挪过去\project (a non-ASCII folder name) and returns the new location */
function moveProject(app: App): string {
  const to = join(app.temp, "挪过去", "project");
  mkdirSync(join(app.temp, "挪过去"));
  renameSync(app.project, to);
  return to;
}

test("the project folder was moved: its library entry says it can't be found and suggests Locate… from the right-click menu; pointing it at the new location replaces it in place and the items and notes come back", async ({ app }) => {
  const to = moveProject(app);
  await app.open();
  await expect(row(app, "project")).toContainText("找不到：可能已被移动、重命名或删除（右键单击「定位…」）");
  app.host.nextPickFolder = to;
  await row(app, "project").click({ button: "right" });
  await app.page.getByRole("menuitem", { name: /定位/ }).click();
  await expect(toast(app)).toContainText(`已将「project」更新到新位置：${to}`);
  expect(app.host.entries.map((e) => e.path)).toEqual([to]);
  await expect(row(app, "hero.png")).toBeVisible();
  // The notes are in the project's own .sniptoss and move with it
  await row(app, "hero.png").click();
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toBeVisible();
});

test("adding the new location after a move is recognized as the same entry and replaces it in place (the pin is kept), without an extra entry in the library", async ({ app }) => {
  app.host.entries = [{ path: app.project, pinned: true }];
  const to = moveProject(app);
  await app.open();
  app.host.nextPickFolder = to;
  await app.page.keyboard.press("Control+Shift+O");
  await expect(toast(app)).toContainText(`已识别：「project」已移动到 ${to}`);
  expect(app.host.entries).toEqual([{ path: to, pinned: true }]);
  await expect(row(app, "hero.png")).toBeVisible();
});

test("a whole drive that isn't connected (USB drive not plugged in) is reported as the drive being disconnected, not as deleted", async ({ app }) => {
  app.host.entries = [{ path: "Z:\\不在的盘\\项目", pinned: false }];
  app.host.offlineDrives = ["Z:\\"];
  await app.open();
  await expect(row(app, "项目")).toContainText("所在磁盘未连接");
  await expect(row(app, "项目")).not.toContainText("删除");
});

test("only a single added file was moved away while the project's .sniptoss is still there: its notes are still read and listed in the item-not-found group of the notes panel", async ({ app }) => {
  app.host.entries = [{ path: join(app.project, "assets", "hero.png"), pinned: false }];
  rmSync(join(app.project, "assets", "hero.png"));
  await app.open();
  await expect(row(app, "hero.png")).toContainText("找不到");
  // It is filed under its original project (it used to be filed under the assets folder, and none of its notes were read); click the project and the notes panel lists its notes
  await row(app, "project").first().click();
  await expect(app.page.locator(".group-head.is-missing", { hasText: "hero.png" })).toContainText("找不到素材");
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toBeVisible();
});

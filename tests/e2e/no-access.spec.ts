// An item the system won't let the app read (NoAccess.tsx, `readable` in host.ts). To the page a refused file looks the same as a damaged
// one, so when an item fails to open the page asks the shell; a refusal (code denied) gets its own page that says where access is granted,
// instead of "the file may be damaged". Granting access happens elsewhere (System Settings on the Mac, the file's Properties on Windows),
// so the page asks again when the window gets focus back and loads the item once it can be read. MockHost.unreadable stands in for the
// refusal: readable says denied and the harness answers 403 for the file

import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const asMac = (app: App) =>
  app.page.addInitScript(() => {
    (window as unknown as { __e2ePlatform: string }).__e2ePlatform = "mac";
  });

const toolBtn = (app: App, name: string) => app.page.locator(`.hdr-tools .tool-btn[aria-label="${name}"]`);
/** The window gets focus back (the user returns from System Settings or the file's Properties) */
const comeBack = (app: App) => app.page.evaluate(() => window.dispatchEvent(new Event("focus")));
const heroWidth = (app: App) =>
  app.page.evaluate(() => [...document.images].find((i) => i.src.includes("hero.png") && i.complete)?.naturalWidth ?? -1);

test("an image the app may not read: the canvas says there is no permission and where to grant it, and loads the image once access is granted and the window gets focus back", async ({
  app,
}) => {
  const hero = join(app.project, "assets", "hero.png");
  app.host.unreadable = [hero];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("没有权限读取这个文件");
  await expect(alert).toContainText("请在文件的「属性 → 安全」中为当前 Windows 账户添加读取权限");
  await expect(alert).not.toContainText("损坏");
  await expect(alert.getByRole("button", { name: "打开系统设置" })).toHaveCount(0);
  for (const name of ["图钉", "矩形", "画笔", "箭头"]) await expect(toolBtn(app, name)).toBeDisabled();
  await alert.getByRole("button", { name: "在资源管理器中显示" }).click();
  expect(app.host.revealed).toEqual([hero]);

  // Coming back while it is still refused asks again and changes nothing
  const asked = () => app.host.calls.filter((c) => c.method === "readable").length;
  const before = asked();
  await comeBack(app);
  await expect.poll(asked).toBe(before + 1);
  await expect(alert).toContainText("没有权限读取这个文件");

  app.host.unreadable = [];
  await comeBack(app);
  await expect.poll(() => heroWidth(app)).toBe(640);
  await expect(app.page.getByRole("alert")).toHaveCount(0);
  for (const name of ["图钉", "矩形", "画笔", "箭头"]) await expect(toolBtn(app, name)).toBeEnabled();
});

test("on the Mac the page points to Files & Folders, and its button opens System Settings there", async ({ app }) => {
  await asMac(app);
  app.host.unreadable = [join(app.project, "assets")];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("没有权限读取这个文件");
  await expect(alert).toContainText("macOS 没有允许超级批注访问这个文件夹。点「打开系统设置」，在「文件与文件夹」里为超级批注打开");
  await expect(alert.getByRole("button", { name: "在访达中显示" })).toBeVisible();
  await alert.getByRole("button", { name: "打开系统设置" }).click();
  await expect.poll(() => app.host.filesAccessOpened).toBe(1);
});

test("a video the app may not read gets the same page, not the unsupported-codec explanation", async ({ app }) => {
  app.host.unreadable = [join(app.project, "video", "clip.mp4")];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "video" }).click();
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("没有权限读取这个文件");
  await expect(alert).not.toContainText("HEVC");
});

/** A folder outside the project with one image in it, added to the library and refused by the system */
function lockedFolder(app: App) {
  const locked = join(app.temp, "locked");
  mkdirSync(locked);
  copyFileSync(join(app.project, "assets", "hero.png"), join(locked, "hero.png"));
  app.host.entries.push({ path: locked, pinned: false });
  app.host.unreadable = [locked];
  return locked;
}

test("a folder in the library the app may not read: its row says so instead of 'no items', clicking it shows where access is granted, and its items appear and open once access is granted and the window gets focus back", async ({
  app,
}) => {
  const locked = lockedFolder(app);
  await app.open();
  const row = app.page.locator(".lib-row.is-project", { hasText: "locked" });
  await expect(row.locator(".lib-sub")).toHaveText("没有权限读取");
  await row.click();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("没有权限读取这个文件夹");
  await expect(alert).toContainText("请在文件夹的「属性 → 安全」中为当前 Windows 账户添加读取权限");
  await expect(app.page.locator(".hdr-meta")).toHaveText("未选择素材");
  await alert.getByRole("button", { name: "在资源管理器中显示" }).click();
  expect(app.host.revealed).toEqual([locked]);

  app.host.unreadable = [];
  await comeBack(app);
  await expect(row.locator(".lib-sub")).not.toHaveText("没有权限读取");
  // As after a click on a project row: the row stays selected and the canvas opens the first item inside
  await expect(app.page.locator(".hdr-file")).toHaveAttribute("title", join(locked, "hero.png"));
  await expect.poll(() => heroWidth(app)).toBe(640);
  await expect(app.page.getByRole("alert")).toHaveCount(0);
});

test("a folder added on its own inside a project (an entry row) is marked the same way", async ({ app }) => {
  const video = join(app.project, "video");
  app.host.entries = [{ path: video, pinned: false }];
  app.host.unreadable = [video];
  await app.open();
  const row = app.page.locator(".lib-row:not(.is-project)", { hasText: "video" });
  await expect(row.locator(".lib-sub")).toHaveText("没有权限读取");
  await row.click();
  await expect(app.page.getByRole("alert")).toContainText("没有权限读取这个文件夹");
});

test("on the Mac a folder it may not read points to Files & Folders, with the button to open it", async ({ app }) => {
  await asMac(app);
  lockedFolder(app);
  await app.open();
  await app.page.locator(".lib-row.is-project", { hasText: "locked" }).click();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("没有权限读取这个文件夹");
  await expect(alert).toContainText("在「文件与文件夹」里为超级批注打开");
  await alert.getByRole("button", { name: "打开系统设置" }).click();
  await expect.poll(() => app.host.filesAccessOpened).toBe(1);
});

test("clicking an item after the folder page leaves the page", async ({ app }) => {
  lockedFolder(app);
  await app.open();
  await app.page.locator(".lib-row.is-project", { hasText: "locked" }).click();
  await expect(app.page.getByRole("alert")).toContainText("没有权限读取这个文件夹");
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page.getByRole("alert")).toHaveCount(0);
  await expect(app.page.locator(".hdr-name")).toHaveText("poster.jpg");
});

test("the page is in the interface language", async ({ app }) => {
  app.host.prefs = { language: "en" };
  app.host.unreadable = [join(app.project, "assets", "hero.png")];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("No permission to read this file");
  await expect(alert).toContainText("Give your Windows account read access under the file's Properties → Security");
});

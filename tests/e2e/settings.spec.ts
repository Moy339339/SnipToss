// Settings, dialogs and startup notices:
// Restore Defaults asks first, a failure to read the capture settings is explained, shortcut recording, validation of skipped folders, the command-line entry toggle, startup notices queue up, reloading the page doesn't lose an unfinished note, ...

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";
import { VERSION_LABEL } from "./mock-host";

const toast = (app: App) => app.page.locator(".toast");
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });

async function openSettings(app: App, tab: string) {
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: tab }).click();
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("Restore Defaults asks for confirmation first and says exactly what it covers; Esc closes only the confirm dialog and Settings stays open", async ({ app }) => {
  app.host.prefs = { author: "小王", backdrop: "plain" };
  await app.open();
  await openSettings(app, "高级");
  await app.page.getByRole("button", { name: "恢复默认" }).click();
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toContainText("恢复默认设置？");
  await expect(dialog).toContainText("截图批注、托盘与开机启动、系统集成、素材列表和窗口位置不受影响");
  await app.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(app.page.locator(".settings")).toBeVisible();
  expect(app.host.prefs?.author).toBe("小王");
  await app.page.getByRole("button", { name: "恢复默认" }).click();
  await dialog.getByRole("button", { name: "恢复默认" }).click();
  await expect(toast(app)).toContainText("已恢复默认设置");
  // Back to the default: no longer written to the settings file (only changed items are stored, see storedPrefs in prefs.ts)
  await expect.poll(() => app.host.prefs?.author).toBeUndefined();
  await expect(app.page.locator(".settings")).toBeVisible();
  // The record of which files are New in the library is not a setting and isn't cleared with them (otherwise all the old files would be marked New again)
  expect(Object.keys((app.host.prefs?.fresh as { since?: object } | undefined)?.since ?? {})).toHaveLength(1);
});

test("when the Screen Capture page fails to load it explains why and can retry (the whole page used to be blank)", async ({ app }) => {
  app.host.failMethods.add("captureSettings");
  await app.open();
  await openSettings(app, "截图批注");
  await expect(app.page.locator(".settings-body .error")).toContainText("无法读取此页设置");
  app.host.failMethods.delete("captureSettings");
  await app.page.locator(".settings-body").getByRole("button", { name: "重试" }).click();
  await expect(app.page.locator(".hotkey-input")).toBeVisible();
});

test("recording the capture shortcut: Shift plus a letter alone is rejected and the box says why; Ctrl+Alt+arrow key can be recorded", async ({ app }) => {
  await app.open();
  await openSettings(app, "截图批注");
  const input = app.page.locator(".hotkey-input");
  await input.click();
  await app.page.keyboard.press("Shift+KeyA");
  await expect(input).toContainText("不能只用 Shift");
  expect(app.host.capture.hotkey).toBe("Ctrl+Alt+A");
  await app.page.keyboard.press("Control+Alt+ArrowUp");
  await expect.poll(() => app.host.capture.hotkey).toBe("Ctrl+Alt+Up");
});

test("skipped folders: names that differ only in case count as duplicates, and names with a path are rejected", async ({ app }) => {
  await app.open();
  await openSettings(app, "高级");
  const input = app.page.getByPlaceholder("输入名称后按 Enter");
  await input.fill("Node_Modules");
  await input.press("Enter");
  await input.fill("assets/old");
  await input.press("Enter");
  await expect(toast(app)).toContainText("请只填写文件夹名称");
  await input.fill("out");
  await input.press("Enter");
  await expect
    .poll(() => (app.host.prefs?.skipDirs as string[] | undefined)?.join(","))
    .toBe("node_modules,bin,obj,dist,build,__pycache__,venv,out");
});

test("the sniptoss.cmd that earlier versions put into projects (used to let an AI mark notes as done) is deleted when the project is opened, and Settings no longer has that toggle", async ({ app }) => {
  const shim = join(app.project, ".sniptoss", "sniptoss.cmd");
  writeFileSync(shim, '@echo off\r\nnode x --root "%~dp0.." %*\r\n');
  await app.open();
  await expect.poll(() => existsSync(shim)).toBe(false);
  await openSettings(app, "复制批注");
  await expect(app.page.locator(".set-row", { hasText: "AI 改完能标成" })).toHaveCount(0);
});

test("context menu toggle: when the shell reports success but the registry wasn't actually written, the UI says the change failed instead of saying it was added", async ({ app }) => {
  app.host.shellIgnoresWrites = true;
  await app.open();
  await openSettings(app, "系统集成");
  await app.page.getByRole("switch").first().click();
  await expect(toast(app)).toContainText("未能更改");
  await expect(app.page.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");
});

test("when the capture shortcut couldn't be set at startup (held by another program), a notice says so and Open Settings opens that page", async ({ app }) => {
  app.host.capture.hotkeyError = "Ctrl Alt A 已经被别的程序占用了，换一个吧";
  await app.open();
  await expect(toast(app)).toContainText("截图快捷键未能注册");
  await toast(app).getByRole("button", { name: "打开设置" }).click();
  await expect(app.page.locator(".settings-tab.is-on")).toHaveText("截图批注");
});

test("when the default capture shortcut types a character in the keyboard layout (AltGr) and the shell replaced it, a notice says what it was replaced with and why, and Open Settings opens that page", async ({ app }) => {
  app.host.capture.hotkey = "Shift+PrintScreen";
  app.host.capture.hotkeyMoved = { from: "Ctrl+Alt+A", to: "Shift+PrintScreen", typed: "ą" };
  await app.open();
  await expect(toast(app)).toContainText("截图快捷键已改为 Shift PrintScreen：Ctrl Alt A 在本机的键盘布局中用于输入「ą」");
  await expect(app.page.locator(".titlebar-action").first()).toHaveAttribute("title", /Shift PrintScreen/);
  await toast(app).getByRole("button", { name: "打开设置" }).click();
  await expect(app.page.locator(".settings-tab.is-on")).toHaveText("截图批注");
  // The replacement doesn't type anything: the settings page shows the usual description
  await expect(app.page.locator(".set-row", { hasText: "快捷键" }).first()).toContainText("全局快捷键");
});

test("when the fallback shortcuts are all taken too, a notice says the capture shortcut is disabled and to set one in Settings", async ({ app }) => {
  app.host.capture.hotkey = "";
  app.host.capture.hotkeyMoved = { from: "Ctrl+Alt+A", to: "", typed: "ą" };
  await app.open();
  await expect(toast(app)).toContainText("截图快捷键已停用：Ctrl Alt A 在本机的键盘布局中用于输入「ą」");
});

test("a shortcut recorded by the user that types a character (AltGr) is used anyway, and the settings page says which character it will block; choosing another shortcut removes the warning", async ({ app }) => {
  app.host.typingKeys = { "Ctrl+Alt+E": "ę" };
  await app.open();
  await openSettings(app, "截图批注");
  const input = app.page.locator(".hotkey-input");
  const row = app.page.locator(".set-row", { has: input });
  await input.click();
  await app.page.keyboard.press("Control+Alt+KeyE");
  await expect.poll(() => app.host.capture.hotkey).toBe("Ctrl+Alt+E");
  await expect(row.locator(".text-warn")).toHaveText("Ctrl Alt E 在本机的键盘布局中用于输入「ę」，用作截图快捷键后将无法输入该字符。");
  await input.click();
  await app.page.keyboard.press("Control+Alt+ArrowUp");
  await expect.poll(() => app.host.capture.hotkey).toBe("Ctrl+Alt+Up");
  await expect(row.locator(".text-warn")).toHaveCount(0);
});

test("both startup notices must be seen: the settings file was corrupt + the first launch after the rename, one after the other", async ({ app }) => {
  app.host.startupNotice = "设置文件坏了，已经从备份恢复";
  app.host.renamedFromPizhu = true;
  await app.open();
  await expect(toast(app)).toContainText("设置文件坏了");
  // A brief notice from something else doesn't push it out
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect(toast(app)).toContainText("已复制");
  await expect(toast(app)).toContainText("设置文件坏了", { timeout: 10_000 });
  await toast(app).getByRole("button", { name: "知道了" }).click();
  await expect(toast(app)).toContainText("技术名称已改为 SnipToss");
  await expect(toast(app)).not.toContainText("pizhu");
  await toast(app).getByRole("button", { name: "知道了" }).click();
  await expect(toast(app)).toHaveCount(0);
});

test("after the page reloads (a new drive, the UI process crashed), unfinished text in the note box is still there to continue writing", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("n");
  await app.page.locator(".composer-text").fill("标题再大一号");
  await app.page.waitForTimeout(1200); // The draft is saved once a second
  await app.page.reload();
  await expect(app.page.locator(".composer-text")).toHaveValue("标题再大一号");
});

test("version number: it looks normal when the UI and the app match; on a mismatch it turns red, and the explanation avoids developer wording such as npm", async ({ app }) => {
  await app.open();
  const tag = app.page.locator(".app-version");
  await expect(tag).toHaveText(VERSION_LABEL);
  await expect(tag).not.toHaveClass(/is-mismatch/);
  app.host.appInfoPatch = { version: "1.0.0-beta.1" };
  await app.page.reload();
  await expect(tag).toHaveClass(/is-mismatch/);
  await expect(tag).toHaveAttribute("title", /重新安装/);
  await expect(tag).not.toHaveAttribute("title", /npm/);
});

test("when the settings page fails to render, the error box is visible in the overlay and can be closed; after closing, Ctrl+, opens Settings again", async ({ app }) => {
  app.allowLogErrors("UI error (settings)");
  app.host.appInfoPatch = { exe: { broken: true } }; // The Advanced page's app location draws it as text → React throws
  await app.open();
  await openSettings(app, "高级");
  const box = app.page.locator(".error-boundary.is-dialog");
  await expect(box).toBeVisible();
  await expect(box).toContainText("设置发生错误");
  await box.getByRole("button", { name: "关闭" }).click();
  await expect(box).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await expect(app.page.locator(".settings")).toBeVisible();
});

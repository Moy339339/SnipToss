// Check for updates (UI updates.ts ↔ shell app/Updates.cs): Help → Check for Updates… has three outcomes (a new version / already up to date / couldn't check);
// when the shell finds a new version by itself after startup (updateAvailable), the title bar shows a "new version" pill that opens the download page, and the Help menu entry becomes "Download X…";
// Settings → General → "Check for updates automatically" is saved to settings (the shell reads Prefs.updateCheck)

import { expect, test, type App } from "./harness";
import { VERSION_LABEL } from "./mock-host";

const toast = (app: App) => app.page.locator(".toast");
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const help = (app: App) => app.page.locator(".menubar button", { hasText: "帮助" }).click();
const RELEASE = "https://github.com/Moy339339/SnipToss/releases/tag/v1.0.0-beta.99";

test("Help → Check for Updates…: a new version shows its version number with an Open Download Page button, the menu entry then becomes Download; the title bar shows the new-version pill", async ({ app }) => {
  await app.open();
  app.host.updateResult = { newer: { version: "1.0.0-beta.99", url: RELEASE, prerelease: true }, error: null };
  await expect(app.page.locator(".titlebar-update")).toHaveCount(0);
  await help(app);
  await menuItem(app, "检查更新…").click();
  await expect(toast(app)).toContainText("有新版本：Beta 99");
  await toast(app).getByRole("button", { name: "打开下载页" }).click();
  await expect.poll(() => app.host.opened.at(-1)).toBe(RELEASE);
  await expect(app.page.locator(".titlebar-update")).toHaveText("有新版本");
  await help(app);
  await menuItem(app, "下载新版本 Beta 99…").click();
  expect(app.host.opened.filter((u) => u === RELEASE)).toHaveLength(2);
  expect(app.host.calls.filter((c) => c.method === "checkUpdates")).toHaveLength(1); // Once a new version is known it isn't checked again
});

test("Help → Check for Updates…: when up to date it shows the current version; when the check fails it asks to check the network (the cause goes only to the log)", async ({ app }) => {
  await app.open();
  await help(app);
  await menuItem(app, "检查更新…").click();
  await expect(toast(app)).toContainText(`已是最新版本（${VERSION_LABEL}）`);
  app.host.updateResult = { newer: null, error: "HTTP 404" };
  await help(app);
  await menuItem(app, "检查更新…").click();
  await expect(toast(app)).toContainText("无法检查更新，请检查网络连接后重试。");
  await expect(toast(app)).not.toContainText("404");
  await expect(app.page.locator(".titlebar-update")).toHaveCount(0);
});

test("a new version found automatically after startup: the title bar pill shows the version number on hover and opens the download page on click, without interrupting with a toast", async ({ app }) => {
  await app.open();
  app.host.announceUpdate({ version: "1.1.0", url: "https://github.com/Moy339339/SnipToss/releases/tag/v1.1.0", prerelease: false });
  const pill = app.page.locator(".titlebar-update");
  await expect(pill).toHaveText("有新版本");
  await expect(pill).toHaveAttribute("title", "v1.1.0 已发布：单击打开下载页");
  await expect(toast(app)).toHaveCount(0);
  await pill.click();
  await expect.poll(() => app.host.opened.at(-1)).toBe("https://github.com/Moy339339/SnipToss/releases/tag/v1.1.0");
});

test("Settings → General → Check for updates automatically: on by default, and turning it off is saved to settings; About → Privacy states that the app only goes online when checking for updates", async ({ app }) => {
  await app.open();
  await app.page.keyboard.press("Control+,");
  const row = app.page.locator(".set-row", { hasText: "自动检查更新" });
  await expect(row).toContainText("只查询版本号，不发送任何个人信息");
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await row.getByRole("switch").click();
  await expect.poll(() => app.host.prefs?.updateCheck).toBe(false);
  await app.page.locator(".settings-tab", { hasText: /^关于$/ }).click();
  await expect(app.page.locator(".set-row", { hasText: "隐私" })).toContainText("程序只在检查更新时联网");
});

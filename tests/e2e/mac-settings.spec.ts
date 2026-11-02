// Settings on the Mac: messages written for it (id.mac, macKeys.ts) replace the Windows ones, so no page names Windows, File Explorer
// or the tray there; System Integration has nothing to switch and does not ask the shell for the File Explorer context menu, which the
// Mac shell does not have. A test turns the Mac on by setting __e2ePlatform before the page loads (harness.ts)

import { expect, test, type App } from "./harness";

const asMac = (app: App) =>
  app.page.addInitScript(() => {
    (window as unknown as { __e2ePlatform: string }).__e2ePlatform = "mac";
  });

async function openTab(app: App, name: string) {
  await app.page.locator(".settings-tab", { hasText: new RegExp(`^${name}$`) }).click();
  await expect(app.page.locator(".settings-head")).toContainText(name);
}

test("on the Mac, the settings pages speak of macOS, Finder, the Dock and the menu bar, never of Windows, File Explorer or the tray", async ({
  app,
}) => {
  await asMac(app);
  await app.open();
  await app.page.keyboard.press("Meta+,");
  const body = app.page.locator(".settings-body");
  for (const tab of ["常规", "截图批注", "系统集成", "高级"]) {
    await openTab(app, tab);
    await expect(body).not.toContainText(/Windows|资源管理器|托盘|注册表/);
  }
  await openTab(app, "常规");
  await expect(body).toContainText("关闭窗口时保留在菜单栏");
  await expect(body).toContainText("登录时打开");
  await expect(body).toContainText("macOS 的首选语言");
});

test("on the Mac, System Integration lists Open With in Finder and the Dock icon, with no switch and no error", async ({ app }) => {
  await asMac(app);
  await app.open();
  await app.page.keyboard.press("Meta+,");
  await openTab(app, "系统集成");
  const body = app.page.locator(".settings-body");
  await expect(body).toContainText("访达中的「打开方式」");
  await expect(body).toContainText("拖放到程序坞图标");
  await expect(body).not.toContainText("无法读取");
  await expect(body.getByRole("switch")).toHaveCount(0);
});

test("on the Mac, neither the Help menu nor Settings → Advanced offers developer tools (the Mac shell has none)", async ({ app }) => {
  await app.page.addInitScript(() => {
    const w = window as unknown as { __e2ePlatform: string; __e2eNativeMenus: boolean };
    w.__e2ePlatform = "mac";
    w.__e2eNativeMenus = true;
  });
  await app.open();
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  expect(JSON.stringify(app.host.menusSent[app.host.menusSent.length - 1])).not.toContain("开发者工具");
  await app.page.keyboard.press("Meta+,");
  await openTab(app, "高级");
  await expect(app.page.locator(".settings-body")).not.toContainText("开发者工具");
});

test("on the Mac, About and the diagnostic info name the system's WebKit as the runtime, not .NET or WebView2", async ({ app }) => {
  await asMac(app);
  app.host.appInfoPatch = { dotnet: "", webview2: "", webkit: "21623.1.14" };
  await app.open();
  await app.page.keyboard.press("Meta+,");
  await openTab(app, "关于");
  const row = (label: string) => app.page.locator(".set-row", { has: app.page.locator(".set-label", { hasText: new RegExp(`^${label}$`) }) });
  await expect(row("运行环境")).toContainText("WebKit 21623.1.14");
  await expect(row("运行环境")).not.toContainText(/NET|WebView2/);
  await row("反馈问题").getByRole("button", { name: "复制诊断信息" }).click();
  await expect.poll(() => app.clipboard()).toContain("WebKit: 21623.1.14");
  expect(await app.clipboard()).not.toMatch(/NET|WebView2/);
});

test("on Windows, System Integration still offers the File Explorer context menu", async ({ app }) => {
  await app.open();
  await app.page.keyboard.press("Control+,");
  await openTab(app, "系统集成");
  await expect(app.page.locator(".settings-body")).toContainText("资源管理器右键菜单");
});

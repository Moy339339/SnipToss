// Settings → Screen Capture on the Mac (SettingsDialog.tsx, `screenAccess` and `openScreenAccessSettings` in host.ts): macOS lets an app
// capture the screen only after the user has allowed it, and the page says whether it has. The Windows shell sends no `screenAccess`, and
// the page then says nothing about it. A test turns the Mac on by setting __e2ePlatform before the page loads (harness.ts)

import { expect, test, type App } from "./harness";

const asMac = (app: App) =>
  app.page.addInitScript(() => {
    (window as unknown as { __e2ePlatform: string }).__e2ePlatform = "mac";
  });

async function openCaptureSettings(app: App, mac: boolean) {
  await app.page.keyboard.press(mac ? "Meta+," : "Control+,");
  await app.page.locator(".settings-tab", { hasText: /^截图批注$/ }).click();
  // The page is there once the shortcut row is
  await expect(app.page.locator(".hotkey-input")).toBeVisible();
}

const accessRow = (app: App) => app.page.locator(".set-row").filter({ has: app.page.getByText("屏幕录制权限", { exact: true }) });

test("on the Mac, Settings → Screen Capture says when macOS has not allowed screen recording, and its button opens System Settings", async ({ app }) => {
  await asMac(app);
  app.host.capture.screenAccess = false;
  await app.open();
  await openCaptureSettings(app, true);
  const row = accessRow(app);
  await expect(row).toContainText("macOS 尚未允许超级批注录制屏幕");
  await row.getByRole("button", { name: "打开系统设置" }).click();
  await expect.poll(() => app.host.screenAccessOpened).toBe(1);
});

test("on the Mac, once screen recording is allowed the row says so and that macOS may ask again, with no button", async ({ app }) => {
  await asMac(app);
  app.host.capture.screenAccess = true;
  await app.open();
  await openCaptureSettings(app, true);
  const row = accessRow(app);
  await expect(row).toContainText("已允许");
  await expect(row).toContainText("再次询问");
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("on Windows, which needs no permission to capture, there is no screen recording row", async ({ app }) => {
  await app.open();
  await openCaptureSettings(app, false);
  await expect(accessRow(app)).toHaveCount(0);
});

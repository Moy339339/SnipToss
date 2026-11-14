// Settings → Screen Capture on the Mac (SettingsDialog.tsx, `screenAccess` and `openScreenAccessSettings` in host.ts): macOS lets an app
// capture the screen only after the user has allowed it, and the page says whether it has. The Windows shell sends no `screenAccess`, and
// the page then says nothing about it. A test turns the Mac on by setting __e2ePlatform before the page loads (harness.ts)

import { join } from "node:path";
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

// The page no longer brings up a hint about the permission (it used to, next to Capture, at launch): macOS is asked the first time Screen
// Capture is used, which is the Mac shell's part. What the page shows on a Mac without the permission is the usual hint next to Capture
// after the guide (onboarding.ts, Hint.tsx), the same as on Windows. Every other test counts the hints as seen (onboarded in mock-host);
// these switch that back
const accessHint = (app: App) => app.page.locator('.hint[data-hint="screenAccess"]');
const captureHint = (app: App) => app.page.locator('.hint[data-hint="capture"]');
const seen = (app: App) => (app.host.prefs?.onboarding as string[] | undefined) ?? [];

/** A Mac without the permission; the guide starts on the first item shown and is skipped, which brings the Capture hint */
async function openWithoutAccess(app: App) {
  await asMac(app);
  app.host.capture.screenAccess = false;
  app.host.onboarded = false;
  app.host.prefs = { onboarding: ["welcome"] };
  await app.open();
  const guide = app.page.locator(".guide");
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "跳过", exact: true }).click();
  await expect(guide).toHaveCount(0);
}

test("on the Mac without the permission, launching says nothing about screen recording (macOS asks at the first capture); after the guide the Capture hint comes below Capture as on Windows", async ({
  app,
}) => {
  await openWithoutAccess(app);
  const hint = captureHint(app);
  await expect(hint).toContainText("要批注屏幕上的内容");
  await expect(hint).toHaveAttribute("data-side", "below");
  // Below Capture without covering it
  const [h, c] = [(await hint.boundingBox())!, (await app.page.locator(".titlebar-split").boundingBox())!];
  expect(h.y).toBeGreaterThanOrEqual(c.y + c.height);
  expect(seen(app)).toContain("hint.capture");
  // Nothing about the permission, and System Settings is not opened by the page
  await expect(accessHint(app)).toHaveCount(0);
  await expect(hint).not.toContainText("录制屏幕");
  expect(seen(app)).not.toContain("hint.screenAccess");
  expect(app.host.screenAccessOpened).toBe(0);
  // Once only
  await hint.getByRole("button", { name: "知道了" }).click();
  await expect(hint).toHaveCount(0);
  await app.page.reload();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  await app.page.waitForTimeout(1200);
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("on the Mac the Capture hint goes at a press elsewhere, and that press still does what it does", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await openWithoutAccess(app);
  await expect(captureHint(app)).toBeVisible();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(captureHint(app)).toHaveCount(0);
  await expect(app.page).toHaveTitle("poster.jpg");
  expect(app.host.screenAccessOpened).toBe(0);
});

test("with the permission, or on Windows, there is no screen recording hint", async ({ app }) => {
  await asMac(app);
  app.host.capture.screenAccess = true;
  app.host.onboarded = false;
  app.host.prefs = { onboarding: ["tour"] };
  await app.open();
  await app.page.waitForTimeout(1200);
  await expect(accessHint(app)).toHaveCount(0);
  expect(seen(app)).not.toContain("hint.screenAccess");
});

test("on Windows, which asks for no permission, there is no screen recording hint", async ({ app }) => {
  app.host.onboarded = false;
  app.host.prefs = { onboarding: ["tour"] };
  await app.open();
  await app.page.waitForTimeout(1200);
  await expect(accessHint(app)).toHaveCount(0);
});
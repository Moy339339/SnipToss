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

// The hint before the first capture on a Mac without the permission (onboarding.ts, Hint.tsx): once, next to Capture, with a button to where
// it is allowed. Every other test counts it as seen (onboarded in mock-host); these switch that back
const accessHint = (app: App) => app.page.locator('.hint[data-hint="screenAccess"]');
const seen = (app: App) => (app.host.prefs?.onboarding as string[] | undefined) ?? [];

async function openWithoutAccess(app: App) {
  await asMac(app);
  app.host.capture.screenAccess = false;
  app.host.onboarded = false;
  app.host.prefs = { onboarding: ["tour"] };
  await app.open();
}

test("on the Mac without the permission, a hint below Capture says so once, and its button leads to System Settings", async ({ app }) => {
  await openWithoutAccess(app);
  const hint = accessHint(app);
  await expect(hint).toContainText("使用截图批注前，需要允许超级批注录制屏幕。");
  await expect(hint).toHaveAttribute("data-side", "below");
  // Below Capture without covering it
  const [h, c] = [(await hint.boundingBox())!, (await app.page.locator(".titlebar-split").boundingBox())!];
  expect(h.y).toBeGreaterThanOrEqual(c.y + c.height);
  // Two buttons, the main one on the right, as far apart as a dialog's
  const ok = hint.getByRole("button", { name: "知道了" });
  const open = hint.getByRole("button", { name: "打开系统设置" });
  const [a, b] = [(await ok.boundingBox())!, (await open.boundingBox())!];
  expect(Math.round(b.x - (a.x + a.width))).toBe(8);
  expect(seen(app)).toContain("hint.screenAccess");
  await open.click();
  await expect.poll(() => app.host.screenAccessOpened).toBe(1);
  await expect(hint).toHaveCount(0);
  // Once only
  await app.page.reload();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  await app.page.waitForTimeout(1200);
  await expect(hint).toHaveCount(0);
});

test("the screen recording hint goes at a press elsewhere, and that press still does what it does", async ({ app }) => {
  await openWithoutAccess(app);
  await expect(accessHint(app)).toBeVisible();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(accessHint(app)).toHaveCount(0);
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
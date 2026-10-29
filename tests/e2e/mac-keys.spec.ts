// Keys on the Mac (keys.ts, hotkey.ts, macKeys.ts; `platform` in host.ts): the Command key is the Ctrl of the shortcut names, the real Control
// key is nothing, Option goes by the key position, and shortcuts are written with the Mac's symbols. Without the Mac flag nothing changes.
// A test turns the Mac on by setting __e2ePlatform before the page loads (the fake chrome.webview in harness.ts reads it)

import { join } from "node:path";
import { expect, test, type App } from "./harness";

const asMac = (app: App) =>
  app.page.addInitScript(() => {
    (window as unknown as { __e2ePlatform: string }).__e2ePlatform = "mac";
  });

const POSTER = (app: App) => join(app.project, "assets", "poster.jpg");

test("on the Mac Command+O adds files, where Windows has Ctrl+O", async ({ app }) => {
  await asMac(app);
  await app.open();
  app.host.nextPickFiles = [POSTER(app)];
  await app.page.keyboard.press("Meta+o");
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("on the Mac the real Control key does not trigger the shortcut", async ({ app }) => {
  await asMac(app);
  await app.open();
  app.host.nextPickFiles = [POSTER(app)];
  await app.page.keyboard.press("Control+o");
  await app.page.waitForTimeout(400);
  expect(app.host.nextPickFiles).toEqual([POSTER(app)]);
  await expect(app.page).not.toHaveTitle("poster.jpg");
});

test("on the Mac a shortcut with Option goes by the key position (Option+Command+B types ∫ but still toggles the notes panel)", async ({ app }) => {
  await asMac(app);
  await app.open();
  const panel = app.page.locator("aside.panel");
  await expect(panel).not.toHaveAttribute("inert", "");
  // Dispatched on body, so the event goes through capture and bubble like a real key (one dispatched on window skips both, and the
  // shortcuts that handle a key first and stop it would not see it)
  await app.page.evaluate(() =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "∫", code: "KeyB", metaKey: true, altKey: true, bubbles: true, cancelable: true }),
    ),
  );
  await expect(panel).toHaveAttribute("inert", "");
});

test("on the Mac shortcuts are written with symbols: on menu items and inside messages", async ({ app }) => {
  await asMac(app);
  await app.open();
  await expect(app.page.getByTitle(/⌘O/).first()).toBeVisible();
  await app.page.locator(".menubar-item").first().click();
  const add = app.page.locator(".menu-item", { hasText: "添加文件" }).first();
  await expect(add.locator(".menu-hint")).toHaveText("⌘O");
  const addFolder = app.page.locator(".menu-item", { hasText: "添加文件夹" }).first();
  await expect(addFolder.locator(".menu-hint")).toHaveText("⇧⌘O");
});

test("without the Mac flag the shortcuts are the Windows ones, written with words", async ({ app }) => {
  await app.open();
  await expect(app.page.getByTitle(/Ctrl O/).first()).toBeVisible();
  app.host.nextPickFiles = [POSTER(app)];
  await app.page.keyboard.press("Control+o");
  await expect(app.page).toHaveTitle("poster.jpg");
});

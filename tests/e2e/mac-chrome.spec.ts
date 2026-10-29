// The Mac shell's window chrome (TitleBar.tsx, `platform` in host.ts): the system draws the three window buttons, so the title strip has none
// of its own and leaves room for them; a WKWebView page has no app-region, so a press on the blank part of the strip asks the shell to drag the
// window and a double click asks it to zoom. Without the Mac flag nothing changes.
// A test turns the Mac on by setting __e2ePlatform before the page loads (the fake chrome.webview in harness.ts reads it)

import { expect, test, type App } from "./harness";

const asMac = (app: App) =>
  app.page.addInitScript(() => {
    (window as unknown as { __e2ePlatform: string }).__e2ePlatform = "mac";
  });

test("on the Mac the title strip has no window buttons of its own and leaves room at the left for the system's", async ({ app }) => {
  await asMac(app);
  await app.open();
  await expect(app.page.locator(".titlebar")).toHaveClass(/is-mac/);
  await expect(app.page.locator(".win-btns")).toHaveCount(0);
  await expect(app.page.locator(".win-resize")).toHaveCount(0);
  // The menu bar starts after the room left for the three buttons (--mac-traffic-inset, 78)
  const menu = (await app.page.locator(".menubar").boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(78);
  expect(menu.x).toBeLessThan(90);
});

test("on the Mac a press on the blank part of the strip asks the shell to drag the window and a double click to zoom it; controls keep their presses", async ({
  app,
}) => {
  await asMac(app);
  await app.open();
  const menu = (await app.page.locator(".menubar").boundingBox())!;
  const blank = { x: menu.width - 30, y: menu.height / 2 };

  await app.page.locator(".menubar").click({ position: blank });
  await expect.poll(() => app.host.windowCalls).toEqual(["windowDrag"]);

  await app.page.locator(".menubar").dblclick({ position: blank });
  await expect.poll(() => app.host.windowCalls).toEqual(["windowDrag", "windowDrag", "windowZoom"]);

  // A menu name and the Capture button are controls: pressing them is not a drag
  await app.page.locator(".menubar-item").first().click();
  await app.page.keyboard.press("Escape");
  await app.page.locator(".titlebar-split .titlebar-action").first().hover();
  await app.page.mouse.down();
  await app.page.mouse.up();
  expect(app.host.windowCalls).toEqual(["windowDrag", "windowDrag", "windowZoom"]);
});

test("without the Mac flag the title strip is the Windows one: window buttons, resize edges, no shell calls from a press", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".titlebar")).not.toHaveClass(/is-mac/);
  await expect(app.page.locator(".win-btns")).toHaveCount(1);
  const menu = (await app.page.locator(".menubar").boundingBox())!;
  await app.page.locator(".menubar").click({ position: { x: menu.width - 30, y: menu.height / 2 } });
  expect(app.host.windowCalls).toEqual([]);
});

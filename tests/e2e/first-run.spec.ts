// First use: with an empty list the middle of the canvas explains how to use the app; the add buttons are always there;
// with the default Select tool, dragging on the image draws a box.

import { join } from "node:path";
import { expect, test } from "./harness";

test("With an empty list, the middle of the canvas explains the three steps and lets you add directly; once there are items, the buttons at the top of the library still add", async ({ app }) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  const welcome = app.page.locator(".welcome");
  await expect(welcome).toBeVisible();
  await expect(welcome.locator(".welcome-steps li")).toHaveCount(3);
  await expect(welcome).toContainText("交由 AI");
  // The Screen Capture shortcut is written into the text (it follows changes made in Settings)
  await expect(welcome).toContainText("Ctrl Alt A");
  // The library only talks about the list itself and does not repeat the "drag it in" hint
  await expect(app.page.locator(".lib-empty")).toContainText("暂无素材");

  app.host.nextPickFolder = join(app.project, "assets");
  await welcome.getByRole("button", { name: "添加文件夹" }).click();
  await expect(app.page.locator(".lib-row", { hasText: "poster.jpg" })).toBeVisible();
  await expect(welcome).toHaveCount(0);

  // The list has content: the two buttons at the top of the library are still there
  app.host.nextPickFiles = [join(app.project, "video", "clip.mp4")];
  await app.page.locator(".lib-header-actions button").first().click();
  await expect(app.page.locator(".lib-row", { hasText: "clip.mp4" })).toBeVisible();
  await expect(app.page.locator(".lib-header-actions button")).toHaveCount(2);
});

test("Dragging on blank canvas with the Select tool draws a box and opens the composer; a plain click draws nothing; dragging while holding H pans", async ({ app }) => {
  app.host.expanded = [join(app.project, "assets")];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  const layer = app.page.locator(".annot-layer");
  await expect(layer).toHaveClass(/tool-select/);
  const box = (await layer.boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

  // A plain click: nothing is drawn and no composer opens
  await app.page.mouse.click(...at(0.5, 0.5));
  await expect(app.page.locator(".composer")).toHaveCount(0);

  // A drag: draws a box and the tool stays Select
  await app.page.mouse.move(...at(0.2, 0.2));
  await app.page.mouse.down();
  await app.page.mouse.move(...at(0.5, 0.4), { steps: 5 });
  await app.page.mouse.up();
  await expect(app.page.locator(".composer-text")).toBeFocused();
  await app.page.locator(".composer-text").fill("这块换成浅色");
  await app.page.keyboard.press("Control+Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect(layer).toHaveClass(/tool-select/);
  await expect
    .poll(() => app.annotations("assets__poster.jpg.json").find((a) => a.body === "这块换成浅色"))
    .toMatchObject({ anchor: { shapes: [{ type: "rect" }] } });

  // After fill, dragging while holding H pans and does not draw
  await app.page.keyboard.press("Shift+2");
  const content = app.page.locator(".zoom-content");
  const before = await content.evaluate((el) => el.style.transform);
  await app.page.mouse.move(...at(0.5, 0.7));
  await app.page.keyboard.down("h");
  await app.page.mouse.down();
  await app.page.mouse.move(...at(0.5, 0.3), { steps: 5 });
  await app.page.mouse.up();
  await app.page.keyboard.up("h");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  expect(await content.evaluate((el) => el.style.transform)).not.toBe(before);
  await expect(layer).toHaveClass(/tool-select/);
});

test("With an empty list and a window too short for the text, the content starts at the top and can scroll to the add button (neither end is clipped); when it fits it is vertically centered", async ({ app }) => {
  app.host.entries = [];
  app.host.prefs = { language: "ja" }; // the Japanese text is the longest
  await app.page.setViewportSize({ width: 960, height: 600 });
  await app.page.goto("https://app.sniptoss.example/index.html");
  const welcome = app.page.locator(".welcome");
  await expect(welcome).toBeVisible();
  const view = (await app.page.locator(".stage-empty.is-welcome").boundingBox())!;
  expect((await welcome.boundingBox())!.y).toBeGreaterThanOrEqual(view.y);
  const add = welcome.locator(".welcome-actions .btn-primary");
  await add.scrollIntoViewIfNeeded();
  const b = (await add.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(view.y);
  expect(b.y + b.height).toBeLessThanOrEqual(view.y + view.height);

  await app.page.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(async () => {
      const v = (await app.page.locator(".stage-empty.is-welcome").boundingBox())!;
      const w = (await welcome.boundingBox())!;
      return Math.abs(w.y - v.y - (v.y + v.height - w.y - w.height));
    })
    .toBeLessThan(2);
});

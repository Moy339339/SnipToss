// An item changed on disk (an agent edited the image from the notes, generated a new file, deleted an old one): no F5 needed, the library and canvas catch up on their own.
// The real-shell side (whether WebView2 serves a stale cached image) is covered by the real-shell tests in tests/shell.

import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./harness";

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("an agent overwrites the image being viewed in place: the canvas shows the new image and the notes stay", async ({ app }) => {
  await app.open();
  const width = () =>
    app.page.evaluate(() => [...document.images].find((i) => i.src.includes("hero.png") && i.complete)?.naturalWidth ?? -1);
  await expect.poll(width).toBe(640);
  writeFileSync(join(app.project, "assets", "hero.png"), ONE_PIXEL_PNG);
  await expect.poll(width).toBe(1);
  await expect(app.page.locator('[data-annot$="|k3f9a2"]')).toBeVisible();
});

test("a new item generated in the folder appears in the library by itself, and a deleted one disappears", async ({ app }) => {
  await app.open();
  copyFileSync(join(app.project, "assets", "poster.jpg"), join(app.project, "assets", "poster-v2.jpg"));
  await expect(app.page.locator(".lib-row", { hasText: "poster-v2.jpg" })).toBeVisible();
  const poster = app.page.locator(".lib-row", { has: app.page.getByText("poster.jpg", { exact: true }) });
  await expect(poster).toHaveCount(1);
  rmSync(join(app.project, "assets", "poster.jpg"));
  await expect(poster).toHaveCount(0);
});

test("an image that cannot be opened (corrupt file): the canvas explains why, and shows the image by itself once the file is fixed", async ({ app }) => {
  const broken = join(app.project, "assets", "broken.png");
  writeFileSync(broken, "不是图片");
  await app.open();
  await app.page.locator(".lib-row", { hasText: "broken.png" }).click();
  await expect(app.page.getByRole("alert")).toContainText("无法打开这张图片");
  await expect(app.page.getByRole("button", { name: "在资源管理器中显示" })).toBeVisible();
  copyFileSync(join(app.project, "assets", "hero.png"), broken);
  await expect
    .poll(() => app.page.evaluate(() => [...document.images].find((i) => i.src.includes("broken.png") && i.complete)?.naturalWidth ?? -1))
    .toBe(640);
  await expect(app.page.getByRole("alert")).toHaveCount(0);
});

test("a video that cannot be played (corrupt file, unsupported codec): the canvas explains why", async ({ app }) => {
  writeFileSync(join(app.project, "video", "broken.mp4"), "不是视频");
  await app.open();
  await app.page.locator(".lib-row", { hasText: "broken.mp4" }).click();
  await expect(app.page.getByRole("alert")).toContainText("无法播放这个视频");
});

test("editing a note after the item's folder was moved away: explains why and does not recreate the folder in its old place", async ({ app }) => {
  app.allowLogErrors("saving notes");
  app.host.prefs = { panelResolved: true };
  await app.open();
  const card = app.page.locator('[data-annot$="|k3f9a2"]');
  await expect(card).toBeVisible();
  app.host.muted = true; // Simulates "just moved, the UI has not noticed yet" (normally noticed within a second, and the library shows it as not found)
  renameSync(app.project, `${app.project}-moved`);
  await card.hover();
  await card.locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
  await expect(app.page.locator(".toast")).toContainText("素材文件夹已不存在");
  expect(existsSync(app.project)).toBe(false);
  renameSync(`${app.project}-moved`, app.project); // Move it back so the fixture can be cleaned up
});

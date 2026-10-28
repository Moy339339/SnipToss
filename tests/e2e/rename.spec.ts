// Rename pizhu → SnipToss (docs/adr/0007-rename.md): an old project's .pizhu is moved to .sniptoss when opened, with no note lost; the first launch after upgrading shows a notice once

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./harness";

test.beforeEach(({ app }) => {
  app.host.prefs = { panelResolved: true };
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("opening a project from before the rename moves .pizhu to .sniptoss, shows the notes as usual and can keep writing", async ({ app }) => {
  renameSync(join(app.project, ".sniptoss"), join(app.project, ".pizhu"));
  writeFileSync(join(app.project, ".pizhu", "pizhu.cmd"), "@echo off\r\n");

  await app.open();

  const card = app.page.locator('[data-annot$="|k3f9a2"]');
  await expect(card).toContainText("标题字太细了");
  expect(existsSync(join(app.project, ".pizhu"))).toBe(false);
  expect(existsSync(join(app.project, ".sniptoss", "annotations", "assets__hero.png.json"))).toBe(true);
  expect(existsSync(join(app.project, ".sniptoss", "pizhu.cmd"))).toBe(false);

  await card.hover();
  await card.locator('.act[title^="更多"]').click();
  await app.page.getByRole("menuitem", { name: "标记为已改" }).click();
  await expect.poll(() => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("resolved");
  expect(existsSync(join(app.project, ".pizhu"))).toBe(false);
});

test("first launch after upgrading: a notice says the technical name is now SnipToss and the old notes folder is renamed automatically; it only closes on OK", async ({ app }) => {
  app.host.renamedFromPizhu = true;
  await app.open();
  const toast = app.page.locator(".toast");
  await expect(toast).toContainText("SnipToss");
  await expect(toast).toContainText("旧的批注文件夹会自动重命名为 .sniptoss");
  await expect(toast).toContainText("批注内容完整保留");
  await toast.getByRole("button", { name: "知道了" }).click();
  await expect(toast).toHaveCount(0);
});

test("a normal launch shows no upgrade notice", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  await expect(app.page.locator(".toast")).toHaveCount(0);
});

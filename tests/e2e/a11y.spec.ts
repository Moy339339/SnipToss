// Accessibility: how the UI behaves when animations are turned off or high contrast is on in the system settings

import { expect, test } from "./harness";

test("With Windows animation effects off (prefers-reduced-motion), menus, dialogs and hints skip animations and transitions and appear at once", async ({ app }) => {
  await app.page.emulateMedia({ reducedMotion: "reduce" });
  await app.open();
  await app.page.locator(".menubar-item").first().click();
  const menu = app.page.locator(".menubar-menu");
  await expect(menu).toBeVisible();
  const ms = (s: string) => Math.max(...s.split(",").map((v) => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000)));
  expect(ms(await menu.evaluate((el) => getComputedStyle(el).animationDuration))).toBeLessThan(1);
  const btn = app.page.locator(".lib-row").first();
  expect(ms(await btn.evaluate((el) => getComputedStyle(el).transitionDuration))).toBeLessThan(1);
});

test("With animation effects on, animations still play (control: the previous test did not pass just because there were no animations)", async ({ app }) => {
  await app.page.emulateMedia({ reducedMotion: "no-preference" });
  await app.open();
  await app.page.locator(".menubar-item").first().click();
  const menu = app.page.locator(".menubar-menu");
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeGreaterThan(0.05);
});

test("Windows high contrast (forced-colors): buttons have borders; the selected row and switches that are on use the system accent color (the system strips backgrounds and shadows)", async ({ app }) => {
  await app.page.emulateMedia({ forcedColors: "active" });
  await app.open();
  const row = app.page.locator(".lib-row", { hasText: "hero.png" });
  await row.click();
  await expect(row).toHaveClass(/is-selected/);
  expect(await row.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  expect(await app.page.locator(".dock-all").evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+,");
  const knob = app.page.locator(".switch.is-on .switch-knob").first();
  await expect(knob).toBeVisible();
  expect(await knob.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await app.page.locator(".settings-tab.is-on").evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
});

// Not accessibility: when the capture shortcut could not be registered the tray shows a notice, and clicking it makes the shell send openSettings
// (the real-shell half is in tests/shell/tray.spec.ts)
test("When the shell asks for a settings page (openSettings), that page opens; an unknown section opens General", async ({ app }) => {
  await app.open();
  const emit = (section: string) =>
    app.page.evaluate(
      (target) => (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit({ event: "openSettings", section: target }),
      section,
    );
  await emit("capture");
  await expect(app.page.locator(".settings-tab.is-on")).toHaveText("截图批注");
  await app.page.keyboard.press("Escape");
  await emit("nope");
  await expect(app.page.locator(".settings-tab.is-on")).toHaveText("常规");
});

test("Help → Export Diagnostics Package…: the shell receives the diagnostic info (English, no paths); once saved the toast says where, and cancelling says nothing", async ({ app }) => {
  await app.open();
  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "导出诊断包…" }).click();
  await expect(app.page.locator(".toast")).toContainText("诊断包已保存：C:\\Users\\me\\Desktop\\SnipToss-diagnostics.zip");
  expect(app.host.exported[0]).toMatch(/^SnipToss /);
  expect(app.host.exported[0]).not.toContain(app.project);
  app.host.nextExportPath = null;
  await expect(app.page.locator(".toast")).toHaveCount(0, { timeout: 10_000 }); // wait for the previous toast to dismiss itself (3 seconds)
  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "导出诊断包…" }).click();
  await expect.poll(() => app.host.exported.length).toBe(2);
  await expect(app.page.locator(".toast")).toHaveCount(0);
});

test("Library list: a screen reader announces its name and which row the keyboard cursor moved to (aria-activedescendant points at the cursor row)", async ({ app }) => {
  await app.open();
  const tree = app.page.getByRole("tree", { name: "素材列表" });
  await app.page.locator(".lib-row", { hasText: "project" }).first().click();
  await expect(tree).toBeFocused();
  const pointsAtCursor = async () => {
    const id = await tree.getAttribute("aria-activedescendant");
    expect(id).toBeTruthy();
    await expect(app.page.locator(`[id="${id}"]`)).toHaveClass(/is-cursor/);
    return app.page.locator(`[id="${id}"]`).innerText();
  };
  const first = await pointsAtCursor();
  await app.page.keyboard.press("ArrowDown");
  const second = await pointsAtCursor();
  expect(second).not.toBe(first);
  await app.page.keyboard.press("End");
  await pointsAtCursor();
});
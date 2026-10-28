// Keyboard and shortcut edge cases.
// Always use real key presses (page.keyboard) and never dispatchEvent in the page: an event dispatched directly on window does not go through
// capture → target → bubble, so shortcuts that "handle first and stop the event" cannot stop it and the test reports false problems.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const ANN = (app: App, name: string) => join(app.project, ".sniptoss", "annotations", name);
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const heroIds = (app: App) => app.annotations("assets__hero.png.json").map((a) => a.id);

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { panelResolved: true };
});

test("Confirm dialog: Tab to Cancel and press Enter cancels (Enter must not confirm regardless of where focus is, which would delete the note)", async ({ app }) => {
  await app.open();
  await card(app, "k3f9a2").click();
  await app.page.keyboard.press("Delete");
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "删除" })).toBeFocused();
  await app.page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(".confirm-actions").getByRole("button", { name: "取消" })).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(card(app, "k3f9a2")).toBeVisible();
  expect(heroIds(app)).toContain("k3f9a2");
  // Control: while focus is still on Delete, Enter deletes
  await app.page.keyboard.press("Delete");
  await expect(dialog).toBeVisible();
  await app.page.keyboard.press("Enter");
  await expect(card(app, "k3f9a2")).toHaveCount(0);
  await expect.poll(() => heroIds(app)).not.toContain("k3f9a2");
});

test("Ctrl+Z in the composer undoes the typing, not the previous note", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  const draw = async () => {
    await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
    await app.page.keyboard.press("r");
    const box = (await app.page.locator(".annot-input").boundingBox())!;
    await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await app.page.mouse.down();
    await app.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
    await app.page.mouse.up();
  };
  const poster = () => (existsSync(ANN(app, "assets__poster.jpg.json")) ? app.annotations("assets__poster.jpg.json") : []);
  await draw();
  await app.page.locator(".composer-text").fill("第一条");
  await app.page.keyboard.press("Control+Enter");
  await expect.poll(() => poster().length).toBe(1);
  await draw();
  await app.page.locator(".composer-text").pressSequentially("abc");
  await app.page.keyboard.press("Control+z");
  await expect(app.page.locator(".composer-text")).not.toHaveValue("abc");
  await expect(app.page.locator(".composer")).toBeVisible();
  await app.page.waitForTimeout(300);
  expect(poster().map((a) => a.body)).toEqual(["第一条"]);
});

test("Tabbing to a button and pressing Enter or Space presses that button (shortcut handling must not swallow the key)", async ({ app }) => {
  await app.open();
  const copy = app.page.getByRole("button", { name: "复制成文字", exact: true });
  await copy.focus();
  await app.page.keyboard.press("Shift+Tab");
  await app.page.keyboard.press("Tab"); // reached by keyboard (:focus-visible)
  await expect(copy).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect.poll(() => app.clipboard()).toContain("标题字太细了");
  await app.page.evaluate(() => ((window as unknown as { __e2eClipboard: { text: string | null } }).__e2eClipboard.text = null));
  await app.page.keyboard.press("Space");
  await expect.poll(() => app.clipboard()).toContain("标题字太细了");
});

test("After selecting a mark on the canvas and opening a menu, the arrow keys move within the menu and do not nudge the mark", async ({ app }) => {
  await app.open();
  const before = readFileSync(ANN(app, "assets__hero.png.json"), "utf8");
  await app.page.locator(".annot-badge").first().click(); // click the mark on the canvas (the arrow keys can now move it)
  await app.page.keyboard.press("Alt+e");
  const focusedItem = () => app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? "");
  const first = await focusedItem();
  await app.page.keyboard.press("ArrowDown");
  await expect.poll(focusedItem).not.toBe(first);
  await app.page.keyboard.press("ArrowUp");
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(500);
  expect(readFileSync(ANN(app, "assets__hero.png.json"), "utf8")).toBe(before);
});

test("Keys meant for an input inside a dialog still work: in Settings, typing a skipped folder and pressing Enter adds it (the dialog must not swallow every key)", async ({ app }) => {
  await app.open();
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: "高级" }).click();
  const input = app.page.getByPlaceholder("输入名称后按 Enter");
  await input.click();
  await input.pressSequentially("build-out");
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".chip-tag", { hasText: "build-out" })).toBeVisible();
  await expect(input).toHaveValue("");
  // Esc still closes the dialog
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".settings-tab")).toHaveCount(0);
});

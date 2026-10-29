// The Mac's native menu bar, seen from the page (menuModel.ts, nativeMenus.ts): the page sends its menus to the shell (setMenus), runs what the
// shell reports (menuCommand), and keeps its own menu bar for Windows only. A test turns the Mac and its native menus on by setting
// __e2ePlatform and __e2eNativeMenus before the page loads (the fake chrome.webview in harness.ts reads them)

import { expect, test, type App } from "./harness";
import { prepare, walkScreens } from "./screens";

const asMacWithMenus = (app: App) =>
  app.page.addInitScript(() => {
    const w = window as unknown as { __e2ePlatform: string; __e2eNativeMenus: boolean };
    w.__e2ePlatform = "mac";
    w.__e2eNativeMenus = true;
  });

type Item = { id: string; label: string; disabled: boolean; checked: boolean; shortcut?: { key: string; cmd: boolean; shift: boolean }; role?: string };
const items = (app: App, menu = -1): Item[] => {
  const sent = app.host.menusSent;
  const last = sent[sent.length - 1];
  const menus = menu < 0 ? last.menus : [last.menus[menu]];
  return menus.flatMap((m) => m.items.filter((i): i is Item => i !== "-"));
};
const find = (app: App, match: (i: Item) => boolean) => items(app).find(match)!;
const lastVersion = (app: App) => app.host.menusSent[app.host.menusSent.length - 1].version;
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);

test("on the Mac with native menus the page sends its menus and shows no menu bar of its own", async ({ app }) => {
  await asMacWithMenus(app);
  await app.open();
  await expect(app.page.locator(".menubar")).toHaveCount(0);
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  const first = app.host.menusSent[0];
  expect(first.version).toBe(1);
  expect(first.modal).toBe(false);
  expect(first.menus.map((m) => m.label)).toHaveLength(7);
  // Exit, Settings… and About are in the app menu of the Mac: not among the page's items
  const labels = items(app).map((i) => i.label);
  expect(labels.some((l) => /退出|Exit/.test(l))).toBe(false);
  expect(labels.some((l) => l.startsWith("关于"))).toBe(false);
  expect(items(app).some((i) => i.shortcut?.key === "o" && i.shortcut.cmd)).toBe(true);
});

test("without native menus (Windows, or a Mac shell that does not draw them) the page keeps its menu bar and sends nothing", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".menubar")).toHaveCount(1);
  await app.page.waitForTimeout(300);
  expect(app.host.menusSent).toEqual([]);
});

test("when the page changes, the model is sent again; when nothing changed, it is not", async ({ app }) => {
  await asMacWithMenus(app);
  await app.open();
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  await app.page.waitForTimeout(400);
  const quiet = app.host.menusSent.length;
  await app.page.waitForTimeout(400);
  expect(app.host.menusSent.length).toBe(quiet);

  const marks = () => find(app, (i) => i.shortcut?.key === "h" && i.shortcut.shift).checked;
  const before = marks();
  await app.page.keyboard.press("Shift+H");
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(quiet);
  expect(marks()).toBe(!before);
});

test("a command from the shell runs the item's action; one from an older menu is dropped, not run on whatever is there now", async ({ app }) => {
  await asMacWithMenus(app);
  await app.open();
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  const marks = () => find(app, (i) => i.shortcut?.key === "h" && i.shortcut.shift);
  const was = marks().checked;
  app.host.chooseMenuItem(marks().id, lastVersion(app));
  await expect.poll(() => marks().checked).toBe(!was);

  // Four more versions pass, then a command arrives that names the first one: nothing happens
  const stale = { id: marks().id, version: 1 };
  for (let i = 0; i < 4; i++) {
    await app.page.keyboard.press("Shift+H");
    const sent = app.host.menusSent.length;
    await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(sent - 1);
    await app.page.waitForTimeout(120);
  }
  const now = marks().checked;
  app.host.chooseMenuItem(stale.id, stale.version);
  await app.page.waitForTimeout(300);
  expect(marks().checked).toBe(now);
});

test("a dialog open: the menus are sent as modal, and again when it is closed", async ({ app }) => {
  await asMacWithMenus(app);
  await app.open();
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  await app.page.keyboard.press("Meta+,");
  await expect(app.page.locator(".overlay")).toBeVisible();
  await expect.poll(() => app.host.menusSent[app.host.menusSent.length - 1].modal).toBe(true);
  const open = lastVersion(app);
  // A click that arrives while it is open does nothing
  const item = find(app, (i) => i.shortcut?.key === "h" && i.shortcut.shift);
  const was = item.checked;
  app.host.chooseMenuItem(item.id, open);
  await app.page.waitForTimeout(300);
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".overlay")).toHaveCount(0);
  await expect.poll(() => app.host.menusSent[app.host.menusSent.length - 1].modal).toBe(false);
  expect(find(app, (i) => i.shortcut?.key === "h" && i.shortcut.shift).checked).toBe(was);
});

test("on every screen of the walkthrough the menus are modal exactly while a dialog is on screen", async ({ app }) => {
  // The walkthrough (screens.ts) opens every dialog of the UI; a dialog is any element that says it is modal. A new dialog that the menus
  // do not know about (one that is not an .overlay or .tour) would leave the Mac's menus enabled behind it
  prepare(app, "en");
  await asMacWithMenus(app);
  await app.open();
  const seen = { dialog: 0, plain: 0 };
  await walkScreens(app, async (screen) => {
    const dialog = (await app.page.locator('[aria-modal="true"]').count()) > 0;
    await expect.poll(() => app.host.menusSent[app.host.menusSent.length - 1]?.modal, { message: screen }).toBe(dialog);
    seen[dialog ? "dialog" : "plain"]++;
  });
  // Settings pages, the confirm dialog, the shortcut list and the tour are dialogs; the main screen, the note box, the context menus are not
  expect(seen.dialog).toBeGreaterThan(8);
  expect(seen.plain).toBeGreaterThan(2);
});

test("many changes in a row send few models (the page waits until it is quiet)", async ({ app }) => {
  await asMacWithMenus(app);
  await app.open();
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  await app.page.waitForTimeout(400);
  const before = app.host.menusSent.length;
  for (let i = 0; i < 51; i++) await app.page.keyboard.press("Shift+H");
  await app.page.waitForTimeout(500);
  // 51 presses: the menu is different at the end (an odd number), and what was sent in between is few
  expect(app.host.menusSent.length - before).toBeLessThanOrEqual(10);
  expect(app.host.menusSent.length).toBeGreaterThan(before);
});

test("undo from the menu: with the caret in the note box it undoes the typing, otherwise the last change to the notes", async ({ app }) => {
  await asMacWithMenus(app);
  await app.open();
  await expect.poll(() => app.host.menusSent.length).toBeGreaterThan(0);
  const undo = () => find(app, (i) => i.role === "undo");
  const status = () => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status;

  // Not in a text box: the notes' own undo
  await card(app, "k3f9a2").click();
  await app.page.keyboard.press("d");
  await expect.poll(status).toBe("resolved");
  await expect.poll(() => undo().disabled).toBe(false);
  app.host.chooseMenuItem(undo().id, lastVersion(app));
  await expect.poll(status).toBe("open");

  // In the note box: the text is undone, the notes are not
  await app.page.keyboard.press("d");
  await expect.poll(status).toBe("resolved");
  await expect.poll(() => undo().disabled).toBe(false);
  await app.page.keyboard.press("n");
  const box = app.page.locator(".composer-text");
  await expect(box).toBeVisible();
  await box.click();
  await app.page.keyboard.type("hello");
  await expect(box).toHaveValue("hello");
  app.host.chooseMenuItem(undo().id, lastVersion(app));
  // The text box undoes by its own steps (one step may be a letter or the whole word, depending on the browser): something was undone
  await expect(box).not.toHaveValue("hello");
  expect(status()).toBe("resolved");
});
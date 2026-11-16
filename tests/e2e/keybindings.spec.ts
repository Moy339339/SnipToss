// Changed shortcuts (Settings → Keyboard Shortcuts) take effect everywhere at once: the key itself, the menus, the tooltips, the shortcut
// list, holding a tool key; a command left without a key still runs from its menu; Restore Defaults leaves the shortcuts alone.

import { join } from "node:path";
import { expect, test, withKey, type App } from "./harness";

const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const keyRow = (app: App, id: string) => app.page.locator(`.key-row[data-command="${id}"]`);
const openMenu = (app: App, name: string) => app.page.locator(".menubar-item", { hasText: name }).click();
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const leftToggle = (app: App) => app.page.locator(".hdr-left .hdr-btn").first();
const tool = (app: App, name: string) => app.page.locator(`.hdr-tools .tool-btn[data-tool="${name}"]`);

async function openKeys(app: App) {
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^快捷键$/ }).click();
}
async function closeSettings(app: App) {
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".settings")).toHaveCount(0);
}
/** Records a new first key for a command */
async function setKey(app: App, id: string, press: string) {
  await keyRow(app, id).locator(".key-pill").first().click();
  await app.page.keyboard.press(press);
  await expect(keyRow(app, id).locator(".key-pill.is-recording")).toHaveCount(0);
}
/** Removes every key of a command */
async function clearKeys(app: App, id: string) {
  const trash = keyRow(app, id).locator(".key-trash");
  while ((await trash.count()) > 0) await trash.first().click();
  await expect(keyRow(app, id).locator(".key-pill.is-empty")).toHaveCount(1);
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("a changed shortcut works at once: the new key runs the command, the old one does nothing, and the menu, the tooltip and the shortcut list show the new key", async ({
  app,
}) => {
  await app.open();
  await openKeys(app);
  await setKey(app, "view.toggleLeft", "Control+Shift+L");
  await expect.poll(() => app.host.prefs?.keybindings).toEqual({ "view.toggleLeft": ["Ctrl+Shift+L"] });
  await closeSettings(app);

  await focusStage(app);
  await expect(leftToggle(app)).toHaveClass(/is-on/);
  await app.page.keyboard.press("Control+B");
  await expect(leftToggle(app)).toHaveClass(/is-on/);
  await app.page.keyboard.press("Control+Shift+L");
  await expect(leftToggle(app)).not.toHaveClass(/is-on/);
  await expect(leftToggle(app)).toHaveAttribute("title", withKey("显示素材栏", "Ctrl Shift L"));
  await app.page.keyboard.press("Control+Shift+L");
  await expect(leftToggle(app)).toHaveClass(/is-on/);

  await openMenu(app, "视图");
  await expect(app.page.getByRole("menuitemcheckbox", { name: /^素材栏/ }).locator(".menu-hint")).toHaveText("Ctrl Shift L");
  await app.page.keyboard.press("Escape");

  await focusStage(app);
  await app.page.keyboard.press("F1");
  const row = app.page.locator(".sheet .shortcut-row", { hasText: "显示 / 隐藏素材栏" });
  await expect(row.locator("kbd")).toHaveText(["Ctrl", "Shift", "L"]);
});

test("a command left without a key still runs from its menu, which then shows no key; the key it had does nothing", async ({ app }) => {
  await app.open();
  await openKeys(app);
  await clearKeys(app, "view.zoomIn");
  await expect.poll(() => app.host.prefs?.keybindings).toEqual({ "view.zoomIn": [] });
  await closeSettings(app);

  const zoom = app.page.locator(".zoom-label");
  await expect(zoom).toContainText("适合");
  await focusStage(app);
  // Neither the listed key nor its unlisted twin (Ctrl and the =/+ key without Shift) zooms any more
  await app.page.keyboard.press("Control+Equal");
  await app.page.keyboard.press("Control+Shift+Equal");
  await expect(zoom).toContainText("适合");
  await expect(app.page.locator(".zoom-btn").last()).toHaveAttribute("title", "放大");

  await openMenu(app, "视图");
  await expect(menuItem(app, /^放大/).locator(".menu-hint")).toHaveCount(0);
  await menuItem(app, /^放大/).click();
  await expect(zoom).not.toContainText("适合");
});

test("a key moved over from another command: the other one loses it", async ({ app }) => {
  await app.open();
  await openKeys(app);
  await keyRow(app, "file.refresh").locator(".key-pill").first().click();
  await app.page.keyboard.press("Control+B");
  await expect(keyRow(app, "file.refresh")).toContainText("已用于「显示 / 隐藏素材栏」");
  await keyRow(app, "file.refresh").getByRole("button", { name: "替换" }).click();
  await expect.poll(() => app.host.prefs?.keybindings).toEqual({ "file.refresh": ["Ctrl+B"], "view.toggleLeft": [] });
  await closeSettings(app);

  await focusStage(app);
  const calls = () => app.host.calls.filter((c) => c.method === "scan").length;
  const before = calls();
  await app.page.keyboard.press("Control+B");
  await expect(leftToggle(app)).toHaveClass(/is-on/);
  await expect.poll(calls).toBeGreaterThan(before);
});

test("a key that can't be changed is refused with its reason, which stays after the modifiers are let go; the next try clears it, and a recorded pill carries the app's tooltip only", async ({
  app,
}) => {
  await app.open();
  await openKeys(app);
  const row = keyRow(app, "file.refresh");
  await row.locator(".key-pill").first().click();
  // Alt+F opens the File menu (fixed): pressed and released the way a person does, Alt last
  await app.page.keyboard.down("Alt");
  await app.page.keyboard.press("F");
  await app.page.keyboard.up("Alt");
  await expect(row.locator(".text-warn")).toHaveText("已用于「打开菜单」，请换一个");
  await expect(row.locator(".key-pill.is-recording")).toHaveCount(1);
  // Starting the next try (a modifier pressed) drops the old reason; a free key is then taken
  await app.page.keyboard.down("Control");
  await expect(row.locator(".text-warn")).toHaveCount(0);
  await app.page.keyboard.press("Shift+F5");
  await app.page.keyboard.up("Control");
  await expect.poll(() => app.host.prefs?.keybindings).toEqual({ "file.refresh": ["Ctrl+Shift+F5"] });
  const pill = row.locator(".key-pill").first();
  await expect(pill).toHaveAttribute("data-tip", "单击后按下新的快捷键");
  await expect(pill).not.toHaveAttribute("title");
});

test("the Hand tool on another key: a tap picks it, and H no longer does", async ({ app }) => {
  await app.open();
  await openKeys(app);
  await setKey(app, "tool.hand", "G");
  await closeSettings(app);

  await focusStage(app);
  await app.page.keyboard.press("H");
  await expect(tool(app, "select")).toHaveClass(/is-on/);
  await app.page.keyboard.press("G");
  await expect(tool(app, "hand")).toHaveClass(/is-on/);
  await expect(tool(app, "hand")).toHaveAttribute("data-tip", withKey("抓手", "G"));
});

test("search by keys: right after clicking the keyboard button the keys pressed are heard (the button gives focus back to the box); clicking it again returns to the full list", async ({
  app,
}) => {
  await app.open();
  await openKeys(app);
  const box = app.page.locator(".keys-search input");
  const all = await app.page.locator(".key-row").count();
  await app.page.locator(".keys-search .search-filter").click();
  await expect(box).toBeFocused();
  await app.page.keyboard.press("Control+Shift+A");
  await expect(box).toHaveValue("Ctrl Shift A");
  await expect(app.page.locator(".key-row")).toHaveCount(1);
  await expect(keyRow(app, "note.copyText")).toBeVisible();
  // The clear button keeps the box listening too
  await app.page.locator(".keys-search .search-clear").click();
  await expect(box).toBeFocused();
  await app.page.keyboard.press("F5");
  await expect(keyRow(app, "file.refresh")).toBeVisible();
  await app.page.locator(".keys-search .search-filter").click();
  await expect(box).toBeFocused();
  await expect(app.page.locator(".key-row")).toHaveCount(all);
});

test("Restore Defaults (Advanced) leaves the shortcuts alone; Reset All on the shortcuts page puts them back", async ({ app }) => {
  await app.open();
  await openKeys(app);
  await setKey(app, "file.refresh", "Control+Shift+R");
  await app.page.locator(".settings-tab", { hasText: /^高级$/ }).click();
  await app.page.locator(".set-row", { hasText: "恢复默认设置" }).getByRole("button", { name: "恢复默认" }).click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "恢复默认" }).click();
  await expect.poll(() => app.host.prefs?.keybindings).toEqual({ "file.refresh": ["Ctrl+Shift+R"] });

  await app.page.locator(".settings-tab", { hasText: /^快捷键$/ }).click();
  await app.page.getByRole("button", { name: "全部恢复默认" }).click();
  await expect.poll(() => app.host.prefs?.keybindings ?? {}).toEqual({});
});

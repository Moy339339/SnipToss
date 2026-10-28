// The title bar: the Capture button and its small arrow, the three window buttons, the top-edge resize handles, the drag region, keyboard use of the menu titles, and the title bar at Interface size 125% and in English.
// Effects on a real window (actually maximizing, full screen covering the monitor, × quitting, the window name) are in tests/shell/titlebar.spec.ts

import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type App } from "./harness";

const toast = (app: App) => app.page.locator(".toast");
const capture = (app: App) => app.page.locator(".titlebar-action").first();
const more = (app: App) => app.page.locator(".titlebar-more");
const winBtn = (app: App, i: number) => app.page.locator(".win-btns .win-btn").nth(i);
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const hideItem = (app: App) => app.page.getByRole("menuitemcheckbox", { name: /截图时隐藏本窗口/ });
const row = (app: App, name: string) => app.page.locator(".lib-row", { hasText: name });
const calls = (app: App, method: string) => app.host.calls.filter((c) => c.method === method);
const sent = (app: App) => calls(app, "window").map((c) => (c.params as { action: string }).action);
/** The system changed the window state (double-clicking the title bar, Win+↑, dragging to the top of the screen): a real window resizes and fires resize, which the UI uses to re-read the state */
async function systemChanged(app: App, w: Partial<typeof app.host.window>) {
  Object.assign(app.host.window, w);
  await app.page.evaluate(() => window.dispatchEvent(new Event("resize")));
}
/** An element's drag region property (app-region): drag = pressing drags the window, no-drag = clicks work as usual */
const region = (app: App, selector: string) =>
  app.page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return s.getPropertyValue("app-region") || s.getPropertyValue("-webkit-app-region");
    });
/** Measures a menu's position: first lets the opening animation finish (it floats up from 6 px below and scales up slightly) */
async function box(l: Locator) {
  await l.evaluate((el) => el.getAnimations().forEach((a) => a.finish()));
  return (await l.boundingBox())!;
}
/** Whether the topmost element at this point is the selector's element (or inside it) */
const hits = (app: App, x: number, y: number, selector: string) =>
  app.page.evaluate(([px, py, s]) => !!document.elementFromPoint(Number(px), Number(py))?.closest(String(s)), [x, y, selector] as const);

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

// ---------- The Capture button and its small arrow ----------

test("Capture: one click asks the shell to start a capture; when the shell reports an error a persistent error toast appears with an Open Log Folder button", async ({ app }) => {
  await app.open();
  await capture(app).click();
  await expect.poll(() => calls(app, "captureStart").length).toBe(1);
  app.host.failMethods.add("captureStart");
  app.allowLogErrors("Screen Capture");
  await capture(app).click();
  await expect(toast(app)).toContainText("无法启动截图批注：captureStart 失败（测试注入）");
  await expect(toast(app).getByRole("button", { name: "打开日志文件夹" })).toBeVisible();
});

// When the window isn't hidden, the shell takes the screenshot as soon as it receives the request: a tooltip still fading out (it only starts to close on mouse down) would be frozen into the screenshot
test("clicking Capture closes the button's tooltip immediately, and only then asks the shell to start the capture", async ({ app }) => {
  await app.open();
  await capture(app).hover();
  await expect(app.page.locator(".tooltip.is-on")).toBeVisible();
  await app.page.evaluate(() => {
    const w = window as unknown as { chrome: { webview: { postMessage: (m: { method?: string }) => void } }; __tipAtCapture?: string };
    const post = w.chrome.webview.postMessage.bind(w.chrome.webview);
    w.chrome.webview.postMessage = (m) => {
      if (m.method === "captureStart") w.__tipAtCapture = getComputedStyle(document.querySelector(".tooltip")!).opacity;
      post(m);
    };
  });
  await capture(app).click();
  await expect.poll(() => calls(app, "captureStart").length).toBe(1);
  expect(await app.page.evaluate(() => (window as unknown as { __tipAtCapture?: string }).__tipAtCapture)).toBe("0");
});

test("the Capture hover tooltip explains what it does, changes wording with the hide-this-window-while-capturing option, and mentions the shortcut only when there is one", async ({ app }) => {
  await app.open();
  const tip = app.page.locator(".tooltip.is-on");
  await capture(app).hover();
  await expect(tip).toContainText("截图批注：框选屏幕任意区域，绘制标记并填写批注，完成后图片复制到剪贴板。");
  await expect(tip).toContainText("截图前先隐藏本窗口（在右侧箭头菜单中更改）");
  await expect(tip).toContainText("快捷键 Ctrl Alt A，在任何程序中均可使用");
  await app.page.mouse.move(600, 500);
  app.host.capture.hideWindow = false;
  app.host.capture.hotkey = "";
  await app.open();
  await capture(app).hover();
  await expect(tip).toContainText("截图时不隐藏本窗口（在右侧箭头菜单中更改）");
  await expect(tip).not.toContainText("快捷键");
});

test("the small arrow opens on click and closes on another click or Esc; screen readers know it is a menu button and whether it is open; the menu holds a toggle, a separator and Settings, aligned to the arrow on the right", async ({ app }) => {
  await app.open();
  const menu = app.page.locator(".menu");
  await expect(more(app)).toHaveAttribute("aria-haspopup", "menu");
  await expect(more(app)).toHaveAttribute("aria-expanded", "false");
  await more(app).click();
  await expect(menu).toBeVisible();
  await expect(more(app)).toHaveAttribute("aria-expanded", "true");
  await expect(more(app)).toHaveClass(/is-on/);
  const parts = menu.locator(":scope > *");
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0)).toHaveAttribute("role", "menuitemcheckbox");
  await expect(parts.nth(1)).toHaveClass(/menu-sep/);
  await expect(parts.nth(2)).toHaveText("截图批注设置…");
  const m = await box(menu);
  const b = (await more(app).boundingBox())!;
  expect(m.x + m.width).toBeCloseTo(b.x + b.width, 0);
  await more(app).click();
  await expect(menu).toHaveCount(0);
  await expect(more(app)).toHaveAttribute("aria-expanded", "false");
  await more(app).click();
  await app.page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("the arrow's drop-down and the menu bar's drop-down are the same distance below the title bar", async ({ app }) => {
  await app.open();
  const bar = (await app.page.locator(".titlebar").boundingBox())!;
  await more(app).click();
  const arrow = await box(app.page.locator(".menu"));
  await app.page.keyboard.press("Escape");
  await app.page.locator(".menubar-item").first().click();
  const file = await box(app.page.locator(".menubar-menu"));
  expect(file.y - (bar.y + bar.height)).toBeCloseTo(4, 1);
  expect(arrow.y).toBeCloseTo(file.y, 1);
});

test("drop-down keyboard and focus: Tab to the small arrow and press Enter / Space, focus goes to the first item; Esc returns to the arrow; after clicking an item with the mouse, focus also returns to the arrow", async ({ app }) => {
  await app.open();
  await capture(app).focus();
  await app.page.keyboard.press("Tab");
  await expect(more(app)).toBeFocused();
  for (const key of ["Enter", "Space"]) {
    await app.page.keyboard.press(key);
    await expect(hideItem(app)).toBeFocused();
    await app.page.keyboard.press("Escape");
    await expect(app.page.locator(".menu")).toHaveCount(0);
    await expect(more(app)).toBeFocused();
  }
  // Open with the mouse and click an item: focus follows the mouse into the menu and returns to the small arrow when the menu closes, instead of falling to the body
  await more(app).click();
  await hideItem(app).click();
  await expect(app.page.locator(".menu")).toHaveCount(0);
  await expect(more(app)).toBeFocused();
});

test("Hide This Window While Capturing in the small arrow menu: one click saves it to settings, a toast explains it and the hover tooltip changes wording; when it can't be saved the toast reports why and the check mark doesn't change", async ({ app }) => {
  await app.open();
  await more(app).click();
  await expect(hideItem(app)).toHaveAttribute("aria-checked", "true");
  await hideItem(app).click();
  await expect.poll(() => app.host.capture.hideWindow).toBe(false);
  await expect(toast(app)).toContainText("从本窗口启动截图批注时，不再隐藏本窗口");
  await expect(capture(app)).toHaveAttribute("title", /截图时不隐藏本窗口/);
  app.host.failMethods.add("setCaptureSettings");
  await more(app).click();
  await hideItem(app).click();
  await expect(toast(app)).toContainText("setCaptureSettings 失败（测试注入）");
  expect(app.host.capture.hideWindow).toBe(false);
  await more(app).click();
  await expect(hideItem(app)).toHaveAttribute("aria-checked", "false");
});

// ---------- The three window buttons and the top-edge handles ----------

test("the three window buttons: the actions they send, hover tips, screen reader names and icons change with the state; in full screen the middle one is Exit Full Screen", async ({ app }) => {
  await app.open();
  const [min, max, close] = [winBtn(app, 0), winBtn(app, 1), winBtn(app, 2)];
  await expect(min).toHaveAttribute("title", "最小化");
  await expect(min).toHaveAttribute("aria-label", "最小化");
  await expect(max).toHaveAttribute("title", "最大化");
  await expect(max).toHaveAttribute("aria-label", "最大化");
  await expect(close).toHaveAttribute("title", "关闭（Alt F4）");
  await expect(close).toHaveAttribute("aria-label", "关闭");
  // A single square means Maximize, and two overlapping squares mean Restore
  await expect(max.locator("path")).toHaveCount(0);
  await min.click();
  await max.click();
  await expect(max).toHaveAttribute("aria-label", "还原");
  await expect(max.locator("path")).toHaveCount(1);
  await max.click();
  await expect(max).toHaveAttribute("aria-label", "最大化");
  await app.page.locator(".lib-list").focus();
  await app.page.keyboard.press("F11");
  await expect(max).toHaveAttribute("aria-label", "退出全屏");
  await expect(max.locator("path")).toHaveCount(1);
  await app.page.mouse.move(600, 500);
  await expect(max).toHaveAttribute("title", "退出全屏（F11）");
  await max.click();
  await expect(max).toHaveAttribute("aria-label", "最大化");
  await close.click();
  await expect.poll(() => sent(app)).toEqual(["minimize", "maximize", "maximize", "fullscreen", "fullscreen", "close"]);
});

test("hover and pressed colors of the window buttons: Minimize / Maximize get one lighter layer on hover and another on press; Close is the system red with a white icon on hover and press; pressing, moving away and releasing doesn't count as a click", async ({
  app,
}) => {
  await app.open();
  const [min, close] = [winBtn(app, 0), winBtn(app, 2)];
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.trim().slice(i, i + 2), 16)).join(", ")})`;
  const token = (name: string) => app.page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name);
  const bg = (btn: typeof min) => btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  const fg = (btn: typeof min) => btn.evaluate((el) => getComputedStyle(el).color);
  const [hover, pressed, red] = [rgb(await token("--hover")), rgb(await token("--border-strong")), rgb(await token("--close"))];
  expect(red).toBe("rgb(196, 43, 28)");
  await min.hover();
  await expect.poll(() => bg(min)).toBe(hover);
  await app.page.mouse.down();
  await expect.poll(() => bg(min)).toBe(pressed);
  await app.page.mouse.move(600, 500);
  await app.page.mouse.up();
  await close.hover();
  await expect.poll(() => bg(close)).toBe(red);
  await expect.poll(() => fg(close)).toBe("rgb(255, 255, 255)");
  await app.page.mouse.down();
  await expect.poll(() => bg(close)).toBe(red);
  await app.page.mouse.move(600, 500);
  await app.page.mouse.up();
  expect(sent(app)).toEqual([]);
});

test("when the system changes the window state (double-clicking the title bar, Win+↑, dragging to the top of the screen), the maximize button, the Window menu and the top-edge handles all follow", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".win-resize")).toHaveCount(3);
  await systemChanged(app, { maximized: true });
  await expect(winBtn(app, 1)).toHaveAttribute("aria-label", "还原");
  await expect(app.page.locator(".win-resize")).toHaveCount(0);
  await app.page.locator(".menubar-item", { hasText: /^窗口/ }).click();
  await expect(menuItem(app, "还原")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await systemChanged(app, { maximized: false });
  await expect(winBtn(app, 1)).toHaveAttribute("aria-label", "最大化");
  await expect(app.page.locator(".win-resize")).toHaveCount(3);
});

test("top edge, top-left and top-right corners: a left press hands resizing to the shell and a right press doesn't count; the cursor is the matching double arrow; there are no handles when maximized or in full screen", async ({ app }) => {
  await app.open();
  const edges = () => calls(app, "windowResize").map((c) => (c.params as { edge: string }).edge);
  for (const [cls, edge, cursor] of [
    ["is-top", "top", "ns-resize"],
    ["is-topleft", "topleft", "nwse-resize"],
    ["is-topright", "topright", "nesw-resize"],
  ] as const) {
    const handle = app.page.locator(`.win-resize.${cls}`);
    await expect(handle).toHaveCSS("cursor", cursor);
    const b = (await handle.boundingBox())!;
    await app.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await app.page.mouse.down({ button: "right" });
    await app.page.mouse.up({ button: "right" });
    await app.page.mouse.down();
    await app.page.mouse.up();
    await expect.poll(edges).toContain(edge);
  }
  expect(edges()).toEqual(["top", "topleft", "topright"]);
  await systemChanged(app, { maximized: true });
  await expect(app.page.locator(".win-resize")).toHaveCount(0);
  await systemChanged(app, { maximized: false, fullscreen: true });
  await expect(app.page.locator(".win-resize")).toHaveCount(0);
});

// ---------- Drag region ----------

test("drag region: blank space in the title bar drags the window and anything clickable doesn't; with a menu open or in full screen the whole bar doesn't drag", async ({ app }) => {
  await app.open();
  const html = app.page.locator("html");
  expect(await region(app, ".titlebar")).toBe("drag");
  for (const s of [".menubar-item", ".titlebar-split", ".titlebar-action", ".titlebar-more", ".win-btns", ".win-resize"])
    expect(await region(app, s), s).toBe("no-drag");
  // With a menu open: clicking blank title bar space must close the menu, so the whole bar temporarily isn't a drag region; switching back and forth between menus keeps the count right
  await app.page.locator(".menubar-item").first().click();
  await expect(html).toHaveClass(/menu-open/);
  expect(await region(app, ".titlebar")).toBe("no-drag");
  expect(await region(app, ".menubar-menu")).toBe("no-drag");
  await app.page.locator(".menubar-item").nth(2).hover();
  await expect(app.page.locator(".menubar-item").nth(2)).toHaveClass(/is-open/);
  await expect(html).toHaveClass(/menu-open/);
  await more(app).click();
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await expect(app.page.locator(".menu")).toBeVisible();
  await expect(html).toHaveClass(/menu-open/);
  await app.page.keyboard.press("Escape");
  await expect(html).not.toHaveClass(/menu-open/);
  expect(await region(app, ".titlebar")).toBe("drag");
  // Full screen: the system treats dragging the title bar of a maximized window as "drag down to restore" and a double-click as restore, which would put the window out of step with the full-screen flag; as in a browser's full screen, the whole bar doesn't drag
  await app.page.locator(".lib-list").focus();
  await app.page.keyboard.press("F11");
  await expect(winBtn(app, 1)).toHaveAttribute("aria-label", "退出全屏");
  expect(await region(app, ".titlebar")).toBe("no-drag");
  await app.page.keyboard.press("F11");
  await expect(winBtn(app, 1)).toHaveAttribute("aria-label", "最大化");
  expect(await region(app, ".titlebar")).toBe("drag");
});

test("with a dialog open, the overlay covers the title bar too (like a system modal dialog), and clicking × closes only the dialog, not the window", async ({ app }) => {
  await app.open();
  await app.page.locator(".lib-list").focus();
  await app.page.keyboard.press("Control+,");
  await expect(app.page.locator(".overlay")).toBeVisible();
  expect(await region(app, ".overlay")).toBe("no-drag");
  const b = (await winBtn(app, 2).boundingBox())!;
  expect(await hits(app, b.x + b.width / 2, b.y + b.height / 2, ".overlay")).toBe(true);
  await app.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(app.page.locator(".overlay")).toHaveCount(0);
  expect(sent(app)).toEqual([]);
});

// ---------- Keyboard use of the menu titles ----------

test("menu titles aren't in the Tab order (like Windows apps; the keyboard uses Alt / F10); after a lone Alt press ← → move the highlighted menu title, ↓ / Enter / Space open it, and Esc returns to where focus was", async ({
  app,
}) => {
  await app.open();
  // Pressing Tab from the far left of the menu bar goes straight to Capture, skipping the seven menu titles
  await app.page.locator(".menubar").click({ position: { x: 2, y: 10 } });
  await app.page.keyboard.press("Tab");
  await expect(capture(app)).toBeFocused();
  await row(app, "hero.png").click();
  const list = app.page.locator(".lib-list");
  await expect(list).toBeFocused();
  const hot = app.page.locator(".menubar-item.is-hot");
  const menu = app.page.locator(".menubar-menu");
  await app.page.keyboard.press("Alt");
  await expect(hot).toHaveText(/^文件/);
  await app.page.keyboard.press("ArrowRight");
  await expect(hot).toHaveText(/^编辑/);
  await expect(menu).toHaveCount(0);
  await app.page.keyboard.press("ArrowDown");
  await expect(menu).toContainText("撤销");
  await expect(menu.locator(".menu-item:not(:disabled)").first()).toBeFocused();
  await app.page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(hot).toHaveCount(0);
  await expect(list).toBeFocused();
  // ← wraps from File around to the last menu, Help, and Enter opens it
  await app.page.keyboard.press("Alt");
  await app.page.keyboard.press("ArrowLeft");
  await expect(hot).toHaveText(/^帮助/);
  await app.page.keyboard.press("Enter");
  await expect(menu).toContainText("关于超级批注");
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Alt");
  await app.page.keyboard.press("Space");
  await expect(menu).toContainText("刷新素材列表");
  await app.page.keyboard.press("Escape");
  await expect(list).toBeFocused();
  // The arrow keys went to the menu bar, and the selection in the library didn't move
  await expect(row(app, "hero.png")).toHaveAttribute("aria-selected", "true");
});

test("a screen reader \"clicking\" a menu title (a click event with no pointer press) still opens the menu", async ({ app }) => {
  await app.open();
  await app.page.locator(".menubar-item", { hasText: /^视图/ }).dispatchEvent("click");
  await expect(app.page.locator(".menubar-menu")).toContainText("适合窗口");
});

test("holding Alt, switching to another app and releasing it after coming back (Alt+Tab away and back) doesn't enter the menu bar", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await app.page.keyboard.down("Alt");
  await app.page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await app.page.keyboard.up("Alt");
  await expect(app.page.locator(".menubar")).not.toHaveClass(/is-armed/);
});

test("pressing a Ctrl / Alt combination after a lone Alt press leaves the menu bar and the combination still takes effect instead of being swallowed (likewise Alt+F4 closing the window and Alt+Space)", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  const bar = app.page.locator(".menubar");
  await app.page.keyboard.press("Alt");
  await expect(bar).toHaveClass(/is-armed/);
  await app.page.keyboard.press("Control+b");
  await expect(app.page.locator(".layout")).toHaveClass(/left-collapsed/);
  await expect(bar).not.toHaveClass(/is-armed/);
  // Alt+letter still opens that menu
  await app.page.keyboard.press("Alt");
  await app.page.keyboard.press("Alt+v");
  await expect(app.page.locator(".menubar-menu")).toContainText("适合窗口");
});

test("the title bar buttons can be reached with the keyboard: Capture → small arrow → Minimize → Maximize → Close, each with a focus ring, and Enter / Space act as a click", async ({ app }) => {
  await app.open();
  await capture(app).focus();
  for (const target of [more(app), winBtn(app, 0), winBtn(app, 1), winBtn(app, 2)]) {
    await app.page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    expect(await target.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  }
  await app.page.keyboard.press("Shift+Tab");
  await app.page.keyboard.press("Shift+Tab");
  await expect(winBtn(app, 0)).toBeFocused();
  await app.page.keyboard.press("Enter");
  await app.page.keyboard.press("Tab");
  await app.page.keyboard.press("Space");
  await expect(winBtn(app, 1)).toHaveAttribute("aria-label", "还原");
  await app.page.keyboard.press("Tab");
  await app.page.keyboard.press("Enter");
  await expect.poll(() => sent(app)).toEqual(["minimize", "maximize", "close"]);
});

// ---------- Interface size, English ----------

test("Interface size 125%: the title bar scales by the factor, the three buttons sit against the top-right corner of the window and are clickable over their whole area, and both drop-downs are the same distance from the title bar", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  const bar = (await app.page.locator(".titlebar").boundingBox())!;
  expect(bar.height).toBeCloseTo(33 * 1.25, 0);
  const vw = app.page.viewportSize()!.width;
  const close = (await winBtn(app, 2).boundingBox())!;
  expect(close.x + close.width).toBeCloseTo(vw, 0);
  expect(close.height).toBeCloseTo(32 * 1.25, 0);
  for (let i = 0; i < 3; i++) {
    const b = (await winBtn(app, i).boundingBox())!;
    expect(await hits(app, b.x + b.width / 2, b.y + b.height / 2, ".win-btn"), `button ${i + 1}`).toBe(true);
  }
  await app.page.locator(".menubar-item").first().click();
  const file = await box(app.page.locator(".menubar-menu"));
  await app.page.keyboard.press("Escape");
  await more(app).click();
  const arrow = await box(app.page.locator(".menu"));
  expect(file.y - (bar.y + bar.height)).toBeCloseTo(4 * 1.25, 0);
  expect(arrow.y).toBeCloseTo(file.y, 0);
});

test("the title bar in English: buttons, tips, menus and screen reader names are all English, and nothing is crowded together at the narrowest window", async ({ app }) => {
  app.host.prefs = { language: "en" };
  await app.page.setViewportSize({ width: 960, height: 700 });
  await app.open();
  await expect(capture(app)).toHaveText("Capture");
  await expect(capture(app)).toHaveAttribute(
    "title",
    "Screen capture: select any area of the screen, draw marks and write notes; the image is copied to the clipboard when you finish. Hides this window before capturing (change in the arrow menu). Shortcut Ctrl Alt A works in any app",
  );
  await expect(more(app)).toHaveAttribute("title", "Capture options");
  await expect(winBtn(app, 0)).toHaveAttribute("aria-label", "Minimize");
  await expect(winBtn(app, 1)).toHaveAttribute("aria-label", "Maximize");
  await expect(winBtn(app, 2)).toHaveAttribute("title", "Close (Alt F4)");
  await more(app).click();
  await expect(app.page.getByRole("menuitemcheckbox", { name: "Hide This Window While Capturing" })).toBeVisible();
  await expect(menuItem(app, "Capture Settings…")).toBeVisible();
  await app.page.keyboard.press("Escape");
  const last = (await app.page.locator(".menubar-item").last().boundingBox())!;
  const split = (await app.page.locator(".titlebar-split").boundingBox())!;
  const btns = (await app.page.locator(".win-btns").boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(split.x);
  expect(split.x + split.width).toBeLessThanOrEqual(btns.x);
});

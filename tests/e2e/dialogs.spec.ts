// Dialogs and notices: the keyboard shortcuts sheet, the intro, confirm dialogs, toasts,
// and the error boxes (inside dialogs, in the main UI, on the startup failure page). The settings dialog itself is in settings-dialog.spec.ts;
// the startup notices are in settings.spec.ts and rename.spec.ts

import { join } from "node:path";
import { expect, test, type App } from "./harness";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (app: App, name: string) => app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${escape(name)}$`) }) });
const list = (app: App) => app.page.locator(".lib-list");
const toast = (app: App) => app.page.locator(".toast");
const sheet = (app: App) => app.page.getByRole("dialog", { name: "快捷键" });
const intro = (app: App) => app.page.getByRole("dialog", { name: "入门" });
const menuItem = (app: App, name: string | RegExp) => app.page.getByRole("menuitem", { name });
const topMenu = (app: App, name: string) => app.page.locator(".menubar button", { hasText: name }).click();
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const composerText = (app: App) => app.page.locator(".composer-text");
/** Whether focus is inside the element matching selector */
const focusIn = (app: App, selector: string) => app.page.evaluate((s) => !!document.activeElement?.closest(s), selector);

/** Drags a rectangle on the canvas and types text in the composer (without saving) */
async function startRect(app: App, body: string) {
  await focusStage(app);
  await app.page.keyboard.press("r");
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await app.page.mouse.up();
  await composerText(app).fill(body);
}

/** Presses Tab and Shift+Tab n times each; after every press focus must still be inside selector */
async function tabStaysIn(app: App, selector: string, n = 20) {
  for (const key of ["Tab", "Shift+Tab"])
    for (let i = 0; i < n; i++) {
      await app.page.keyboard.press(key);
      expect(await focusIn(app, selector), `${key} press ${i + 1}`).toBe(true);
    }
}

/**
 * Puts a piece of the UI into the "error" state: finds the ErrorBoundary around selector (the one whose area matches) and sets its error state directly.
 * What is tested here is how the error box looks and handles keys; that a real thrown error is caught and logged is covered by the
 * "settings page render error" test in settings.spec.ts and the two tests in layout.spec.ts
 */
async function crash(app: App, selector: string, area: string) {
  await app.page.evaluate(
    ([sel, wantedArea]) => {
      const el = document.querySelector(sel)!;
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))!;
      type Fiber = { stateNode?: { props?: { area?: string }; setState?: (s: unknown) => void }; return?: Fiber };
      let f = (el as unknown as Record<string, Fiber>)[key] as Fiber | undefined;
      while (f && !(f.stateNode?.props?.area === wantedArea && typeof f.stateNode.setState === "function")) f = f.return;
      f!.stateNode!.setState!({ error: new Error("测试注入的出错") });
    },
    [selector, area],
  );
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

// ---------- Keyboard shortcuts sheet ----------

test("Keyboard shortcuts: ?, F1 and the Help menu all open it; in the filter box ? types a character while F1 still opens it", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("?");
  await expect(sheet(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(sheet(app)).toHaveCount(0);
  await app.page.keyboard.press("F1");
  await expect(sheet(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await topMenu(app, "帮助");
  await menuItem(app, /^快捷键/).click();
  await expect(sheet(app)).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(sheet(app)).toHaveCount(0);

  const search = app.page.getByPlaceholder("筛选素材");
  await search.click();
  await app.page.keyboard.press("?");
  await expect(search).toHaveValue("?");
  await expect(sheet(app)).toHaveCount(0);
  await app.page.keyboard.press("F1");
  await expect(sheet(app)).toBeVisible();
});

test("Keyboard shortcuts: Esc, ?, F1, × and a click on the backdrop all close it; other shortcuts do nothing while it is open", async ({ app }) => {
  await app.open();
  const open = async () => {
    await focusStage(app);
    await app.page.keyboard.press("F1");
    await expect(sheet(app)).toBeVisible();
  };
  for (const key of ["Escape", "?", "F1"]) {
    await open();
    await app.page.keyboard.press(key);
    await expect(sheet(app), key).toHaveCount(0);
  }
  await open();
  await sheet(app).getByRole("button", { name: /^关闭/ }).click();
  await expect(sheet(app)).toHaveCount(0);
  await open();
  await app.page.mouse.click(5, 300);
  await expect(sheet(app)).toHaveCount(0);

  await open();
  await app.page.keyboard.press("r");
  await app.page.keyboard.press("Control+o");
  await app.page.keyboard.press("Control+b");
  await app.page.keyboard.press("Escape");
  expect(app.host.calls.some((c) => c.method === "pickFiles")).toBe(false);
  await expect(app.page.locator(".layout")).not.toHaveClass(/left-collapsed/);
  await expect(app.page.locator(".annot-layer")).not.toHaveClass(/tool-rect/);
});

test("Keyboard shortcuts and intro: pressing inside the dialog and releasing over the backdrop does not close it (same as Settings and confirm dialogs)", async ({ app }) => {
  await app.open();
  for (const [open, dialog] of [
    [
      async () => {
        await focusStage(app);
        await app.page.keyboard.press("F1");
      },
      sheet(app),
    ],
    [
      async () => {
        await topMenu(app, "帮助");
        await menuItem(app, "入门").click();
      },
      intro(app),
    ],
  ] as const) {
    await open();
    await expect(dialog).toBeVisible();
    const box = (await dialog.locator(".sheet-title").boundingBox())!;
    await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.page.mouse.down();
    await app.page.mouse.move(5, 300, { steps: 5 });
    await app.page.mouse.up();
    await expect(dialog).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("Keyboard shortcuts: six groups with these names in this order; parenthetical remarks go on their own line in small text; there is no search box", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("F1");
  await expect(sheet(app).locator(".section-label")).toHaveText(["全局", "截图批注（全局可用）", "素材列表（焦点在列表中时）", "批注", "画面", "视频"]);
  expect(await sheet(app).locator(".shortcut-note").count()).toBeGreaterThan(0);
  await expect(sheet(app).locator("input")).toHaveCount(0);
});

test("Keyboard shortcuts: in a short window the bottom edge fades out, the fade disappears when scrolled to the end and returns when scrolled back", async ({ app }) => {
  await app.page.setViewportSize({ width: 960, height: 600 });
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("F1");
  const scroll = sheet(app).locator(".sheet-scroll");
  await expect(scroll).toHaveClass(/has-more/);
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(scroll).not.toHaveClass(/has-more/);
  await scroll.evaluate((el) => (el.scrollTop = 0));
  await expect(scroll).toHaveClass(/has-more/);
});

test("Keyboard shortcuts: focus moves into the dialog and Tab / Shift+Tab never reach the page behind; Esc closes it, focus returns to where it was and ↓ still works", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("F1");
  await expect(sheet(app)).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => focusIn(app, ".sheet")).toBe(true);
  await tabStaysIn(app, ".sheet");
  await app.page.keyboard.press("Escape");
  await expect(sheet(app)).toHaveCount(0);
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("Keyboard shortcuts: the keyboard can scroll the content (focus is on the content area; ↓ and End scroll down)", async ({ app }) => {
  await app.page.setViewportSize({ width: 960, height: 600 });
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("F1");
  const scroll = sheet(app).locator(".sheet-scroll");
  await expect(scroll).toBeFocused();
  await app.page.keyboard.press("End");
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("F1 while writing a note, then Esc: only the shortcuts sheet closes and the composer with its unsaved text stays; text typed while the sheet is open does not go into the composer", async ({ app }) => {
  await app.open();
  await startRect(app, "还没写完");
  await app.page.keyboard.press("F1");
  await expect(sheet(app)).toBeVisible();
  await app.page.keyboard.type("abc");
  await app.page.keyboard.press("Enter");
  await app.page.keyboard.press("Escape");
  await expect(sheet(app)).toHaveCount(0);
  await expect(composerText(app)).toHaveValue("还没写完");
  // The cursor is back in the composer so writing can continue
  await expect(composerText(app)).toBeFocused();
});

test("While the shortcuts sheet is open, the filter box behind it receives no text", async ({ app }) => {
  await app.open();
  const search = app.page.getByPlaceholder("筛选素材");
  await search.click();
  await app.page.keyboard.press("F1");
  await expect(sheet(app)).toBeVisible();
  await app.page.keyboard.type("abc");
  await expect(search).toHaveValue("");
});

// ---------- Intro ----------

test("Intro: has aria-modal, focus moves into the dialog, Tab / Shift+Tab never reach the page behind, and Esc, × and a click on the backdrop all close it", async ({ app }) => {
  await app.open();
  const open = async () => {
    await topMenu(app, "帮助");
    await menuItem(app, "入门").click();
    await expect(intro(app)).toBeVisible();
  };
  await open();
  await expect(intro(app)).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => focusIn(app, ".sheet-intro")).toBe(true);
  await tabStaysIn(app, ".sheet-intro");
  await app.page.keyboard.press("Escape");
  await expect(intro(app)).toHaveCount(0);
  await open();
  await intro(app).getByRole("button", { name: /^关闭/ }).click();
  await expect(intro(app)).toHaveCount(0);
  await open();
  await app.page.mouse.click(5, 300);
  await expect(intro(app)).toHaveCount(0);
});

test("Intro: three steps and the small print; Add Folder first closes the dialog, then opens the picker, and the chosen folder is added to the list", async ({ app }) => {
  await app.open();
  await topMenu(app, "帮助");
  await menuItem(app, "入门").click();
  await expect(intro(app).locator(".welcome-steps li")).toHaveCount(3);
  await expect(intro(app)).toContainText(".sniptoss");
  await expect(intro(app)).toContainText("Ctrl Alt A");
  // The tooltips of the two buttons match the library's (the name includes the shortcut)
  await expect(intro(app).getByRole("button", { name: "添加文件夹" })).toHaveAttribute("title", "添加文件夹（Ctrl Shift O）");
  await expect(intro(app).getByRole("button", { name: "添加文件", exact: true })).toHaveAttribute("title", "添加文件（Ctrl O）");
  app.host.nextPickFolder = join(app.project, "video");
  await intro(app).getByRole("button", { name: "添加文件夹" }).click();
  await expect(intro(app)).toHaveCount(0);
  await expect.poll(() => app.host.calls.some((c) => c.method === "pickFolder")).toBe(true);
});

test("Intro: at the minimum window size and 125% interface size the content does not fit; the bottom fade shows there is more to scroll and disappears at the end", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.page.setViewportSize({ width: 960, height: 600 });
  await app.open();
  await topMenu(app, "帮助");
  await menuItem(app, "入门").click();
  const scroll = intro(app).locator(".sheet-scroll");
  expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  await expect(scroll).toHaveClass(/has-more/);
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(scroll).not.toHaveClass(/has-more/);
});

// ---------- Confirm dialogs ----------

test("Confirm dialog: a screen reader reads the body (aria-describedby), Tab / Shift+Tab cycle inside the dialog, and Cancel cancels", async ({ app }) => {
  await app.open();
  await row(app, "project").click();
  await app.page.keyboard.press("Delete");
  const dialog = app.page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAccessibleDescription(/project/);
  await expect(dialog.locator(".btn-danger-soft")).toBeFocused();
  await tabStaysIn(app, ".confirm");
  await dialog.locator(".confirm-actions").getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(app, "project")).toBeVisible();
  await expect(list(app)).toBeFocused();
});

// ---------- Toasts ----------

test("Toast: the same error shown repeatedly appears only once, and one click on × dismisses it (it does not queue up)", async ({ app }) => {
  app.allowLogErrors("磁盘满了");
  app.host.failWrites = /hero/;
  await app.open();
  await startRect(app, "存不上");
  await app.page.keyboard.press("Enter");
  await expect(toast(app)).toHaveClass(/is-error/);
  // The composer comes back with the text; saving again fails the same way
  await expect(composerText(app)).toHaveValue("存不上");
  await composerText(app).focus();
  await app.page.keyboard.press("Enter");
  await expect(toast(app)).toHaveCount(1);
  await toast(app).getByRole("button", { name: "关闭" }).click();
  await expect(toast(app)).toHaveCount(0);
});

test("Toast: when \"settings could not be saved\" is queued behind another persistent notice, several failed saves in a row still queue only one", async ({ app }) => {
  app.host.startupNotice = "设置文件已损坏，已从上次的备份恢复。";
  app.host.failMethods.add("setPrefs");
  await app.open();
  await expect(toast(app)).toContainText("设置文件已损坏");
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^批注$/ }).click();
  const loop = app.page.locator(".set-row", { hasText: "循环播放视频" }).getByRole("switch");
  await loop.click();
  await loop.click();
  await loop.click();
  await app.page.keyboard.press("Escape");
  await toast(app).getByRole("button", { name: "知道了" }).click();
  await expect(toast(app)).toContainText("设置未能保存");
  await toast(app).getByRole("button", { name: "关闭" }).click();
  await expect(toast(app)).toHaveCount(0);
});

test("Toast: a very long path without spaces wraps inside the bubble instead of overflowing", async ({ app }) => {
  app.host.failMethods.add("reveal");
  app.host.failMessages.reveal = `找不到文件或文件夹：C:\\${"很长的文件夹名".repeat(6)}\\${"x".repeat(160)}.png`;
  await app.open();
  await row(app, "hero.png").click({ button: "right" });
  await menuItem(app, /在资源管理器中显示/).click();
  await expect(toast(app)).toContainText("找不到文件或文件夹");
  const [text, bubble] = await Promise.all([toast(app).locator("span").last().boundingBox(), toast(app).boundingBox()]);
  expect(text!.x + text!.width).toBeLessThanOrEqual(bubble!.x + bubble!.width);
  expect(bubble!.x).toBeGreaterThanOrEqual(0);
  expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(app.page.viewportSize()!.width);
});

test("A startup notice (corrupt settings file) that was not dismissed with OK survives a page reload (new drive plugged in, UI process crashed); once dismissed it is gone after the next reload", async ({ app }) => {
  app.host.startupNotice = "设置文件已损坏，已从上次的备份恢复。";
  await app.open();
  await expect(toast(app)).toContainText("设置文件已损坏");
  // The shell hands the notice out only once (Bridge.TakeStartupNotice) and the mock host does the same
  await app.page.reload();
  await expect(row(app, "hero.png")).toBeVisible();
  await expect(toast(app)).toContainText("设置文件已损坏");
  await toast(app).getByRole("button", { name: "知道了" }).click();
  await expect(toast(app)).toHaveCount(0);
  await app.page.reload();
  await expect(row(app, "hero.png")).toBeVisible();
  await app.page.waitForTimeout(300);
  await expect(toast(app)).toHaveCount(0);
});

// ---------- Error boxes ----------

test("Settings page error: the error box is modal (focus moves into it, Tab cannot leave, shortcuts behind it do not respond) and Esc closes it; Ctrl+, can open Settings again", async ({ app }) => {
  app.allowLogErrors("UI error (settings)");
  app.host.appInfoPatch = { exe: { broken: true } }; // the Advanced page renders the app location as text, so an object makes React throw
  await app.open();
  await row(app, "project").click();
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^高级$/ }).click();
  const box = app.page.locator(".error-boundary.is-dialog");
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("role", "alertdialog");
  await expect(box).toHaveAttribute("aria-modal", "true");
  await expect(box).toHaveAccessibleName("设置发生错误");
  await expect.poll(() => focusIn(app, ".error-boundary")).toBe(true);
  await tabStaysIn(app, ".error-boundary", 6);
  await app.page.keyboard.press("n"); // overall comment
  await app.page.keyboard.press("Delete");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect(app.page.getByRole("alertdialog", { name: /移除/ })).toHaveCount(0);
  await app.page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("Control+,");
  await expect(app.page.locator(".settings")).toBeVisible();
});

test("Shortcuts sheet error: the error box appears in the overlay, Esc closes it and ? can open the sheet again", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("F1");
  await crash(app, ".sheet", "shortcuts");
  const box = app.page.locator(".error-boundary.is-dialog");
  await expect(box).toContainText("快捷键一览发生错误");
  await expect.poll(() => focusIn(app, ".error-boundary")).toBe(true);
  await app.page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await focusStage(app);
  await app.page.keyboard.press("?");
  await expect(sheet(app)).toBeVisible();
});

test("Main UI error: the error page has the window title bar (draggable, minimize / maximize / close clickable), can still open the log folder, and Retry returns to the main UI", async ({ app }) => {
  await app.open();
  await crash(app, ".titlebar", "workspace");
  const page = app.page.locator(".error-page");
  await expect(page).toContainText("主界面发生错误");
  await expect(app.page.locator(".lib-row")).toHaveCount(0);
  const bar = page.locator(".titlebar");
  expect(await bar.evaluate((el) => getComputedStyle(el).getPropertyValue("app-region") || getComputedStyle(el).getPropertyValue("-webkit-app-region"))).toBe(
    "drag",
  );
  await page.getByRole("button", { name: "最小化" }).click();
  await page.getByRole("button", { name: "最大化" }).click();
  await expect.poll(() => app.host.calls.filter((c) => c.method === "window").map((c) => (c.params as { action: string }).action)).toEqual([
    "minimize",
    "maximize",
  ]);
  await expect(page.getByRole("button", { name: "还原" })).toBeVisible();
  await page.getByRole("button", { name: "打开日志文件夹" }).click();
  expect(app.host.revealed.at(-1)).toBe("@logs");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(row(app, "hero.png")).toBeVisible();
});

test("Outermost error (the toast / message layer itself): the whole window becomes the error page with the window buttons; messages may be gone by then, so it falls back to English", async ({ app }) => {
  await app.open();
  await crash(app, ".titlebar", "app");
  const page = app.page.locator(".error-page");
  await expect(page).toContainText("An error occurred in the app");
  await expect(page.getByRole("button", { name: "Minimize" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Log Folder" }).click();
  expect(app.host.revealed.at(-1)).toBe("@logs");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(row(app, "hero.png")).toBeVisible();
});

test("Main UI error: Reload reloads the whole page and returns to the main UI", async ({ app }) => {
  await app.open();
  await app.page.evaluate(() => ((window as unknown as { __before: boolean }).__before = true));
  await crash(app, ".titlebar", "workspace");
  await app.page.getByRole("button", { name: "重新载入" }).click();
  await expect(row(app, "hero.png")).toBeVisible();
  expect(await app.page.evaluate(() => (window as unknown as { __before?: boolean }).__before)).toBeUndefined();
});

test("After the notes panel or canvas errors, switching to another item makes it retry by itself and recover", async ({ app }) => {
  await app.open();
  await expect(app.page).toHaveTitle("hero.png");
  for (const [selector, area, name] of [
    [".panel", "panel", "批注栏"],
    [".zoom-media", "stage", "画面"],
  ] as const) {
    await crash(app, selector, area);
    await expect(app.page.locator(".error-boundary", { hasText: `${name}发生错误` })).toBeVisible();
    const next = (await app.page.title()) === "hero.png" ? "poster.jpg" : "hero.png";
    await row(app, next).click();
    await expect(app.page).toHaveTitle(next);
    await expect(app.page.locator(".error-boundary")).toHaveCount(0);
    await expect(app.page.locator(selector)).toBeVisible();
  }
});

test("When settings cannot be read at startup, the error page has the window title bar, states the reason, and can reload or open the log folder", async ({ app }) => {
  app.allowLogErrors("startup");
  app.host.failMethods.add("getPrefs");
  await app.page.goto("https://app.sniptoss.example/index.html");
  const page = app.page.locator(".error-page");
  await expect(page.getByRole("alert")).toContainText("getPrefs 失败（测试注入）");
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();
  await page.getByRole("button", { name: "打开日志文件夹" }).click();
  expect(app.host.revealed.at(-1)).toBe("@logs");
  app.host.failMethods.delete("getPrefs");
  await page.getByRole("button", { name: "重新载入" }).click();
  await expect(row(app, "hero.png")).toBeVisible();
});

test("Outside the app window (opened in a normal browser), the page only asks to open it in the app window and makes no shell calls", async ({ app }) => {
  await app.page.addInitScript(() => delete (window as unknown as { chrome: { webview?: unknown } }).chrome.webview);
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.getByRole("alert")).toHaveText("请在超级批注窗口中打开此界面。");
  await expect(app.page.locator(".win-btn")).toHaveCount(0);
  expect(app.host.calls).toHaveLength(0);
});

test("Uncaught UI errors are written to the shell log: errors thrown in events as error, unhandled Promise rejections and CSP blocks as warn; the same entry is logged only once per minute", async ({ app }) => {
  await app.open();
  for (const a of ["e2e-thrown", "e2e-rejected", "content security policy"]) app.allowLogErrors(a);
  // Same entry = same location, message and stack: throw from the same function every time
  await app.page.evaluate(() => {
    const boom = () => {
      throw new Error("e2e-thrown");
    };
    (window as unknown as { __boom: () => void }).__boom = boom;
    for (let i = 0; i < 3; i++) setTimeout(boom);
    void Promise.reject(new Error("e2e-rejected"));
    const img = new Image();
    img.src = "https://blocked.example/x.png"; // not allowed by img-src
    document.body.append(img);
  });
  const logs = (s: string) => app.host.logs.filter((l) => l.message.includes(s));
  await expect.poll(() => logs("e2e-thrown").length).toBe(1);
  await expect.poll(() => logs("e2e-rejected").length).toBe(1);
  await expect.poll(() => logs("blocked.example").length).toBe(1);
  expect(logs("e2e-thrown")[0]).toMatchObject({ level: "error" });
  expect(logs("e2e-thrown")[0].message).toMatch(/^Uncaught error: e2e-thrown/);
  expect(logs("e2e-rejected")[0]).toMatchObject({ level: "warn" });
  expect(logs("e2e-rejected")[0].message).toMatch(/^Unhandled Promise rejection: e2e-rejected/);
  expect(logs("blocked.example")[0]).toMatchObject({ level: "warn" });
  expect(logs("blocked.example")[0].message).toMatch(/^Blocked by the content security policy: img-src/);
  // The same entry again a moment later: not logged again within a minute (the three throws above were also logged once)
  await app.page.evaluate(() => setTimeout((window as unknown as { __boom: () => void }).__boom));
  await app.page.waitForTimeout(300);
  expect(logs("e2e-thrown")).toHaveLength(1);
});

// ---------- Sizes ----------

test("At the minimum window size and 125% interface size, the shortcuts sheet, intro, confirm dialog and error box all fit inside the window and their × can be clicked", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.page.setViewportSize({ width: 960, height: 600 });
  await app.open();
  const inside = async (selector: string) => {
    const b = (await app.page.locator(selector).boundingBox())!;
    expect(b.x, selector).toBeGreaterThanOrEqual(0);
    expect(b.y, selector).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, selector).toBeLessThanOrEqual(960);
    expect(b.y + b.height, selector).toBeLessThanOrEqual(600);
  };
  const closeHit = (selector: string) =>
    app.page.evaluate((s) => {
      const btn = document.querySelector(`${s} .dialog-close`)!;
      const r = btn.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(".dialog-close") === btn;
    }, selector);

  await focusStage(app);
  await app.page.keyboard.press("F1");
  await inside(".sheet");
  expect(await closeHit(".sheet")).toBe(true);
  await app.page.keyboard.press("Escape");

  await topMenu(app, "帮助");
  await menuItem(app, "入门").click();
  await inside(".sheet-intro");
  expect(await closeHit(".sheet-intro")).toBe(true);
  await app.page.keyboard.press("Escape");

  await row(app, "project").click();
  await app.page.keyboard.press("Delete");
  await inside(".confirm");
  expect(await closeHit(".confirm")).toBe(true);
  await app.page.keyboard.press("Escape");

  await focusStage(app);
  await app.page.keyboard.press("F1");
  await crash(app, ".sheet", "shortcuts");
  await inside(".error-boundary.is-dialog");
});

// Settings: the dialog itself (opening, switching pages, closing, focus),
// the controls on each page (click → the setting changes → the effect shows up and survives a reopen), and what is said when reading or writing fails.
// A few earlier fixes (Restore Defaults asks first, shortcut recording, skipped folders, startup notices, ...) are covered in settings.spec.ts

import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";
import { IS_BETA, VERSION, VERSION_LABEL } from "./mock-host";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (app: App, name: string) =>
  app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${escape(name)}$`) }) });
const list = (app: App) => app.page.locator(".lib-list");
const toast = (app: App) => app.page.locator(".toast");
const settings = (app: App) => app.page.locator(".settings");
const onTab = (app: App) => app.page.locator(".settings-tab.is-on");
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
/** The row in Settings whose name is label */
const setRow = (app: App, label: string) =>
  app.page.locator(".set-row", { has: app.page.locator(".set-label", { hasText: new RegExp(`^${escape(label)}$`) }) });
const composer = (app: App) => app.page.locator(".composer");
const media = (app: App) => app.media();
const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) =>
  [box.x + box.width * fx, box.y + box.height * fy] as const;
/** Whether focus is inside the Settings dialog */
const focusInSettings = (app: App) => app.page.evaluate(() => !!document.activeElement?.closest(".settings"));

async function openSettings(app: App, tab?: string) {
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await expect(settings(app)).toBeVisible();
  if (tab) await app.page.locator(".settings-tab", { hasText: new RegExp(`^${escape(tab)}$`) }).click();
}

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

// ---------- The dialog itself ----------

test("keyboard focus: it moves into the dialog on opening, Tab / Shift+Tab never reach the UI behind it; closing returns focus to where it was and ↓ still works afterwards", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("Control+,");
  await expect(settings(app)).toBeVisible();
  await expect(settings(app)).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => focusInSettings(app)).toBe(true);
  for (const key of ["Tab", "Shift+Tab"])
    for (let i = 0; i < 20; i++) {
      await app.page.keyboard.press(key);
      expect(await focusInSettings(app), `${key} press ${i + 1}`).toBe(true);
    }
  // Click a tab inside (focus is on the tab), then Esc
  await app.page.locator(".settings-tab", { hasText: /^批注$/ }).click();
  await app.page.keyboard.press("Escape");
  await expect(settings(app)).toHaveCount(0);
  await expect(list(app)).toBeFocused();
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("clicking Open Settings in a toast while Settings is already open switches to the Screen Capture page", async ({ app }) => {
  app.host.capture.hotkeyError = "Ctrl Alt A 已被其他程序占用，请更换快捷键";
  await app.open();
  await expect(toast(app)).toContainText("截图快捷键未能注册");
  await openSettings(app);
  await expect(onTab(app)).toHaveText("常规");
  await toast(app).getByRole("button", { name: "打开设置" }).click();
  await expect(onTab(app)).toHaveText("截图批注");
});

// ---------- Saving settings ----------

test("the settings file only records items that were changed: untouched ones aren't written (if a later version changes a default, people who never touched it follow the new one)", async ({ app }) => {
  await app.open();
  await openSettings(app, "批注");
  const loop = setRow(app, "循环播放视频").getByRole("switch");
  await loop.click();
  await expect.poll(() => app.host.prefs?.loop).toBe(true);
  // The reference time for what counts as New in the library (not a setting; recorded the first time a project is seen) and the item just changed
  await expect.poll(() => Object.keys(app.host.prefs ?? {}).sort()).toEqual(["fresh", "loop"]);
  await loop.click();
  await expect.poll(() => Object.keys(app.host.prefs ?? {}).sort()).toEqual(["fresh"]);
});

test("a setting change that wasn't saved (the shell can't write the settings file) is announced instead of silently dropped", async ({ app }) => {
  await app.open();
  app.host.failMethods.add("setPrefs");
  await openSettings(app, "批注");
  await setRow(app, "循环播放视频").getByRole("switch").click();
  await expect(toast(app)).toContainText("设置未能保存，下次更改设置时将重试");
  // Changing another item still fails to save: the same toast, without queueing up a pile of them
  await setRow(app, "在画面上显示已处理的批注").getByRole("switch").click();
  await expect(toast(app)).toHaveCount(1);
  await toast(app).locator(".toast-close").click();
  await expect(toast(app)).toHaveCount(0);
});

test("Restore Defaults only covers items on the settings pages: casual state such as the notes panel scope and the volume is left alone", async ({ app }) => {
  app.host.prefs = { author: "小王", panelScope: "material", panelResolved: true, volume: 0.3, muted: true };
  await app.open();
  await openSettings(app, "高级");
  await setRow(app, "恢复默认设置").getByRole("button", { name: "恢复默认" }).click();
  await app.page.getByRole("alertdialog").getByRole("button", { name: "恢复默认" }).click();
  await expect(toast(app)).toContainText("已恢复默认设置");
  await expect.poll(() => app.host.prefs?.author).toBeUndefined();
  expect(app.host.prefs).toMatchObject({ panelScope: "material", panelResolved: true, volume: 0.3, muted: true });
});

// ---------- Interface size ----------

test("Interface size 125%: the note box still sits next to the mark without covering it (a mark drawn on the left gets it on the right, one on the right gets it on the left)", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  const box = await media(app);
  const stage = (await app.page.locator(".stage").boundingBox())!;
  for (const [from, to, side] of [
    [at(box, 0.05, 0.3), at(box, 0.25, 0.6), "right"],
    [at(box, 0.75, 0.3), at(box, 0.95, 0.6), "left"],
  ] as const) {
    await focusStage(app);
    await app.page.keyboard.press("r");
    await app.page.mouse.move(...from);
    await app.page.mouse.down();
    await app.page.mouse.move(...to, { steps: 8 });
    await app.page.mouse.up();
    const c = (await composer(app).boundingBox())!;
    const gap = side === "right" ? c.x - to[0] : from[0] - (c.x + c.width);
    expect(gap, side).toBeGreaterThanOrEqual(6);
    expect(gap, side).toBeLessThanOrEqual(24);
    expect(c.x).toBeGreaterThanOrEqual(stage.x);
    expect(c.x + c.width).toBeLessThanOrEqual(stage.x + stage.width);
    await app.page.keyboard.press("Escape");
  }
});

test("Interface size 125%: hover tooltips still appear right below the button", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  const btn = app.page.locator(".hdr-btn").first();
  await btn.hover();
  const tip = app.page.locator(".tooltip.is-on");
  await expect(tip).toBeVisible();
  const b = (await btn.boundingBox())!;
  const t = (await tip.boundingBox())!;
  const vw = app.page.viewportSize()!.width;
  // For a button against the right edge of the window the tooltip is pushed back into the window: horizontally it only has to cover the button's center line
  expect(t.x).toBeLessThanOrEqual(b.x + b.width / 2);
  expect(t.x + t.width).toBeGreaterThanOrEqual(b.x + b.width / 2);
  expect(t.x + t.width).toBeLessThanOrEqual(vw);
  expect(t.y - (b.y + b.height)).toBeGreaterThanOrEqual(2);
  expect(t.y - (b.y + b.height)).toBeLessThanOrEqual(16);
});

// ---------- Screen Capture, System, Advanced, About: read and write failures ----------

test("the \"capture shortcut was changed to …\" notice is shown only once per launch: it isn't shown again when the page reloads (after a new drive is plugged in)", async ({ app }) => {
  app.host.capture.hotkey = "Shift+PrintScreen";
  app.host.capture.hotkeyMoved = { from: "Ctrl+Alt+A", to: "Shift+PrintScreen", typed: "ą" };
  await app.open();
  await expect(toast(app)).toContainText("截图快捷键已改为 Shift PrintScreen");
  const reads = () => app.host.calls.filter((c) => c.method === "captureSettings").length;
  const before = reads();
  await app.page.reload();
  await expect(row(app, "project")).toBeVisible();
  await expect.poll(reads).toBeGreaterThan(before);
  await app.page.waitForTimeout(300);
  await expect(toast(app).filter({ hasText: "截图快捷键已改为" })).toHaveCount(0);
});

test("recording the capture shortcut: arrow keys, Home and Insert with only Shift are rejected (they would stop Shift+← from selecting text and Shift+Insert from pasting in every program); Shift+F8 can be recorded", async ({
  app,
}) => {
  await app.open();
  await openSettings(app, "截图批注");
  const input = app.page.locator(".hotkey-input");
  await input.click();
  for (const key of ["Shift+ArrowLeft", "Shift+Home", "Shift+Insert", "Shift+PageDown"]) {
    await app.page.keyboard.press(key);
    await expect(input, key).toContainText("不能只用 Shift");
  }
  expect(app.host.capture.hotkey).toBe("Ctrl+Alt+A");
  await app.page.keyboard.press("Shift+F8");
  await expect.poll(() => app.host.capture.hotkey).toBe("Shift+F8");
});

test("when the System page fails to load, it explains why and can retry, and there is no switch to click while it can't be read (the switch used to sit at Off and still be clickable)", async ({ app }) => {
  await app.open();
  app.host.failMethods.add("shellIntegration");
  await openSettings(app, "系统集成");
  await expect(app.page.locator(".settings-body .error")).toContainText("无法读取此页设置");
  await expect(setRow(app, "资源管理器右键菜单")).toHaveCount(0);
  app.host.failMethods.delete("shellIntegration");
  await app.page.locator(".settings-body").getByRole("button", { name: "重试" }).click();
  await expect(setRow(app, "资源管理器右键菜单").getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

test("when the About and Advanced pages can't read the app info, they explain why and can retry instead of showing an ellipsis forever", async ({ app }) => {
  await app.open();
  app.host.failMethods.add("appInfo");
  await openSettings(app, "关于");
  await expect(app.page.locator(".settings-body .error")).toContainText("无法读取此页设置");
  await app.page.locator(".settings-tab", { hasText: /^高级$/ }).click();
  await expect(app.page.locator(".settings-body .error")).toContainText("无法读取此页设置");
  app.host.failMethods.delete("appInfo");
  await app.page.locator(".settings-body").getByRole("button", { name: "重试" }).click();
  await expect(setRow(app, "设置文件")).toContainText("settings.json");
  await app.page.locator(".settings-tab", { hasText: /^关于$/ }).click();
  await expect(setRow(app, "运行环境")).toContainText(".NET e2e · WebView2 e2e");
});

test("screenshot save location Change…: when opening the picker fails it says why", async ({ app }) => {
  await app.open();
  app.host.failMethods.add("pickFolder");
  await openSettings(app, "截图批注");
  await setRow(app, "截图保存位置").getByRole("button", { name: "更改…" }).click();
  await expect(toast(app)).toContainText("pickFolder 失败（测试注入）");
});

test("when Show in File Explorer / Open fails, it says the folder doesn't exist yet if that is the case and reports other causes as they are (it used to always say it didn't exist yet)", async ({ app }) => {
  await app.open();
  await openSettings(app, "截图批注");
  // The default screenshot folder hasn't been created because no screenshot was taken yet
  await setRow(app, "截图保存位置").getByRole("button", { name: "打开" }).click();
  await expect(toast(app)).toContainText("截图文件夹尚未创建");
  app.host.failMethods.add("reveal");
  await setRow(app, "截图保存位置").getByRole("button", { name: "打开" }).click();
  await expect(toast(app)).toContainText("reveal 失败（测试注入）");
  await app.page.locator(".settings-tab", { hasText: /^常规$/ }).click();
  await setRow(app, "批注保存位置").getByRole("button", { name: "在资源管理器中显示" }).click();
  await expect(toast(app)).toContainText("reveal 失败（测试注入）");
});

// ---------- Interface size: conversions elsewhere (cssZoom.ts) ----------

test("Interface size 125%: with Fit to Window the whole picture is inside the canvas area; Actual Size is one-to-one screen pixels and doesn't scale with the interface", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  const view = (await app.page.locator(".zoom-view").boundingBox())!;
  await expect.poll(async () => (await media(app)).width).toBeLessThanOrEqual(view.width);
  const m = await media(app);
  expect(m.x).toBeGreaterThanOrEqual(view.x);
  expect(m.y).toBeGreaterThanOrEqual(view.y);
  expect(m.x + m.width).toBeLessThanOrEqual(view.x + view.width + 0.5);
  expect(m.y + m.height).toBeLessThanOrEqual(view.y + view.height + 0.5);
  // Equal margins left and right (or top and bottom): centered
  expect(Math.abs(m.x - view.x - (view.x + view.width - m.x - m.width))).toBeLessThanOrEqual(1);
  await focusStage(app);
  await app.page.keyboard.press("Shift+0");
  await expect.poll(async () => Math.round((await media(app)).width)).toBe(640); // hero.png is 640 wide
});

test("Interface size 125%: the numbers on the canvas scale with the interface (they are part of it); changing it in Settings takes effect immediately and survives a reopen", async ({ app }) => {
  await app.open();
  const badge = app.page.locator(".annot-badge").first();
  await expect(badge).toBeVisible();
  const small = (await badge.boundingBox())!.width;
  await openSettings(app);
  await setRow(app, "界面大小").getByRole("button", { name: "125%" }).click();
  await expect.poll(() => app.page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1.25");
  await expect.poll(() => app.host.prefs?.uiScale).toBe(1.25);
  await expect(setRow(app, "界面大小").locator(".seg.is-on")).toHaveText("125%");
  await app.page.keyboard.press("Escape");
  await expect.poll(async () => Math.round((await badge.boundingBox())!.width)).toBe(Math.round(small * 1.25));
  await app.page.reload();
  await expect(row(app, "project")).toBeVisible();
  expect(await app.page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1.25");
});

test("Interface size 125%: dragging the Library edge, the edge follows the mouse", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  const sash = app.page.locator(".sash-left");
  const b = (await sash.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + 300;
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x + 60, y, { steps: 6 });
  await app.page.mouse.up();
  const after = (await sash.boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - (x + 60))).toBeLessThanOrEqual(2);
});

test("Interface size 125%: marquee selection in the Library, the marquee follows the mouse and selects exactly the rows it sweeps", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  // Start from the name (starting on the arrow at the beginning of a row doesn't start a marquee)
  const a = (await row(app, "hero.png").locator(".lib-name").boundingBox())!;
  const b = (await row(app, "video").locator(".lib-name").boundingBox())!;
  const from = [a.x + 5, a.y + a.height / 2] as const;
  const to = [b.x + 40, b.y + b.height / 2] as const;
  await app.page.mouse.move(...from);
  await app.page.mouse.down();
  await app.page.mouse.move(...to, { steps: 5 });
  const box = (await app.page.locator(".marquee").boundingBox())!;
  expect(Math.abs(box.y - from[1])).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height - to[1])).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x - from[0])).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x + box.width - to[0])).toBeLessThanOrEqual(2);
  await app.page.mouse.up();
  for (const name of ["hero.png", "poster.jpg", "video"]) await expect(row(app, name)).toHaveAttribute("aria-selected", "true");
  for (const name of ["assets", "clip.mp4"]) await expect(row(app, name)).toHaveAttribute("aria-selected", "false");
});

// ---------- The dialog: entry points, switching pages, closing ----------

test("every way of opening Settings lands on General: Ctrl+,, the toolbar gear and File → Settings…; the UI behind it is still there", async ({ app }) => {
  await app.open();
  const opens: [string, () => Promise<void>][] = [
    ["Ctrl+,", () => openSettings(app)],
    ["齿轮", () => app.page.locator(".hdr-right .hdr-btn").first().click()],
    [
      "文件菜单",
      async () => {
        await app.page.locator(".menubar-item", { hasText: /^文件/ }).click();
        await app.page.getByRole("menuitem", { name: /^设置…/ }).click();
      },
    ],
  ];
  for (const [name, open] of opens) {
    await open();
    await expect(onTab(app), name).toHaveText("常规");
    await expect(row(app, "hero.png")).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(settings(app)).toHaveCount(0);
  }
});

test("opening with a target page: the arrow next to Capture in the title bar → Capture Settings…, and Help → Ways to Copy Notes and About", async ({ app }) => {
  await app.open();
  await app.page.locator(".titlebar-more").click();
  await app.page.getByRole("menuitem", { name: /^截图批注设置…/ }).click();
  await expect(onTab(app)).toHaveText("截图批注");
  await app.page.keyboard.press("Escape");
  for (const [item, tab] of [
    ["复制批注的方式", "复制批注"],
    ["关于超级批注", "关于"],
  ]) {
    await app.page.locator(".menubar-item", { hasText: /^帮助/ }).click();
    await app.page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
    await expect(onTab(app)).toHaveText(tab);
    await app.page.keyboard.press("Escape");
    await expect(settings(app)).toHaveCount(0);
  }
});

test("closing: the × in the top-right corner can be clicked (even with the content scrolled to the bottom), Esc closes, and pressing on the overlay closes; pressing inside the dialog and releasing outside doesn't close", async ({ app }) => {
  await app.open();
  await openSettings(app, "高级");
  const close = app.page.locator(".settings-close");
  // No tooltip (no title); the name is for screen readers
  await expect(close).toHaveAttribute("aria-label", "关闭（Esc）");
  await expect(close).not.toHaveAttribute("title");
  // Flush with the dialog's top-right corner (like a window's close button, against the top and right edges)
  const dlg = (await settings(app).boundingBox())!;
  const corner = (await close.boundingBox())!;
  expect(Math.abs(corner.y - dlg.y)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(dlg.x + dlg.width - (corner.x + corner.width))).toBeLessThanOrEqual(0.5);
  // On hover the whole block turns the mark orange (the same color as the marks on the canvas)
  await close.hover();
  const mark = await app.page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--mark)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  await expect.poll(() => close.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(mark);
  await app.page.mouse.move(dlg.x + 300, dlg.y + 300);
  await app.page.locator(".settings-body").evaluate((el) => (el.scrollTop = el.scrollHeight));
  const c = (await close.boundingBox())!;
  const hit = await app.page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest(".settings-close"),
    [c.x + c.width / 2, c.y + c.height / 2],
  );
  expect(hit).toBe(true);
  await close.click();
  await expect(settings(app)).toHaveCount(0);
  // Esc inside the author field closes it too
  await openSettings(app, "高级");
  await setRow(app, "批注署名").locator("input").click();
  await app.page.keyboard.press("Escape");
  await expect(settings(app)).toHaveCount(0);
  // Press inside the dialog and release outside: it doesn't close
  await openSettings(app);
  const d = (await settings(app).boundingBox())!;
  await app.page.mouse.move(d.x + 200, d.y + 20);
  await app.page.mouse.down();
  await app.page.mouse.move(5, 5, { steps: 4 });
  await app.page.mouse.up();
  await expect(settings(app)).toBeVisible();
  // Pressing on the overlay (without waiting for the release) closes it
  await app.page.mouse.move(5, 300);
  await app.page.mouse.down();
  await expect(settings(app)).toHaveCount(0);
  await app.page.mouse.up();
});

test("eight tabs: clicking a tab shows its page and lights the current tab; switching pages doesn't lose text just typed; closing and reopening returns to General; there is no OK button, and the dialog says changes take effect immediately", async ({
  app,
}) => {
  await app.open();
  await openSettings(app);
  const tabs = ["常规", "批注", "截图批注", "复制批注", "系统集成", "快捷键", "高级", "关于"];
  await expect(app.page.locator(".settings-tab")).toHaveText(tabs);
  for (const tab of tabs) {
    await app.page.locator(".settings-tab", { hasText: new RegExp(`^${tab}$`) }).click();
    await expect(onTab(app)).toHaveText(tab);
    await expect(app.page.locator(".settings-body h2")).toHaveText(tab);
  }
  await expect(app.page.locator(".settings-nav-foot")).toHaveText("更改即时生效");
  await expect(settings(app).getByRole("button", { name: /^(确定|保存|取消)$/ })).toHaveCount(0);
  await app.page.locator(".settings-tab", { hasText: /^复制批注$/ }).click();
  await setRow(app, "附加说明").locator("textarea").fill("改完重新导出一版");
  await app.page.locator(".settings-tab", { hasText: /^高级$/ }).click();
  await app.page.locator(".settings-tab", { hasText: /^复制批注$/ }).click();
  await expect(setRow(app, "附加说明").locator("textarea")).toHaveValue("改完重新导出一版");
  await expect.poll(() => app.host.prefs?.promptExtra).toBe("改完重新导出一版");
  await app.page.keyboard.press("Escape");
  await openSettings(app);
  await expect(onTab(app)).toHaveText("常规");
});

// ---------- The General and Annotations pages ----------

test("note author: written into the author of new notes; empty or all-whitespace falls back to the Windows user name; the description states the user name", async ({ app }) => {
  await app.open();
  const authorOf = (body: string) =>
    (app.annotations("assets__hero.png.json") as unknown as { body: string; author: string }[]).find((a) => a.body === body)?.author;
  const note = async (body: string) => {
    await focusStage(app);
    await app.page.keyboard.press("n");
    await app.page.locator(".composer-text").fill(body);
    await app.page.locator(".composer-text").press("Enter");
    await expect.poll(() => authorOf(body)).toBeTruthy();
  };
  await openSettings(app, "高级");
  const input = setRow(app, "批注署名").locator("input");
  await expect(input).toHaveAttribute("placeholder", "tester");
  await expect(setRow(app, "批注署名")).toContainText("留空则使用 Windows 用户名（tester）");
  await input.fill("小王");
  await app.page.keyboard.press("Escape");
  await note("署名是小王");
  expect(authorOf("署名是小王")).toBe("小王");
  await openSettings(app, "高级");
  await input.fill("   ");
  await app.page.keyboard.press("Escape");
  await note("署名留空");
  expect(authorOf("署名留空")).toBe("tester");
  // Existing notes don't change with it
  expect(authorOf("署名是小王")).toBe("小王");
});

test("canvas surround: choosing Solid in Settings removes the blur around the canvas, and switching back to Blurred brings it back", async ({ app }) => {
  await app.open();
  await expect(app.page.locator(".ambient.is-on")).toHaveCount(1);
  await openSettings(app);
  await setRow(app, "画面四周").getByRole("button", { name: "纯色" }).click();
  await expect(app.page.locator(".ambient")).toHaveCount(0);
  await expect.poll(() => app.host.prefs?.backdrop).toBe("plain");
  await setRow(app, "画面四周").getByRole("button", { name: "模糊铺满" }).click();
  await expect(app.page.locator(".ambient.is-on")).toHaveCount(1);
  await expect.poll(() => app.host.prefs?.backdrop).toBeUndefined(); // Back to the default: no longer written to the settings file
});

test("Annotations page: the default category and opening the text box automatically after drawing take effect right after clicking", async ({ app }) => {
  await app.open();
  await openSettings(app, "批注");
  await setRow(app, "默认类别").getByRole("button", { name: "疑问" }).click();
  await setRow(app, "绘制标记后自动打开输入框").getByRole("switch").click();
  await expect.poll(() => app.host.prefs).toMatchObject({ defaultCategory: "question", autoCompose: false });
  await app.page.keyboard.press("Escape");
  await focusStage(app);
  await app.page.keyboard.press("n");
  await expect(app.page.locator(".composer .seg.is-on")).toHaveText("疑问");
  await app.page.keyboard.press("Escape");
  // The note box doesn't open after drawing
  const box = await media(app);
  await focusStage(app);
  await app.page.keyboard.press("r");
  await app.page.mouse.move(...at(box, 0.1, 0.1));
  await app.page.mouse.down();
  await app.page.mouse.move(...at(box, 0.3, 0.3), { steps: 6 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(300);
  await expect(composer(app)).toHaveCount(0);
});

test("Annotations page toggles: loop playback and Ctrl+L are the same setting; pausing, showing resolved notes, line width, color and hold-to-switch tools are all saved to settings", async ({ app }) => {
  await app.open();
  await row(app, "clip.mp4").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await focusStage(app);
  await app.page.keyboard.press("Control+l");
  await expect.poll(() => app.host.prefs?.loop).toBe(true);
  await openSettings(app, "批注");
  const sw = (label: string) => setRow(app, label).getByRole("switch");
  await expect(sw("循环播放视频")).toHaveAttribute("aria-checked", "true");
  await sw("循环播放视频").click();
  await expect.poll(() => app.page.locator("video").evaluate((v: HTMLVideoElement) => v.loop)).toBe(false);
  await sw("选择批注工具时暂停视频").click();
  await sw("在画面上显示已处理的批注").click();
  await setRow(app, "标记线宽").getByRole("button", { name: "粗" }).click();
  await app.page.locator(".swatch").nth(1).click();
  await expect(app.page.locator(".swatch.is-on")).toHaveAttribute("aria-label", "红色");
  await expect.poll(() => app.page.evaluate(() => document.documentElement.style.getPropertyValue("--mark"))).toBe("#ff4d6d");
  await app.page.locator(".settings-tab", { hasText: /^高级$/ }).click();
  await sw("长按切换工具").click();
  await expect
    .poll(() => app.host.prefs)
    .toMatchObject({ pauseOnAnnotate: false, showResolved: false, markWidth: 3, markColor: "#ff4d6d", holdTools: true });
  expect(app.host.prefs?.loop).toBeUndefined();
});

test("General page: tray, start at login, selection after adding a folder, and the notes save location", async ({ app }) => {
  await app.open();
  await openSettings(app);
  await setRow(app, "关闭窗口时保留在托盘").getByRole("switch").click();
  await expect.poll(() => app.host.capture.keepInTray).toBe(false);
  await expect(setRow(app, "关闭窗口时保留在托盘").getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await setRow(app, "登录 Windows 时启动").getByRole("switch").click();
  await expect.poll(() => app.host.capture.autostart).toBe(true);
  await setRow(app, "添加文件夹后选中").getByRole("button", { name: "第一个有待处理批注的素材" }).click();
  await expect.poll(() => app.host.prefs?.initialSelect).toBe("firstOpen");
  const storage = setRow(app, "批注保存位置");
  await expect(storage.locator("code")).toHaveText(join(app.project, ".sniptoss"));
  await storage.getByRole("button", { name: "在资源管理器中显示" }).click();
  await expect.poll(() => app.host.revealed.at(-1)).toBe(join(app.project, ".sniptoss"));
  // The shell errors while changing the tray setting: the reason is shown and the switch doesn't change
  app.host.failMethods.add("setCaptureSettings");
  await setRow(app, "关闭窗口时保留在托盘").getByRole("switch").click();
  await expect(toast(app)).toContainText("setCaptureSettings 失败（测试注入）");
  await expect(setRow(app, "关闭窗口时保留在托盘").getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

test("notes save location: with no item selected it says so and the button is disabled; when the project has no .sniptoss yet it says the folder isn't created yet", async ({ app }) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".sidebar-footer")).toBeVisible();
  await app.page.keyboard.press("Control+,");
  const storage = setRow(app, "批注保存位置");
  await expect(storage).toContainText("未选择素材");
  await expect(storage.getByRole("button", { name: "在资源管理器中显示" })).toBeDisabled();
  await app.page.keyboard.press("Escape");
  // A folder that has never had a note written
  const fresh = join(app.temp, "fresh");
  mkdirSync(fresh);
  copyFileSync(join(app.project, "assets", "hero.png"), join(fresh, "a.png"));
  app.host.entries = [{ path: fresh, pinned: false }];
  await app.page.reload();
  await expect(app.page).toHaveTitle("a.png");
  await openSettings(app);
  await expect(storage.locator("code")).toHaveText(join(fresh, ".sniptoss"));
  await storage.getByRole("button", { name: "在资源管理器中显示" }).click();
  await expect(toast(app)).toContainText("此项目尚无批注，.sniptoss 文件夹尚未创建");
});

test("when the General page can't read the tray and start-at-login settings, those two rows are replaced by an explanation and a retry while the other items work as usual", async ({ app }) => {
  await app.open();
  app.host.failMethods.add("captureSettings");
  await openSettings(app);
  await expect(app.page.locator(".settings-body .error")).toContainText("无法读取此页设置");
  await expect(setRow(app, "关闭窗口时保留在托盘")).toHaveCount(0);
  await expect(setRow(app, "界面大小")).toBeVisible();
  await expect(setRow(app, "批注保存位置")).toBeVisible();
  app.host.failMethods.delete("captureSettings");
  await app.page.locator(".settings-body").getByRole("button", { name: "重试" }).click();
  await expect(setRow(app, "关闭窗口时保留在托盘").getByRole("switch")).toBeVisible();
  await expect(setRow(app, "登录 Windows 时启动").getByRole("switch")).toBeVisible();
});

test("opening Settings with the window at its minimum size and Interface size 125%: the whole dialog is inside the window, the × can be clicked, and the changes-take-effect-immediately line is visible", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.page.setViewportSize({ width: 960, height: 600 }); // Same as MinWidth / MinHeight in MainWindow
  await app.open();
  await openSettings(app, "高级");
  const d = (await settings(app).boundingBox())!;
  expect(d.x).toBeGreaterThanOrEqual(0);
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(d.x + d.width).toBeLessThanOrEqual(960);
  expect(d.y + d.height).toBeLessThanOrEqual(600);
  const c = (await app.page.locator(".settings-close").boundingBox())!;
  const hit = await app.page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest(".settings-close"),
    [c.x + c.width / 2, c.y + c.height / 2],
  );
  expect(hit).toBe(true);
  const foot = (await app.page.locator(".settings-nav-foot").boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(d.y + d.height);
  // The content area scrolls on its own, and scrolled to the bottom the last row is visible
  await app.page.locator(".settings-body").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(setRow(app, "恢复默认设置")).toBeInViewport();
});

// ---------- The Screen Capture page ----------

test("capture shortcut: shows the current keys; an unset shortcut reads Not set; when the shell fails to register it, the description turns into red text", async ({ app }) => {
  app.host.capture.hotkeyError = "Ctrl Alt A 已被其他程序占用，请更换快捷键";
  await app.open();
  await openSettings(app, "截图批注");
  const keyRow = setRow(app, "快捷键");
  await expect(keyRow.locator(".hotkey-input kbd")).toHaveText(["Ctrl", "Alt", "A"]);
  await expect(keyRow.locator(".text-danger")).toHaveText("Ctrl Alt A 已被其他程序占用，请更换快捷键");
  // The title bar button's tooltip doesn't mention a shortcut that failed to register
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".titlebar-action").first()).not.toHaveAttribute("title", /Ctrl Alt A/);
  app.host.capture.hotkey = "";
  app.host.capture.hotkeyError = null;
  await openSettings(app, "截图批注");
  await expect(keyRow.locator(".hotkey-input")).toHaveText("未设置");
  await expect(keyRow).toContainText("全局快捷键，在任何程序中均可使用");
});

test("recording the capture shortcut: the old one is paused while recording and restored afterwards; the title bar tooltip and the menu follow the new one; Esc only cancels recording and Backspace clears it", async ({ app }) => {
  await app.open();
  await openSettings(app, "截图批注");
  const input = app.page.locator(".hotkey-input");
  await input.click();
  await expect(input).toHaveText("请按下组合键");
  await expect.poll(() => app.host.hotkeyPaused).toBe(true);
  await app.page.keyboard.press("Control+Alt+KeyK");
  await expect.poll(() => app.host.capture.hotkey).toBe("Ctrl+Alt+K");
  await expect(input.locator("kbd")).toHaveText(["Ctrl", "Alt", "K"]);
  expect(app.host.hotkeyPaused).toBe(false);
  // Esc while recording: nothing changes and Settings stays open
  await input.click();
  await app.page.keyboard.press("Escape");
  await expect(input.locator("kbd")).toHaveText(["Ctrl", "Alt", "K"]);
  await expect(settings(app)).toBeVisible();
  expect(app.host.hotkeyPaused).toBe(false);
  // Clicking elsewhere cancels in the same way
  await input.click();
  await app.page.locator(".settings-body h2").click();
  await expect(input.locator("kbd")).toHaveText(["Ctrl", "Alt", "K"]);
  await app.page.keyboard.press("Escape");
  await expect(settings(app)).toHaveCount(0);
  await expect(app.page.locator(".titlebar-action").first()).toHaveAttribute("title", /Ctrl Alt K/);
  await app.page.locator(".menubar-item", { hasText: /^文件/ }).click();
  await expect(app.page.getByRole("menuitem", { name: /^截图批注…/ })).toContainText("Ctrl Alt K");
  await app.page.keyboard.press("Escape");
  // Backspace clears it
  await openSettings(app, "截图批注");
  await input.click();
  await app.page.keyboard.press("Backspace");
  await expect.poll(() => app.host.capture.hotkey).toBe("");
  await expect(input).toHaveText("未设置");
});

test("recording a capture shortcut that another program holds: it isn't switched, the description gives the reason, and the previous one stays", async ({ app }) => {
  app.host.hotkeyTaken.add("Ctrl+Alt+K");
  await app.open();
  await openSettings(app, "截图批注");
  const input = app.page.locator(".hotkey-input");
  await input.click();
  await app.page.keyboard.press("Control+Alt+KeyK");
  await expect(setRow(app, "快捷键").locator(".text-danger")).toHaveText("Ctrl Alt K 已被其他程序占用，请更换快捷键");
  await expect(input.locator("kbd")).toHaveText(["Ctrl", "Alt", "A"]);
  expect(app.host.capture.hotkey).toBe("Ctrl+Alt+A");
});

test("Screen Capture page toggles: hide the window first when launched from this window (kept in sync with the title bar arrow menu) and attach notes to the image", async ({ app }) => {
  await app.open();
  await openSettings(app, "截图批注");
  await setRow(app, "从本窗口启动时先隐藏窗口").getByRole("switch").click();
  await expect.poll(() => app.host.capture.hideWindow).toBe(false);
  await setRow(app, "在图片中附加批注").getByRole("switch").click();
  await expect.poll(() => app.host.capture.notesInImage).toBe(false);
  await app.page.keyboard.press("Escape");
  await app.page.locator(".titlebar-more").click();
  await expect(app.page.getByRole("menuitemcheckbox", { name: /截图时隐藏本窗口/ })).toHaveAttribute("aria-checked", "false");
});

test("screenshot save location: the default states that screenshots are kept for 30 days; Change… switches when a folder is picked and not when cancelled; Reset goes back; Open opens it", async ({ app }) => {
  await app.open();
  await openSettings(app, "截图批注");
  const folderRow = setRow(app, "截图保存位置");
  const def = join(app.temp, "captures");
  await expect(folderRow).toContainText(`${def}（默认位置，保留 30 天）`);
  await expect(folderRow.getByRole("button", { name: "恢复默认" })).toHaveCount(0);
  // Cancel
  await folderRow.getByRole("button", { name: "更改…" }).click();
  await expect.poll(() => app.host.calls.filter((c) => c.method === "pickFolder").length).toBe(1);
  expect(app.host.calls.find((c) => c.method === "pickFolder")?.params).toEqual({ title: "选择截图保存位置" });
  expect(app.host.capture.folder).toBe("");
  // Pick one
  const mine = join(app.project, "assets");
  app.host.nextPickFolder = mine;
  await folderRow.getByRole("button", { name: "更改…" }).click();
  await expect.poll(() => app.host.capture.folder).toBe(mine);
  await expect(folderRow.locator("code")).toHaveText(mine);
  await expect(folderRow).not.toContainText("默认位置");
  await folderRow.getByRole("button", { name: "打开" }).click();
  await expect.poll(() => app.host.revealed.at(-1)).toBe(mine);
  await folderRow.getByRole("button", { name: "恢复默认" }).click();
  await expect.poll(() => app.host.capture.folder).toBe("");
  await expect(folderRow.getByRole("button", { name: "恢复默认" })).toHaveCount(0);
});

// ---------- Copying, System, Shortcuts, Advanced, About ----------

test("extra instructions are appended at the end of Copy as Text; all-whitespace text is not appended", async ({ app }) => {
  await app.open();
  await openSettings(app, "复制批注");
  await expect(app.page.locator(".settings-body .set-heading")).toContainText("复制成文字");
  await expect(app.page.locator(".settings-body .set-heading")).toContainText("复制成图片");
  const extra = setRow(app, "附加说明").locator("textarea");
  await expect(extra).toHaveAttribute("placeholder", "留空则不附加");
  await extra.fill("改完重新导出一版");
  await app.page.keyboard.press("Escape");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect.poll(async () => (await app.clipboard())?.trimEnd().endsWith("改完重新导出一版")).toBe(true);
  await openSettings(app, "复制批注");
  await extra.fill("   ");
  await app.page.keyboard.press("Escape");
  await focusStage(app);
  await app.page.keyboard.press("Control+Shift+a");
  await expect.poll(async () => (await app.clipboard())?.includes("改完重新导出一版")).toBe(false);
  expect((await app.clipboard())?.endsWith("   ")).toBe(false);
});

test("System page: the context menu switch reads the shell's state and announces a change; when the shell errors it says why and the switch doesn't move; \"drop onto the desktop icon\" is only a description", async ({ app }) => {
  await app.open();
  await openSettings(app, "系统集成");
  const sw = setRow(app, "资源管理器右键菜单").getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(toast(app)).toContainText("已添加到资源管理器右键菜单");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  app.host.failMethods.add("setShellIntegration");
  await sw.click();
  await expect(toast(app)).toContainText("setShellIntegration 失败（测试注入）");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  const drop = setRow(app, "拖放到桌面图标");
  await expect(drop).toContainText("已支持");
  await expect(drop.getByRole("switch")).toHaveCount(0);
});

test("portable build: the two switches that write to the registry (start at login, context menu) are disabled and explain why", async ({ app }) => {
  app.host.appInfoPatch = { portable: true };
  await app.open();
  await openSettings(app);
  const auto = setRow(app, "登录 Windows 时启动");
  await expect(auto.getByRole("switch")).toBeDisabled();
  await expect(auto).toContainText("绿色版不写入系统注册表，此项不可用。");
  await app.page.locator(".settings-tab", { hasText: /^系统集成$/ }).click();
  const shell = setRow(app, "资源管理器右键菜单");
  await expect(shell.getByRole("switch")).toBeDisabled();
  await expect(shell).toContainText("绿色版不写入系统注册表，此项不可用。");
  await shell.getByRole("switch").click({ force: true });
  expect(app.host.calls.some((c) => c.method === "setShellIntegration" || c.method === "setCaptureSettings")).toBe(false);
  // The tray switch doesn't write to the registry and works as usual
  await app.page.locator(".settings-tab", { hasText: /^常规$/ }).click();
  await expect(setRow(app, "关闭窗口时保留在托盘").getByRole("switch")).toBeEnabled();
});

test("Shortcuts page: shows the same groups as the ones you get by pressing ?", async ({ app }) => {
  await app.open();
  await openSettings(app, "快捷键");
  await expect(app.page.locator(".settings-body .set-heading")).toContainText("也可随时按 ? 查看");
  const inSettings = await app.page.locator(".keys-grid .section-label").allInnerTexts();
  expect(inSettings.length).toBeGreaterThanOrEqual(6);
  await app.page.keyboard.press("Escape");
  await focusStage(app);
  await app.page.keyboard.press("?");
  await expect(app.page.locator(".sheet .section-label")).toHaveText(inSettings);
});

test("Advanced page: the three notes file options are saved to settings; the settings file, app location, log folder and developer tools are all handed to the shell; a failure to show them gives the reason", async ({
  app,
}) => {
  await app.open();
  await openSettings(app, "高级");
  await setRow(app, "REVIEW.md 中包含已处理的批注").getByRole("switch").click();
  await setRow(app, "截图尺寸").getByRole("button", { name: "原图" }).click();
  await setRow(app, "截图格式").getByRole("button", { name: "JPEG" }).click();
  await expect.poll(() => app.host.prefs).toMatchObject({ reviewIncludeResolved: true, snapshotMax: 0, snapshotFormat: "jpeg" });
  await setRow(app, "截图尺寸").getByRole("button", { name: "2048" }).click();
  await expect.poll(() => app.host.prefs?.snapshotMax).toBe(2048);
  await expect(setRow(app, "设置文件")).toContainText(join(app.temp, "settings.json"));
  await expect(setRow(app, "日志文件夹")).toContainText(join(app.temp, "logs"));
  await setRow(app, "设置文件").getByRole("button", { name: "在资源管理器中显示" }).click();
  await setRow(app, "程序位置").getByRole("button", { name: "在资源管理器中显示" }).click();
  await setRow(app, "日志文件夹").getByRole("button", { name: "打开" }).click();
  await expect.poll(() => app.host.revealed.slice(-3)).toEqual(["@settings", "@app", "@logs"]);
  await setRow(app, "开发者工具").getByRole("button", { name: "打开" }).click();
  await expect.poll(() => app.host.calls.some((c) => c.method === "openDevTools")).toBe(true);
  app.host.failMethods.add("reveal");
  await setRow(app, "设置文件").getByRole("button", { name: "在资源管理器中显示" }).click();
  await expect(toast(app)).toContainText("reveal 失败（测试注入）");
});

test("About page: version, author, license, homepage, runtime and issue reporting; a mismatch between the app and UI versions is marked red", async ({ app }) => {
  await app.open();
  await openSettings(app, "关于");
  const body = app.page.locator(".settings-body");
  await expect(body.locator(".set-label").first()).toHaveText(`超级批注 ${VERSION_LABEL}${IS_BETA ? "（测试版）" : ""}`);
  await expect(body).toContainText(`版本 ${VERSION}`);
  await expect(body).toContainText("程序构建于");
  await expect(body.locator(".text-danger")).toHaveCount(0);
  await expect(setRow(app, "作者")).toContainText("MoyGoldenAge");
  await expect(setRow(app, "许可证")).toContainText("MIT 许可证，开源");
  await expect(setRow(app, "运行环境")).toContainText(".NET e2e · WebView2 e2e");
  await setRow(app, "许可证").getByRole("button", { name: "查看" }).click();
  await setRow(app, "主页").getByRole("button", { name: "打开" }).click();
  await expect
    .poll(() => app.host.opened.slice(-2))
    .toEqual(["https://github.com/Moy339339/SnipToss/blob/main/LICENSE", "https://github.com/Moy339339/SnipToss"]);
  await setRow(app, "反馈问题").getByRole("button", { name: "复制诊断信息" }).click();
  await expect(toast(app)).toContainText("已复制诊断信息");
  await expect.poll(() => app.clipboard()).toContain(`SnipToss ${VERSION}`);
  expect(await app.clipboard()).not.toContain(app.temp);
  await setRow(app, "反馈问题").getByRole("button", { name: "报告问题…" }).click();
  await expect.poll(() => app.host.opened.at(-1)).toMatch(/^https:\/\/github\.com\/Moy339339\/SnipToss\/issues\/new\?/);
  // The app and the UI were not installed together
  await app.page.keyboard.press("Escape");
  app.host.appInfoPatch = { version: "1.0.0-beta.1" };
  await app.page.reload();
  await expect(row(app, "project")).toBeVisible();
  await openSettings(app, "关于");
  await expect(body.locator(".text-danger")).toHaveText("程序版本为 Beta 1，与界面不一致，请重新安装");
});

test("About page: third-party notices can be read inside the app and are only loaded when opened; they are listed by component, a click on a row shows the license text; Esc closes only the notices and Settings stays open", async ({ app }) => {
  await app.open();
  await openSettings(app, "关于");
  await expect(setRow(app, "第三方声明")).toContainText("程序中使用的开源组件及其许可证");
  await setRow(app, "第三方声明").getByRole("button", { name: "查看" }).click();
  const sheet = app.page.getByRole("dialog", { name: "第三方声明" });
  // The intro and the header follow the UI language; each component has a row, and the license text starts collapsed
  await expect(sheet.locator(".notices-intro")).toContainText("许可证以英文原文为准");
  await expect(sheet.locator(".notices-head")).toHaveText("组件版本许可证");
  await expect(sheet.locator(".notice-name")).toContainText([
    ".NET Runtime",
    "Microsoft.Web.WebView2",
    "MessageFormat",
    "Noto Sans SC",
    "react",
    "react-intl",
  ]);
  await expect(sheet.locator(".notices-text")).toHaveCount(0);
  await expect(sheet.locator(".sheet-scroll")).toBeFocused();
  expect(app.host.opened).toHaveLength(0); // No browser is opened and nothing is fetched online
  // Clicking a row expands it: the source URL + the English original (marked lang="en"); the browser only opens when the URL is clicked
  const noto = sheet.getByRole("button", { name: /^Noto Sans SC 2\.04 OFL-1\.1$/ });
  await expect(noto).toHaveAttribute("aria-expanded", "false");
  await noto.click();
  await expect(noto).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.locator(".notices-text")).toContainText("SIL OPEN FONT LICENSE");
  await expect(sheet.locator(".notices-text")).toHaveAttribute("lang", "en");
  await expect(sheet.locator(".notice-source")).toContainText("来源github.com/notofonts/noto-cjk");
  expect(app.host.opened).toHaveLength(0);
  await sheet.getByRole("button", { name: "github.com/notofonts/noto-cjk" }).click();
  await expect.poll(() => app.host.opened.at(-1)).toBe("https://github.com/notofonts/noto-cjk");
  // The keyboard can collapse it too
  await noto.focus();
  await app.page.keyboard.press("Enter");
  await expect(noto).toHaveAttribute("aria-expanded", "false");
  await expect(sheet.locator(".notices-text")).toHaveCount(0);
  await app.page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(app.page.locator(".settings-body")).toBeVisible();
});

test("third-party notices follow the UI language: the intro and header use the chosen language while component names and license texts stay as they are (English)", async ({ app }) => {
  app.host.prefs = { language: "de" };
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: /^Info$/ }).click();
  await setRow(app, "Hinweise zu Drittanbietern").getByRole("button", { name: "Anzeigen" }).click();
  const sheet = app.page.getByRole("dialog", { name: "Hinweise zu Drittanbietern" });
  await expect(sheet.locator(".notices-intro")).toContainText("Maßgeblich ist der englische Originaltext");
  await expect(sheet.locator(".notices-head")).toHaveText("KomponenteVersionLizenz");
  await sheet.getByRole("button", { name: /^react 19\.\S+ MIT$/ }).click();
  await expect(sheet.locator(".notice-source")).toContainText("Quelle");
  await expect(sheet.locator(".notices-text")).toContainText("Permission is hereby granted");
});

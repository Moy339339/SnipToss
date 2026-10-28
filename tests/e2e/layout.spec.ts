// The library's width and collapsing:
// dragging the edge, collapsing by dragging to the narrowest, double-clicking the edge, Ctrl+B, Ctrl+\, restoring the default layout,
// how the side panels shrink in a narrow window, no keyboard access once collapsed, the keyboard focus ring, and a library error

import { expect, test, type App } from "./harness";

const sidebar = (app: App) => app.page.locator("aside.sidebar");
const layout = (app: App) => app.page.locator(".layout");
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const width = async (app: App) => Math.round((await sidebar(app).boundingBox())!.width);
/** The widths of the side panels on the next load (localStorage, Panels.tsx) */
const presetPanels = (app: App, left: number, right = 320) =>
  app.page.addInitScript(
    ([l, r]) => localStorage.setItem("sniptoss.panels", JSON.stringify({ left: { width: l, collapsed: false }, right: { width: r, collapsed: false } })),
    [left, right],
  );
const stored = (app: App) => app.page.evaluate(() => JSON.parse(localStorage.getItem("sniptoss.panels") ?? "null"));

test("Once the library and notes panel are collapsed, Tab cannot enter them (focus must not land in an invisible list where Delete would open an invisible removal prompt)", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+b");
  await app.page.keyboard.press("Control+Alt+b");
  await expect(layout(app)).toHaveClass(/left-collapsed/);
  await expect(layout(app)).toHaveClass(/right-collapsed/);
  for (let i = 0; i < 30; i++) {
    await app.page.keyboard.press("Tab");
    expect(await app.page.evaluate(() => !!document.activeElement?.closest("aside.sidebar, aside.panel"))).toBe(false);
  }
  // Expanding them again lets focus in as usual; Ctrl+P goes straight to the filter box
  await app.page.keyboard.press("Control+p");
  await expect(app.page.getByPlaceholder("筛选素材")).toBeFocused();
});

test("A click on the edge without dragging leaves the stored width unchanged (in a narrow window the displayed width is the shrunk one, which must not be stored by a mere click)", async ({ app }) => {
  await presetPanels(app, 520);
  await app.page.setViewportSize({ width: 1000, height: 800 });
  await app.open();
  await expect.poll(() => width(app)).toBeLessThan(520);
  const b = (await app.page.locator(".sash-left").boundingBox())!;
  await app.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.up();
  expect((await stored(app)).left.width).toBe(520);
  await app.page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => width(app)).toBe(520);
});

/** Presses the left edge and drags horizontally by dx (hold: do not release) */
async function dragSash(app: App, dx: number, hold = false) {
  const b = (await app.page.locator(".sash-left").boundingBox())!;
  const x = Math.max(1, b.x + b.width / 2);
  const y = b.y + 300;
  await app.page.mouse.move(x, y);
  await app.page.mouse.down();
  await app.page.mouse.move(x + dx, y, { steps: 6 });
  if (!hold) await app.page.mouse.up();
}

test("Dragging the edge resizes between 180 and 520: the style is changed directly during the drag (not through React), no text gets selected, the width is stored only on release, and it survives a reload", async ({ app }) => {
  await app.open();
  expect(await width(app)).toBe(260);
  await dragSash(app, 100, true);
  await expect(layout(app)).toHaveClass(/is-resizing/);
  expect(await layout(app).evaluate((el) => (el as HTMLElement).style.getPropertyValue("--left-drag"))).toBe("360px");
  expect(await app.page.locator(".lib-name").first().evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
  expect((await stored(app))?.left.width ?? 260).toBe(260); // not released yet
  await app.page.mouse.up();
  await expect(layout(app)).not.toHaveClass(/is-resizing/);
  await expect.poll(() => width(app)).toBe(360);
  await dragSash(app, 2000); // drag far outside the window before releasing
  await expect.poll(() => width(app)).toBe(520);
  await dragSash(app, -60);
  await expect.poll(() => width(app)).toBe(460);
  await app.page.reload();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  expect(await width(app)).toBe(460);
});

test("Dragging past the narrowest width collapses the library and double-clicking the edge restores it: 72 below 180 collapses and is remembered, while collapsed it takes a drag of about 108 to expand; a double-click returns to 260 and expands", async ({ app }) => {
  await app.open();
  await dragSash(app, -160);
  await expect(layout(app)).toHaveClass(/left-collapsed/);
  expect(await stored(app)).toMatchObject({ left: { width: 260, collapsed: true } });
  await dragSash(app, 100);
  await expect(layout(app)).toHaveClass(/left-collapsed/);
  await dragSash(app, 130);
  await expect(layout(app)).not.toHaveClass(/left-collapsed/);
  await expect.poll(() => width(app)).toBe(180);
  await dragSash(app, 200);
  await expect.poll(() => width(app)).toBe(380);
  await app.page.locator(".sash-left").dblclick();
  await expect.poll(() => width(app)).toBe(260);
  await dragSash(app, -200);
  await expect(layout(app)).toHaveClass(/left-collapsed/);
  await app.page.locator(".sash-left").dblclick();
  await expect(layout(app)).not.toHaveClass(/left-collapsed/);
  await expect.poll(() => width(app)).toBe(260);
});

test("Collapsing and expanding the library works with Ctrl+B, the View → Library menu item (with a check mark) and the toolbar button; it is remembered and expanding restores the previous width", async ({ app }) => {
  await presetPanels(app, 300);
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+b");
  await expect(layout(app)).toHaveClass(/left-collapsed/);
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  await expect(app.page.locator(".menu .menu-item", { hasText: "素材栏" }).first()).toHaveAttribute("aria-checked", "false");
  await app.page.keyboard.press("Escape");
  expect((await stored(app)).left.collapsed).toBe(true);
  await app.page.locator('.hdr-btn[title^="显示素材栏"]').click();
  await expect(layout(app)).not.toHaveClass(/left-collapsed/);
  await expect.poll(() => width(app)).toBe(300);
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  await app.page.locator(".menu .menu-item", { hasText: "素材栏" }).first().click();
  await expect(layout(app)).toHaveClass(/left-collapsed/);
});

test("Hide both side panels: Ctrl+\\ collapses both if either is open and expands both only when both are collapsed; the menu label follows", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const both = async () => [await layout(app).evaluate((el) => el.classList.contains("left-collapsed")), await layout(app).evaluate((el) => el.classList.contains("right-collapsed"))];
  await app.page.keyboard.press("Control+\\");
  await expect.poll(both).toEqual([true, true]);
  await app.page.keyboard.press("Control+\\");
  await expect.poll(both).toEqual([false, false]);
  await app.page.keyboard.press("Control+b"); // collapse only the left side
  await app.page.keyboard.press("Control+\\");
  await expect.poll(both).toEqual([true, true]);
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  await expect(app.page.locator(".menu .menu-label", { hasText: "显示两侧面板" })).toBeVisible();
  await app.page.locator(".menu .menu-item", { hasText: "显示两侧面板" }).click();
  await expect.poll(both).toEqual([false, false]);
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  await expect(app.page.locator(".menu .menu-label", { hasText: "隐藏两侧面板" })).toBeVisible();
});

test("Restore Default Layout returns the side panels to 260 / 320 and expands them, and leaves the window size to the shell", async ({ app }) => {
  await presetPanels(app, 400, 500);
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("Control+Alt+b");
  await expect(layout(app)).toHaveClass(/right-collapsed/);
  await app.page.locator(".menubar button", { hasText: "视图" }).click();
  await app.page.locator(".menu .menu-item", { hasText: "恢复默认布局" }).click();
  await expect(layout(app)).not.toHaveClass(/right-collapsed/);
  await expect.poll(() => width(app)).toBe(260);
  expect(Math.round((await app.page.locator("aside.panel").boundingBox())!.width)).toBe(320);
  expect(app.host.calls.some((c) => c.method === "window" && (c.params as { action: string }).action === "resetLayout")).toBe(true);
});

test("In a narrow window the side panels shrink so that the canvas area keeps at least 360, both in proportion; the stored widths stay unchanged and return when the window grows", async ({ app }) => {
  await presetPanels(app, 520, 640);
  await app.page.setViewportSize({ width: 960, height: 700 });
  await app.open();
  await expect.poll(async () => (await app.page.locator(".stage-col").boundingBox())!.width).toBeGreaterThanOrEqual(359);
  expect(await width(app)).toBeGreaterThanOrEqual(180);
  expect((await app.page.locator("aside.panel").boundingBox())!.width).toBeGreaterThanOrEqual(240);
  await app.page.setViewportSize({ width: 1700, height: 900 });
  await expect.poll(() => width(app)).toBe(520);
  expect(Math.round((await app.page.locator("aside.panel").boundingBox())!.width)).toBe(640);
  expect(await stored(app)).toMatchObject({ left: { width: 520 }, right: { width: 640 } });
});

test("Keyboard focus ring: tabbing into the list shows the focus ring on the cursor row; a mouse click does not", async ({ app }) => {
  await app.open();
  const list = app.page.locator(".lib-list");
  await app.page.getByPlaceholder("筛选素材").click();
  await app.page.keyboard.press("Tab"); // the funnel button
  await app.page.keyboard.press("Tab"); // the list
  await expect(list).toBeFocused();
  expect(await list.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  const cursor = app.page.locator(".lib-row.is-cursor");
  await expect(cursor).toHaveCount(1);
  expect(await cursor.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
  // Clicking in with the mouse while focus is elsewhere: no ring (while focus stays in the list the browser does not recompute it,
  // so after entering by keyboard a click would keep it lit)
  await focusStage(app);
  await app.page.locator(".lib-row", { hasText: "video" }).first().click();
  expect(await list.evaluate((el) => el.matches(":focus-visible"))).toBe(false);
});

test("A library error replaces only the library with an error message while the canvas and notes panel work as usual; it is logged, and reloading after the fix brings the library back", async ({ app }) => {
  app.allowLogErrors("UI error (library)");
  app.host.appInfoPatch = { pastedDir: { broken: true } }; // the library uses it as a path, so drawing throws; nothing else reads it
  await app.page.goto("https://app.sniptoss.example/index.html");
  const box = app.page.locator(".error-boundary");
  await expect(box).toContainText("素材栏发生错误");
  await expect(box).toContainText("批注均已保存");
  await expect(app.page.locator("aside.panel")).toBeVisible();
  await expect(app.page).toHaveTitle("hero.png");
  expect(app.host.logs.some((l) => l.message.includes("UI error (library)"))).toBe(true);
  app.host.appInfoPatch = {};
  await box.getByRole("button", { name: "重新载入" }).click();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
});

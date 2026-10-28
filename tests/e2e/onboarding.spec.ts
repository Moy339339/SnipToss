// The onboarding tour and the first-use hints (the tour is kept short; onboarding.ts, Tour.tsx, Hint.tsx).
// Tour: runs automatically in 3 steps the first time an item is shown (drawing tools → notes panel → Screen Capture); Help → Feature Tour shows it again.
// Hints: the first time a note is saved, a hint appears next to the copy button; the first time a video is opened, one appears next to Timestamped comment.
// Each shows once, closes when you press elsewhere, and doesn't block the interface.
// Every other test treats them as seen (onboarded in mock-host); this file switches that back

import { join } from "node:path";
import { expect, test, type App } from "./harness";

const tour = (app: App) => app.page.locator(".tour");
const tourCard = (app: App) => app.page.locator(".tour-card");
const hole = (app: App) => app.page.locator(".tour-hole");
const hint = (app: App, id: string) => app.page.locator(`.hint[data-hint="${id}"]`);
const button = (app: App, name: string) => tourCard(app).getByRole("button", { name, exact: true });
const seen = (app: App) => (app.host.prefs?.onboarding as string[] | undefined) ?? [];

/** The highlight ring surrounds the selector's element (4 px larger on every side, scaling with the interface size) */
async function expectRingAround(app: App, selector: string, pad = 4) {
  await expect
    .poll(async () => {
      const [h, t] = await Promise.all([hole(app).boundingBox(), app.page.locator(selector).first().boundingBox()]);
      if (!h || !t) return "没有";
      const off = [t.x - h.x, t.y - h.y, h.x + h.width - (t.x + t.width), h.y + h.height - (t.y + t.height)];
      return off.every((d) => Math.abs(d - pad) <= 1.5) ? "套住" : `差 ${off.map((d) => d.toFixed(1)).join(" ")}`;
    })
    .toBe("套住");
}

/** The tour card is entirely inside the window */
async function expectCardInWindow(app: App) {
  const c = (await tourCard(app).boundingBox())!;
  const vp = app.page.viewportSize()!;
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.y).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width).toBeLessThanOrEqual(vp.width);
  expect(c.y + c.height).toBeLessThanOrEqual(vp.height);
}

/** Picks the Rectangle tool (R), drags a rectangle on the canvas, writes the note and saves it */
async function drawRect(app: App, body: string, from = 0.3, to = 0.6) {
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = (await app.page.locator(".annot-input").boundingBox())!;
  await app.page.mouse.move(box.x + box.width * from, box.y + box.height * from);
  await app.page.mouse.down();
  await app.page.mouse.move(box.x + box.width * to, box.y + box.height * to, { steps: 5 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill(body);
  await app.page.keyboard.press("Control+Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
}

test.beforeEach(({ app }) => {
  app.host.onboarded = false;
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("no tour with an empty library (the middle of the canvas is the explanation); after the first item is added it runs automatically in 3 steps highlighting the drawing tools, the notes panel and Screen Capture; it is recorded as seen and doesn't reappear after a reopen", async ({
  app,
}) => {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".welcome")).toBeVisible();
  await app.page.waitForTimeout(1200);
  await expect(tour(app)).toHaveCount(0);

  app.host.nextPickFiles = [join(app.project, "assets", "poster.jpg")];
  await app.page.locator(".welcome").getByRole("button", { name: "添加文件", exact: true }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(tourCard(app)).toBeVisible();
  await expect(tourCard(app)).toHaveAttribute("role", "dialog");
  await expect(tourCard(app)).toHaveAttribute("aria-modal", "true");
  // It is recorded as seen as soon as it appears (so quitting midway doesn't bring it back)
  await expect.poll(() => seen(app)).toContain("tour");

  // Step 1: the drawing tools
  await expect(tourCard(app).locator(".tour-count")).toHaveText("1 / 3");
  await expect(tourCard(app).locator(".tour-title")).toHaveText("标注修改位置");
  await expect(tourCard(app)).toContainText("整体意见");
  await expectRingAround(app, ".hdr-tools");
  await expectCardInWindow(app);
  await expect(button(app, "下一步")).toBeFocused();
  await expect(button(app, "上一步")).toHaveCount(0);
  await expect(button(app, "跳过")).toBeVisible();

  // Step 2: the notes panel; Back returns to step 1
  await button(app, "下一步").click();
  await expect(tourCard(app).locator(".tour-count")).toHaveText("2 / 3");
  await expect(tourCard(app).locator(".tour-title")).toHaveText("批注栏");
  await expectRingAround(app, "aside.panel");
  await expectCardInWindow(app);
  await button(app, "上一步").click();
  await expect(tourCard(app).locator(".tour-count")).toHaveText("1 / 3");
  // Back on step 1 the Back button is gone and focus doesn't fall through to what's behind
  await expect(button(app, "下一步")).toBeFocused();

  // → changes step; step 3: Screen Capture, whose text names the shortcut; the last step only has Finish
  await app.page.keyboard.press("ArrowRight");
  await app.page.keyboard.press("ArrowRight");
  await expect(tourCard(app).locator(".tour-count")).toHaveText("3 / 3");
  await expect(tourCard(app).locator(".tour-title")).toHaveText("截图批注");
  await expect(tourCard(app)).toContainText("Ctrl Alt A");
  await expectRingAround(app, ".titlebar-split");
  await expectCardInWindow(app);
  await expect(button(app, "跳过")).toHaveCount(0);
  await button(app, "完成").click();
  await expect(tour(app)).toHaveCount(0);

  // Reopen: it doesn't appear again
  await app.page.reload();
  await expect(app.page).toHaveTitle("poster.jpg");
  await app.page.waitForTimeout(1200);
  await expect(tour(app)).toHaveCount(0);
});

test("while the tour is open, shortcuts and the mouse behind it do nothing and Tab cycles only within the card; Esc closes it. Help → Feature Tour runs it again and Skip closes it", async ({ app }) => {
  await app.open();
  await expect(tourCard(app)).toBeVisible();
  // Shortcuts behind it: R doesn't switch tools
  await app.page.keyboard.press("r");
  await expect(app.page.locator(".annot-layer")).toHaveClass(/tool-select/);
  // Clicking on the dimmed canvas neither draws nor closes the tour
  const stage = (await app.page.locator(".stage").boundingBox())!;
  await app.page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await expect(tourCard(app)).toBeVisible();
  await expect(app.page.locator(".composer")).toHaveCount(0);
  // A full Tab cycle stays inside the card
  await button(app, "下一步").click();
  for (let i = 0; i < 4; i++) {
    await app.page.keyboard.press("Tab");
    expect(await app.page.evaluate(() => !!document.activeElement?.closest(".tour-card"))).toBe(true);
  }
  await app.page.keyboard.press("Escape");
  await expect(tour(app)).toHaveCount(0);
  expect(seen(app)).toContain("tour");
  // Once it is closed the shortcuts work again
  await app.page.keyboard.press("r");
  await expect(app.page.locator(".annot-layer")).toHaveClass(/tool-rect/);

  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "功能导览" }).click();
  await expect(tourCard(app).locator(".tour-count")).toHaveText("1 / 3");
  await button(app, "跳过").click();
  await expect(tour(app)).toHaveCount(0);
});

test("with the notes panel collapsed the tour has only two steps (it doesn't point at what is invisible)", async ({ app }) => {
  app.host.prefs = { onboarding: ["tour"] };
  await app.open();
  await app.page.keyboard.press("Control+Alt+b");
  await expect(app.page.locator("aside.panel")).toHaveAttribute("inert", "");
  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "功能导览" }).click();
  await expect(tourCard(app).locator(".tour-count")).toHaveText("1 / 2");
  await button(app, "下一步").click();
  await expect(tourCard(app).locator(".tour-title")).toHaveText("截图批注");
  await expect(tourCard(app).locator(".tour-count")).toHaveText("2 / 2");
});

test("the first time a note is saved, a hint appears once next to Copy as Text; pressing elsewhere closes it and that press still takes effect; editing a note or saving another doesn't bring it back", async ({ app }) => {
  // The notes panel lists only this item: poster.jpg has no notes yet, so the copy button isn't there (this is how a new project looks the first time)
  app.host.prefs = { onboarding: ["tour"], panelScope: "material" };
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(app.page.locator(".dock-buttons")).toHaveCount(0);

  await drawRect(app, "标题换粗体");
  const h = hint(app, "copy");
  await expect(h).toBeVisible();
  await expect(h).toHaveAttribute("role", "status");
  await expect(h).toContainText("复制成文字");
  await expect(h).toHaveAttribute("data-side", "above");
  // Directly above the copy button, without covering it
  const [hb, db] = [(await h.boundingBox())!, (await app.page.locator(".dock-buttons").boundingBox())!];
  expect(hb.y + hb.height).toBeLessThanOrEqual(db.y);
  expect(seen(app)).toContain("hint.copy");
  // It doesn't take focus or dim the window
  expect(await app.page.evaluate(() => !!document.activeElement?.closest(".hint"))).toBe(false);
  await expect(app.page.locator(".tour")).toHaveCount(0);

  // Clicking Copy as Text directly: the hint closes and the copy works as usual
  await app.page.locator(".dock-copy").click();
  await expect(h).toHaveCount(0);
  await expect.poll(() => app.clipboard()).toContain("标题换粗体");

  await drawRect(app, "背景换浅色", 0.1, 0.2);
  await app.page.waitForTimeout(1000);
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("a hint closes with OK and with Esc; switching items also closes the hint attached to the previous one", async ({ app }) => {
  app.host.prefs = { onboarding: ["tour"] };
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await drawRect(app, "标题换粗体");
  await expect(hint(app, "copy")).toBeVisible();
  await hint(app, "copy").getByRole("button", { name: "知道了" }).click();
  await expect(app.page.locator(".hint")).toHaveCount(0);

  // The video hint: Esc closes it
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(hint(app, "video")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("the first time a video is opened: no hint while the tour is open; once the tour is closed a hint appears once next to Timestamped comment; opening a video again doesn't show it", async ({ app }) => {
  app.host.selected = join(app.project, "video", "clip.mp4");
  await app.open();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(tourCard(app)).toBeVisible();
  await app.page.waitForTimeout(1000);
  await expect(app.page.locator(".hint")).toHaveCount(0);
  await app.page.keyboard.press("Escape");

  const h = hint(app, "video");
  await expect(h).toBeVisible();
  await expect(h).toContainText("时间点意见");
  await expect(h).toHaveAttribute("data-side", "below");
  const [hb, tb] = [(await h.boundingBox())!, (await app.page.locator(".tool-timed").boundingBox())!];
  expect(hb.y).toBeGreaterThanOrEqual(tb.y + tb.height);
  expect(seen(app)).toContain("hint.video");

  // Pressing elsewhere closes it
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(h).toHaveCount(0);
  await app.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await app.page.waitForTimeout(1200);
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("Interface size 125%: the highlight ring still surrounds its target, the card stays inside the window, and the hint sits next to its control", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25 };
  await app.open();
  await expect(tourCard(app)).toBeVisible();
  await expectRingAround(app, ".hdr-tools", 4 * 1.25);
  await expectCardInWindow(app);
  await button(app, "下一步").click();
  await expectRingAround(app, "aside.panel", 4 * 1.25);
  await expectCardInWindow(app);
  await button(app, "下一步").click();
  await expectRingAround(app, ".titlebar-split", 4 * 1.25);
  await expectCardInWindow(app);
  await button(app, "完成").click();

  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await drawRect(app, "标题换粗体");
  const [hb, db] = [(await hint(app, "copy").boundingBox())!, (await app.page.locator(".dock-buttons").boundingBox())!];
  expect(db.y - (hb.y + hb.height)).toBeCloseTo(8 * 1.25, 0);
});

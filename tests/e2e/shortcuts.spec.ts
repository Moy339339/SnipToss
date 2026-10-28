// Shortcuts: the boundaries of how keys are divided up — Enter / Space after an arrow key, typing while a menu was opened with the mouse,
// ↑ ↓ on note cards, ↓ while muted, Backspace in the Library, pinch zoom outside the canvas, and a few entries missing from the shortcut list.
// Always use real key presses (page.keyboard) rather than dispatchEvent in the page: events dispatched directly on window skip capture → target → bubble, so shortcuts that "handle first and stop the event" can't stop them, which produces false failures

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";

const row = (app: App, name: string) =>
  app.page.locator(".lib-row", { has: app.page.locator(".lib-name", { hasText: new RegExp(`^${name.replace(/\./g, "\\.")}$`) }) });
const card = (app: App, id: string) => app.page.locator(`[data-annot$="|${id}"]`);
const focusStage = (app: App) => app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
const video = (app: App) => app.page.locator("video");
const paused = (app: App) => video(app).evaluate((v: HTMLVideoElement) => v.paused);
const volume = (app: App) => video(app).evaluate((v: HTMLVideoElement) => Math.round(v.volume * 100));
const focused = (app: App) => app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.annot ?? document.activeElement?.tagName);
const heroNotes = (app: App) =>
  existsSync(join(app.project, ".sniptoss", "annotations", "assets__hero.png.json")) ? app.annotations("assets__hero.png.json") : [];

async function openVideo(app: App) {
  await row(app, "clip.mp4").click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect.poll(() => video(app).evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await app.page.waitForTimeout(300); // The frame rate is read separately
}

/**
 * Synthesizes one precision-touchpad pinch over CDP (it arrives in the page as Ctrl+wheel). A two-finger touch pinch (gestureSourceType: "touch")
 * doesn't zoom the whole page in headless Edge anyway, so it can't be tested here and is left to manual testing
 */
async function pinch(app: App, at: { x: number; y: number }) {
  const cdp = await app.page.context().newCDPSession(app.page);
  await cdp.send("Input.synthesizePinchGesture", { x: at.x, y: at.y, scaleFactor: 2, gestureSourceType: "mouse" });
  await cdp.detach();
}
const center = async (app: App, selector: string) => {
  const b = (await app.page.locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const pageScale = (app: App) => app.page.evaluate(() => window.visualViewport!.scale);

test.beforeEach(({ app }) => {
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
});

test("after clicking a button with the mouse and then stepping frames / switching items with the arrow keys, Space still plays and Enter doesn't press that button (an arrow key press used to count as having reached it by keyboard)", async ({
  app,
}) => {
  await app.open();
  await openVideo(app);
  // Click the mute button with the mouse, press → to step a frame (focus hasn't moved and is still on the mute button), then press Space: it plays instead of clicking mute again
  await app.page.locator(".transport .icon-btn").nth(2).click();
  await app.page.mouse.move(1, 1);
  await expect.poll(() => app.host.prefs?.muted).toBe(true);
  await app.page.keyboard.press("ArrowRight");
  await app.page.keyboard.press("Space");
  await expect.poll(() => paused(app)).toBe(false);
  expect(app.host.prefs?.muted).toBe(true);
  await app.page.keyboard.press("Space");
  await expect.poll(() => paused(app)).toBe(true);
  // The speed button behaves the same
  await app.page.locator(".transport .text-btn").click();
  await app.page.mouse.move(1, 1);
  await expect(app.page.locator(".transport .text-btn")).toHaveText("1.5×");
  await app.page.keyboard.press("ArrowLeft");
  await app.page.keyboard.press("Space");
  await expect.poll(() => paused(app)).toBe(false);
  await expect(app.page.locator(".transport .text-btn")).toHaveText("1.5×");
  await app.page.keyboard.press("Space");
  // A note card's checkbox: checked with the mouse, → switches items, and Enter afterwards doesn't uncheck it
  await row(app, "hero.png").click();
  const check = card(app, "k3f9a2").locator(".card-check");
  await check.click();
  await app.page.mouse.move(1, 1);
  await expect(check).toHaveAttribute("aria-checked", "true");
  await app.page.keyboard.press("ArrowRight");
  await expect(app.page).not.toHaveTitle("hero.png");
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(200);
  await expect(check).toHaveAttribute("aria-checked", "true");
  // For comparison: on a button reached with Tab, Enter still presses it
  await check.focus();
  await app.page.keyboard.press("Shift+Tab");
  await app.page.keyboard.press("Tab");
  await expect(check).toBeFocused();
  await app.page.keyboard.press("Enter");
  await expect(check).toHaveAttribute("aria-checked", "false");
});

test("with a menu opened by clicking its title while the caret is still in the filter box, typing and Backspace don't go into the filter box; after Esc closes the menu the caret is still there and typing continues", async ({ app }) => {
  await app.open();
  const filter = app.page.getByPlaceholder("筛选素材");
  await filter.click();
  await app.page.keyboard.type("ab");
  await app.page.locator(".menubar-item", { hasText: "视图" }).click();
  await expect(app.page.locator(".menubar-menu")).toBeVisible();
  await expect(filter).toBeFocused(); // Opening a menu with the mouse doesn't steal focus
  await app.page.keyboard.type("xyz");
  await app.page.keyboard.press("Backspace");
  await app.page.keyboard.press("Delete");
  await expect(filter).toHaveValue("ab");
  await expect(app.page.locator(".menubar-menu")).toBeVisible();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  await expect(filter).toBeFocused();
  await app.page.keyboard.type("c");
  await expect(filter).toHaveValue("abc");
});

test("↑ ↓ on note cards move between cards (reaching one selects it), Home / End jump to the first / last, ↑ on the first returns to the search box; the volume isn't changed even with a video open", async ({
  app,
}) => {
  // Keep only the video's two notes in the notes panel: selecting the image's note would switch the canvas away and make "the volume isn't changed" untestable
  const dir = join(app.project, ".sniptoss", "annotations");
  rmSync(join(dir, "assets__hero.png.json"));
  const clip = JSON.parse(readFileSync(join(dir, "video__clip.mp4.json"), "utf8"));
  clip.annotations.push({ ...clip.annotations[0], id: "q1w2e3", body: "开头这里太暗", anchor: { time: { start: 0.5 }, shape: { type: "point", x: 0.2, y: 0.2 } } });
  writeFileSync(join(dir, "video__clip.mp4.json"), JSON.stringify(clip, null, 2) + "\n");
  await app.open();
  await openVideo(app);
  await app.page.keyboard.press("Control+f");
  await expect(app.page.locator(".panel-search input")).toBeFocused();
  await app.page.keyboard.press("ArrowDown");
  const ids = await app.page.locator(".panel-body .card").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.annot));
  expect(ids.length).toBe(2);
  await expect.poll(() => focused(app)).toBe(ids[0]);
  await app.page.keyboard.press("ArrowDown");
  await expect.poll(() => focused(app)).toBe(ids[1]);
  await expect(card(app, ids[1]!.split("|")[1])).toHaveClass(/is-selected/);
  await app.page.keyboard.press("ArrowDown"); // Pressing again on the last card: it stops
  await expect.poll(() => focused(app)).toBe(ids[1]);
  await app.page.keyboard.press("Home");
  await expect.poll(() => focused(app)).toBe(ids[0]);
  await expect(card(app, ids[0]!.split("|")[1])).toHaveClass(/is-selected/);
  await app.page.keyboard.press("End");
  await expect.poll(() => focused(app)).toBe(ids[1]);
  await app.page.keyboard.press("ArrowUp");
  await expect.poll(() => focused(app)).toBe(ids[0]);
  await app.page.keyboard.press("ArrowUp");
  await expect(app.page.locator(".panel-search input")).toBeFocused();
  await expect(app.page).toHaveTitle("clip.mp4");
  expect(await volume(app)).toBe(100);
  expect(app.host.prefs?.volume).toBeUndefined();
});

test("pressing ↓ while muted doesn't change the stored volume and shows a muted notice; ↑ unmutes", async ({ app }) => {
  await app.open();
  await openVideo(app);
  await focusStage(app);
  await app.page.keyboard.press("m");
  await expect.poll(() => app.host.prefs?.muted).toBe(true);
  await app.page.keyboard.press("ArrowDown");
  await app.page.keyboard.press("ArrowDown");
  await expect(app.page.locator(".hud")).toHaveText("已静音");
  expect(await volume(app)).toBe(100);
  expect(app.host.prefs?.volume).toBeUndefined();
  await expect(app.page.locator(".volume-slider")).toHaveValue("0");
  await app.page.keyboard.press("ArrowUp");
  await expect.poll(() => app.host.prefs?.muted ?? false).toBe(false); // Back to the default: not written to the settings file
  await expect(app.page.locator(".hud")).toHaveText("音量 100%");
});

test("Backspace with focus in the Library does nothing and doesn't delete the note selected on the canvas (Delete is what removes from the library)", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await card(app, "k3f9a2").click();
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);
  await row(app, "hero.png").click(); // Focus goes into the list while the note on the canvas stays selected
  await expect(card(app, "k3f9a2")).toHaveClass(/is-selected/);
  await app.page.keyboard.press("Backspace");
  await app.page.waitForTimeout(300);
  await expect(app.page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row(app, "hero.png")).toBeVisible();
  expect(heroNotes(app).map((a) => a.id)).toContain("k3f9a2");
  // For comparison: with focus outside the list, Backspace still deletes this note
  await card(app, "k3f9a2").click();
  await app.page.keyboard.press("Backspace");
  await expect(app.page.getByRole("alertdialog")).toContainText("删除");
  await app.page.keyboard.press("Escape");
});

test("touchpad pinch (which arrives in the page as Ctrl+wheel) zooms the canvas, and on the Library and the notes panel it doesn't zoom the whole interface", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await expect(app.page.locator(".zoom-label")).toContainText("适合");
  // The first pinch used to zoom the whole page to 2x, and the second one's coordinates fell outside the visible area (CDP reported Position out of bounds)
  await pinch(app, await center(app, ".lib-list"));
  await pinch(app, await center(app, ".panel-body"));
  await app.page.waitForTimeout(200);
  expect(await pageScale(app)).toBe(1);
  await pinch(app, await center(app, ".zoom-view"));
  await expect(app.page.locator(".zoom-label")).not.toContainText("适合");
  expect(await pageScale(app)).toBe(1);
});

test("Keyboard Shortcuts: Ctrl+V is in the Global group (works everywhere); it lists Ctrl+Enter to save and Home / End and Space in menus", async ({ app }) => {
  await app.open();
  await focusStage(app);
  await app.page.keyboard.press("?");
  const groups = app.page.locator(".sheet-grid section");
  await expect(groups.first()).toContainText("从剪贴板添加");
  await expect(groups.nth(2)).not.toContainText("从剪贴板添加");
  await expect(app.page.locator(".shortcut-row", { hasText: "保存正在填写的批注" })).toContainText("Ctrl Enter");
  await expect(app.page.locator(".shortcut-row", { hasText: "打开菜单" })).toContainText("Home");
  await expect(app.page.locator(".shortcut-row", { hasText: "打开菜单" })).toContainText("空格");
});

test("the note box on a video: with focus outside the text box, a lone I / O sets the start / end, and inside the text box Alt+I / Alt+O do; a start later than the end clears the end, an end earlier than the start swaps them, and not moving the video shows a hint", async ({
  app,
}) => {
  await app.open();
  await openVideo(app);
  const seek = (to: number) =>
    video(app).evaluate(
      (v: HTMLVideoElement, t) =>
        new Promise<void>((done) => {
          v.addEventListener("seeked", () => done(), { once: true });
          v.currentTime = t;
        }),
      to,
    );
  const chips = app.page.locator(".composer .time-chip");
  await seek(1);
  await focusStage(app);
  await app.page.keyboard.press("n"); // An overall comment on a video defaults to the whole video, with no time
  await expect(app.page.locator(".composer")).toContainText("整段视频");
  await expect(chips).toHaveCount(0);
  // Click a category with the mouse: focus leaves the text box, so a lone I / O isn't typing
  await app.page.locator(".composer .seg").first().click();
  await app.page.keyboard.press("i");
  await expect(chips).toHaveText(["00:01.000"]);
  await seek(2);
  await app.page.keyboard.press("o");
  await expect(chips).toHaveText(["00:01.000", "00:02.000"]);
  await seek(2.5);
  await app.page.keyboard.press("i"); // Start later than the end: the end is cleared
  await expect(chips).toHaveText(["00:02.500"]);
  await seek(1.5);
  await app.page.keyboard.press("o"); // End earlier than the start: the two are swapped
  await expect(chips).toHaveText(["00:01.500", "00:02.500"]);
  await app.page.keyboard.press("o"); // The video is still at the start time
  await expect(app.page.locator(".composer-hint-line")).toContainText("请先将视频定位到时间段的结束位置");
  await expect(chips).toHaveText(["00:01.500", "00:02.500"]);
  // In the text box: single keys are typing, and Alt+I / Alt+O set the time
  const text = app.page.locator(".composer-text");
  await text.click();
  await app.page.keyboard.type("io");
  await expect(text).toHaveValue("io");
  await expect(chips).toHaveText(["00:01.500", "00:02.500"]);
  await seek(0.5);
  await app.page.keyboard.press("Alt+i");
  await seek(2.75);
  await app.page.keyboard.press("Alt+o");
  await expect(chips).toHaveText(["00:00.500", "00:02.750"]);
  await expect(text).toHaveValue("io");
  await expect(text).toBeFocused();
});

test("with a menu open, ← → switch to the neighboring menu (wrapping at both ends) and Alt+letter switches directly, staying open if it is the same menu; focus always lands on the first item", async ({ app }) => {
  await app.open();
  await focusStage(app);
  const open = app.page.locator(".menubar-item.is-open");
  /** Focus is on the first enabled item of the menu */
  const inMenu = () =>
    app.page.evaluate(() => !!document.activeElement && document.activeElement === document.querySelector(".menubar-menu .menu-item:not(:disabled)"));
  await app.page.keyboard.press("Alt+f");
  await expect(open).toHaveText(/文件/);
  await app.page.keyboard.press("ArrowRight");
  await expect(open).toHaveText(/编辑/);
  await expect.poll(inMenu).toBe(true);
  await app.page.keyboard.press("ArrowLeft");
  await app.page.keyboard.press("ArrowLeft");
  await expect(open).toHaveText(/帮助/);
  await expect.poll(inMenu).toBe(true);
  await app.page.keyboard.press("ArrowRight");
  await expect(open).toHaveText(/文件/);
  await app.page.keyboard.press("Alt+v");
  await expect(open).toHaveText(/视图/);
  await expect.poll(inMenu).toBe(true);
  await app.page.keyboard.press("Alt+v");
  await expect(open).toHaveText(/视图/);
  await expect(app.page.locator(".menubar-menu")).toHaveCount(1);
  await app.page.keyboard.press("Alt+h");
  await expect(open).toHaveText(/帮助/);
  await expect(app.page.locator(".menubar-menu")).toContainText("关于超级批注");
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".menubar-menu")).toHaveCount(0);
  // A menu opened with the mouse, with the pointer still resting on its title: switching works all the same. It used to switch back immediately to the one under the pointer (the browser re-sent an "enter" for the stationary mouse)
  await app.page.locator(".menubar-item", { hasText: "视图" }).click();
  await app.page.keyboard.press("ArrowRight");
  await expect(open).toHaveText(/批注/);
  await app.page.waitForTimeout(150);
  await expect(open).toHaveText(/批注/);
  await app.page.keyboard.press("Alt+w");
  await expect(open).toHaveText(/窗口/);
  await app.page.waitForTimeout(150);
  await expect(open).toHaveText(/窗口/);
  await expect.poll(inMenu).toBe(true);
  // Only a real mouse move makes it follow; pressing a menu's own Alt+letter while the mouse hovers over it keeps it open and puts focus on the first item
  await app.page.locator(".menubar-item", { hasText: "编辑" }).hover();
  await expect(open).toHaveText(/编辑/);
  await app.page.keyboard.press("Alt+e");
  await expect(open).toHaveText(/编辑/);
  await expect(app.page.locator(".menubar-menu")).toHaveCount(1);
  await expect.poll(inMenu).toBe(true);
});

test("Ctrl+Z undoes and Ctrl+Shift+Z / Ctrl+Y redo: the mark-as-done step goes back and forth", async ({ app }) => {
  await app.open();
  await row(app, "hero.png").click();
  await card(app, "k3f9a2").click();
  const status = () => heroNotes(app).find((a) => a.id === "k3f9a2")?.status;
  await app.page.keyboard.press("d");
  await expect.poll(status).toBe("resolved");
  await app.page.keyboard.press("Control+z");
  await expect.poll(status).toBe("open");
  await app.page.keyboard.press("Control+Shift+z");
  await expect.poll(status).toBe("resolved");
  await app.page.keyboard.press("Control+z");
  await expect.poll(status).toBe("open");
  await app.page.keyboard.press("Control+y");
  await expect.poll(status).toBe("resolved");
});

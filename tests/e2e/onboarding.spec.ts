// The first launch, the guide and the first-use hints (onboarding.ts, FirstRun.tsx, Guide.tsx, Hint.tsx).
// First launch (an empty library): one dialog; Start Tutorial adds the sample picture (addSample) and the guide walks through it: pick the
// rectangle → box the place → write → the toolbar labeled → copy → done; the sample leaves the list at the end. Each step is done by doing
// (or by Next, which does it), and only what the step is done on takes presses. Without the tutorial the guide still starts on the first
// item shown unless the first-run dialog was skipped; Tutorial (welcome page, Help) runs it again on the sample; beginner mode off keeps all of it from coming by itself.
// Hints: shown once next to their control the first time a feature is used (a note saved, a video opened, the Pin tool picked, the first mark
// drawn, a drawing kept, after the guide next to Capture); a press elsewhere closes them and still takes effect; they never block the interface.
// Every other test treats all of it as seen (onboarded in mock-host); this file switches that back

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type App } from "./harness";
import { ONBOARDED } from "./mock-host";

const guide = (app: App) => app.page.locator(".guide");
const firstRun = (app: App) => app.page.locator(".firstrun");
const hint = (app: App, id: string) => app.page.locator(`.hint[data-hint="${id}"]`);
const button = (app: App, name: string) => guide(app).getByRole("button", { name, exact: true });
const seen = (app: App) => (app.host.prefs?.onboarding as string[] | undefined) ?? [];
/** Everything of the onboarding counts as seen but these */
const seenAllBut = (...keys: string[]) => ONBOARDED.filter((k) => !keys.includes(k));
const RECT = '.hdr-tools .tool-btn[data-tool="rect"]';
const calls = (app: App, method: string) => app.host.calls.filter((c) => c.method === method);

/** The guide is on this step, with its card on screen */
async function onStep(app: App, step: string, title: string, count?: string) {
  await expect(guide(app)).toHaveAttribute("data-step", step);
  await expect(guide(app)).toBeVisible();
  await expect(guide(app).locator(".guide-title")).toHaveText(title);
  if (count) await expect(guide(app).locator(".guide-count")).toHaveText(count);
  else await expect(guide(app).locator(".guide-count")).toHaveCount(0);
}

/** The ring around what the step is done on surrounds the selector's element (4 px larger on every side, scaling with the interface size) */
async function expectRingAround(app: App, selector: string, pad = 4) {
  await expect
    .poll(async () => {
      const [h, t] = await Promise.all([app.page.locator(".guide-ring").boundingBox(), app.page.locator(selector).first().boundingBox()]);
      if (!h || !t) return "没有";
      const off = [t.x - h.x, t.y - h.y, h.x + h.width - (t.x + t.width), h.y + h.height - (t.y + t.height)];
      return off.every((d) => Math.abs(d - pad) <= 1.5) ? "套住" : `差 ${off.map((d) => d.toFixed(1)).join(" ")}`;
    })
    .toBe("套住");
}

/** The guide's card is entirely inside the window */
async function expectCardInWindow(app: App) {
  const c = (await guide(app).boundingBox())!;
  const vp = app.page.viewportSize()!;
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.y).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width).toBeLessThanOrEqual(vp.width);
  expect(c.y + c.height).toBeLessThanOrEqual(vp.height);
}

/** A press in the middle of the element lands on something else (the guide's shades take it) */
const covered = (app: App, selector: string) =>
  app.page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });

/** The notes written on the sample picture (the shell's own Sample folder) */
function sampleNotes(app: App): { body: string; anchor: { shapes?: { type: string; x: number; y: number; w: number; h: number }[] } }[] {
  const dir = join(app.host.sampleDir, ".sniptoss", "annotations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .flatMap((n) => JSON.parse(readFileSync(join(dir, n), "utf8")).annotations);
}

/** The very first launch: nothing in the library; waits for the first-run dialog */
async function firstLaunch(app: App) {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(firstRun(app)).toBeVisible();
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

// ---------- The first launch and the tutorial on the sample ----------

test("the first launch with an empty library shows one dialog (recorded as seen at once, focus on Start Tutorial, Tab stays inside, the title bar stays usable); Start Tutorial adds the sample picture and the guide walks through it, each step done by hand; the end card takes the sample off the list and Capture's hint follows; nothing of it comes back after a reopen", async ({
  app,
}) => {
  await firstLaunch(app);
  const dialog = firstRun(app);
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toContainText("标出要改的地方，交给 AI 改");
  await expect(dialog).toContainText("用一张示例图跟着做一遍，约 1 分钟。");
  const start = dialog.getByRole("button", { name: "开始教程" });
  await expect(start).toBeFocused();
  // Recorded as soon as it appears (quitting midway doesn't bring it back)
  await expect.poll(() => seen(app)).toContain("welcome");
  for (let i = 0; i < 3; i++) {
    await app.page.keyboard.press("Tab");
    expect(await app.page.evaluate(() => !!document.activeElement?.closest(".firstrun"))).toBe(true);
  }
  // The title bar is not covered (the window can be moved, minimized, closed), but its menus and Capture are off meanwhile
  const close = (await app.page.locator(".win-btns .win-btn").last().boundingBox())!;
  expect(await app.page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".win-btns"), [close.x + close.width / 2, close.y + close.height / 2])).toBe(
    true,
  );
  await app.page.locator(".menubar-item", { hasText: "文件" }).click({ force: true });
  await expect(app.page.locator(".menu")).toHaveCount(0);
  // A press on the backdrop does not close it
  await app.page.mouse.click(120, 400);
  await expect(dialog).toBeVisible();
  expect(calls(app, "addSample")).toHaveLength(0);

  await start.click();
  await expect(dialog).toHaveCount(0);
  await expect(app.page).toHaveTitle("landing-page.jpg");
  expect(calls(app, "addSample")).toHaveLength(1);
  await expect.poll(() => seen(app)).toContain("tour");

  // 1: pick the Rectangle tool. Only that button is lit and takes presses: the other tools and the library are covered; the card says nothing but its title
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await expectRingAround(app, RECT);
  await expectCardInWindow(app);
  await expect(guide(app)).toHaveAttribute("data-side", "below");
  await expect(guide(app).locator(".guide-body")).toHaveCount(0);
  expect(await covered(app, RECT)).toBe(false);
  expect(await covered(app, '.hdr-tools .tool-btn[data-tool="pen"]')).toBe(true);
  expect(await covered(app, ".lib-row")).toBe(true);
  await expect(app.page.locator(".guide-drag")).toBeHidden();
  await app.page.locator(RECT).click();

  // 2: box what to change: on the sample a dashed box shows where (its headline), and the card sits beside it
  await onStep(app, "mark", "圈出要改的地方", "2 / 4");
  const drag = app.page.locator(".guide-drag");
  await expect(drag).toBeVisible();
  await expectCardInWindow(app);
  await expect(guide(app)).toHaveAttribute("data-side", /./);
  const d = (await drag.boundingBox())!;
  await app.page.mouse.move(d.x + 2, d.y + 2);
  await app.page.mouse.down();
  await app.page.mouse.move(d.x + d.width - 2, d.y + d.height - 2, { steps: 5 });
  await app.page.mouse.up();

  // 3: write the note: the note box is what is lit
  await onStep(app, "write", "写下修改要求", "3 / 4");
  await expectRingAround(app, ".composer");
  await expectCardInWindow(app);
  await app.page.locator(".composer-text").fill("标题换成粗体");
  await app.page.keyboard.press("Enter");

  // The toolbar: every tool and Overall Comment labeled at once (what it does, on a line from its button); it only explains, so the
  // toolbar takes no presses and Next is the one thing to press
  await onStep(app, "tools", "认识工具栏");
  const labels = app.page.locator(".guide-callout");
  await expect(labels).toHaveCount(7);
  await expect(labels.first()).toHaveText("选择选中、移动标记");
  await expect(labels.last()).toHaveText("整体意见不指定位置");
  expect(await covered(app, RECT)).toBe(true);
  await expect(button(app, "跳过")).toHaveCount(0);
  await expect.poll(() => sampleNotes(app).map((n) => n.body)).toEqual(["标题换成粗体"]);
  await button(app, "下一步").click();

  // 4: copy for the AI: both copy buttons are lit, and one sentence says which suits which AI
  await onStep(app, "copy", "复制，交给 AI", "4 / 4");
  await expect(guide(app).locator(".guide-body")).toHaveText("用「复制成文字」粘贴给 Claude Code 或 Codex；网页版 AI 和聊天软件用「复制成图片」。");
  await expectRingAround(app, ".panel-dock .dock-buttons");
  await expectCardInWindow(app);
  await app.page.locator(".dock-copy").click();
  await expect.poll(() => app.clipboard()).toContain("标题换成粗体");

  // The end, in the middle of the window: one button, which starts the real work
  await onStep(app, "done", "恭喜完成教程");
  await expect(guide(app).getByRole("button")).toHaveText(["开始使用"]);
  // (It slides there from the copy buttons)
  await expect
    .poll(async () => {
      const card = (await guide(app).boundingBox())!;
      return Math.abs(card.x + card.width / 2 - app.page.viewportSize()!.width / 2);
    })
    .toBeLessThan(2);
  await expect(guide(app)).not.toHaveAttribute("data-side", /./);
  await button(app, "开始使用").click();
  await expect(guide(app)).toHaveCount(0);
  // The sample has done its job: it leaves the list, and the welcome page is back
  await expect(app.page.locator(".welcome")).toBeVisible();
  await expect(app.page.locator(".lib-row")).toHaveCount(0);
  expect(app.host.entries).toHaveLength(0);
  // Then, once, next to Capture: the screen can be annotated too (with its shortcut)
  const captureHint = hint(app, "capture");
  await expect(captureHint).toBeVisible();
  await expect(captureHint).toHaveAttribute("data-side", "below");
  await expect(captureHint).toContainText(/按 Ctrl\sAlt\sA 截图/);
  expect(seen(app)).toContain("hint.capture");
  // The tutorial showed where Copy is: the hint that says the same is not needed afterwards
  expect(seen(app)).toContain("hint.copy");
  await captureHint.getByRole("button", { name: "知道了" }).click();
  await expect(captureHint).toHaveCount(0);

  // Reopen: neither the dialog nor the guide nor the hint comes again
  await app.page.reload();
  await expect(app.page.locator(".welcome")).toBeVisible();
  await app.page.waitForTimeout(1200);
  await expect(firstRun(app)).toHaveCount(0);
  await expect(guide(app)).toHaveCount(0);
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("Next does each step for the user: the rectangle picked, the sample's headline boxed, a sample note saved, copied as text; Skip on the sample takes it off the list too; Tutorial on the welcome page runs it again on a clean sample, though it was seen", async ({
  app,
}) => {
  await firstLaunch(app);
  await firstRun(app).getByRole("button", { name: "开始教程" }).click();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await button(app, "下一步").click();
  await onStep(app, "mark", "圈出要改的地方", "2 / 4");
  await expect(app.page.locator(".annot-layer")).toHaveClass(/tool-rect/);
  await button(app, "下一步").click();
  await onStep(app, "write", "写下修改要求", "3 / 4");
  await expect(app.page.locator(".composer")).toBeVisible();
  await button(app, "下一步").click();
  await onStep(app, "tools", "认识工具栏");
  // The note is the sample sentence, boxed where the dashed box was (the headline)
  await expect.poll(() => sampleNotes(app).map((n) => n.body)).toEqual(["标题字体加粗"]);
  const shape = sampleNotes(app)[0].anchor.shapes![0];
  expect(shape.type).toBe("rect");
  for (const [k, v] of Object.entries({ x: 0.06, y: 0.24, w: 0.48, h: 0.2 })) expect(shape[k as "x"]).toBeCloseTo(v, 2);
  await button(app, "下一步").click();
  await onStep(app, "copy", "复制，交给 AI", "4 / 4");
  await button(app, "下一步").click();
  await onStep(app, "done", "恭喜完成教程");
  await expect.poll(() => app.clipboard()).toContain("标题字体加粗");
  await button(app, "开始使用").click();
  await expect(app.page.locator(".welcome")).toBeVisible();

  // Tutorial on the welcome page: the sample comes back without last time's note, and the guide starts though it was seen, from its first
  // step (the Rectangle tool was still the one in use after the last run; it goes back to Select); Skip takes the sample off again
  await app.page.locator(".welcome").getByRole("button", { name: "新手教程" }).click();
  await expect(app.page).toHaveTitle("landing-page.jpg");
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await expect(app.page.locator(".annot-layer")).not.toHaveClass(/tool-rect/);
  expect(calls(app, "addSample")).toHaveLength(2);
  expect(sampleNotes(app)).toEqual([]);
  await expect(app.page.locator(".card-body")).toHaveCount(0);
  await button(app, "跳过").click();
  await expect(guide(app)).toHaveCount(0);
  await expect(app.page.locator(".welcome")).toBeVisible();
  expect(app.host.entries).toHaveLength(0);
});

test("Skip on the first-run dialog (or Esc) adds nothing and counts as having seen the guide: it doesn't start by itself on the first item added (where Next would write sample notes into the user's project); Help → Tutorial runs it on the sample, which leaves the list again", async ({
  app,
}) => {
  await firstLaunch(app);
  await app.page.keyboard.press("Escape");
  await expect(firstRun(app)).toHaveCount(0);
  await expect(app.page.locator(".welcome")).toBeVisible();
  expect(calls(app, "addSample")).toHaveLength(0);
  await expect.poll(() => seen(app)).toEqual(expect.arrayContaining(["welcome", "tour"]));

  app.host.nextPickFiles = [join(app.project, "assets", "poster.jpg")];
  await app.page.locator(".welcome").getByRole("button", { name: "添加文件", exact: true }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await app.page.waitForTimeout(1500);
  await expect(guide(app)).toHaveCount(0);

  // Help → Tutorial: on the sample picture, not on poster.jpg
  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "新手教程" }).click();
  await expect.poll(() => calls(app, "addSample").length).toBe(1);
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await expect(app.page).toHaveTitle("landing-page.jpg");
  await button(app, "跳过").click();
  await expect(guide(app)).toHaveCount(0);
  // The sample leaves the list; the user's own item stays, without any note written on it
  await expect.poll(() => app.host.entries.length).toBe(1);
  await expect(app.page.locator(".lib-row", { hasText: "poster.jpg" })).toBeVisible();
  await expect(app.page.locator(".lib-row", { hasText: "landing-page.jpg" })).toHaveCount(0);
  expect(app.annotations("assets__poster.jpg.json")).toHaveLength(0);
  // Again: from the first step
  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "新手教程" }).click();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await button(app, "跳过").click();
  await expect(guide(app)).toHaveCount(0);
});

test("while the guide is on, presses outside what the step is done on do nothing (the library, the canvas, the title bar's menus and Capture) and hover tooltips are off; the keyboard is left alone, so R picks the rectangle and moves it on", async ({
  app,
}) => {
  app.host.prefs = { onboarding: seenAllBut("tour") };
  await app.open();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  const title = await app.page.title();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click({ force: true });
  await expect(app.page).toHaveTitle(title);
  // A drag on the dimmed picture (with the Select tool it would draw a box) draws nothing
  const media = await app.media();
  await app.page.mouse.move(media.x + media.width * 0.3, media.y + media.height * 0.3);
  await app.page.mouse.down();
  await app.page.mouse.move(media.x + media.width * 0.6, media.y + media.height * 0.6, { steps: 5 });
  await app.page.mouse.up();
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect(guide(app)).toHaveAttribute("data-step", "tool");
  await app.page.locator(".menubar-item", { hasText: "文件" }).click({ force: true });
  await expect(app.page.locator(".menu")).toHaveCount(0);
  await app.page.locator(".titlebar-action").first().click({ force: true });
  await app.page.waitForTimeout(300);
  expect(calls(app, "captureStart")).toHaveLength(0);
  // Tooltips: the lit button's would cover the card
  await app.page.locator(RECT).hover();
  await app.page.waitForTimeout(800);
  await expect(app.page.locator(".tooltip.is-on")).toBeHidden();
  // The keyboard
  await app.page.keyboard.press("r");
  await onStep(app, "mark", "圈出要改的地方", "2 / 4");
  await button(app, "跳过").click();
  await expect(guide(app)).toHaveCount(0);
  // Afterwards everything takes presses again
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
});

test("while the guide is on, a right-click on the dimmed part opens no context menu (it takes no presses, the right button included)", async ({ app }) => {
  app.host.prefs = { onboarding: seenAllBut("tour") };
  await app.open();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  for (const where of [".lib-row", ".stage"]) {
    const b = (await app.page.locator(where).last().boundingBox())!;
    await app.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
    await app.page.waitForTimeout(300);
    await expect(app.page.locator(".menu"), `right-click on the dimmed ${where}`).toHaveCount(0);
  }
  await expect(guide(app)).toHaveAttribute("data-step", "tool");
});

test("with the notes panel collapsed the copy step lights nothing (it doesn't point at what is invisible): nothing is dimmed and the card waits in the corner of the canvas", async ({ app }) => {
  app.host.prefs = { onboarding: seenAllBut() };
  await app.open();
  await app.page.keyboard.press("Control+Alt+b");
  await expect(app.page.locator("aside.panel")).toHaveAttribute("inert", "");
  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "新手教程" }).click();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  for (let i = 0; i < 4; i++) await guide(app).locator(".guide-actions button").last().click();
  await onStep(app, "copy", "复制，交给 AI", "4 / 4");
  await expect(app.page.locator(".guide-ring")).toBeHidden();
  for (const shade of await app.page.locator(".guide-shade").all()) await expect(shade).toBeHidden();
  await expect(guide(app)).not.toHaveAttribute("data-side", /./);
  // Next still copies
  await button(app, "下一步").click();
  await onStep(app, "done", "恭喜完成教程");
  await expect.poll(() => app.clipboard()).toContain("标题字体加粗");
});

test("with beginner mode off the first-run dialog, the guide and the hints don't come by themselves (and nothing is recorded as seen); Tutorial on the welcome page and in Help still start the guide", async ({ app }) => {
  app.host.entries = [];
  app.host.prefs = { beginner: false };
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".welcome")).toBeVisible();
  await app.page.waitForTimeout(1200);
  await expect(firstRun(app)).toHaveCount(0);
  expect(seen(app)).not.toContain("welcome");

  // Asked for: the tutorial runs on the sample
  await app.page.locator(".welcome").getByRole("button", { name: "新手教程" }).click();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await button(app, "跳过").click();
  await expect(app.page.locator(".welcome")).toBeVisible();
  // No Capture hint after it, and nothing when a video is opened
  app.host.nextPickFiles = [join(app.project, "video", "clip.mp4")];
  await app.page.locator(".welcome").getByRole("button", { name: "添加文件", exact: true }).click();
  await expect(app.page).toHaveTitle("clip.mp4");
  await app.page.waitForTimeout(1500);
  await expect(guide(app)).toHaveCount(0);
  await expect(app.page.locator(".hint")).toHaveCount(0);
  expect(seen(app)).not.toContain("hint.video");
  expect(seen(app)).not.toContain("hint.capture");

  await app.page.locator(".menubar-item", { hasText: "帮助" }).click();
  await app.page.getByRole("menuitem", { name: "新手教程" }).click();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
});

test("a shell that can't add the sample picture (no sampleDir in appInfo) offers no first-run dialog and no Tutorial button; the guide still starts on the first item added", async ({ app }) => {
  app.host.entries = [];
  app.host.appInfoPatch = { sampleDir: undefined };
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".welcome")).toBeVisible();
  await expect(app.page.locator(".welcome-actions button")).toHaveText(["添加文件", "添加文件夹"]);
  await app.page.waitForTimeout(1000);
  await expect(firstRun(app)).toHaveCount(0);
  app.host.nextPickFiles = [join(app.project, "assets", "poster.jpg")];
  await app.page.locator(".welcome").getByRole("button", { name: "添加文件", exact: true }).click();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
});

// ---------- Hints ----------

test("the first time a note is saved, a hint appears once next to Copy as Text; pressing elsewhere closes it and that press still takes effect; editing a note or saving another doesn't bring it back", async ({ app }) => {
  // The notes panel lists only this item: poster.jpg has no notes yet, so the copy button isn't there (this is how a new project looks the first time)
  app.host.prefs = { onboarding: seenAllBut("hint.copy"), panelScope: "material" };
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await expect(app.page.locator(".dock-buttons")).toHaveCount(0);

  await drawRect(app, "标题换粗体");
  const h = hint(app, "copy");
  await expect(h).toBeVisible();
  await expect(h).toHaveAttribute("role", "status");
  await expect(h).toContainText("写完后，用「复制成文字」粘贴给 Claude Code 或 Codex；网页版 AI 和聊天软件用「复制成图片」。");
  await expect(h).toHaveAttribute("data-side", "above");
  // Directly above the copy buttons, without covering them; it plays the feature's animation above its sentence
  const [hb, db] = [(await h.boundingBox())!, (await app.page.locator(".dock-buttons").boundingBox())!];
  expect(hb.y + hb.height).toBeLessThanOrEqual(db.y);
  await expect(h.locator(".demo")).toBeVisible();
  expect(seen(app)).toContain("hint.copy");
  // It doesn't take focus or dim the window
  expect(await app.page.evaluate(() => !!document.activeElement?.closest(".hint"))).toBe(false);
  await expect(app.page.locator(".guide-shade, .overlay")).toHaveCount(0);

  // Clicking Copy as Text directly: the hint closes and the copy works as usual
  await app.page.locator(".dock-copy").click();
  await expect(h).toHaveCount(0);
  await expect.poll(() => app.clipboard()).toContain("标题换粗体");

  await drawRect(app, "背景换浅色", 0.1, 0.2);
  await app.page.waitForTimeout(1000);
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("a hint closes with OK and with Esc; switching items also closes the hint attached to the previous one; Turn Off Beginner Mode on any hint turns them all off and shows where to turn it back on", async ({ app }) => {
  app.host.prefs = { onboarding: seenAllBut("hint.copy", "hint.video", "hint.pin") };
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

  // The Pin tool's hint: Turn Off Beginner Mode
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  await expect(hint(app, "pin")).toBeVisible();
  await hint(app, "pin").getByRole("button", { name: "关闭新手模式" }).click();
  await expect(app.page.locator(".hint")).toHaveCount(0);
  await expect.poll(() => app.host.prefs?.beginner).toBe(false);
  await expect(app.page.locator(".settings-tab.is-on")).toHaveText("常规");
  const row = app.page.locator(".set-row", { hasText: "新手模式" });
  await expect(row).toBeInViewport();
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

test("the first time a video is opened: no hint while the guide is on; once it is closed a hint appears once next to Timestamped comment; opening a video again doesn't show it", async ({ app }) => {
  app.host.prefs = { onboarding: seenAllBut("tour", "hint.video") };
  app.host.selected = join(app.project, "video", "clip.mp4");
  await app.open();
  await expect(app.page).toHaveTitle("clip.mp4");
  await expect(guide(app)).toBeVisible();
  await app.page.waitForTimeout(1000);
  await expect(app.page.locator(".hint")).toHaveCount(0);
  await button(app, "跳过").click();
  // Skipped on an item of the user's own: it stays in the list
  await expect(app.page.locator(".lib-row", { hasText: "clip.mp4" })).toBeVisible();

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

test("the first time the Pin tool is picked a hint below it says one note can mark several places; the first mark drawn brings, next to it, the hint that marks can be recolored, without taking the caret from the note box; each comes once", async ({
  app,
}) => {
  app.host.prefs = { onboarding: seenAllBut("hint.pin", "hint.color") };
  await app.open();
  await app.page.locator(".lib-row", { hasText: "poster.jpg" }).click();
  await expect(app.page).toHaveTitle("poster.jpg");
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  const pin = hint(app, "pin");
  await expect(pin).toContainText("写批注时单击别处，可在同一条批注中标出多处。");
  await expect(pin).toHaveAttribute("data-side", "below");
  const [pb, tb] = [(await pin.boundingBox())!, (await app.page.locator('.hdr-tools .tool-btn[data-tool="point"]').boundingBox())!];
  expect(pb.y).toBeGreaterThanOrEqual(tb.y + tb.height);
  await app.page.keyboard.press("Escape");
  await expect(pin).toHaveCount(0);

  const media = await app.media();
  await app.page.mouse.click(media.x + media.width * 0.3, media.y + media.height * 0.3);
  const color = hint(app, "color");
  await expect(color).toContainText("单击标记可更换颜色或删除。");
  // Beside the new mark's number, and the caret stays in the note box: typing goes on
  await expect(app.page.locator(".composer-text")).toBeFocused();
  await app.page.keyboard.type("这里换成蓝色");
  await expect(app.page.locator(".composer-text")).toHaveValue("这里换成蓝色");
  const [cb, bb] = [(await color.boundingBox())!, (await app.page.locator(".annot-badge.is-draft").boundingBox())!];
  expect(cb.y + cb.height <= bb.y || cb.x + cb.width <= bb.x || cb.y >= bb.y + bb.height).toBe(true);
  await app.page.keyboard.press("Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect(color).toHaveCount(0);
  expect(seen(app)).toEqual(expect.arrayContaining(["hint.pin", "hint.color"]));

  // Once each
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("c");
  await app.page.mouse.click(media.x + media.width * 0.6, media.y + media.height * 0.6);
  await expect(app.page.locator(".composer")).toBeVisible();
  await app.page.waitForTimeout(800);
  await expect(app.page.locator(".hint")).toHaveCount(0);
});

test("Interface size 125%: the ring still surrounds what the step is done on, the card stays inside the window, and the hint sits next to its control", async ({ app }) => {
  app.host.prefs = { uiScale: 1.25, onboarding: seenAllBut("tour", "hint.copy", "hint.pin") };
  await app.open();
  await onStep(app, "tool", "选择矩形工具", "1 / 4");
  await expectRingAround(app, RECT, 4 * 1.25);
  await expectCardInWindow(app);
  await button(app, "下一步").click();
  await onStep(app, "mark", "圈出要改的地方", "2 / 4");
  await expectCardInWindow(app);
  await button(app, "下一步").click();
  await onStep(app, "write", "写下修改要求", "3 / 4");
  await expectRingAround(app, ".composer", 4 * 1.25);
  await expectCardInWindow(app);
  await button(app, "下一步").click();
  await onStep(app, "tools", "认识工具栏");
  await expectCardInWindow(app);
  await button(app, "下一步").click();
  await onStep(app, "copy", "复制，交给 AI", "4 / 4");
  await expectRingAround(app, ".panel-dock .dock-buttons", 4 * 1.25);
  await expectCardInWindow(app);
  await button(app, "跳过").click();
  await expect(guide(app)).toHaveCount(0);

  // The guide reached the copy step, which shows where Copy is: no hint about it afterwards
  expect(seen(app)).toContain("hint.copy");
  // The Pin tool's hint, 8 below its button at this size too
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("c");
  await expect(hint(app, "pin")).toBeVisible();
  const pb = (await app.page.locator('.hdr-tools .tool-btn[data-tool="point"]').boundingBox())!;
  // (Measured once its appearing animation has ended)
  await expect.poll(async () => (await hint(app, "pin").boundingBox())!.y - (pb.y + pb.height)).toBeCloseTo(8 * 1.25, 0);
});

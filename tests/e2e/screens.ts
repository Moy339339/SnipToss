// Opens every screen of the UI once: overflow detection (overflow.spec.ts), pseudo-localization (pseudo.spec.ts) and the per-language screenshots (i18n-shots.spec.ts)
// share this one walkthrough, so a new screen added here is checked by all three. visit(screen name) is called once per screen.
// The welcome page on its own needs an empty library and goes through welcome(); the walk ends on it too, after the first launch
// (the first-run dialog and the tutorial on the sample picture)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import { expect, ROOT, type App } from "./harness";
import { ONBOARDED } from "./mock-host";

/** The first-use hints the walk passes by on the way (each where its feature is first used); the one next to Capture follows the tutorial */
const PASSED_BY = ["hint.pin", "hint.color", "hint.copy", "hint.drawing", "hint.video"];
/** What a first launch has not seen yet: the first-run dialog, the tutorial and the hint that follows it */
const FIRST_LAUNCH = ["welcome", "tour", "hint.capture"];

/**
 * Set before the UI opens: the UI language; nothing of the onboarding comes by itself but the hints the walk passes by (the first-run
 * dialog and the tutorial come at the end, from an empty library)
 */
export function prepare(app: App, language: string) {
  app.host.onboarded = false;
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { language, onboarding: ONBOARDED.filter((k) => !PASSED_BY.includes(k)) };
}

/** The steps of the tutorial, in order (onboarding.ts: the four done by doing, with the toolbar between writing and copying, and the end) */
export const GUIDE_STEPS = ["tool", "mark", "write", "tools", "copy", "done"];

export async function walkScreens(app: App, visit: (screen: string) => Promise<void>) {
  const page = app.page;
  const menu = page.locator(".menu").first();
  await page.locator(".lib-row", { hasText: "hero.png" }).click();
  // The most crowded title bar: the shell has found a new version (the "new version" pill is squeezed between the menu bar and the Capture button)
  app.host.announceUpdate({ version: "1.0.0-beta.99", url: "https://example.com/", prerelease: true });
  await expect(page.locator(".titlebar-update")).toBeVisible();
  await visit("主界面");

  // With the Mac's native menus the page has no menu bar of its own: there are no menus to click through, Command is the key of Settings, and
  // the tour is started with its item of the Help menu the shell would send back (see mac-menus.spec.ts)
  const native = (await page.locator(".menubar").count()) === 0;

  // Every menu of the menu bar
  const tops = page.locator(".menubar > button, .menubar .menubar-top");
  if (!native) {
    expect(await tops.count()).toBeGreaterThan(5);
    for (let i = 0; i < (await tops.count()); i++) {
      await tops.nth(i).click();
      await expect(menu).toBeVisible();
      await visit(`菜单 ${i + 1}`);
      await page.keyboard.press("Escape");
    }
  }

  // Three context menus: the canvas, a row of the Library, a card of the notes panel
  for (const [where, target] of [
    ["画面右键菜单", page.locator(".zoom-media")],
    ["素材右键菜单", page.locator(".lib-row", { hasText: "hero.png" })],
    ["批注右键菜单", page.locator('[data-annot$="|k3f9a2"]')],
  ] as const) {
    await target.click({ button: "right" });
    await expect(menu).toBeVisible();
    await visit(where);
    await page.keyboard.press("Escape");
    await expect(page.locator(".menu")).toHaveCount(0);
  }

  // The Pin tool picked for the first time brings its hint; then the note box (the pin lands outside the frames that already exist in the
  // test item), with the hint about recoloring next to the first mark drawn
  const hint = (id: string) => page.locator(`.hint[data-hint="${id}"]`);
  const layer = page.locator(".annot-layer");
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("c");
  await expect(hint("pin")).toBeVisible();
  await visit("图钉的提示");
  // Esc closes only the hint (the tool stays): in the longer languages the hint reaches down over the picture
  await page.keyboard.press("Escape");
  await expect(page.locator(".hint")).toHaveCount(0);
  await expect(layer).toHaveClass(/tool-point/);
  const media = await app.media();
  await page.mouse.click(media.x + media.width * 0.8, media.y + media.height * 0.75);
  await expect(page.locator(".composer")).toBeVisible();
  await expect(hint("color")).toBeVisible();
  await visit("写批注小窗");
  await page.keyboard.press("Escape"); // The hint first
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".composer")).toHaveCount(0);
  await page.keyboard.press("Escape"); // Back to the Select tool
  await expect(layer).toHaveClass(/tool-select/);
  await page.locator('[data-annot$="|k3f9a2"] .card-body').click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await visit("删除确认框");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // The color bar of a mark clicked on the canvas (presets, recent colors, hue disc, Delete) and the color picker behind its hue disc
  for (const c of ["#8b5a2b", "#17a998"]) app.host.addRecentColor(c);
  await page.locator('.annot-badge[data-id="k3f9a2"][data-part="0"]').click();
  await expect(page.locator(".mark-colors")).toBeVisible();
  await visit("标记颜色条");
  await page.locator(".mark-colors .menu-swatch.is-custom").click();
  await expect(page.locator(".color-picker")).toBeVisible();
  await visit("自定义颜色");
  await page.keyboard.press("Escape");
  await expect(page.locator(".color-picker")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".mark-colors")).toHaveCount(0);

  // Every page of Settings
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(native ? "Meta+," : "Control+,");
  const tabs = page.locator(".settings-tab");
  await expect(tabs.first()).toBeVisible();
  expect(await tabs.count()).toBeGreaterThan(5);
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await visit(`设置 ${i + 1}`);
  }
  await page.keyboard.press("Escape");

  // Keyboard Shortcuts (F1)
  await page.keyboard.press("F1");
  await expect(page.locator(".sheet").first()).toBeVisible();
  await visit("快捷键一览");
  await page.keyboard.press("Escape");

  // The first note saved brings the hint next to the copy buttons (an overall comment: no mark, so nothing else comes with it)
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("n");
  await page.locator(".composer-text").fill("整体再亮一点");
  await page.keyboard.press("Enter");
  await expect(page.locator(".composer")).toHaveCount(0);
  await expect(hint("copy")).toBeVisible();
  await visit("复制的提示");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hint")).toHaveCount(0);

  // A mark left without a word stays as a drawing, and the first one brings its hint
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("b");
  await page.mouse.move(media.x + media.width * 0.6, media.y + media.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(media.x + media.width * 0.75, media.y + media.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".composer")).toBeVisible();
  // A click elsewhere on the picture leaves the note unwritten (on the right: in a narrow window the note box covers the left of the picture)
  await page.mouse.click(media.x + media.width * 0.9, media.y + media.height * 0.3);
  await expect(page.locator(".composer")).toHaveCount(0);
  await expect(hint("drawing")).toBeVisible();
  await visit("涂鸦的提示");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.keyboard.press("v");
  await expect(layer).toHaveClass(/tool-select/);

  // The hint shown when a video is opened
  await page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(hint("video")).toBeVisible();
  await visit("视频的提示");
  await page.keyboard.press("Escape");
  await expect(page.locator(".hint")).toHaveCount(0);

  // The very first launch: an empty library, and nothing seen yet but the hints passed by above. The first-run dialog, the tutorial on the
  // sample picture step by step ("Next" does each step), and at its end the hint next to Capture on the welcome page
  app.host.entries = [];
  app.host.selected = null;
  const seen = (app.host.prefs?.onboarding as string[] | undefined) ?? [];
  app.host.prefs = { ...app.host.prefs, onboarding: seen.filter((k) => !FIRST_LAUNCH.includes(k)) };
  await page.reload();
  const firstRun = page.locator(".firstrun");
  await expect(firstRun).toBeVisible();
  await visit("首次启动");
  await firstRun.locator(".firstrun-actions .btn-primary").click();
  const guide = page.locator(".guide");
  for (const step of GUIDE_STEPS) {
    await expect(guide).toHaveAttribute("data-step", step);
    await expect(guide).toBeVisible();
    await visit(`教程 ${GUIDE_STEPS.indexOf(step) + 1} ${step}`);
    await guide.locator(".guide-actions button").last().click();
  }
  await expect(guide).toHaveCount(0);
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(hint("capture")).toBeVisible();
  await visit("截图批注的提示");
}

/** The welcome page in the middle of the canvas with an empty library (the first-run dialog counts as seen). Call it before app.open(): the library is empty */
export async function welcome(app: App, visit: (screen: string) => Promise<void>) {
  app.host.entries = [];
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect(app.page.locator(".welcome")).toBeVisible();
  await visit("欢迎页");
}

const PLAIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ACCENTED = "áƀçðéƒĝĥíĵķļɱñóƥɋŕšţúṽŵẋýžÁƁÇÐÉƑĜĤÍĴĶĻṀÑÓƤɊŔŠŢÚṼŴẊÝŽ";
const accent = (s: string) => [...s].map((c) => (PLAIN.includes(c) ? [...ACCENTED][PLAIN.indexOf(c)] : c)).join("");

/** Pseudo-localizes one message: only literal text is replaced (placeholder names and plural / select branch names stay), following ICU syntax */
function pseudo(msg: string): string {
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (el.type === TYPE.literal) el.value = accent(el.value);
      if ("options" in el) for (const o of Object.values(el.options)) walk(o.value);
      if ("children" in el) walk(el.children);
    }
  };
  const ast = parse(msg);
  walk(ast);
  return printAST(ast);
}

/** Makes the UI use pseudo-localized messages: every letter of the English messages becomes an accented one (a → á, Settings → Šéţţíñĝš). The UI language must be set to en */
export async function usePseudo(app: App) {
  const en = JSON.parse(readFileSync(join(ROOT, "i18n", "locales", "en.json"), "utf8")) as Record<string, string>;
  const fake = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, pseudo(v)]));
  await app.page.route(/\/assets\/en-[^/]+\.js$/, (route) =>
    route.fulfill({ contentType: "text/javascript", body: `export default ${JSON.stringify(fake)};` }),
  );
}

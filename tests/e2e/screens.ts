// Opens every screen of the UI once: overflow detection (overflow.spec.ts), pseudo-localization (pseudo.spec.ts) and the per-language screenshots (i18n-shots.spec.ts)
// share this one walkthrough, so a new screen added here is checked by all three. visit(screen name) is called once per screen.
// The welcome page needs an empty library and goes through welcome() instead

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import { expect, ROOT, type App } from "./harness";

/** Set before the UI opens: the UI language; the tour doesn't start by itself (it is opened from the Help menu at the end) and the video hint is left for last */
export function prepare(app: App, language: string) {
  app.host.onboarded = false;
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  app.host.prefs = { language, onboarding: ["tour", "hint.copy"] };
}

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

  // The note box (the pin lands outside the frames that already exist in the test item) and the confirm dialog before deleting
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("c");
  const media = (await page.locator(".zoom-media").boundingBox())!;
  await page.mouse.click(media.x + media.width * 0.8, media.y + media.height * 0.75);
  await expect(page.locator(".composer")).toBeVisible();
  await visit("写批注小窗");
  await page.keyboard.press("Escape");
  await expect(page.locator(".composer")).toHaveCount(0);
  await page.keyboard.press("Escape"); // Back to the Select tool
  await page.locator('[data-annot$="|k3f9a2"] .card-body').click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await visit("删除确认框");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

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

  // The three steps of the onboarding tour (the second Help menu item, Feature Tour) and the hint shown when a video is opened
  if (native) {
    // The menus the shell has are the ones with the shortcut list still open until the page has sent them again: a command from those is dropped
    await expect.poll(() => app.host.menusSent.at(-1)?.modal).toBe(false);
    const sent = app.host.menusSent[app.host.menusSent.length - 1];
    const help = sent.menus[sent.menus.length - 1].items as { id: string; label: string }[];
    app.host.chooseMenuItem(help.find((item) => item.label === "Feature Tour")!.id, sent.version);
  } else {
    await tops.last().click();
    await page.locator(".menu [role=menuitem]").nth(1).click();
  }
  for (let i = 1; i <= 3; i++) {
    await expect(page.locator(".tour-count")).toHaveText(`${i} / 3`);
    await visit(`引导 ${i}`);
    await page.locator(".tour-card .btn-primary").click();
  }
  await expect(page.locator(".tour")).toHaveCount(0);
  await page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(page.locator(".hint")).toBeVisible();
  await visit("视频的提示");
}

/** The three-step explanation in the middle of the canvas with an empty library (what you see the first time you open the app). Call it before app.open(): the library is empty */
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

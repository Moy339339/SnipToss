// The i18n pipeline (docs/adr/0001-i18n.md): following the system language, choosing one manually, and text that is already a message switching with it.
// Screenshots of every screen in every language and text overflow checks are in overflow.spec.ts, pseudo.spec.ts and i18n-shots.spec.ts

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, type App } from "./harness";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");

const readyCalls = (app: App) => app.host.calls.filter((c) => c.method === "ready").length;
/** The bundled Chinese messages (a chunk Vite loads on demand) */
const ZH = /\/assets\/zh-CN-[^/]+\.js$/;

test("The UI is drawn only after the messages have loaded (no flash of another language) and ready is called exactly once after it is drawn", async ({ app }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await app.page.route(ZH, async (route) => {
    await gate;
    await route.fallback();
  });
  await app.page.goto("https://app.sniptoss.example/index.html");
  await expect.poll(() => app.host.calls.some((c) => c.method === "appInfo")).toBe(true);
  await app.page.waitForTimeout(300);
  expect(await app.page.locator("#root").innerHTML()).toBe("");
  expect(readyCalls(app)).toBe(0);
  release();
  await expect(app.page.locator(".lib-row").first()).toBeVisible();
  await expect(app.page.locator(".menubar")).toContainText("文件");
  await expect.poll(() => readyCalls(app)).toBe(1);
  await app.page.waitForTimeout(300);
  expect(readyCalls(app)).toBe(1);
});

// Known and left as is: the message files are installed together with the app, so a broken one means a broken installation;
// it is logged and the UI remains usable
test("When the messages fail to load, an error is logged, the UI still appears showing raw message ids, and ready is still called", async ({ app }) => {
  app.allowLogErrors("loading messages");
  app.allowLogErrors("i18n message: ");
  await app.page.route(ZH, (route) => route.abort());
  await app.open();
  await expect.poll(() => app.host.logs.some((l) => l.level === "error" && l.message.startsWith("loading messages"))).toBe(true);
  await expect(app.page.locator(".menubar")).toContainText("menu.top.file");
  await expect.poll(() => readyCalls(app)).toBe(1);
});

// "Follow system" only picks languages that are fully translated (SYSTEM_LOCALES in i18n.tsx);
// anything not fully translated falls back to English instead of mixing languages
test("With an English system and the setting on Follow system, the whole UI is in English", async ({ app }) => {
  app.host.systemLanguage = "en-US";
  await app.open();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "en");
  await expect(app.page.locator(".menubar")).toContainText("File");
  spawnSync(process.execPath, [CLI, "resolve", "k3f9a2", "-m", "done", "--root", app.project]);
  await expect(app.page.locator(".toast")).toContainText("The notes file was changed outside the app");
});

test("With a Japanese system and the setting on Follow system, the UI is in Japanese (a second-tier language that ships with the app); an unsupported language (Dutch) falls back to English", async ({ app }) => {
  app.host.systemLanguage = "ja-JP";
  await app.open();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "ja");
  app.host.systemLanguage = "nl-NL";
  await app.open();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "en");
});

test("Settings → General → Language: Follow system names the language it resolves to and the list shows the languages that have messages (each in its own language); a choice applies immediately and is stored, and choosing Follow system again stores nothing", async ({ app }) => {
  app.host.systemLanguage = "en-US";
  app.host.prefs = { language: "zh-CN" };
  await app.open();
  await app.page.keyboard.press("Control+,");
  const picker = app.page.locator(".set-select");
  await expect(picker).toHaveText("简体中文");
  await picker.click();
  const items = app.page.getByRole("menuitemradio");
  await expect(items).toHaveText([
    "跟随系统（English）",
    "简体中文",
    "繁體中文",
    "English",
    "日本語",
    "한국어",
    "Français",
    "Deutsch",
    "Español",
    "Italiano",
    "Português (Brasil)",
    "Русский",
  ]);
  // Simplified Chinese and English have been proofread, so there is no "corrections welcome" note; second-tier languages have one
  await expect(app.page.locator(".set-desc-line")).toHaveCount(0);
  await expect(app.page.getByRole("menuitemradio", { name: "简体中文", exact: true })).toHaveAttribute("aria-checked", "true");
  await app.page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "en");
  await expect(picker).toHaveText("English");
  await expect.poll(() => app.host.prefs?.language).toBe("en");
  await picker.click();
  await app.page.getByRole("menuitemradio", { name: "Follow system (English)" }).click();
  await expect(picker).toHaveText("Follow system (English)");
  await expect.poll(() => app.host.prefs?.language).toBeUndefined();
});

test("With English chosen in Settings, text that is already a message appears in English", async ({ app }) => {
  app.host.prefs = { language: "en" };
  await app.open();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "en");
  spawnSync(process.execPath, [CLI, "resolve", "k3f9a2", "-m", "done", "--root", app.project]);
  await expect(app.page.locator(".toast")).toContainText("The notes file was changed outside the app");
});

test("A language chosen in Settings is used whatever the system language is", async ({ app }) => {
  app.host.systemLanguage = "en-US";
  app.host.prefs = { language: "zh-CN" };
  await app.open();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "zh-CN");
  spawnSync(process.execPath, [CLI, "resolve", "k3f9a2", "-m", "改好了", "--root", app.project]);
  await expect(app.page.locator(".toast")).toContainText("批注文件已在外部更新");
});

// Text for AI (docs/adr/0001-i18n.md item 7): Copy as Text follows the UI language;
// REVIEW.md follows the language recorded in the notes folder (.sniptoss/project.json)
const reviewOf = (app: App) => app.review();
const projectOf = (app: App) => {
  const file = join(app.project, ".sniptoss", "project.json");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};
/** Selects the note and marks it done with D (this rewrites REVIEW.md) */
async function markDone(app: App, id: string) {
  await app.page.locator(`[data-annot$="|${id}"]`).click();
  await app.page.keyboard.press("d");
  await expect.poll(() => app.annotations("assets__hero.png.json").find((a) => a.id === id)?.status).toBe("resolved");
}

test("With an English UI, the text from Copy as Text is in English (categories, locations, instructions) while the original note text is unchanged", async ({ app }) => {
  app.host.prefs = { language: "en" };
  await app.open();
  await app.page.keyboard.press("Control+Shift+A");
  await expect.poll(() => app.clipboard()).toContain("Please change the items as described in the notes below");
  const text = await app.clipboard();
  expect(text).toContain("Change · Region: top left of the frame");
  expect(text).toContain("标题字太细了，换成粗一点的黑体");
  expect(text).not.toMatch(/请按|区域|修改 ·/);
});

test("The first REVIEW.md of a new project uses the UI language at that time and records it in project.json; changing the UI language afterwards does not change REVIEW.md", async ({ app }) => {
  app.host.prefs = { language: "en" };
  await app.open();
  await markDone(app, "k3f9a2");
  await expect.poll(() => projectOf(app)).toBe('{\n  "language": "en"\n}\n');
  await expect.poll(() => reviewOf(app)).toContain("# Open notes (1)");
  // Switch to the Chinese UI: REVIEW.md keeps the recorded English (so people collaborating in different languages do not keep rewriting it)
  app.host.prefs = { language: "zh-CN", panelResolved: true }; // the notes panel lists resolved notes too, so that this one can be reopened
  await app.open();
  await expect(app.page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await app.page.locator('[data-annot$="|k3f9a2"]').click();
  await app.page.keyboard.press("d"); // reopen
  await expect.poll(() => app.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("open");
  await expect.poll(() => reviewOf(app)).toContain("# Open notes (2)");
  expect(projectOf(app)).toBe('{\n  "language": "en"\n}\n');
});

test("A project whose REVIEW.md was written by an earlier version and has no recorded language is recorded as Chinese and written in Chinese, even when the UI is English", async ({ app }) => {
  writeFileSync(join(app.project, ".sniptoss", "REVIEW.md"), "# 待处理批注（2 条）\n");
  app.host.prefs = { language: "en" };
  await app.open();
  await markDone(app, "k3f9a2");
  await expect.poll(() => projectOf(app)).toBe('{\n  "language": "zh-CN"\n}\n');
  await expect.poll(() => reviewOf(app)).toContain("# 待处理批注（1 条）");
});

test("With an English UI, hover tooltips still split the trailing shortcut out and show it right-aligned in a lighter gray (English uses ASCII parentheses)", async ({ app }) => {
  app.host.prefs = { language: "en" };
  await app.open();
  const tip = app.page.locator(".tooltip.is-on");
  await app.page.locator(".win-close").hover();
  await expect(tip).toBeVisible();
  await expect(tip.locator(".tooltip-key")).toHaveText("Alt F4");
  expect(await tip.evaluate((el) => el.firstChild?.textContent)).toBe("Close");
});

test("With a second-tier language (German), Settings shows a line under Language saying it has not been proofread by native speakers and welcoming corrections", async ({ app }) => {
  app.host.prefs = { language: "de" };
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+,");
  await expect(app.page.locator(".set-desc-line")).toHaveText(
    "Diese Übersetzung wurde noch nicht von Muttersprachlern geprüft. Verbesserungsvorschläge sind auf GitHub willkommen.",
  );
});

test("Menu bar mnemonics follow the language: in German Alt+D opens Datei with the D underlined when shown; Chinese keeps the (F) mnemonic after the menu name (ADR-0001 item 10)", async ({ app }) => {
  app.host.prefs = { language: "de" };
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Alt+d");
  await expect(app.page.locator(".menubar-menu")).toBeVisible();
  await expect(app.page.locator(".menubar-item.is-open")).toHaveText("Datei");
  await expect(app.page.locator(".menubar-item.is-open .menubar-mnemonic")).toHaveText("D");
  await expect(app.page.locator(".menubar-item.is-open .menubar-mnemonic")).toHaveCSS("text-decoration-line", "underline");
  await app.page.keyboard.press("Escape");
  // Russian keyboard layout: Alt plus the F key (which types а) still opens Файл
  app.host.prefs = { language: "ru" };
  await app.open();
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.evaluate(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "а", code: "KeyF", altKey: true, bubbles: true, cancelable: true })),
  );
  await expect(app.page.locator(".menubar-item.is-open")).toContainText("Файл");
});

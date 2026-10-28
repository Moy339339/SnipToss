// Pseudo-localization (docs/adr/0001-i18n.md item 12): every letter of the English messages is replaced with an accented one (a → á, Settings → Šéţţíñĝš, usePseudo in screens.ts),
// and every screen of the UI (screens.ts) plus the welcome page is opened with it. Any plain English word still on screen is text that bypassed the messages and is hard-coded
// (hard-coded Chinese is blocked by scripts/check-i18n.mjs; hard-coded English can only be caught here).
// Things that are never translated, such as file names, key names and the version number, are listed in ALLOWED

import { expect, test, type App } from "./harness";
import { prepare, usePseudo, walkScreens, welcome } from "./screens";

/** Never translated: file names of the test items, key names, the version number, units, file formats, names of folders skipped by default */
const ALLOWED = new Set([
  "hero", "png", "clip", "mp4", "assets", "video", "project", "sniptoss", "snapshots", "tester", // tester: the Windows user name given by the mock host
  "jpg", "webp", "gif", "bmp", "avif", "webm", "mov", "JPEG", "node", "modules", "bin", "obj", "dist", "build", "pycache", "venv", "beta",
  "svg", "tiff", "heic", "ico", "mkv", "apng", "jfif", "SVG", "TIFF", "HEIC", "ICO", "MKV", "HEIF", "HEVC",
  "Ctrl", "Shift", "Alt", "Esc", "Enter", "Tab", "Delete", "Backspace", "Win", "Home", "End", "PageUp", "PageDown", "Insert",
  "Beta", "PNG", "JPG", "MP4", "PDF", "PPT", "px", "WebView2", "WebView", "NET", "Edge", "Claude", "Code", "Codex", "MIT", "GitHub", "MoyGoldenAge",
]);

/** Visible words on screen that are still plain English (three letters or more) */
function plainWords(app: App, where: string) {
  return app.page.evaluate(
    ({ where: screen, allowed }) => {
      const out = new Set<string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        // User data (item names, paths, note text), key names and a language's own name (elements with lang) don't count
        if (!el || el.closest("script, style, [aria-hidden='true'], .lib-name, .lib-path, .card-body, code, kbd, body [lang]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
        // Paths and URLs (containing \ or /) are skipped entirely
        for (const token of n.textContent!.split(/\s+/)) {
          if (/[\\/]/.test(token)) continue;
          for (const w of token.match(/[A-Za-z]{3,}/g) ?? []) if (!allowed.includes(w)) out.add(`${screen}: “${w}” in “${n.textContent!.trim().slice(0, 40)}”`);
        }
      }
      return [...out];
    },
    { where, allowed: [...ALLOWED] },
  );
}

test("pseudo-localization: no hard-coded English on any UI screen (main UI, menus, context menus, note box, confirm dialogs, Settings pages, Keyboard Shortcuts, onboarding tour and hints)", async ({ app }) => {
  await usePseudo(app);
  prepare(app, "en");
  await app.open();
  const found: string[] = [];
  await walkScreens(app, async (screen) => void found.push(...(await plainWords(app, screen))));
  expect(found, found.join("\n")).toEqual([]);
});

test("pseudo-localization: no hard-coded English on the welcome page with an empty library", async ({ app }) => {
  await usePseudo(app);
  prepare(app, "en");
  const found: string[] = [];
  await welcome(app, async (screen) => void found.push(...(await plainWords(app, screen))));
  expect(found, found.join("\n")).toEqual([]);
});

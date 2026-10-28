// Screenshots of the native windows in every language (the part of the full-UI language screenshots that web pages can't draw;
// the web part is in tests/e2e/i18n-shots.spec.ts):
// every state of the capture overlay (magnifier and first-use hint, dragging a region, toolbar, note box, overall comment, text box,
// selected mark, cancel warning), finish / error toasts, the composited image of Screen Capture (with notes), the image Copy as Images draws,
// the error window, and the notice page shown when the UI can't start; one set per language, for a person to go through one by one.
// The tooltips of the toolbar buttons (popup windows can't be drawn into the overlay), the tray menu and the sentences in the overlay
// go into texts.json to be read together.
// The overlay and toasts are drawn to PNG through the test hooks (the fake monitor is off-screen, so a screen grab can't catch it);
// the notice page is captured with PrintWindow. Not run normally; to take them:
//   $env:SNIPTOSS_I18N_SHOTS = '<folder>'; npx playwright test -c playwright.shell.config.ts i18n-shots
// Output goes to <folder>/<language>/native/<number> <name>.png (build tests/shell/.app first with npm run e2e:shell)

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, waitFor, type Shell } from "./harness";

const OUT = process.env.SNIPTOSS_I18N_SHOTS;
const LOCALES = readdirSync(join(ROOT, "i18n", "locales"))
  .filter((n) => n.endsWith(".json"))
  .map((n) => n.replace(/\.json$/, ""));

test.skip(!OUT, "Only takes screenshots when SNIPTOSS_I18N_SHOTS is set");

type Layer = {
  buttons: { id: string; name: string }[];
  picked: number;
  warn: { text: string } | null;
  magnifier: { hint: string | null } | null;
};
type Op = Record<string, unknown> & { op: string };

const OFF = -20000;
const run = async (shell: Shell, ops: Op[]) =>
  (await shell.ask<{ state: { overlays: Layer[] } }>("debugCaptureDo", { monitor: 0, ops })).state.overlays[0];
const result = (shell: Shell) =>
  shell.ask<{ saved: string | null; shown: unknown[]; windows: { kind: string }[] }>("debugCaptureResult", {});

/** Switches to a fake monitor off-screen and presses the capture hotkey to open the capture overlay (fail = the screen grab fails) */
async function open(shell: Shell, fail = false) {
  await shell.ask("debugCaptureFake", {
    monitors: [{ x: OFF, y: OFF, width: 1280, height: 720, scale: 1 }],
    windows: [],
    cursor: null,
    fail,
  });
  await shell.ask("debugHotkey");
  if (!fail) await waitFor("the capture overlay to appear", async () => (await shell.ask<{ open: boolean }>("debugCaptureState")).open);
}

/** Written into the settings file before launch (UI settings written through the bridge after launch get overwritten by the UI, see presetPrefs in capture.spec.ts) */
function preset(shell: Shell, locale: string) {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    JSON.stringify({ ...s, Prefs: { ...s.Prefs, language: locale }, Capture: { ...s.Capture, SelectHintDone: false } }, null, 2),
  );
}

/** A sentence in this language as the note text (so the font and line height show) */
const sample = (locale: string) =>
  locale.startsWith("zh")
    ? "标题字太细了，换成粗一点的黑体"
    : locale === "ja"
      ? "見出しが細すぎるので太めの書体に"
      : locale === "ko"
        ? "제목 글꼴이 너무 가늘어요"
        : "The heading is too thin, use a bolder typeface";

for (const locale of LOCALES) {
  const messages = JSON.parse(readFileSync(join(ROOT, "i18n", "locales", `${locale}.json`), "utf8")) as Record<string, string>;

  test(`${locale}: native window screenshots`, async ({ shell }) => {
    test.setTimeout(120_000);
    const dir = join(OUT!, locale, "native");
    mkdirSync(dir, { recursive: true });
    let n = 0;
    const file = (name: string) => join(dir, `${String(++n).padStart(2, "0")} ${name}.png`);
    const shot = (name: string) => run(shell, [{ op: "shot", path: file(name) }]);
    const texts: Record<string, unknown> = {};

    preset(shell, locale);
    await shell.launch();
    shell.allowLogErrors(); // a failed save and a UI-thread error both log an ERROR

    // Capture overlay
    await open(shell);
    let o = await run(shell, [{ op: "move", x: 300, y: 260 }]);
    texts["first-use hint under the magnifier"] = o.magnifier?.hint;
    await shot("magnifier and first-use hint");
    await run(shell, [{ op: "drag", from: [200, 200], to: [600, 500], hold: true }]);
    await shot("dragging a region (size readout)");
    o = await run(shell, [{ op: "up" }]);
    texts["toolbar button tooltips"] = o.buttons.map((b) => `${b.id}: ${b.name}`);
    await shot("region selected (toolbar)");
    await run(shell, [
      { op: "key", key: "R" },
      { op: "drag", from: [250, 250], to: [350, 320] },
    ]);
    await shot("note box (empty)");
    o = await run(shell, [{ op: "type", text: sample(locale) }]);
    texts["buttons in the note box"] = o.buttons.map((b) => `${b.id}: ${b.name}`);
    await shot("note box (with text)");
    await run(shell, [
      { op: "key", key: "Enter" },
      { op: "key", key: "N" },
    ]);
    await shot("overall comment");
    await run(shell, [
      { op: "type", text: sample(locale) },
      { op: "key", key: "Enter" },
    ]);
    await run(shell, [{ op: "key", key: "T" }, { op: "down", x: 450, y: 420 }, { op: "up" }, { op: "type", text: sample(locale) }]);
    await shot("text box");
    await run(shell, [
      { op: "key", key: "Escape" },
      { op: "key", key: "R" },
    ]); // Esc means done writing
    o = await run(shell, [{ op: "move", x: 250, y: 285 }, { op: "down", x: 250, y: 285 }, { op: "up" }]);
    expect(o.picked, "clicking the left edge of the rectangle selects it").toBeGreaterThanOrEqual(0);
    texts["color bar while a mark is selected"] = o.buttons.map((b) => `${b.id}: ${b.name}`);
    await shot("selected mark (color bar)");
    o = await run(shell, [
      { op: "key", key: "Escape" },
      { op: "key", key: "Escape" },
    ]); // the first puts down the selected mark, the second shows the warning
    texts["cancel warning"] = o.warn?.text;
    await shot("cancel warning");

    // Finish: toast + composited image (notes attached by default)
    await run(shell, [{ op: "key", key: "Enter" }]);
    await new Promise((r) => setTimeout(r, 400)); // let the fade-in (0.15 s) finish before capturing
    await shell.ask("debugWindowShot", { which: "toast", path: file("finish toast") });
    const done = await result(shell);
    texts["finish toast"] = done.shown;
    copyFileSync(done.saved!, file("composited image (with notes)"));

    // Error toasts: the save can't be written (the longest message), the screen grab fails
    const blocker = join(shell.temp, "a-file");
    writeFileSync(blocker, "x");
    await shell.ask("setCaptureSettings", { folder: join(blocker, "captures"), notesInImage: false });
    await open(shell);
    await run(shell, [
      { op: "drag", from: [200, 200], to: [600, 500] },
      { op: "key", key: "N" },
      { op: "type", text: sample(locale) },
      { op: "key", key: "Enter" },
      { op: "key", key: "Enter" },
    ]);
    await waitFor("the error toast to appear", async () => (await result(shell)).windows.some((w) => w.kind === "error"));
    await shell.ask("debugWindowShot", { which: "error", path: file("error toast (save failed)") });
    texts["error toast (save failed)"] = (await result(shell)).shown;
    await shell.ask("debugCaptureErrorKey", { key: "Escape" });
    await open(shell, true);
    await waitFor("the error toast to appear", async () => (await result(shell)).windows.some((w) => w.kind === "error"));
    await shell.ask("debugWindowShot", { which: "error", path: file("error toast (screen grab failed)") });
    texts["error toast (screen grab failed)"] = (await result(shell)).shown;
    await shell.ask("debugCaptureErrorKey", { key: "Escape" });

    // The main app's Copy as Images (the clipboard is still the recorder)
    await shell.page.locator('[data-annot$="|k3f9a2"]').click({ button: "right" });
    await shell.page.getByRole("menuitem", { name: messages["app.copy.asImages"] }).click();
    const image = file("copy as images");
    await waitFor("the image to be put on the clipboard", () =>
      shell.ask("debugClipboardPng", { path: image }).then(
        () => true,
        () => false,
      ),
    );

    texts["tray"] = await shell.ask("debugTray");

    // Error window
    await shell.callHost("debugThrow", { where: "ui" });
    const buttons = [messages["shell.button.continue"], messages["shell.button.restart"]];
    await waitFor("the error window to appear", () => shell.nativeWindows().some((w) => buttons.every((b) => w.buttons.includes(b))));
    await shell.ask("debugWindowShot", { which: "crash", path: file("error window") });
    texts["error window"] = shell.nativeWindows().find((w) => buttons.every((b) => w.buttons.includes(b)));
    shell.clickNative(messages["shell.button.continue"]);

    writeFileSync(join(dir, "texts.json"), JSON.stringify(texts, null, 2) + "\n");
  });

  test(`${locale}: notice page when the UI can't start`, async ({ shell }) => {
    const dir = join(OUT!, locale, "native");
    mkdirSync(dir, { recursive: true });
    shell.allowLogErrors();
    preset(shell, locale);
    await shell.launch({ withoutUi: true });
    const buttons = [messages["shell.button.restart"], messages["shell.button.exit"]];
    await waitFor("the notice page to appear", () => shell.nativeWindows().some((w) => buttons.every((b) => w.buttons.includes(b))));
    await new Promise((r) => setTimeout(r, 300)); // wait for painting to finish
    const r = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        join(ROOT, "scripts", "capture-window.ps1"),
        "-Out",
        join(dir, "99 notice page when the UI cannot start.png"),
        "-ProcessId",
        String(shell.proc!.pid),
      ],
      {
        encoding: "utf8",
      },
    );
    expect(r.status, r.stderr).toBe(0);
  });
}

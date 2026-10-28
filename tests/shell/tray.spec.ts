// The tray: when the icon exists, what the menu contains, and what left-click and each menu item do.
// The tray icon can't be clicked (the real mouse isn't moved), so it is read and its handlers are called through the test hooks
// (app/TestHooks.cs, compiled only into the shell-test build);
// how the right-click menu really looks when it pops up (dark theme, position) and real mouse single / double clicks are left to manual testing

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, waitFor, type Shell } from "./harness";

type TrayState = { present: boolean; text?: string; items?: { text: string; shortcut: string }[]; said?: { title: string; text: string } | null };
const tray = (shell: Shell) => shell.ask<TrayState>("debugTray");
const act = (shell: Shell, action: string) => shell.callHost("debugTrayAct", { action });
const settings = (shell: Shell) => JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8"));

test("Tray icon: present while keep-in-tray is on, tooltip is the product name, menu is Capture Screen / Open / separator / Exit; the switch adds and removes the icon at once", async ({
  shell,
}) => {
  await shell.launch();
  expect(await tray(shell)).toMatchObject({
    present: true,
    text: "超级批注",
    items: [
      { text: "截图批注", shortcut: "" },
      { text: "打开超级批注", shortcut: "" },
      { text: "-", shortcut: "" },
      { text: "退出", shortcut: "" },
    ],
  });
  await shell.ask("setCaptureSettings", { keepInTray: false });
  expect(await tray(shell)).toMatchObject({ present: false });
  await shell.ask("setCaptureSettings", { keepInTray: true });
  expect(await tray(shell)).toMatchObject({ present: true });
});

test("The tray follows the UI language: with English in settings the product name reads SnipToss and the menu is English; changing the language switches it at once, no restart (ADR-0001)", async ({
  shell,
}) => {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...s, Prefs: { ...s.Prefs, language: "en" } }, null, 2));
  await shell.launch();
  expect(await tray(shell)).toMatchObject({
    present: true,
    text: "SnipToss",
    items: [
      { text: "Capture Screen", shortcut: "" },
      { text: "Open SnipToss", shortcut: "" },
      { text: "-", shortcut: "" },
      { text: "Exit", shortcut: "" },
    ],
  });
  expect(shell.windows().some((w) => w.endsWith("SnipToss"))).toBe(true);
  await shell.ask("setPrefs", { prefs: { ...settings(shell).Prefs, language: "zh-CN" } });
  expect(await tray(shell)).toMatchObject({ text: "超级批注", items: [{ text: "截图批注" }, { text: "打开超级批注" }, { text: "-" }, { text: "退出" }] });
  expect(shell.windows().some((w) => w.endsWith("超级批注"))).toBe(true);
});

test("Started by autostart (--tray): no window is shown and the tray has an icon; the icon stays even with keep-in-tray turned off (otherwise it couldn't be seen or exited)", async ({
  shell,
}) => {
  await shell.launch({ tray: true });
  await waitFor("the startup line in the log", () => shell.log().some((l) => l.includes("[INFO] Starting") && l.includes(" · tray")));
  await new Promise((r) => setTimeout(r, 1500));
  expect(shell.windowShown()).toBe(false);
  expect(shell.windows()).toEqual([]);
  // The UI loads only when the window is first shown: bring the window up from outside, then connect
  expect(await shell.second([])).toBe(0);
  await shell.connect();
  await shell.ask("setCaptureSettings", { keepInTray: false });
  expect(await tray(shell)).toMatchObject({ present: true });
});

test("Started by autostart (--tray) with \"keep in the tray\" off: the icon is there, and once the window is up, closing it exits the process (there is nothing to hide to)", async ({
  shell,
}) => {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...s, Capture: { ...s.Capture, KeepInTray: false } }, null, 2));
  await shell.launch({ tray: true });
  await waitFor("the startup line in the log", () => shell.log().some((l) => l.includes("[INFO] Starting") && l.includes(" · tray")));
  await new Promise((r) => setTimeout(r, 1500));
  expect(shell.windowShown()).toBe(false);
  // The UI isn't built until the window first shows (the tray menu and left-click end up at the same call as a second start with no arguments),
  // so there is no page to read the icon through yet: bring the window up from outside, then connect
  expect(await shell.second([])).toBe(0);
  await shell.connect();
  expect(settings(shell).Capture.KeepInTray).toBe(false);
  expect(await tray(shell)).toMatchObject({ present: true }); // the switch is off, but a login start always keeps its icon
  // Closing the window (WM_CLOSE, what × and Alt+F4 end up sending) quits: with the switch off the window isn't hidden
  shell.windows(true);
  await waitFor("the process to exit", () => !shell.alive());
  expect(shell.proc!.exitCode).toBe(0);
  expect(typeof settings(shell).Placement?.Left).toBe("number"); // the position is saved on the way out
});

test("Tray left-click and \"Open\": a hidden window comes back and a minimized one is restored to the front; an already open window is not hidden", async ({
  shell,
}) => {
  await shell.launch();
  shell.windows(true); // WM_CLOSE: hides to the tray
  await waitFor("the window to hide", () => !shell.windowShown());
  await act(shell, "left");
  await waitFor("the window to appear", () => shell.windowShown());
  // A restored window stays cloaked until it has painted (no white flash frame): it counts as shown only once uncloaked
  await waitFor("the window to be uncloaked", () => shell.windowInfo()?.cloaked === false);
  await act(shell, "left"); // double-click = two single clicks: an open window is not hidden
  await new Promise((r) => setTimeout(r, 300));
  expect(shell.windowShown()).toBe(true);
  await shell.callHost("window", { action: "minimize" });
  await waitFor("the window to minimize", () => shell.windowInfo()?.iconic);
  await act(shell, "打开");
  await waitFor("the window to be restored", () => shell.windowInfo() && !shell.windowInfo()!.iconic);
});

test("Tray \"Capture\": the main window isn't hidden first and the capture overlay appears; the active hotkey is shown on the right; \"Exit\" while capturing ends the capture, exits the process and saves the position", async ({
  shell,
}) => {
  await shell.launch();
  await shell.ask("setCaptureSettings", { hotkey: "Ctrl+Alt+Shift+F11" });
  expect((await tray(shell)).items![0]).toEqual({ text: "截图批注", shortcut: "Ctrl Alt Shift F11" });
  await act(shell, "截图批注");
  await waitFor("the capture overlay to appear", () => shell.windows().length > 1);
  expect(shell.windowShown()).toBe(true);
  await act(shell, "退出");
  await waitFor("the process to exit", () => !shell.alive());
  expect(shell.proc!.exitCode).toBe(0);
  expect(typeof settings(shell).Placement?.Left).toBe("number");
  expect(shell.log().filter((l) => l.includes("[ERROR]"))).toEqual([]);
});

test("The first time the window is hidden to the tray: the tray says it is still running with the current capture shortcut in the text, the hint is recorded as shown, and hiding again says nothing", async ({
  shell,
}) => {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...s, Capture: { ...s.Capture, Hotkey: "Ctrl+Alt+Shift+F10", HotkeyCustom: true, TrayHintShown: false } }, null, 2));
  await shell.launch();
  expect((await tray(shell)).said ?? null).toBeNull(); // nothing is said while the window is open
  shell.windows(true); // WM_CLOSE: hides to the tray
  await waitFor("the window to hide", () => !shell.windowShown());
  const first = (await tray(shell)).said;
  expect(first).toMatchObject({ title: "超级批注仍在后台运行" });
  expect(first!.text).toContain("按 Ctrl Alt Shift F10 可随时截图批注。");
  expect(first!.text).toContain("单击托盘图标打开窗口");
  await waitFor("the hint to be recorded as shown", () => settings(shell).Capture.TrayHintShown === true);

  // Bring the window back and hide it again, with another shortcut in force: had the hint been said again, its text would carry the new one
  await act(shell, "left");
  await waitFor("the window to appear", () => shell.windowShown());
  expect(await shell.ask("setCaptureSettings", { hotkey: "Ctrl+Alt+Shift+F8" })).toMatchObject({ hotkey: "Ctrl+Alt+Shift+F8", hotkeyError: null });
  shell.windows(true);
  await waitFor("the window to hide again", () => !shell.windowShown());
  expect((await tray(shell)).said).toEqual(first);
});

test("Capture hotkey fails to register (here a malformed hotkey): the tray pops up a balloon with the reason, and clicking it opens the window and Settings → Screen Capture", async ({
  shell,
}) => {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...s, Capture: { ...s.Capture, Hotkey: "Ctrl+Alt+NoSuchKey", HotkeyCustom: true } }, null, 2));
  await shell.launch();
  const t = await tray(shell);
  expect(t.said).toMatchObject({ title: "截图快捷键未能启用" });
  expect(t.said!.text).toContain("无法识别的快捷键");
  await act(shell, "balloon");
  await expect(shell.page.locator(".settings-tab.is-on")).toHaveText("截图批注");
});

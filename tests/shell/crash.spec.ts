// The shell's global safety net: an error on the UI thread shows an error window, repeated errors offer only "Restart" and "Exit",
// no second error window stacks on an open one, restart, exit, a background thread crash (log + crash dump + message box),
// unobserved background task exceptions are only logged, and malformed bridge messages.
// Errors are produced through the test hooks (app/TestHooks.cs, compiled only into the shell-test build); the text and buttons of native
// windows are read and clicked through UI Automation, without moving the mouse or keyboard

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ONBOARDED, test, waitFor, type Shell } from "./harness";

/** The error window (the native window with the "复制诊断信息" button) */
const crashWindows = (shell: Shell) => shell.nativeWindows().filter((w) => w.buttons.includes("复制诊断信息"));
const uiErrors = (shell: Shell) => shell.log().filter((l) => l.includes("[ERROR] UI thread error"));
const settings = (shell: Shell) => JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8"));

test("Error on the UI thread: an error window appears (title, explanation, exception, four buttons); after Continue the app carries on", async ({
  shell,
}) => {
  shell.allowLogErrors();
  await shell.launch();
  await shell.callHost("debugThrow", { where: "ui" });
  const [w] = await waitFor("the error window to appear", () => crashWindows(shell).length > 0 && crashWindows(shell));
  expect(w.texts).toContain("发生错误");
  expect(w.texts).toContain("InvalidOperationException: Test hook: UI thread error");
  expect(w.buttons).toEqual(expect.arrayContaining(["复制诊断信息", "打开日志文件夹", "继续使用", "重启"])); // the system title bar's Close is there too
  shell.clickNative("继续使用");
  await waitFor("the error window to close", () => crashWindows(shell).length === 0);
  expect(shell.alive()).toBe(true);
  expect(await shell.ask("windowState")).toMatchObject({ fullscreen: false });
  await expect(shell.page.locator(".lib-row", { hasText: "hero.png" })).toBeVisible();
  expect(uiErrors(shell)).toHaveLength(1);
});

test("The error window follows the UI language: in the English UI the title, explanation and buttons are English; the exception text is as is", async ({
  shell,
}) => {
  shell.allowLogErrors();
  const file = join(shell.temp, "settings.json");
  writeFileSync(file, JSON.stringify({ ...settings(shell), Prefs: { language: "en", onboarding: ONBOARDED } }, null, 2));
  await shell.launch();
  await shell.callHost("debugThrow", { where: "ui" });
  const [w] = await waitFor("the error window to appear", () => {
    const found = shell.nativeWindows().filter((n) => n.buttons.includes("Copy Diagnostic Info"));
    return found.length > 0 && found;
  });
  expect(w.title).toBe("SnipToss");
  expect(w.texts).toContain("Something went wrong");
  expect(w.texts).toContain("InvalidOperationException: Test hook: UI thread error");
  expect(w.buttons).toEqual(expect.arrayContaining(["Copy Diagnostic Info", "Open Log Folder", "Continue", "Restart"]));
  shell.clickNative("Continue");
  await waitFor("the error window to close", () => shell.nativeWindows().every((n) => !n.buttons.includes("Copy Diagnostic Info")));
});

test("More errors while the error window is open are only logged; from the 3rd within 10 seconds a \"multiple errors\" window offers only Restart and Exit; Exit saves the position and exits with code 1", async ({
  shell,
}) => {
  shell.allowLogErrors();
  await shell.launch();
  await shell.callHost("debugThrow", { where: "ui" });
  await waitFor("the error window to appear", () => crashWindows(shell).length > 0);
  await shell.callHost("debugThrow", { where: "ui" });
  await shell.callHost("debugThrow", { where: "ui" });
  await waitFor("the log to record three errors", () => uiErrors(shell).length === 3);
  expect(crashWindows(shell)).toHaveLength(1);
  shell.clickNative("继续使用");
  await waitFor("the error window to close", () => crashWindows(shell).length === 0);
  // The two that came while the window was open count toward "within 10 seconds" too
  await shell.callHost("debugThrow", { where: "ui" });
  const [w] = await waitFor("the second error window to appear", () => crashWindows(shell).length > 0 && crashWindows(shell));
  expect(w.texts).toContain("多次发生错误");
  expect(w.buttons).toEqual(expect.arrayContaining(["复制诊断信息", "打开日志文件夹", "退出", "重启"]));
  expect(w.buttons).not.toContain("继续使用");
  shell.clickNative("退出");
  await waitFor("the process to exit", () => !shell.alive());
  expect(shell.proc!.exitCode).toBe(1);
  expect(typeof settings(shell).Placement?.Left).toBe("number");
});

test("Error window \"Restart\": the old process exits and the new one comes up as the first instance (it doesn't hand over to the exiting old process); the library is as before", async ({
  shell,
}) => {
  shell.allowLogErrors();
  await shell.launch();
  await shell.callHost("debugThrow", { where: "ui" });
  await waitFor("the error window to appear", () => crashWindows(shell).length > 0);
  const first = shell.proc!;
  shell.clickNative("重启");
  await waitFor("the old process to exit", () => first.exitCode !== null);
  expect(first.exitCode).toBe(0);
  await shell.adoptRestarted();
  await expect(shell.page.locator(".lib-row", { hasText: "hero.png" })).toBeVisible();
  expect(shell.log().filter((l) => l.includes("[INFO] Starting"))).toHaveLength(2);
  expect(shell.log().some((l) => l.includes("Could not reach"))).toBe(false);
});

test("Background thread crash: logged, crash dump written, a message box says where the log is (it asks to attach the log, not the memory dump); closing it exits; no user folder in the log", async ({
  shell,
}) => {
  shell.allowLogErrors();
  await shell.launch();
  // First get the log to record a line with a path (the project is in the test instance's temp folder, which is under the user folder)
  await expect(shell.ask("reveal", { path: join(shell.project, "assets", "没有这个.png") })).rejects.toThrow("找不到");
  await shell.callHost("debugThrow", { where: "thread" });
  const box = await waitFor("the message box to appear", () => shell.nativeWindows().find((w) => w.texts.some((t) => t.includes("遇到严重错误"))));
  const text = box.texts.find((t) => t.includes("遇到严重错误"))!;
  expect(text).toContain(".log");
  expect(text).not.toContain(".dmp");
  expect(shell.log().some((l) => l.includes("[ERROR] App crashed"))).toBe(true);
  // The user name is removed before the log is written (reports get pasted into public GitHub issues):
  // the test instance's temp folder is under the user folder, and the log shows it as %USERPROFILE%
  expect(shell.log().join("\n")).not.toContain(process.env.USERPROFILE!);
  expect(shell.log().join("\n")).toContain("%USERPROFILE%");
  const dumps = readdirSync(join(shell.temp, "logs")).filter((f) => /^crash-.*\.dmp$/.test(f));
  expect(dumps).toHaveLength(1);
  shell.windows(true);
  await waitFor("the process to exit", () => !shell.alive());
  expect(shell.proc!.exitCode).not.toBe(0);
});

test("Unobserved background task exception: only logged, no window, no exit", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch();
  await shell.callHost("debugThrow", { where: "task" });
  await waitFor("the log to record it", () => shell.log().some((l) => l.includes("[ERROR] Background task failed and nobody handled it")));
  expect(shell.alive()).toBe(true);
  expect(shell.windows()).toHaveLength(1);
  expect(await shell.ask("windowState")).toMatchObject({ fullscreen: false });
});

test("Malformed bridge messages: each is logged and dropped, with no crash and no window, and replies continue as normal", async ({ shell }) => {
  await shell.launch();
  await shell.page.evaluate(() => {
    const wv = (window as unknown as { chrome: { webview: { postMessage(m: unknown): void } } }).chrome.webview;
    for (const bad of ["不是对象", 123, null, {}, { id: "x", method: "windowState" }, { id: 1 }, { id: 1, method: 5 }, { id: 1.5, method: "windowState" }])
      wv.postMessage(bad);
  });
  await expect(shell.ask("nope")).rejects.toThrow("Unsupported method");
  expect(await shell.ask("windowState")).toMatchObject({ fullscreen: false });
  await waitFor("the log to record the malformed messages", () => shell.log().filter((l) => l.includes("malformed message")).length === 8);
  expect(shell.windows()).toHaveLength(1);
});

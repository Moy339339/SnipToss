// Settings behavior that only the real shell can show: changes are really written to settings.json and survive a restart,
// test instances leave the startup entry alone, and the page reloads while a shortcut is being recorded.
// The UI's own behavior is covered in tests/e2e/settings-dialog.spec.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, waitFor, type Shell } from "./harness";

const prefsOnDisk = (shell: Shell) => JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8")).Prefs as Record<string, unknown>;

async function openSettings(shell: Shell) {
  await shell.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await shell.page.keyboard.press("Control+,");
  await expect(shell.page.locator(".settings")).toBeVisible();
}

test("A changed setting is written to settings.json (changed items only) and survives quit and reopen", async ({ shell }) => {
  await shell.launch();
  await openSettings(shell);
  await shell.page.locator(".set-row", { hasText: "界面大小" }).getByRole("button", { name: "125%" }).click();
  await waitFor("the setting to be written to the settings file", () => prefsOnDisk(shell)?.uiScale === 1.25);
  // Defaults that were never touched are not written (if a later version changes a default, people who never changed it follow the new one)
  expect(Object.keys(prefsOnDisk(shell))).not.toContain("author");
  expect(Object.keys(prefsOnDisk(shell))).not.toContain("markColor");
  await shell.callHost("window", { action: "quit" });
  await waitFor("the process to exit", () => !shell.alive());
  await shell.launch();
  expect(await shell.page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1.25");
});

test("Test instances leave the startup entry alone: the switch is refused with the reason shown and doesn't move", async ({ shell }) => {
  await shell.launch();
  await openSettings(shell);
  const sw = shell.page.locator(".set-row", { hasText: "登录 Windows 时启动" }).getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(shell.page.locator(".toast")).toContainText("Test instances don't change the context menu or startup entries");
  await expect(sw).toHaveAttribute("aria-checked", "false");
});

test("Page reloads while recording the capture hotkey: the hotkey comes back instead of staying paused", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("captureHotkeyPause", { pause: true });
  await shell.page.evaluate(() => location.reload());
  await waitFor("the log to say the hotkey was restored", () => shell.log().some((l) => l.includes("Page reloaded while recording the hotkey: Screen Capture hotkey restored")));
  await expect(shell.page.locator(".lib-row").first()).toBeVisible();
});

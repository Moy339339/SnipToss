// Commands the installer wizard and uninstaller call (app/SetupCommand.cs, installer/SnipToss.iss): they exit when done without opening a window,
// and the exit code says whether it worked.
// Test instances must not write the registry (the context menu and startup entry belong to the installed copy), so all that can be tested here
// is "refused, exit code 1, reason in the log", plus the half that doesn't touch the registry: on uninstall, the directory junction for a long path
// is removed on its own and the folder it points to is left as it was. Really writing the registry is covered by an install inside Windows Sandbox

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { EXE } from "./harness";

function run(arg: string, temp: string) {
  const started = Date.now();
  const r = spawnSync(EXE, [arg], { env: { ...process.env, SNIPTOSS_SETTINGS: join(temp, "settings.json") }, timeout: 30_000 });
  return { status: r.status, ms: Date.now() - started };
}
const log = (temp: string) =>
  existsSync(join(temp, "logs"))
    ? readdirSync(join(temp, "logs"))
        .map((f) => readFileSync(join(temp, "logs", f), "utf8"))
        .join("\n")
    : "";

test("Uninstall cleanup: only the long-path junction is removed, files stay; a test instance exits 1 with the reason logged", async () => {
  const temp = mkdtempSync(join(tmpdir(), "shell-setup-"));
  try {
    const material = join(temp, "素材");
    mkdirSync(material);
    writeFileSync(join(material, "hero.png"), "not really a png");
    mkdirSync(join(temp, "paths"));
    const link = join(temp, "paths", "a1b2c3");
    expect(spawnSync("cmd", ["/c", "mklink", "/J", link, material], { encoding: "utf8" }).status).toBe(0);
    expect(existsSync(join(link, "hero.png"))).toBe(true);

    const r = run("--uninstall-cleanup", temp);
    expect(r.status).toBe(1);
    expect(r.ms).toBeLessThan(15_000);
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(material, "hero.png"), "utf8")).toBe("not really a png");
    expect(log(temp)).toContain("--uninstall-cleanup did not finish");
    expect(log(temp)).toContain("Test instances don't change the context menu or startup entries");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Adding the context menu at install: a test instance refuses without touching the registry, exits 1, logs why", async () => {
  const temp = mkdtempSync(join(tmpdir(), "shell-setup-"));
  try {
    const r = run("--register-context-menu", temp);
    expect(r.status).toBe(1);
    expect(r.ms).toBeLessThan(15_000);
    expect(log(temp)).toContain("--register-context-menu did not finish");
    expect(existsSync(join(temp, "WebView2"))).toBe(false); // the UI was not started
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

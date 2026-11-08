// The hang watchdog (app/HangWatch.cs) and the hang report (app/HangReport.cs): when the UI thread stops responding for 3 seconds the log says
// whether it is busy or waiting and where it is stuck (read by a second copy of the app), and when it runs again, how long it was stuck.
// The UI thread is stopped through the test hook (debugBlock): asleep, asleep inside a callback from Windows, or busy in a loop

import { expect, test, waitFor, type Shell } from "./harness";

const notResponding = (shell: Shell) => shell.log().filter((l) => l.includes("The UI thread has not responded"));
const responded = (shell: Shell) => shell.log().filter((l) => l.includes("The UI thread responded again after"));

/** The report's lines: the header, then one line per frame, the native modules on the stack and the modules from other vendors */
function report(shell: Shell): string[] {
  const log = shell.log();
  const start = log.findIndex((l) => l.includes("Hang report: where the UI thread"));
  if (start < 0) return [];
  const end = log.findIndex((l, i) => i > start && /^\d{4}-\d\d-\d\d /.test(l));
  return log.slice(start, end < 0 ? undefined : end);
}

test("Stuck inside a callback from Windows: after 3 s the log says it is waiting and where, through native and .NET frames down to Main; then how long it lasted", async ({
  shell,
}) => {
  await shell.launch();
  await shell.callHost("debugBlock", { ms: 6000, how: "native" });
  const [line] = await waitFor("the hang to be logged", () => notResponding(shell).length > 0 && notResponding(shell), 15_000);
  expect(line).toMatch(/has not responded for 3\.\d s \(waiting: 0\.\d s of CPU\); reading where it is stuck/);
  const lines = await waitFor("the hang report", () => report(shell).length > 0 && report(shell), 15_000);
  const frames = lines.filter((l) => /^ {2}#\d\d /.test(l));
  const at = (pattern: RegExp) => frames.findIndex((l) => pattern.test(l));
  // From the top down, in order: the wait in Windows, the .NET method that is waiting, the callback from Windows, the Windows function that called it, the .NET code that called that, the entry point
  const order = [/ntdll!/, /SnipToss\.App\.TestHooks\.Stall\(Int32\)\+0x/, /SnipToss\.App\.TestHooks\.StallInCallback\(IntPtr, IntPtr\)/, /USER32!EnumWindows\+0x/, /System\.Windows\.Threading\.Dispatcher\.ProcessQueue\(\)/, /SnipToss\.App\.Program\.Main\(System\.String\[\]\)/];
  const found = order.map(at);
  expect(found.every((i) => i >= 0), `Frames:\n${frames.join("\n")}`).toBe(true);
  expect(found).toEqual([...found].sort((a, b) => a - b));
  expect(lines.join("\n")).toMatch(/Native modules on the stack: ntdll\.dll \d+\.\d+\.\d+\.\d+/);
  expect(lines.join("\n")).toContain("Modules from other vendors:");
  const [back] = await waitFor("the recovery to be logged", () => responded(shell).length > 0 && responded(shell), 15_000);
  expect(back).toMatch(/responded again after [4-7]\.\d s/);
  // And the app carries on
  expect(await shell.ask("windowState")).toMatchObject({ fullscreen: false });
});

test("Busy in a loop: the log says busy, with the .NET method running at the top", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("debugBlock", { ms: 5000, how: "spin" });
  const [line] = await waitFor("the hang to be logged", () => notResponding(shell).length > 0 && notResponding(shell), 15_000);
  expect(line).toMatch(/has not responded for 3\.\d s \(busy: [1-3]\.\d s of CPU\)/);
  const lines = await waitFor("the hang report", () => report(shell).length > 0 && report(shell), 15_000);
  const frames = lines.filter((l) => /^ {2}#\d\d /.test(l));
  // Only the runtime's own code may sit above the loop
  const spin = frames.findIndex((l) => l.includes("SnipToss.App.TestHooks.Spin(Int32)"));
  expect(spin, `Frames:\n${frames.join("\n")}`).toBeGreaterThanOrEqual(0);
  expect(spin).toBeLessThanOrEqual(3);
  expect(frames.some((l) => l.includes("SnipToss.App.Program.Main"))).toBe(true);
  await waitFor("the recovery to be logged", () => responded(shell).length > 0, 15_000);
});

test("A stall shorter than 3 seconds is not recorded", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("debugBlock", { ms: 1500, how: "sleep" });
  // Long enough for a report to have been written had it counted: 1.5 s stuck + the watchdog's 1 s step + 3 s
  await new Promise((r) => setTimeout(r, 6000));
  expect(await shell.ask("windowState")).toMatchObject({ fullscreen: false });
  expect(notResponding(shell)).toEqual([]);
  expect(report(shell)).toEqual([]);
});

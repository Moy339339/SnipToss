// Long random-operation run (1.0 exit criteria: "2-hour random-operation soak: zero unhandled exceptions, no error-level log entries"
// and "memory does not keep growing over 2 hours of continuous use").
// A real-shell test instance (using the harness in tests/shell: temp settings, a temp project, and at the end a check that the log has no [ERROR]);
// real keyboard and mouse events are sent into the UI over CDP, on a CDP session of the test's own (RawInput), not through Playwright's
// locators: every locator call runs Playwright's injected script in the page, and that left Blink objects behind at about the same rate
// as everything the app does (the same random steps: 0.31 KB of Blink live objects per step driven by locators, 0.17 KB with bare CDP input),
// so the memory check partly measured the test tool. Element positions are read with Runtime.evaluate (values only, no handles).
// It doesn't touch the system clipboard (no copy, no paste), doesn't open system dialogs (no Ctrl+O) and doesn't register global hotkeys
// (the capture hotkey is empty in the harness settings).
// Every few minutes the notes files are reset to the test project's copy (which also tests syncing "notes changed on disk"):
// notes don't pile up, so memory should be flat.
//   $env:SNIPTOSS_SOAK_MINUTES = 120; npm run soak     default 120 minutes; opens a window on screen
// Memory is sampled every SAMPLE_MS (after a forced GC): the UI's JS heap, elements attached to the document, event listeners,
// the live objects in Blink's own heap (from Chromium's memory dump), and the private memory of the whole process tree (shell + WebView2).
// For the live amounts the first third and the last third after warm-up are compared, and growth over GROWTH counts as "keeps growing".
// The process tree's private memory only has a ceiling (TREE_CEILING_MB): Blink's heap keeps the pages freed by garbage collection
// (fragmentation), so the renderer grows while the live objects stay flat, ever more slowly, and levels off (about 60 MB more after a
// thousand saved notes, then flat). A heap snapshot at the end checks that few DOM nodes are detached from the document yet still held by JS.
// Blink's Nodes count is only reported, not asserted: over 2 hours it can grow by 600 while document elements and the JS heap stay flat
// and the heap snapshot has no detached nodes. The extra ones are held inside Blink (e.g. the undo stacks of text inputs, which are capped),
// not leaked by the UI code

import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Page } from "@playwright/test";
import { ROOT, expect, test, type Shell } from "../shell/harness";

const MINUTES = Number(process.env.SNIPTOSS_SOAK_MINUTES ?? 120);
const SAMPLE_MS = Math.min(5, Math.max(1, MINUTES / 24)) * 60_000;
const RESET_MS = 7 * 60_000;
const WARMUP = 0.1;
const GROWTH = 0.25;
const TREE_CEILING_MB = 1500;

interface Sample {
  minute: number;
  heap: number;
  nodes: number;
  /** Elements actually attached to the document (nodes also counts detached ones not yet collected) */
  inDoc: number;
  listeners: number;
  /** Live objects in Blink's own heap (cppgc), MB */
  blinkLive: number;
  /** Memory Blink's heap holds (live objects plus freed pages it keeps), MB */
  blinkHeld: number;
  privateMb: number;
  roles: Roles;
}

/** The process tree split by role: shell (SnipToss.exe), the WebView2 browser process, the UI (renderer) process, the GPU process, and the rest (utility, crash reporter) */
const ROLES = ["shell", "browser", "renderer", "gpu", "other"] as const;
type Roles = Record<(typeof ROLES)[number], number>;

/** Private memory of the app's whole process tree (SnipToss.exe and its msedgewebview2 children), in MB: the total and per role (to see which process grows) */
function treeMemory(pid: number): { total: number; roles: Roles } {
  const script = `
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, PrivatePageCount, CommandLine
    $ids = [Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid})
    do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n)
    $roles = [ordered]@{ shell = 0; browser = 0; renderer = 0; gpu = 0; other = 0 }
    foreach ($p in $all | Where-Object { $ids.Contains([int]$_.ProcessId) }) {
      $role = if ([int]$p.ProcessId -eq ${pid}) { 'shell' } elseif ($p.CommandLine -notmatch '--type=') { 'browser' } elseif ($p.CommandLine -match '--type=renderer') { 'renderer' } elseif ($p.CommandLine -match '--type=gpu-process') { 'gpu' } else { 'other' }
      $roles[$role] += [double]$p.PrivatePageCount
    }
    foreach ($k in @($roles.Keys)) { $roles[$k] = [math]::Round($roles[$k] / 1MB) }
    $roles | ConvertTo-Json -Compress`;
  const roles = JSON.parse(spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" }).stdout.trim()) as Roles;
  return { total: ROLES.reduce((s, r) => s + roles[r], 0), roles };
}

/**
 * Resets the notes to the test project's copy: delete annotations, then copy. If we only copied, notes written at random on other files
 * (poster.jpg has no notes file in the test project) would stay, and the cards in the notes panel would pile up: over 2 hours the DOM node count
 * can grow from about a thousand to over three thousand (by element type, the extra ones are all cards). That is not a leak
 */
function resetNotes(shell: Shell, fixture: string) {
  const dir = join(shell.project, ".sniptoss", "annotations");
  rmSync(dir, { recursive: true, force: true });
  cpSync(fixture, dir, { recursive: true, force: true });
}
/**
 * Before measuring, get back to the same state: close overlays, reset the notes to the test project's copy, select hero.png and wait for the
 * externally changed notes to be read back. Otherwise the node count reflects "what happens to be open right now", not a leak
 */
async function settle(shell: Shell, input: RawInput, fixture: string) {
  for (let i = 0; i < 3; i++) await input.press("Escape").catch(() => {});
  resetNotes(shell, fixture);
  await input.click(`[...document.querySelectorAll(".lib-row")].find((e) => e.textContent.includes("hero.png"))`);
  await shell.page.waitForTimeout(3000);
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
type Modifier = keyof typeof MODIFIER_BITS;
const isModifier = (k: string): k is Modifier => k in MODIFIER_BITS;
/** Virtual key code, code and text of the keys the soak presses (US layout, described the way Playwright's keyboard sends them) */
const KEYS: Record<string, [number, string, string?]> = {
  Escape: [27, "Escape"],
  Enter: [13, "Enter", "\r"],
  F5: [116, "F5"],
  F10: [121, "F10"],
  Home: [36, "Home"],
  ArrowDown: [40, "ArrowDown"],
  ArrowUp: [38, "ArrowUp"],
  ArrowLeft: [37, "ArrowLeft"],
  ArrowRight: [39, "ArrowRight"],
  Control: [17, "ControlLeft"],
  Shift: [16, "ShiftLeft"],
  " ": [32, "Space", " "],
  "]": [221, "BracketRight", "]"],
  "[": [219, "BracketLeft", "["],
  ",": [188, "Comma", ","],
  ".": [190, "Period", "."],
  "=": [187, "Equal", "="],
  "-": [189, "Minus", "-"],
  "?": [191, "Slash", "?"],
};
for (let d = 0; d <= 9; d++) KEYS[String(d)] = [48 + d, `Digit${d}`, String(d)];
for (let c = 0; c < 26; c++) {
  const ch = String.fromCharCode(97 + c);
  KEYS[ch] = [65 + c, `Key${ch.toUpperCase()}`, ch];
}
/** What a key types with Shift held (letters become upper case) */
const SHIFTED: Record<string, string> = { "1": "!", "2": "@", "0": ")", "=": "+", "-": "_", ",": "<", ".": ">", "[": "{", "]": "}" };

/** Keyboard and mouse over a CDP session of the soak's own: Input.dispatchKeyEvent / dispatchMouseEvent / insertText, nothing injected */
class RawInput {
  private held = new Set<Modifier>();
  private x = 0;
  private y = 0;
  private buttons = 0;
  private constructor(private cdp: CDPSession) {}

  static async attach(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    // The window may be in the background while the soak runs: the page should still behave as focused
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    return new RawInput(cdp);
  }

  private get modifiers() {
    let m = 0;
    for (const k of this.held) m |= MODIFIER_BITS[k];
    return m;
  }

  private async down(k: string) {
    const [code, name, plain] = KEYS[k];
    let key = k;
    let text = plain;
    if (isModifier(k)) this.held.add(k);
    if (text && this.held.has("Shift")) key = text = SHIFTED[k] ?? k.toUpperCase();
    // With any modifier other than Shift held, a key types nothing
    if (this.held.size > 1 || (this.held.size === 1 && !this.held.has("Shift"))) text = isModifier(k) ? undefined : "";
    const location = isModifier(k) ? 1 : 0;
    await this.cdp.send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      modifiers: this.modifiers,
      windowsVirtualKeyCode: code,
      code: name,
      key,
      text,
      unmodifiedText: text,
      location,
    });
    return { code, name, key, location };
  }

  private async up(k: string, d: { code: number; name: string; key: string; location: number }) {
    if (isModifier(k)) this.held.delete(k);
    await this.cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers: this.modifiers,
      windowsVirtualKeyCode: d.code,
      code: d.name,
      key: d.key,
      location: d.location,
    });
  }

  /** A key or a combination such as "Control+Shift+z" */
  async press(combo: string, delay = 0) {
    const pressed = [];
    for (const k of combo.split("+")) pressed.push({ k, d: await this.down(k) });
    if (delay) await new Promise((r) => setTimeout(r, delay));
    for (const { k, d } of pressed.reverse()) await this.up(k, d);
  }

  /** Types text key by key; characters that aren't on the keyboard (Chinese) are inserted as text, as Playwright's keyboard.type does */
  async type(text: string, delay = 0) {
    for (const ch of text) {
      if (KEYS[ch]) await this.press(ch, delay);
      else if (/[A-Z]/.test(ch)) await this.press(`Shift+${ch.toLowerCase()}`, delay);
      else await this.cdp.send("Input.insertText", { text: ch });
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
  }

  async move(x: number, y: number, steps = 1) {
    const [fx, fy] = [this.x, this.y];
    for (let i = 1; i <= steps; i++) {
      this.x = fx + ((x - fx) * i) / steps;
      this.y = fy + ((y - fy) * i) / steps;
      const button = this.buttons ? "left" : "none";
      await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: this.x, y: this.y, button, buttons: this.buttons, modifiers: this.modifiers });
    }
  }

  async mouse(type: "mousePressed" | "mouseReleased") {
    this.buttons = type === "mousePressed" ? 1 : 0;
    await this.cdp.send("Input.dispatchMouseEvent", { type, x: this.x, y: this.y, button: "left", buttons: this.buttons, clickCount: 1, modifiers: this.modifiers });
  }

  /** The rectangle of the element the expression returns (scrolled into view first), or null when it is missing or has no size */
  async rect(element: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const r = await this.cdp.send("Runtime.evaluate", {
      expression: `(() => { const e = ${element}; if (!e) return null; e.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value as { x: number; y: number; width: number; height: number } | null;
  }

  async count(selector: string) {
    const r = await this.cdp.send("Runtime.evaluate", { expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`, returnByValue: true });
    return r.result.value as number;
  }

  /**
   * Clicks the element the expression returns: its center, or (dx, dy) from its top left corner. Waits up to 8 seconds for it to show up,
   * as a locator click does (right after launch the library is not drawn yet)
   */
  async click(element: string, dx?: number, dy?: number) {
    let r = await this.rect(element);
    for (const until = Date.now() + 8000; !r && Date.now() < until; r = await this.rect(element)) await new Promise((w) => setTimeout(w, 100));
    if (!r) throw new Error(`not on screen: ${element}`);
    await this.move(r.x + (dx ?? r.width / 2), r.y + (dy ?? r.height / 2));
    await this.mouse("mousePressed");
    await this.mouse("mouseReleased");
  }
}

/** Blink's own heap in the UI process, from a Chromium memory dump (memory-infra): live objects and what the heap holds, in MB */
async function blinkHeap(page: Page): Promise<{ live: number; held: number }> {
  const cdp = await page.context().browser()!.newBrowserCDPSession();
  try {
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      traceConfig: { includedCategories: ["disabled-by-default-memory-infra"], excludedCategories: ["*"], memoryDumpConfig: { triggers: [] } as unknown as Record<string, string> },
    });
    await cdp.send("Tracing.requestMemoryDump", { deterministic: true, levelOfDetail: "detailed" });
    const complete = new Promise<{ stream?: string }>((resolve) => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.end");
    const { stream } = await complete;
    const parts: string[] = [];
    for (;;) {
      const r = await cdp.send("IO.read", { handle: stream!, size: 1 << 20 });
      parts.push(r.base64Encoded ? Buffer.from(r.data, "base64").toString("utf8") : r.data);
      if (r.eof) break;
    }
    await cdp.send("IO.close", { handle: stream! });
    type Dump = { attrs?: { size?: { value: string } } };
    type Event = { ph: string; pid: number; name?: string; args?: { name?: string; dumps?: { allocators?: Record<string, Dump> } } };
    const parsed = JSON.parse(parts.join("")) as Event[] | { traceEvents: Event[] };
    const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
    const renderers = new Set(events.filter((e) => e.ph === "M" && e.name === "process_name" && /renderer/i.test(e.args?.name ?? "")).map((e) => e.pid));
    const mb = (d?: Dump) => (d?.attrs?.size ? parseInt(d.attrs.size.value, 16) / 1048576 : 0);
    let live = 0;
    let held = 0;
    for (const e of events) {
      const a = e.ph === "v" && renderers.has(e.pid) ? e.args?.dumps?.allocators : undefined;
      if (!a?.blink_gc) continue;
      live += mb(a["blink_gc/main/allocated_objects"]);
      held += mb(a.blink_gc);
    }
    return { live: Math.round(live * 10) / 10, held: Math.round(held) };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function sample(shell: Shell, started: number): Promise<Sample> {
  const cdp = await shell.page.context().newCDPSession(shell.page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  await cdp.detach();
  const m = (name: string) => metrics.find((x) => x.name === name)?.value ?? 0;
  const memory = treeMemory(shell.proc!.pid!);
  const blink = await blinkHeap(shell.page);
  return {
    minute: Math.round((Date.now() - started) / 60_000),
    heap: Math.round(m("JSHeapUsedSize") / 1024 / 1024),
    nodes: m("Nodes"),
    inDoc: await shell.page.evaluate(() => document.getElementsByTagName("*").length),
    listeners: m("JSEventListeners"),
    blinkLive: blink.live,
    blinkHeld: blink.held,
    privateMb: memory.total,
    roles: memory.roles,
  };
}

/** How many DOM nodes in the heap snapshot are detached from the document (detachedness = 2) yet still held by JS */
async function detachedNodes(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const chunks: string[] = [];
  cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => chunks.push(chunk));
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  await cdp.detach();
  const snap = JSON.parse(chunks.join("")) as { snapshot: { meta: { node_fields: string[] } }; nodes: number[] };
  const fields = snap.snapshot.meta.node_fields;
  const at = fields.indexOf("detachedness");
  if (at < 0) return 0; // snapshots from older versions don't have this field
  let n = 0;
  for (let i = 0; i < snap.nodes.length; i += fields.length) if (snap.nodes[i + at] === 2) n++;
  return n;
}
const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const pause = (page: Page, min = 40, max = 400) => page.waitForTimeout(min + Math.random() * (max - min));

/** One random step: all things users often do; the higher the weight, the more often it runs */
function actions(page: Page, input: RawInput): [number, () => Promise<void>][] {
  const key = (k: string) => () => input.press(k);
  const focusStage = () => input.click(`document.querySelector(".stage")`, 4, 4);
  const draw = async () => {
    await focusStage();
    await input.press(pick(["r", "a", "b"]));
    const box = await input.rect(`document.querySelector(".annot-input")`);
    if (!box) return;
    const x = box.x + box.width * (0.1 + Math.random() * 0.5);
    const y = box.y + box.height * (0.1 + Math.random() * 0.5);
    await input.move(x, y);
    await input.mouse("mousePressed");
    await input.move(x + box.width * 0.2, y + box.height * 0.15, 6);
    await input.mouse("mouseReleased");
    if (await input.rect(`document.querySelector(".composer-text")`)) {
      await input.type(`soak ${Date.now() % 100000}`, 10);
      await input.press(pick(["Enter", "Enter", "Escape"]));
    }
  };
  const settings = async () => {
    await input.press("Escape");
    await input.press("Control+,");
    for (let i = 0; i < 3; i++) {
      const n = Math.floor(Math.random() * (await input.count(".settings-tab")));
      await input.click(`document.querySelectorAll(".settings-tab")[${n}]`);
      await pause(page);
    }
    await input.press("Escape");
  };
  const menu = async () => {
    await input.press("F10");
    for (let i = 0; i < 4; i++) await input.press(pick(["ArrowRight", "ArrowLeft", "ArrowDown"]));
    await input.press("Escape");
    await input.press("Escape");
  };
  const search = async () => {
    await input.press("Control+f");
    await input.type(pick(["标题", "soak", "x"]), 20);
    await pause(page);
    await input.press("Escape");
    await input.press("Escape");
  };
  return [
    [6, key("Control+ArrowDown")],
    [4, key("Control+ArrowUp")],
    [4, key("]")],
    [3, key("[")],
    [5, draw],
    [3, key("Control+z")],
    [2, key("Control+Shift+z")],
    [2, async () => (await focusStage(), input.press(pick(["d", "Shift+d"])))],
    [2, async () => (await focusStage(), input.press(pick([" ", "k", "j", "l", ",", ".", "ArrowRight", "Home"])))],
    [1, async () => (await focusStage(), input.press(pick(["Control+=", "Control+-", "Shift+1", "Shift+2", "Shift+0"])))],
    [1, async () => (await input.press("?"), await pause(page), input.press("Escape"))],
    [1, settings],
    [1, menu],
    [1, search],
    [1, key("F5")],
  ];
}

test.setTimeout((MINUTES + 15) * 60_000);

/**
 * Where the window opens, as physical pixels "x,y,width,height" (SNIPTOSS_SOAK_PLACEMENT), so a long run can sit on a spare screen
 * while the computer is in use; without it the default layout applies (centered on the screen under the mouse)
 */
const PLACEMENT = process.env.SNIPTOSS_SOAK_PLACEMENT?.split(",").map(Number);

test(`Random operations for ${MINUTES} minutes: no log errors, no UI crash, memory doesn't keep growing`, async ({ shell }) => {
  if (PLACEMENT) {
    const file = join(shell.temp, "settings.json");
    const [Left, Top, Width, Height] = PLACEMENT;
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), Placement: { Left, Top, Width, Height, Maximized: false } }, null, 2));
  }
  await shell.launch();
  const page = shell.page;
  const uncaught: string[] = [];
  page.on("pageerror", (e) => uncaught.push(e.message));
  const fixture = join(ROOT, "tests", "e2e", "fixtures", "project", ".sniptoss", "annotations");
  const input = await RawInput.attach(page);
  const table = actions(page, input);
  const total = table.reduce((s, [w]) => s + w, 0);
  const roll = () => {
    let r = Math.random() * total;
    for (const [w, act] of table) if ((r -= w) < 0) return act;
    return table[0][1];
  };

  const started = Date.now();
  const end = started + MINUTES * 60_000;
  await settle(shell, input, fixture);
  const samples: Sample[] = [await sample(shell, started)];
  let nextSample = started + SAMPLE_MS;
  let nextReset = started + RESET_MS;
  let steps = 0;
  const failures: string[] = [];
  while (Date.now() < end) {
    try {
      await roll()();
    } catch (e) {
      // A step that didn't go through (the element happened to be missing or covered by an overlay) is not a problem; note it.
      // Real errors show up in the log and pageerror
      failures.push((e as Error).message.split("\n")[0]);
      await input.press("Escape").catch(() => {});
    }
    steps++;
    await pause(page);
    if (Date.now() >= nextReset) {
      // Reset the notes files to the test project's copy: the notes changed on disk, so the UI reads them again
      resetNotes(shell, fixture);
      nextReset += RESET_MS;
    }
    if (Date.now() >= nextSample) {
      await settle(shell, input, fixture);
      samples.push(await sample(shell, started));
      nextSample += SAMPLE_MS;
    }
    expect(shell.alive(), "the app exited").toBe(true);
  }
  await settle(shell, input, fixture);
  samples.push(await sample(shell, started));

  const report = [
    `Random operations for ${MINUTES} minutes, ${steps} steps, ${failures.length} steps didn't go through (most common: ${[...new Set(failures)].slice(0, 3).join(" | ") || "none"})`,
    "min  JS heap MB  DOM nodes  in doc  listeners  Blink live / held MB  tree private MB  (shell / browser / renderer / GPU / other)",
    ...samples.map(
      (s) =>
        `${String(s.minute).padStart(4)}  ${String(s.heap).padStart(8)}  ${String(s.nodes).padStart(8)}  ${String(s.inDoc).padStart(6)}  ${String(s.listeners).padStart(5)}  ${`${s.blinkLive} / ${s.blinkHeld}`.padStart(14)}  ${String(s.privateMb).padStart(10)}` +
        `  (${ROLES.map((r) => s.roles[r]).join(" / ")})`,
    ),
  ];
  writeFileSync(test.info().outputPath("soak-report.txt"), report.join("\n") + "\n");
  console.log(report.join("\n"));

  expect(uncaught, `Uncaught errors in the UI:\n${uncaught.join("\n")}`).toEqual([]);
  // DOM detached from the document but still held (closed dialogs, replaced cards kept alive by a closure): one left over,
  // such as the last note box, is normal; dozens mean a leak
  const kept = await detachedNodes(page);
  expect(kept, `${kept} DOM nodes detached from the document but still held`).toBeLessThan(100);
  const after = samples.filter((s) => s.minute >= MINUTES * WARMUP);
  const third = Math.max(1, Math.floor(after.length / 3));
  const mean = (list: Sample[], k: "heap" | "inDoc" | "listeners" | "blinkLive") => list.reduce((s, x) => s + x[k], 0) / list.length;
  for (const k of ["heap", "inDoc", "listeners", "blinkLive"] as const) {
    const head = mean(after.slice(0, third), k);
    const tail = mean(after.slice(-third), k);
    expect(tail, `${k} grew from ${head.toFixed(1)} to ${tail.toFixed(1)}`).toBeLessThanOrEqual(head * (1 + GROWTH) + 2);
  }
  const peak = Math.max(...samples.map((s) => s.privateMb));
  expect(peak, `the process tree reached ${peak} MB of private memory`).toBeLessThanOrEqual(TREE_CEILING_MB);
});

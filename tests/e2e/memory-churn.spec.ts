// Whether memory only grows when the UI receives thousands of "changed on disk" events (an agent writing notes back continuously).
// Why: if a write run stalls or an agent keeps writing back for a long time, the browser process hosting the UI might accumulate memory,
// which needs measuring on its own.
// How: open hero.png and have the mock host push annotationsChanged again and again (the number of notes, ids, text, positions and statuses change each time,
// and the file is written to disk as well); after each batch force a garbage collection and record the JS heap, DOM nodes, event listeners and the browser process's private memory;
// finally push the original content back, idle for a while and measure again: it should return to near the starting point.
//
// Not run by default (two or three minutes): run npm run build first, then
//   $env:SNIPTOSS_MEMORY_CHURN = '1'; npx playwright test tests/e2e/memory-churn.spec.ts --workers=1
// The count defaults to 3000 (change it with SNIPTOSS_MEMORY_CHURN_EVENTS); each batch's numbers are printed and also written to tests/e2e/.results/memory-churn.json

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test } from "./harness";

const EVENTS = Number(process.env.SNIPTOSS_MEMORY_CHURN_EVENTS) || 3000;
const SAMPLE_EVERY = 250;
const HERO = "assets__hero.png.json";

type Sample = { at: string; events: number; heapMB: number; nodes: number; listeners: number; documents: number; browserMB: number | null };

/** Private memory of all processes of the Edge that Playwright started (Windows leak checks look at process memory, not just the JS heap); null if it can't be measured */
function browserPrivateMB(): number | null {
  try {
    const out = execFileSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object CommandLine -like '*playwright_chromiumdev_profile*' | Measure-Object PrivatePageCount -Sum).Sum",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const bytes = Number(out.trim());
    return bytes > 0 ? Math.round(bytes / 2 ** 20) : null;
  } catch {
    return null;
  }
}

test.skip(process.env.SNIPTOSS_MEMORY_CHURN !== "1", "not run by default: set SNIPTOSS_MEMORY_CHURN=1");

test("thousands of consecutive on-disk note changes: memory does not just keep growing", async ({ app }) => {
  test.setTimeout(30 * 60_000);
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page.locator(".card").first()).toBeVisible();

  // Keep the mock host's polling from pushing again (this test writes the file and pushes itself, waiting for the UI to paint a frame before the next push)
  const host = app.host as unknown as { muted: boolean; observe(): number; readAnnotations(home: string): unknown };
  host.muted = true;
  const home = app.project;
  const file = join(app.project, ".sniptoss", "annotations", HERO);
  const original = readFileSync(file, "utf8");
  const base = JSON.parse(original) as Record<string, unknown>;
  const categories = ["change", "remove", "add", "question"];
  /** What the file looks like after the i-th change: 1–25 notes, ids rotating among 60 (some new, some old), with varying text length, position, status and replies */
  const variant = (i: number) => {
    const annotations = Array.from({ length: 1 + (i % 25) }, (_, j) => ({
      id: `c${(i + j) % 60}x${j}`,
      status: (i + j) % 3 === 0 ? "resolved" : "open",
      category: categories[(i + j) % 4],
      body: `第 ${i} 次外面改了：第 ${j + 1} 条，${"字".repeat((i * 7 + j * 13) % 120)}`,
      anchor: { shape: { type: "rect", x: ((i * 3 + j * 17) % 80) / 100, y: ((i * 5 + j * 11) % 80) / 100, w: 0.1, h: 0.08 } },
      author: "user",
      created_at: "2026-10-27T02:00:00Z",
      updated_at: new Date(Date.UTC(2026, 9, 27, 3, 0, 0, i)).toISOString(),
      replies: i % 4 === 0 ? [{ author: "codex", body: `回复 ${i}`, at: "2026-10-27T03:00:00Z" }] : [],
    }));
    return `${JSON.stringify({ ...base, annotations }, null, 2)}\n`;
  };
  const push = async (text: string) => {
    writeFileSync(file, text);
    const payload = { event: "annotationsChanged", home, seq: host.observe(), annotations: host.readAnnotations(home) };
    await app.page.evaluate(async (p) => {
      (window as unknown as { __e2eEmit: (x: unknown) => void }).__e2eEmit(p);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, payload);
  };

  const cdp = await app.page.context().newCDPSession(app.page);
  const samples: Sample[] = [];
  const sample = async (at: string, events: number) => {
    for (let k = 0; k < 3; k++) await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    const dom = await cdp.send("Memory.getDOMCounters");
    const s = {
      at,
      events,
      heapMB: Math.round((heap.usedSize / 2 ** 20) * 100) / 100,
      nodes: dom.nodes,
      listeners: dom.jsEventListeners,
      documents: dom.documents,
      browserMB: browserPrivateMB(),
    };
    samples.push(s);
    console.log(`${at.padEnd(10)} ${String(events).padStart(5)} events  JS heap ${s.heapMB} MB  DOM nodes ${s.nodes}  listeners ${s.listeners}  documents ${s.documents}  browser processes ${s.browserMB ?? "?"} MB`);
  };

  await app.page.waitForTimeout(2000);
  await sample("开头", 0);
  const started = Date.now();
  for (let i = 1; i <= EVENTS; i++) {
    await push(variant(i));
    if (i % SAMPLE_EVERY === 0) await sample("推送中", i);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  // Push the original content back (the same two notes as at the start), idle for a while, then measure again
  await push(original);
  await expect(app.page.locator(".card")).toHaveCount(await app.page.locator(".card").count());
  await app.page.waitForTimeout(5000);
  await sample("推回原样", EVENTS);
  await app.page.waitForTimeout(20_000);
  await sample("空闲 20 秒", EVENTS);
  console.log(`Pushed ${EVENTS} events in ${seconds} s`);

  const out = join(ROOT, "tests", "e2e", ".results");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "memory-churn.json"), JSON.stringify({ events: EVENTS, seconds, samples }, null, 2));

  // The pushing phase levels off: over the last two thirds the JS heap grows by less than 1 MB (a real leak adds a little with every push). Normally it stays at 7.7–7.8 MB after 750 events
  const churn = samples.filter((s) => s.at === "推送中");
  if (churn.length >= 3) expect(churn.at(-1)!.heapMB - churn[Math.floor(churn.length / 3)].heapMB, "JS heap kept growing while pushing").toBeLessThan(1);
  // Back to near the start: the JS heap is less than 5 MB higher, and DOM nodes and event listeners did not pile up
  const first = samples[0];
  const last = samples.at(-1)!;
  expect(last.heapMB, "JS heap did not come back down").toBeLessThan(first.heapMB + 5);
  expect(last.nodes, "DOM nodes piled up").toBeLessThan(first.nodes * 1.1 + 50);
  expect(last.listeners, "event listeners piled up").toBeLessThan(first.listeners + 30);
});

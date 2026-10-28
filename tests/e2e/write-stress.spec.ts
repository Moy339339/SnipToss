// Write concurrency stress test (docs/adr/0005-write-protocol.md item 6; a 1.0 acceptance criterion: thousands of interleaved writes lose no change):
// the real UI (annotationStore's queued writes, three-way merge, sync of on-disk changes, undo) and several agents (real sniptoss resolve / wontfix command-line processes)
// modify the same notes file at the same time. The UI randomly adds, edits, deletes and undoes; the agents randomly mark notes done / won't fix, sometimes with a reply.
// So that every note can be verified at the end, the work is split: only agents change status, and each note belongs to one agent (by id); only the UI changes the note text.
// The UI editing text while an agent changes status and adds a reply on the same note is common, and both sides must survive.
// Final checks: every note left in the UI has the text of its last edit and deleted ones are gone; every successful agent reply is present and the status is the one the agent set last;
// the file parsed as valid JSON throughout; no locks or temp files remain.
//
// npm run e2e runs a small round (a dozen steps, so that a breakage of this suite doesn't go unnoticed); npm run stress runs the full round (300 UI steps + 2400 or more agent runs, a few minutes)

import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test } from "./harness";
import { textSha256 } from "./mock-host";

const FULL = process.env.SNIPTOSS_STRESS === "1";
const UI_OPS = FULL ? 300 : 12;
const AGENTS = FULL ? 4 : 2;
const AGENT_OPS = FULL ? 2400 : 40;
/** Same as HISTORY_LIMIT in annotationStore.ts: undo remembers at most this many steps */
const HISTORY_LIMIT = 200;
const HERO = "assets__hero.png.json";
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");

type Note = { id: string; status: string; body: string; replies: { author: string; body: string }[] };

/** A replayable random number generator (on failure, rerun the same sequence of UI actions with the seed from the log) */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which agent changes the status of this note */
const owner = (id: string) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % AGENTS;

function runCli(args: string[]): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { windowsHide: true }, (error, _out, err) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, err: String(err) }),
    );
  });
}

test("the UI and several agents modify the same notes file at the same time: no change is lost and the file is always readable", async ({ app }) => {
  test.setTimeout(FULL ? 15 * 60_000 : 90_000);
  const seed = Number(process.env.SNIPTOSS_STRESS_SEED) || Date.now() % 1_000_000;
  console.log(`Write stress test: seed ${seed} (replay with SNIPTOSS_STRESS_SEED=${seed}), ${UI_OPS} UI steps, ${AGENTS} agents with ${AGENT_OPS} or more runs in total`);
  const rand = prng(seed);
  const file = join(app.project, ".sniptoss", "annotations", HERO);
  const dir = join(app.project, ".sniptoss", "annotations");

  // Resolved notes are listed in the notes panel too (the UI must be able to find a note an agent has marked in order to edit or delete it)
  app.host.prefs = { panelResolved: true };
  app.host.expanded = [join(app.project, "assets"), join(app.project, "video")];
  await app.open();
  await app.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(app.page.locator(".zoom-media")).toBeVisible();
  // At most 15 seconds per step: fail early when stuck (the error report prints where that note is and what it looks like) instead of waiting out the whole test's time limit
  app.page.setDefaultTimeout(15_000);

  // SNIPTOSS_STRESS_TRACE=1: records every write the UI makes to disk (what was written, the fingerprint it was based on, whether it succeeded, and what was on disk when it was rejected) and every "changed on disk" notification,
  // so that when an agent's reply is lost, you can find which write dropped it and what the UI believed was on disk at the time (for investigations only, off normally: it records tens of MB)
  type Trace = { kind: "write"; expect: string | null; text: string; written: boolean; current: string | null } | { kind: "notify"; text: string } | { kind: "step"; text: string };
  const trace: Trace[] = [];
  if (process.env.SNIPTOSS_STRESS_TRACE) {
    const handle = app.host.handle.bind(app.host);
    app.host.handle = async (msg) => {
      const r = (await handle(msg)) as { result?: { written?: boolean; current?: string | null } };
      const p = msg.params as { path?: string; text?: string; expectSha256?: string | null };
      if (msg.method === "writeAnnotation" && p.path?.endsWith(HERO))
        trace.push({ kind: "write", expect: p.expectSha256 ?? null, text: p.text!, written: !!r.result?.written, current: r.result?.current ?? null });
      return r;
    };
    const opts = (app.host as unknown as { opts: { emit: (p: object) => Promise<void> } }).opts;
    const emit = opts.emit;
    opts.emit = (payload) => {
      const q = payload as { event: string; annotations?: { name: string; text: string }[] };
      const hero = q.event === "annotationsChanged" ? q.annotations?.find((a) => a.name === HERO) : undefined;
      if (hero) trace.push({ kind: "notify", text: hero.text });
      return emit(payload);
    };
  }
  /** Whether that reply is in this version of the file (text is null when there is no such version) */
  const replyIn = (text: string | null, id: string, body: string) => {
    if (text === null) return "none";
    const a = (JSON.parse(text) as { annotations: (Note & { updated_at: string })[] }).annotations.find((x) => x.id === id);
    if (!a) return "no such note";
    const tail = a.replies.slice(-2).map((x) => x.body).join(",");
    return `${a.replies.some((x) => x.body === body) ? "has it" : "missing"} (${a.status} ${a.updated_at.slice(17, 23)}, ${a.replies.length} replies, last ${tail})`;
  };
  /** atEnd: not looking for a reply, only showing the most recent entries (when a UI step fails) */
  const explain = (id: string, body: string, atEnd = false) => {
    const bySha = new Map<string, string>();
    for (const t of trace) {
      if (t.kind === "step") continue;
      bySha.set(textSha256(t.text)!, t.text);
      if (t.kind === "write" && t.current) bySha.set(textSha256(t.current)!, t.current);
    }
    const lines = trace.map((t, i) =>
      t.kind === "step"
        ? `${i} —— UI ${t.text}`
        : t.kind === "notify"
        ? `${i} notified: ${replyIn(t.text, id, body)}`
        : `${i} write ${t.written ? "done" : "rejected"}: wrote ${replyIn(t.text, id, body)}; based on ${t.expect ? replyIn(bySha.get(t.expect) ?? null, id, body) : "(new file)"}` +
          (t.current ? `; on disk when rejected ${replyIn(t.current, id, body)}` : ""),
    );
    // Around the last version in which the reply still exists: the write that dropped it comes right after
    if (atEnd) return lines.slice(-40).join(String.fromCharCode(10));
    const last = lines.findLastIndex((l) => /wrote has it|notified: has it/.test(l));
    return lines.slice(Math.max(0, last - 24), last + 12).join("\n");
  };

  // Reads continuously: replacing the file is atomic, so what is read at any moment must be complete JSON.
  // Once every 20 ms (the shell checks once a second): any denser and the file is open almost all the time, Windows refuses to replace it, and what gets measured is a reader that is too dense, not a bug in writing
  let reads = 0;
  const torn: string[] = [];
  const readNotes = (): Note[] | undefined => {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      torn.push(`unreadable: ${(e as Error).message}`);
      return undefined;
    }
    reads++;
    try {
      return (JSON.parse(text) as { annotations: Note[] }).annotations;
    } catch (e) {
      torn.push(`not complete JSON: ${(e as Error).message}`);
      return undefined;
    }
  };
  const reader = setInterval(readNotes, 20);

  // Agent: picks a note that belongs to it and really runs sniptoss resolve / wontfix once (a command-line process that takes the same lock)
  type Done = { id: string; status: string; body?: string };
  const done: Done[][] = Array.from({ length: AGENTS }, () => []);
  const failures: string[] = [];
  let missing = 0;
  const run = { stop: false }; // Set when the test ends (or fails); an agent stops after finishing the run in hand
  const agent = async (i: number) => {
    const pick = prng(seed + i + 1); // Each uses its own random numbers: the UI's sequence of actions can be replayed from the seed
    for (let k = 0; !run.stop; k++) {
      const mine = (readNotes() ?? []).filter((a) => owner(a.id) === i);
      if (!mine.length) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      const id = mine[Math.floor(pick() * mine.length)].id;
      const command = pick() < 0.5 ? "resolve" : "wontfix";
      // One run in four attaches a reply (replies pile up on the card, and attaching one every time would make the UI heavier and heavier; real agents wouldn't do that either)
      const body = pick() < 0.25 ? `a${i}-${k}` : undefined;
      const r = await runCli([command, id, ...(body ? ["-m", body] : []), "--author", `agent${i}`, "--root", app.project]);
      if (r.code === 0) done[i].push({ id, status: command === "resolve" ? "resolved" : "wontfix", body });
      else if (r.code === 1 && r.err.includes(`Note ${id} not found`)) missing++; // The UI just deleted this note
      else failures.push(`agent${i} ${command} ${id}: exit code ${r.code}, ${r.err.trim()}`);
    }
  };
  const agents = Array.from({ length: AGENTS }, (_, i) => agent(i));

  // UI: acts like a real person (click the canvas to drop a pin and write text, double-click a card to edit, Delete to remove, Ctrl+Z to undo)
  type Mine = { id: string; text: string; alive: boolean; deleted: boolean };
  const notes: Mine[] = [];
  type Step = { kind: "create"; n: number } | { kind: "edit"; n: number; prev: string } | { kind: "delete"; n: number };
  const undo: Step[] = [];
  const page = app.page;
  const card = (id: string) => page.locator(`[data-annot$="|${id}"]`);
  const focusStage = () => page.locator(".stage").click({ position: { x: 5, y: 5 } });
  const remember = (s: Step) => {
    undo.push(s);
    if (undo.length > HISTORY_LIMIT) undo.shift();
  };
  const write = async (text: string) => {
    await page.locator(".composer-text").fill(text);
    await page.locator(".composer-text").press("Enter");
    await expect(page.locator(".composer")).toHaveCount(0);
  };
  const exactly = (text: string) => new RegExp(`^\\s*${text}\\s*$`);
  // When an agent writes back, the notes panel re-lays out (cards gain replies or change status), and if the card moves at the moment of the click the neighboring card is hit: verify after clicking and retry if it is wrong
  const select = async (m: Mine) => {
    for (let i = 0; i < 5; i++) {
      await card(m.id).locator(".card-body").click();
      if (await card(m.id).evaluate((el) => el.classList.contains("is-selected"))) return;
    }
    throw new Error(`could not hit the card of ${m.id}`);
  };
  const openEditor = async (m: Mine, text: string) => {
    for (let i = 0; i < 5; i++) {
      await card(m.id).locator(".card-body").dblclick();
      await expect(page.locator(".composer")).toBeVisible();
      if ((await page.locator(".composer-text").inputValue()) === text) return;
      await page.keyboard.press("Escape");
      await expect(page.locator(".composer")).toHaveCount(0);
    }
    throw new Error(`could not open the note box of ${m.id}`);
  };
  const counts = { create: 0, edit: 0, delete: 0, undo: 0 };
  // Pins land in the middle of a grid cell, once per cell: clicking an existing mark selects that note instead of opening the note box (the rectangles already in the test item are avoided too)
  const COLS = 16;
  type Box = { x: number; y: number; w: number; h: number };
  const taken = (JSON.parse(readFileSync(file, "utf8")) as { annotations: { anchor: { shape?: Box; shapes?: Box[] } }[] }).annotations
    .flatMap((a) => a.anchor.shapes ?? (a.anchor.shape ? [a.anchor.shape] : []))
    .filter((b) => b.w !== undefined);
  const free = (cell: number) => {
    const [x, y] = [((cell % COLS) + 0.5) / COLS, (Math.floor(cell / COLS) + 0.5) / 12];
    return !taken.some((b) => x > b.x - 0.05 && x < b.x + b.w + 0.05 && y > b.y - 0.05 && y < b.y + b.h + 0.05);
  };
  const cells = [...Array(COLS * 12).keys()].filter(free).sort(() => rand() - 0.5);
  /** Which note this step touches (its state is reported on failure); and every step taken (the latest few are reported on failure) */
  let focus: Mine | undefined;
  const trail: string[] = [];

  const doStep = async (kind: keyof typeof counts) => {
    const alive = notes.filter((m) => m.alive);
    if (kind === "create") {
      const n = notes.length;
      const text = `ui-${n} v0`;
      const cell = cells.pop()!;
      await focusStage();
      const box = (await page.locator(".zoom-media").boundingBox())!;
      await page.mouse.click(box.x + (box.width * ((cell % COLS) + 0.5)) / COLS, box.y + (box.height * (Math.floor(cell / COLS) + 0.5)) / 12);
      await expect(page.locator(".composer")).toBeVisible();
      await write(text);
      const made = page.locator("[data-annot]").filter({ has: page.locator(".card-body", { hasText: exactly(text) }) });
      await expect(made).toHaveCount(1);
      const id = (await made.getAttribute("data-annot"))!.split("|").pop()!;
      notes.push({ id, text, alive: true, deleted: false });
      remember({ kind, n });
    } else if (kind === "edit") {
      const m = (focus = alive[Math.floor(rand() * alive.length)]);
      const prev = m.text;
      m.text = `ui-${notes.indexOf(m)} v${Number(prev.split(" v")[1]) + 1}`;
      await openEditor(m, prev);
      await write(m.text);
      await expect(card(m.id).locator(".card-body")).toHaveText(exactly(m.text));
      remember({ kind, n: notes.indexOf(m), prev });
    } else if (kind === "delete") {
      const m = (focus = alive[Math.floor(rand() * alive.length)]);
      await select(m);
      await page.keyboard.press("Delete");
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      // Confirm with Enter like a real person: focus has to be inside the confirm dialog (not stolen when an agent writes back and the notes panel redraws)
      const where = () => page.evaluate(() => (document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : "none"));
      const inDialog = () => dialog.evaluate((d) => d.contains(document.activeElement));
      for (const until = Date.now() + 3000; !(await inDialog()) && Date.now() < until; ) await page.waitForTimeout(50);
      if (!(await inDialog())) throw new Error(`the confirm dialog appeared but focus is on ${await where()}`);
      await expect(dialog, "whether the dialog asks about this note").toContainText(m.text);
      const focused = await where();
      await page.keyboard.press("Enter");
      try {
        await expect(card(m.id)).toHaveCount(0);
      } catch (e) {
        const toastText = await page.locator(".toast").allInnerTexts();
        throw new Error(`before Enter focus was on ${focused}; now there are ${await dialog.count()} confirm dialogs, toast “${toastText.join(" / ")}”`, { cause: e });
      }
      m.alive = false;
      m.deleted = true;
      remember({ kind, n: notes.indexOf(m) });
    } else {
      const s = undo.pop()!;
      const m = (focus = notes[s.n]);
      await focusStage();
      await page.keyboard.press("Control+z");
      if (s.kind === "create") {
        m.alive = false;
        m.deleted = true;
        await expect(card(m.id)).toHaveCount(0);
      } else if (s.kind === "edit") {
        m.text = s.prev;
        await expect(card(m.id).locator(".card-body")).toHaveText(exactly(m.text));
      } else {
        m.alive = true;
        await expect(card(m.id)).toHaveCount(1);
      }
    }
  };

  try {
    await focusStage();
    await page.keyboard.press("c");
    for (let step = 0; step < UI_OPS; step++) {
      const r = rand();
      const alive = notes.filter((m) => m.alive).length;
      const kind = alive < 3 || r < 0.35 ? "create" : r < 0.65 ? "edit" : r < 0.8 ? "delete" : undo.length ? "undo" : "create";
      counts[kind]++;
      focus = undefined;
      if (process.env.SNIPTOSS_STRESS_TRACE) trace.push({ kind: "step", text: `step ${step + 1} ${kind} starts` });
      try {
        await doStep(kind);
        if (process.env.SNIPTOSS_STRESS_TRACE) trace.push({ kind: "step", text: `step ${step + 1} ${kind} ${(focus ?? notes.at(-1))?.id} done` });
        trail.push(`${step + 1} ${kind} ${(focus ?? notes.at(-1))?.id}`);
      } catch (e) {
        const m = focus as Mine | undefined;
        const onDisk = m && readNotes()?.find((a) => a.id === m.id);
        const shown = m ? await card(m.id).count() : 0;
        // Failure report: which step failed and why, what state the note should be in versus what is on disk and in the UI,
        // the last few steps, and (with SNIPTOSS_STRESS_TRACE) the latest writes and notifications
        throw new Error(
          `step ${step + 1} (${kind}) failed: ${(e as Error).message.split("\n")[0]}\n` +
            (m
              ? `note ${m.id}: by the steps it should be ${m.alive ? `there with text “${m.text}”` : "deleted"}; ` +
                `on disk ${onDisk ? `there (“${onDisk.body}”, ${onDisk.status})` : "missing"}; ${shown} cards in the UI\n`
              : "") +
            `previous steps: ${trail.slice(-8).join(", ")}` +
            (m && trace.length ? `${String.fromCharCode(10)}latest writes and notifications (is this note there):${String.fromCharCode(10)}${explain(m.id, "", true)}` : ""),
          { cause: e },
        );
      }
    }

    // The UI is done; if the agents haven't reached their count yet, they keep writing until they do
    await expect.poll(() => done.flat().length, { timeout: FULL ? 10 * 60_000 : 60_000, intervals: [200] }).toBeGreaterThanOrEqual(AGENT_OPS);
  } finally {
    // Stop the agents on failure too, otherwise they keep writing and the temp folder can't be deleted
    run.stop = true;
    clearInterval(reader);
    await Promise.all(agents);
  }

  // Verification: once the writes queued by the UI and the sync of on-disk changes have settled, what is on disk should be exactly this
  const problems = (): string[] => {
    const now = readNotes();
    if (!now) return ["can't read the notes file"];
    const byId = new Map(now.map((a) => [a.id, a]));
    const out: string[] = [];
    for (const m of notes) {
      const a = byId.get(m.id);
      if (!m.alive && a) out.push(`${m.id} (${m.text}) was deleted / undone but is still there`);
      if (m.alive && !a) out.push(`${m.id} (${m.text}) is lost`);
      if (m.alive && a && a.body !== m.text) out.push(`the text of ${m.id} should be “${m.text}” but is “${a.body}”`);
    }
    // Deleted notes (including ones that came back by undoing the deletion) aren't checked for agent changes: the UI's deletion wins (ADR-0005 item 2), and what an agent writes after a deletion isn't kept anyway
    const touched = new Set(notes.filter((m) => m.deleted).map((m) => m.id));
    for (const ops of done) {
      const last = new Map<string, string>();
      for (const op of ops) {
        last.set(op.id, op.status);
        const a = byId.get(op.id);
        if (touched.has(op.id) || !a || !op.body) continue;
        if (!a.replies.some((x) => x.body === op.body)) out.push(`the agent's reply “${op.body}” on ${op.id} is lost`);
      }
      for (const [id, status] of last) {
        const a = byId.get(id);
        if (!touched.has(id) && a && a.status !== status) out.push(`the status of ${id} should be ${status}, which the agent set last, but is ${a.status}`);
      }
    }
    const left = readdirSync(dir).filter((n) => !n.endsWith(".json"));
    if (left.length) out.push(`locks / temp files left over: ${left.join(", ")}`);
    return out;
  };
  // Wait for it to settle (at most 20 seconds); if it doesn't, the problems are reported one by one below
  for (const until = Date.now() + 20_000; problems().length && Date.now() < until; ) await new Promise((r) => setTimeout(r, 200));

  const writes = app.host.calls.filter((c) => c.method === "writeAnnotation").length;
  console.log(
    `Write stress test: ${UI_OPS} UI steps (${counts.create} added, ${counts.edit} edited, ${counts.delete} deleted, ${counts.undo} undone), ` +
      `${writes} UI write requests; ${done.flat().length} successful agent runs, ${missing} that hit a note just deleted; ${reads} reads`,
  );
  expect(failures, failures.join("\n")).toEqual([]);
  expect(torn, torn.slice(0, 5).join("\n")).toEqual([]);
  const lost = problems()
    .map((p) => /^the agent's reply “(\S+)” on (\S+) is lost$/.exec(p))
    .find(Boolean);
  if (lost && trace.length) console.log(`Writes and notifications around the reply “${lost[1]}” (${lost[2]}):\n${explain(lost[2], lost[1])}`);
  expect(problems(), problems().join("\n")).toEqual([]);
  // The writes really interleaved: the UI had writes rejected (an agent had just written), merged again and rewrote
  if (FULL) expect(writes).toBeGreaterThan(counts.create + counts.edit + counts.delete + counts.undo);
});

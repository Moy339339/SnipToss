import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  DATA_DIR,
  describeUnreadable,
  earlierVersions,
  isWritable,
  LEGACY_DATA_DIR,
  MaterialFileError,
  parseMaterialFile,
  renderReview,
  reviewLanguage,
  serializeMaterialFile,
  serializeProject,
  slugFor,
  type Annotation,
  type Locale,
  type MaterialFile,
} from "@sniptoss/core";
import { systemLocale, translator } from "./i18n.js";

/**
 * The notes data directory name for this project: .sniptoss. If only the legacy .pizhu exists (the new app has not opened the project yet),
 * it is read and written in place (docs/adr/0007-rename.md).
 * The CLI never migrates it itself: it is often launched through .pizhu\pizhu.cmd, and moving the directory that holds
 * the running script would leave cmd unable to find it when the script returns
 */
export function dataDirOf(root: string): string {
  if (existsSync(join(root, DATA_DIR))) return DATA_DIR;
  return existsSync(join(root, LEGACY_DATA_DIR)) ? LEGACY_DATA_DIR : DATA_DIR;
}

/**
 * The project root: walk up from start to the nearest folder that holds .sniptoss (or the legacy .pizhu), like git looking for .git,
 * so running the command inside a subfolder of the project still finds the notes.
 * If nothing is found up to the drive root, start itself is used
 */
export function findRoot(start: string): string {
  for (let dir = start; ;) {
    if (existsSync(join(dir, DATA_DIR)) || existsSync(join(dir, LEGACY_DATA_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/**
 * A notes file that was read: name is its file name in annotations/ (written back under this name, not a new one derived from the slug),
 * text is the original text on disk
 */
export interface LoadedFile {
  name: string;
  text: string;
  file: MaterialFile;
}

export interface Loaded {
  files: LoadedFile[];
  /** Files that cannot be read (broken JSON, wrong fields, written by a newer version): skipped without blocking the rest (ADR-0006 item 7) */
  unreadable: MaterialFileError[];
}

/**
 * The notes written on an earlier version of each item: material.path → note ids (the rules live in core's versions.ts, shared with the UI;
 * docs/adr/0008-earlier-versions.md). An item last modified before its notes is not read; the file is read only when
 * its current fingerprint is needed. Items that are gone or unreadable do not count (when unsure, a note is not counted as "earlier")
 */
export async function earlierAll(root: string, files: readonly MaterialFile[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const f of files) {
    if (f.material.kind === "folder") continue;
    const full = join(root, f.material.path);
    try {
      const { mtimeMs } = await stat(full);
      let v = earlierVersions(f, mtimeMs);
      if (v.pending) v = earlierVersions(f, mtimeMs, await sha256File(full));
      if (v.earlier.size) out[f.material.path] = [...v.earlier];
    } catch {
      // The item is gone or unreadable: treat it as unchanged
    }
  }
  return out;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function loadAll(root: string): Promise<Loaded> {
  const dir = join(root, dataDirOf(root), "annotations");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { files: [], unreadable: [] };
    throw err;
  }
  const loaded: Loaded = { files: [], unreadable: [] };
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    try {
      const text = await readFile(join(dir, name), "utf8");
      loaded.files.push({ name, text, file: parseMaterialFile(text, name) });
    } catch (err) {
      if (err instanceof MaterialFileError) loaded.unreadable.push(err);
      else if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // a file deleted after the directory listing does not count
    }
  }
  return loaded;
}

export type UpdateResult =
  | { result: "ok"; file: MaterialFile }
  | { result: "missing"; unreadable: MaterialFileError[] }
  | { result: "readonly"; schema: string; name: string };

/**
 * Changes one note and writes it back to its file (ADR-0005): find which file holds it, then take that file's lock
 * (withFileLock; the shell takes the same one when it writes), re-read, change and write, so nobody can slip in between the read and the write.
 * A "read → change → check for changes → write" sequence would overwrite another writer who got in between the check and the write
 * (and one that forced the write after 5 conflicts lost 771 of 1000 write-backs from 4 concurrent processes; see test/stress.test.ts).
 * Files written by a newer version are left alone (ADR-0006 item 4). beforeWrite is for tests only: it simulates the UI writing once just
 * before the lock is taken
 */
export async function updateAnnotation(
  root: string,
  id: string,
  change: (a: Annotation) => void,
  beforeWrite?: (path: string, attempt: number) => Promise<void>,
): Promise<UpdateResult> {
  const { files, unreadable } = await loadAll(root);
  const hit = files.find((f) => f.file.annotations.some((a) => a.id === id));
  if (!hit) return { result: "missing", unreadable };
  if (!isWritable(hit.file)) return { result: "readonly", schema: hit.file.schema, name: hit.name };
  const path = join(root, dataDirOf(root), "annotations", hit.name);
  await beforeWrite?.(path, 1);
  return withFileLock(path, async (): Promise<UpdateResult> => {
    const text = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (text === null) return { result: "missing", unreadable };
    const file = parseMaterialFile(text.replace(/^\uFEFF/, ""), hit.name);
    if (!isWritable(file)) return { result: "readonly", schema: file.schema, name: hit.name };
    const target = file.annotations.find((a) => a.id === id);
    if (!target) return { result: "missing", unreadable };
    change(target);
    await writeAtomic(path, serializeMaterialFile(file));
    return { result: "ok", file };
  });
}

/**
 * How long to wait for the lock at most: another writer holds it for a few milliseconds per write, so a much longer wait most likely means
 * it is stuck
 */
const LOCK_WAIT_MS = 10_000;
/** A lock file that has not been touched for this long, and whose writer process is gone, is treated as left behind by a crash */
const LOCK_STALE_MS = 10_000;
/**
 * Give up when creating the lock is denied for this long: the folder is not writable. The shell's lock is also denied while it is being
 * deleted, but only for a moment
 */
const LOCK_DENIED_MS = 1_000;

/**
 * Cross-process write lock (ADR-0005, "Locks"): .<file name>.lock next to the notes file. It is taken by creating it exclusively (wx),
 * holds "pid time machine id" (see machineId), and is deleted after the write.
 * The shell (app/FileLock.cs) uses the same name and the same rules, so the CLI, the UI and several agents writing the same file take turns.
 * A lock left by a crashed process (its writer is gone, or it has not been touched for LOCK_STALE_MS) is deleted and taken again. waitMs is
 * only given by tests
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
  const lock = join(dirname(path), `.${basename(path)}.lock`);
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  let deniedSince: number | null = null;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      try {
        await handle.writeFile(`${process.pid} ${Date.now()} ${MACHINE}`);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // EPERM / EBUSY / EACCES: the shell's lock is being deleted (on Windows nobody can open a half-deleted file), so a short wait is enough;
      // being denied for a whole second means the folder is not writable, so don't wait the full 10 seconds
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
      if (code === "EEXIST") {
        deniedSince = null;
        // Read it again before deleting and check it is still the same lock: someone may have just released it and taken a new one, which
        // must not be deleted.
        // If it cannot be deleted (read-only, no permission), wait as usual and fail at the time limit
        const stale = await staleLock(lock);
        if (
          stale !== null &&
          (await readFile(lock, "utf8").catch(() => null)) === stale &&
          (await rm(lock).then(
            () => true,
            () => false,
          ))
        )
          continue;
      } else {
        deniedSince ??= Date.now();
        if (Date.now() - deniedSince > LOCK_DENIED_MS) throw err;
      }
      if (Date.now() - started > waitMs)
        throw new Error(`The notes file stayed locked by another program (${lock}); nothing was written`, { cause: err });
      await new Promise((r) => setTimeout(r, 2 + Math.random() * 10));
    }
  }
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

/**
 * Deletes our own lock. Windows refuses to delete it while someone else has it open (checking whether it was left by a crash), so retry:
 * giving up on the first failure would leave the lock in place (its process is alive and it was just written, so nobody treats it as stale)
 * and every writer would wait the full 10 seconds when the shell and the CLI write together
 */
async function releaseLock(lock: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rm(lock, { force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt >= 200) return; // cannot delete it at all: after LOCK_STALE_MS others treat it as stale
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

/**
 * What the lock file says about the computer: a short hash of its name, not the name itself. A lock left by a crash stays in the project
 * folder, and computer names often carry the owner's name; the hash still tells this computer from another one. The shells compute the same
 * value (tests/golden/lock-machine.json)
 */
export function machineId(name: string): string {
  return createHash("sha256").update(name.toLowerCase(), "utf8").digest("hex").slice(0, 16);
}

/** The computer name: the same as the shell's Environment.MachineName (the NetBIOS name) */
const MACHINE_NAME = process.env.COMPUTERNAME ?? hostname();
const MACHINE = machineId(MACHINE_NAME);

/**
 * If the lock was left by a crashed process (its writer is gone, or it has not been touched for a long time), returns its content (to
 * verify before deleting); null if it is still valid
 */
async function staleLock(lock: string): Promise<string | null> {
  try {
    const text = await readFile(lock, "utf8");
    const [pidText, , machine] = text.split(" ");
    const pid = Number(pidText);
    // Written by another computer (the item is on a network drive): the pid belongs to that machine and cannot be checked here, so only
    // look at how long it has been untouched
    // (the plain name: a lock written before the hash was used)
    const here = machine === undefined || machine === MACHINE || machine.toLowerCase() === MACHINE_NAME.toLowerCase();
    if (here && pid > 0 && !processAlive(pid)) return text;
    return Date.now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS ? text : null;
  } catch {
    return null; // just deleted, or not fully written yet: treat it as valid and look again next round
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // another user's process: it exists, we just may not signal it
  }
}

/**
 * Safe write (docs/adr/0005-write-protocol.md, the same approach as the shell's AtomicFile): write a uniquely named temporary file in the
 * same directory, then replace the target with it in one step. If the write is interrupted the original file is still complete, and a UI
 * reading at that
 * moment never sees half a JSON file.
 * If another program has the target open (replacing is refused on Windows), wait a little and retry.
 * Overwriting in place would not give either guarantee
 */
export async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(tmp, text, { encoding: "utf8", flush: true });
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 10 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 20 * attempt));
        continue;
      }
      await rm(tmp, { force: true });
      throw err;
    }
  }
}

export async function saveMaterialFile(root: string, file: MaterialFile): Promise<void> {
  const name = slugFor(file.material.path, file.material.kind);
  await writeAtomic(join(root, dataDirOf(root), "annotations", name), serializeMaterialFile(file));
}

/**
 * Reads .sniptoss/annotations/ and rewrites .sniptoss/REVIEW.md; returns the number of open notes and the files that could not be read.
 * current = the language to use when the directory has not recorded one for REVIEW.md and it has not been written yet
 * (defaults to the system display language; tests pass it explicitly so the result does not depend on the machine running them)
 */
export async function writeReview(
  root: string,
  current: Locale = systemLocale(),
): Promise<{ path: string; open: number; unreadable: MaterialFileError[] }> {
  const { files, unreadable } = await loadAll(root);
  const dataDir = dataDirOf(root);
  const path = join(root, dataDir, "REVIEW.md");
  // Write in the language this notes folder has recorded (project.json); if none is recorded yet, decide it by the rules and record it
  // (docs/annotation-format.md, "Folder settings"; the UI does the same)
  const projectPath = join(root, dataDir, "project.json");
  const project = existsSync(projectPath) ? await readFile(projectPath, "utf8") : null;
  const { language, write } = reviewLanguage(project, existsSync(path), current);
  if (write) await writeAtomic(projectPath, serializeProject(language));
  const t = translator(language);
  const all = files.map((f) => f.file);
  const bad = unreadable.map((e) => ({ file: `${dataDir}/annotations/${e.file}`, reason: describeUnreadable(e, t) }));
  // Items that are gone (deleted, renamed, moved) are marked after the heading (the same as the UI writes it)
  const missing = all.filter((f) => f.material.kind !== "folder" && !existsSync(join(root, f.material.path))).map((f) => f.material.path);
  const earlier = await earlierAll(root, all);
  await writeAtomic(path, renderReview(all, t, { dataDir, unreadable: bad, missing, earlier }));
  const openCount = all.reduce((n, f) => n + f.annotations.filter((a) => a.status === "open").length, 0);
  return { path, open: openCount, unreadable };
}

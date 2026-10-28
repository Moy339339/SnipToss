import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useIntl } from "react-intl";
import {
  DATA_DIR,
  MaterialFileError,
  PROJECT_FILE,
  REVIEW_FILE,
  SOURCE_LOCALE,
  annotationFileFor,
  describeUnreadable,
  isLocale,
  isWritable,
  mergeMaterialFiles,
  parseMaterialFile,
  renderReview,
  reviewLanguage,
  serializeMaterialFile,
  serializeProject,
  slugFor,
  type Material,
  type MaterialFile,
} from "@sniptoss/core";
import { removeOldShim } from "./agent";
import { translatorFor } from "./i18n";
import { annotationPath, baseName, call, homeJoin, keyOf, logError, onHostEvent, parseHomeFiles, textSha256 } from "./host";
import type { FolderTarget, useLibrary } from "./library";
import type { Notify, Report } from "./report";

// Note data (split out of Workspace): stored per item (keyed by absolute path), each remembering its own notes folder. Reading, writing
// to disk (queueing, compare before write, three-way merge, ADR-0005), REVIEW.md, unreadable files, items that are gone, undo / redo and
// syncing external changes all live here. Snapshots (retaken when an undo moved a mark) and the toast saying what was undone need the
// canvas and the selection, so the caller passes them in through afterStep / onStep

export interface Stored {
  home: string;
  file: MaterialFile;
}

/**
 * Key of a notes file in files: for an item it is its absolute path (keyOf); a folder comment uses the folder path plus "|folder",
 * which cannot collide with the path of an item or of the folder itself, and is not found in library.byKey (so it is never opened as an item)
 */
export const fileKey = (home: string, m: Pick<Material, "path" | "kind">) =>
  m.kind === "folder" ? `${keyOf(homeJoin(home, m.path === "." ? "" : m.path)).replace(/\\+$/, "")}|folder` : keyOf(homeJoin(home, m.path));
export const folderKey = (t: FolderTarget) => fileKey(t.home, { path: t.rel, kind: "folder" });
export const isFolderKey = (key: string) => key.endsWith("|folder");
/** Key of an unreadable notes file: notes folder + file name inside annotations/ (Windows is case-insensitive) */
const badKey = (home: string, name: string) => `${keyOf(home)}|${name.toLowerCase()}`;
/** Is the reason the same for an unreadable file seen twice: compares reason code and detail, not the wording (wording changes with the language) */
const errorKey = (e: unknown) => (e instanceof MaterialFileError ? `${e.reason}|${e.detail}` : String(e));

/**
 * Whether the notes of this item (or folder) can be changed now: the notes file is unreadable → the explanation of why;
 * written by a newer version (read-only) → "upgrade before editing"; editable → undefined.
 * The newer-version explanation needs a message, so only a marker is returned here and the caller supplies the text
 */
export function blockedReason(
  unreadable: ReadonlyMap<string, string>,
  home: string,
  m: Pick<Material, "path" | "kind">,
  file: MaterialFile | undefined,
): string | undefined {
  const bad = unreadable.get(badKey(home, slugFor(m.path, m.kind)));
  if (bad) return bad;
  if (file && !isWritable(file)) return NEWER;
}
export const NEWER = "\u0000newer";

export interface Op {
  /** Key of the notes file (fileKey) */
  key: string;
  home: string;
  before?: MaterialFile;
  after: MaterialFile;
  /** Other notes files changed in the same step (a bulk status change spanning several items): undo and redo handle them together */
  rest?: Op[];
}
/** Every notes file touched by one step */
export const partsOf = (op: Op): Op[] => [op, ...(op.rest ?? [])];

/** What this step changed (so the undo / redo toast says what was undone; the message app.undo.what picks its wording by it) */
export function opKind(op: Op): "add" | "delete" | "status" | "edit" | "move" | "other" {
  const before = new Map((op.before?.annotations ?? []).map((a) => [a.id, a]));
  const after = new Map(op.after.annotations.map((a) => [a.id, a]));
  if ([...after.keys()].some((id) => !before.has(id))) return "add";
  if ([...before.keys()].some((id) => !after.has(id))) return "delete";
  for (const [id, a] of after) {
    const b = before.get(id)!;
    if (a.status !== b.status) return "status";
    const anchor = JSON.stringify(a.anchor) !== JSON.stringify(b.anchor);
    if (a.body !== b.body || a.category !== b.category) return "edit";
    if (anchor) return "move";
  }
  return "other";
}

/** How many undo steps to keep: each step holds a whole notes file, and without a limit memory keeps growing over a full day */
const HISTORY_LIMIT = 200;

/**
 * After a write is rejected (someone else wrote just before), merge and write again; only if it still cannot be written after this long
 * (10 seconds) does it count as a failure. Measured in time, not attempts: with 3 attempts, several agents writing back densely often got
 * rejected 3 times in a row and the change in the UI was rolled back (see write-stress.spec.ts). The first few retries are immediate
 * (the shorter the window, the likelier the write succeeds); after that each waits a little, so a real never-resolving mismatch
 * doesn't flood the shell
 */
const SAVE_RETRY_MS = 10_000;
const SAVE_RETRY_PAUSE_AFTER = 3;

export function useAnnotationStore(opts: {
  library: Pick<ReturnType<typeof useLibrary>, "homes" | "byKey" | "rescan">;
  /** Whether REVIEW.md lists resolved notes (Settings → Annotations) */
  includeResolved: boolean;
  onNotify: Notify;
  report: Pick<Report, "notifyError" | "reasonOf" | "describeBad">;
  /**
   * After a notes file was undone / redone (retake snapshots whose position changed): returns the file to save in the end; if it equals
   * target nothing more is saved
   */
  afterStep: (part: Op, target: MaterialFile, other?: MaterialFile) => Promise<MaterialFile>;
  /** Undo / redo succeeded: show what was undone */
  onStep: (op: Op, redone: boolean) => void;
  /** Notes in this notes folder written on earlier versions (material.path → ids, materialVersions.ts): REVIEW.md marks each one */
  earlierIn: (home: string) => Record<string, readonly string[]>;
}) {
  const { library, onNotify } = opts;
  const { notifyError, reasonOf, describeBad } = opts.report;
  const intl = useIntl();
  const [files, setFiles] = useState(() => new Map<string, Stored>());
  const filesRef = useRef(files);
  /**
   * Unreadable notes files (key see badKey) → an explanation for people. These items cannot be edited for now: the UI has none of their
   * notes, so editing would overwrite the unreadable file with an empty one. They recover automatically once the file is fixed or
   * deleted (read again from the external-change notification)
   */
  const [unreadable, setUnreadable] = useState(() => new Map<string, string>());
  const unreadableRef = useRef(unreadable);
  /**
   * The same unreadable files as they were (notes folder key → file name → error): listed at the top of REVIEW.md so agents know there
   * are notes that are not listed
   */
  const badFiles = useRef(new Map<string, Map<string, unknown>>());
  const history = useRef<{ undo: Op[]; redo: Op[] }>({ undo: [], redo: [] });
  /**
   * What each notes file currently holds on disk (raw text; null = the file doesn't exist yet). Updated when read, when an external
   * change is synced in, and when our own write succeeds. Used for the compare before writing: if the disk changed, an agent wrote back,
   * so merge first and then write (docs/adr/0005-write-protocol.md); an external-change notification whose content equals it is our own
   * write or unchanged, and is skipped
   */
  const onDisk = useRef(new Map<string, string | null>());
  /**
   * The last few disk versions of each file that were superseded (when they were superseded; the latest 6 versions, within 5 seconds).
   * An external-change notification can arrive late: the shell read the file at this version, but by the time it arrives the UI has
   * already written a newer one. It then differs from onDisk without anybody else having changed anything; it used to be treated as an
   * external change, so the UI went back to the old version and showed "updated externally" (now and then when copying for AI twice in
   * a row). Only if someone else turns the file back to exactly an old version within 5 seconds is it mistaken for a late one, and then
   * the fingerprint compare at the next write fails to match and merges anyway
   */
  const superseded = useRef(new Map<string, { text: string; at: number }[]>());
  /** Record what the disk holds now (when read, when our own write succeeds, when a notification is synced in) */
  const knowDisk = (key: string, text: string | null) => {
    const old = onDisk.current.get(key);
    if (old && old !== text) superseded.current.set(key, [...(superseded.current.get(key) ?? []).slice(-5), { text: old, at: Date.now() }]);
    onDisk.current.set(key, text);
  };
  /**
   * Sequence number of the newest content seen for each file (seq from the shell, ADR-0005 item 8): carried by reading a notes folder, by
   * write results and by external-change notifications. A notification with a smaller number than this may be late, stale content
   * (between the shell reading and the notification arriving, the UI already learned a newer state from a write result) and must not be
   * merged: it used to be treated as "changed elsewhere again", so notes untouched on the UI side took the old version from the
   * notification, rolling back and wiping the status and replies an agent had just written back. A shell without seq falls back to
   * lateEcho alone
   */
  const observed = useRef(new Map<string, number>());
  const observe = (key: string, seq: number | undefined) => {
    if (seq !== undefined && seq > (observed.current.get(key) ?? 0)) observed.current.set(key, seq);
  };
  const olderThanSeen = (key: string, seq: number | undefined) => seq !== undefined && seq < (observed.current.get(key) ?? 0);
  const lateEcho = (key: string, text: string) =>
    superseded.current.get(key)?.some((w) => w.text === text && Date.now() - w.at < 5_000) ?? false;
  /**
   * Writes to the same notes file are queued: when changes come in quick succession (arrow-key moves, fast undo) writes cannot get out of
   * order, so an earlier write never overwrites a later one
   */
  const writeQueue = useRef(new Map<string, Promise<void>>());
  const [, bump] = useState(0); // the undo stack changed: refresh the buttons' enabled state

  const openCount = useCallback((key: string) => files.get(key)?.file.annotations.filter((a) => a.status === "open").length ?? 0, [files]);
  const homeFiles = (home: string) => [...filesRef.current.values()].filter((s) => keyOf(s.home) === keyOf(home)).map((s) => s.file);

  /**
   * The item for a notes file is gone (deleted, renamed, moved; the shell checked the disk). Their notes used to vanish from the notes
   * panel while the file stayed and agents still saw them in REVIEW.md, so the user could neither see nor delete them.
   * Items merely not listed (a disabled kind, or next to an individually added file) don't count
   */
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const missingRef = useRef(missing);
  /**
   * The item open on the canvas with notes disappeared from the library: once the disk check confirms it is really gone, say so (items
   * removed from the library are not mentioned)
   */
  const lostKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    const candidates = [...files].filter(([key, s]) => s.file.material.kind !== "folder" && !library.byKey.has(key));
    if (candidates.length === 0) {
      if (missingRef.current.size) {
        missingRef.current = new Set();
        setMissing(missingRef.current);
      }
      return;
    }
    let stale = false;
    call("missing", { paths: candidates.map(([, s]) => homeJoin(s.home, s.file.material.path)) })
      .then((gone) => {
        if (stale) return;
        const keys = new Set(gone.map(keyOf));
        // Rewrite REVIEW.md for the notes folders that changed: the heading notes which items cannot be found
        const changed = new Set(
          [...keys, ...missingRef.current]
            .filter((k) => keys.has(k) !== missingRef.current.has(k))
            .map((k) => files.get(k)?.home)
            .filter((h): h is string => !!h),
        );
        missingRef.current = keys;
        setMissing(keys);
        for (const h of changed) void writeReviewRef.current(h).catch((e) => logError("writing REVIEW.md", e, "warn"));
        const lost = lostKey.current && files.get(lostKey.current);
        if (lost && keys.has(lostKey.current!))
          onNotify(
            intl.formatMessage(
              { id: "app.material.gone" },
              { name: baseName(lost.file.material.path), count: lost.file.annotations.filter((a) => a.status === "open").length },
            ),
          );
        lostKey.current = undefined;
      })
      .catch((e) => logError("checking whether items still exist", e, "warn"));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, library.byKey]);

  // ---------- Reading notes: the notes folders used by the library, each read when it first appears ----------
  const loadedHomes = useRef(new Set<string>());
  /** The raw project.json of each notes folder and whether REVIEW.md exists (read in by readHomes): decides which language REVIEW.md is written in */
  const projects = useRef(new Map<string, { text: string | null; review: boolean }>());
  /**
   * Notes folders that finished reading (failed reads count too: nobody waits for them); homesRead goes up by one per finished batch
   * (locating "the first item with open notes" has to wait for the notes to be read in)
   */
  const readHomes = useRef(new Set<string>());
  const [homesRead, setHomesRead] = useState(0);
  const markRead = (homes: string[]) => {
    homes.forEach((h) => readHomes.current.add(keyOf(h)));
    setHomesRead((n) => n + 1);
  };
  useEffect(() => {
    const fresh = library.homes.filter((h) => !loadedHomes.current.has(keyOf(h)));
    if (fresh.length === 0) return;
    fresh.forEach((h) => loadedHomes.current.add(keyOf(h)));
    call("readHomes", { homes: fresh })
      .then((results) => {
        const next = new Map(filesRef.current);
        for (const { home, seq, annotations: raw, project } of results) {
          projects.current.set(keyOf(home), project);
          const parsed = parseHomeFiles(raw);
          markUnreadable(home, parsed.bad, false);
          for (const { file: f, text } of parsed.files) {
            const key = fileKey(home, f.material);
            // The UI already has this file (written before the read came back): keep the UI's, and don't replace "what the disk holds"
            // with the disk's either; if the two disagree, the next merge on write would treat notes that are on disk but not in the UI
            // as deleted by the UI side
            if (next.has(key)) continue;
            next.set(key, { home, file: f });
            knowDisk(key, text);
            observe(key, seq);
          }
          // Delete the command-line entry point that earlier versions put there (it told agents to mark notes as done)
          if (parsed.files.length > 0) void removeOldShim(home);
        }
        filesRef.current = next;
        setFiles(next);
        markRead(fresh);
        for (const { home } of results) pruneSnapshots(home);
      })
      .catch((e: Error) => {
        // Record it as "not read" so it is read again when the list changes next (F5 refresh); a single failed read used to mean the
        // project was never read again. Locating no longer waits for it
        fresh.forEach((h) => loadedHomes.current.delete(keyOf(h)));
        markRead(fresh);
        logError("reading notes", e, "warn");
        notifyError(intl.formatMessage({ id: "app.read.failed" }, { reason: reasonOf(e, fresh.join(", ")) }), e, undefined, {
          label: intl.formatMessage({ id: "app.read.retry" }),
          run: () => void library.rescan(),
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.homes]);

  /**
   * Removes the snapshots in this notes folder that no note uses any more (left behind by deleted notes or a changed snapshot format).
   * Done once when read in: deleting a note doesn't delete its snapshot, since undo needs it. Those referenced in the undo stack are kept
   * too; with an unreadable notes file nothing is pruned (it is unknown which snapshots it refers to)
   */
  const pruneSnapshots = (home: string) => {
    if (badFiles.current.get(keyOf(home))?.size) return;
    const keep = new Set<string>();
    const add = (f?: MaterialFile) => f?.annotations.forEach((a) => a.snapshot && keep.add(a.snapshot));
    homeFiles(home).forEach(add);
    for (const op of [...history.current.undo, ...history.current.redo].flatMap(partsOf))
      if (keyOf(op.home) === keyOf(home)) {
        add(op.before);
        add(op.after);
      }
    void call("pruneSnapshots", { home, keep: [...keep] }).catch((e: unknown) => logError("pruning unused snapshots", e, "warn"));
  };

  // ---------- Writing to disk ----------
  /**
   * Which language REVIEW.md is written in: the one recorded in the folder (project.json); if none is recorded yet it is decided by the rules
   * and recorded (core's reviewLanguage, docs/annotation-format.md "Folder settings"). It does not follow the UI language: when several
   * people use different languages in one project, REVIEW.md is not rewritten back and forth (ADR-0001 item 7)
   */
  const reviewTranslator = async (home: string) => {
    const info = projects.current.get(keyOf(home)) ?? { text: null, review: false };
    const { language, write } = reviewLanguage(info.text, info.review, isLocale(intl.locale) ? intl.locale : SOURCE_LOCALE);
    if (write) {
      const text = serializeProject(language);
      await call("writeText", { home, path: PROJECT_FILE, text });
      projects.current.set(keyOf(home), { text, review: info.review });
    }
    return translatorFor(language);
  };

  // REVIEW.md is the entry point handed to AI (the text from "Copy for AI" points at it) and is rewritten on every note change
  const writeReviewNow = async (home: string) => {
    const all = homeFiles(home).filter((f) => f.annotations.length > 0);
    const t = await reviewTranslator(home);
    const bad = [...(badFiles.current.get(keyOf(home)) ?? [])].map(([name, error]) => ({
      file: `${DATA_DIR}/annotations/${name}`,
      reason: describeUnreadable(error, t),
    }));
    await call("writeText", {
      home,
      path: REVIEW_FILE,
      text: renderReview(all, t, {
        includeResolved: opts.includeResolved,
        unreadable: bad,
        missing: [...missingRef.current]
          .map((key) => filesRef.current.get(key))
          .filter((s) => s && keyOf(s.home) === keyOf(home))
          .map((s) => s!.file.material.path),
        earlier: opts.earlierIn(home),
      }),
    });
  };
  /**
   * The REVIEW.md of each notes folder is written one at a time in a queue (each write reads the latest notes, so the last write is the
   * newest): of two simultaneous writes the one that started first may finish last and overwrite the newer one. Changing a note (commit)
   * does not wait for it: the undo stack and the toast shouldn't be slowed down by it (deciding REVIEW.md's language the first time
   * needs reading messages and writing project.json, and a Ctrl+Z pressed too early would have nothing to undo)
   */
  const reviewWrites = useRef(new Map<string, Promise<void>>());
  const writeReview = (home: string) => {
    const key = keyOf(home);
    const next = (reviewWrites.current.get(key) ?? Promise.resolve()).catch(() => {}).then(() => writeReviewNow(home));
    reviewWrites.current.set(key, next);
    void next.finally(() => reviewWrites.current.get(key) === next && reviewWrites.current.delete(key)).catch(() => {});
    return next;
  };
  const writeReviewRef = useRef(writeReview);
  writeReviewRef.current = writeReview;

  /**
   * Records the unreadable files of a notes folder. whole = bad is everything read for this folder this time (an external-change
   * notification), so what was recorded for this folder before is cleared first
   */
  const markUnreadable = (home: string, bad: { name: string; error: unknown }[], whole: boolean) => {
    const prefix = `${keyOf(home)}|`;
    const next = new Map(unreadableRef.current);
    if (whole) for (const k of next.keys()) if (k.startsWith(prefix)) next.delete(k);
    const was = badFiles.current.get(keyOf(home)) ?? new Map<string, unknown>();
    const now = new Map(whole ? [] : was);
    for (const { name, error } of bad) {
      next.set(badKey(home, name), describeBad(home, name, error));
      now.set(name, error);
      logError("reading notes file", error, "warn");
    }
    badFiles.current.set(keyOf(home), now);
    // The set of unreadable files changed (broke, got fixed, got deleted): the list at the top of REVIEW.md follows. Written only after
    // the notes read in this round are in place
    const same = (a: Map<string, unknown>, b: Map<string, unknown>) =>
      a.size === b.size && [...a].every(([k, e]) => b.has(k) && errorKey(b.get(k)) === errorKey(e));
    if (!same(was, now))
      setTimeout(() => void writeReviewRef.current(home).catch((e: unknown) => logError("writing REVIEW.md", e, "warn")));
    if (next.size === unreadableRef.current.size && [...next].every(([k, v]) => unreadableRef.current.get(k) === v)) return;
    unreadableRef.current = next;
    setUnreadable(next);
  };

  const setStored = (key: string, home: string, file: MaterialFile | undefined) => {
    const next = new Map(filesRef.current);
    if (file) next.set(key, { home, file });
    else next.delete(key);
    filesRef.current = next;
    setFiles(next);
  };

  /**
   * Writes this notes file from the UI to disk. Queued: only one write per file at a time, and what is written is the newest content in
   * the UI when its turn comes (several quick changes write only the last). Before writing, the shell compares against "the disk content
   * we last knew": a mismatch means an agent wrote back or something else changed it → three-way merge (core's mergeMaterialFiles), the
   * UI switches to the merged result, then writes. It used to overwrite the whole file, wiping the "done" an agent had just written back (ADR-0005)
   */
  const flush = (key: string, home: string): Promise<void> => {
    const run = async () => {
      const started = Date.now();
      for (let attempt = 1; ; attempt++) {
        const mine = filesRef.current.get(key)?.file;
        if (!mine) return;
        const text = serializeMaterialFile(mine);
        const known = onDisk.current.get(key);
        if (known === text) return; // the disk already holds exactly this
        const res = await call("writeAnnotation", {
          home,
          path: annotationFileFor(mine.material.path, mine.material.kind),
          text,
          expectSha256: known ? await textSha256(known) : null,
        });
        observe(key, res.seq);
        if (res.written) {
          knowDisk(key, text);
          return;
        }
        // The file on disk was changed elsewhere: take what we last knew as the common base and merge the newest UI content with what is on
        // disk now. If the file on disk is unreadable (damaged, or written by a newer version): neither merge nor write, record it as
        // unreadable (editing is then blocked), and roll back this change
        const name = slugFor(mine.material.path, mine.material.kind);
        let theirs: MaterialFile | undefined;
        if (res.current !== null) {
          try {
            theirs = parseMaterialFile(res.current, name);
          } catch (e) {
            markUnreadable(home, [{ name, error: e }], false);
            throw new Error(describeBad(home, name, e), { cause: e });
          }
          // Same file name but another item's (a__b.png and a/b.png under root are both called a__b.png.json): must not be merged in, or
          // the notes of the two get mixed up
          if (theirs.material.kind !== mine.material.kind || keyOf(theirs.material.path) !== keyOf(mine.material.path))
            throw new Error(intl.formatMessage({ id: "app.save.nameClash" }, { name, other: theirs.material.path }));
        }
        knowDisk(key, res.current);
        if (Date.now() - started > SAVE_RETRY_MS) throw new Error(intl.formatMessage({ id: "app.save.busyLoop" }));
        const latest = filesRef.current.get(key)?.file ?? mine;
        const base = known ? parseMaterialFile(known) : undefined;
        theirs ??= { ...latest, annotations: [] };
        const { file: merged, conflicts } = mergeMaterialFiles(base, latest, theirs);
        if (conflicts.length)
          logError(
            "merging with changes from elsewhere on save",
            new Error(`both sides changed the same place, one side was taken by the rules: ${conflicts.join(", ")}`),
            "warn",
          );
        setStored(key, home, merged);
        if (attempt >= SAVE_RETRY_PAUSE_AFTER) await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
      }
    };
    const queued = (writeQueue.current.get(key) ?? Promise.resolve()).then(run, run);
    writeQueue.current.set(
      key,
      queued.catch(() => {}),
    );
    return queued;
  };

  /**
   * A notes file changed: update the UI first (fast), then queue the write; if it can't be written, roll back to what is on disk and say
   * so (the UI must not show notes that were never saved). base = the file this change was computed from: if the UI changed between
   * computing and now (an agent's write-back was synced in), this change is merged into the current file instead of overwriting it with
   * the old whole. Returns { op } when saved (this step; if it went onto the undo stack, the "Undo" on the "marked as done" toast undoes
   * exactly it), false when not saved. quiet: on failure only log, no error toast (for incidental writes like recording the "copied at"
   * time: the copy itself succeeded and must not report "save failed")
   */
  const commit = async (
    home: string,
    after: MaterialFile,
    how: { base?: MaterialFile; record?: boolean; quiet?: boolean } = {},
  ): Promise<false | { op: Op }> => {
    const key = fileKey(home, after.material);
    const before = filesRef.current.get(key)?.file;
    const blocked = blockedReason(unreadableRef.current, home, after.material, before ?? after);
    if (blocked) {
      setFiles(filesRef.current); // the canvas was changed first when moving a mark (not in filesRef yet): roll it back
      const path = annotationPath(home, slugFor(after.material.path, after.material.kind));
      onNotify(blocked === NEWER ? intl.formatMessage({ id: "app.file.newer" }, { schema: (before ?? after).schema, path }) : blocked);
      return false;
    }
    if (how.base && before && before !== how.base) after = mergeMaterialFiles(how.base, after, before).file;
    setStored(key, home, after);
    const op: Op = { key, home, before, after };
    const record = how.record ?? true;
    if (record) {
      history.current.undo.push(op);
      if (history.current.undo.length > HISTORY_LIMIT) history.current.undo.shift();
      history.current.redo = [];
      bump((n) => n + 1);
    }
    try {
      await flush(key, home);
    } catch (e) {
      logError("saving notes", e);
      // Roll back to what is on disk (onDisk holds only readable raw text); this used to parse an unreadable raw text again and throw
      // again, leaving the unsaved note in the UI
      const known = onDisk.current.get(key);
      setStored(key, home, known ? parseMaterialFile(known) : undefined);
      // The unsaved step does not stay on the undo stack either (otherwise the next Ctrl+Z would undo a change that never happened)
      const i = history.current.undo.lastIndexOf(op);
      if (i >= 0) {
        history.current.undo.splice(i, 1);
        bump((n) => n + 1);
      }
      if (!how.quiet) notifyError(intl.formatMessage({ id: "app.save.failed" }, { reason: reasonOf(e, home) }), e, home);
      return false;
    }
    // The note is already written; the summary (REVIEW.md) is queued behind, and if it fails don't report it as "not saved"
    void writeReview(home).catch((e: unknown) => {
      logError("writing REVIEW.md", e);
      if (!how.quiet) notifyError(intl.formatMessage({ id: "app.review.failed" }, { reason: reasonOf(e, home) }), e, home);
    });
    return { op };
  };

  // Undo / redo are queued and run one at a time: each step also retakes snapshots (asynchronous), and with repeated Ctrl+Z the late
  // result of an earlier step would overwrite the next one
  const historyQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (step: () => Promise<void>) => {
    historyQueue.current = historyQueue.current.then(step, step);
    return historyQueue.current;
  };
  /**
   * Undo: by default the latest step; with target only that step is undone (the "Undo" on the "marked as done" toast: if a mark was
   * moved within the 6 seconds, it used to undo the move instead). If that step was already undone, say so
   */
  const undo = (target?: Op) =>
    enqueue(async () => {
      const stack = history.current.undo;
      const i = target ? stack.lastIndexOf(target) : stack.length - 1;
      if (i < 0) {
        if (target) onNotify(intl.formatMessage({ id: "app.undo.already" }));
        return;
      }
      const [op] = stack.splice(i, 1);
      history.current.redo.push(op);
      bump((n) => n + 1);
      // Undo only this step's own change: take "after this step" as the base and merge "before this step" into the current file, so what
      // an agent wrote back in between and the changes of later steps are kept. A step that changed several notes files (bulk status
      // change) undoes each of them; only if none could be undone does the step count as not undone
      let done = 0;
      for (const part of partsOf(op)) {
        const now = filesRef.current.get(part.key)?.file ?? part.after;
        const merged = mergeMaterialFiles(part.after, part.before ?? { ...part.after, annotations: [] }, now).file;
        if (!(await commit(part.home, merged, { record: false }))) continue;
        done++;
        const fixed = await opts.afterStep(part, merged, part.after);
        if (fixed !== merged) await commit(part.home, fixed, { record: false, base: merged });
      }
      if (done === 0) {
        history.current.redo.pop();
        stack.splice(i, 0, op);
        bump((n) => n + 1);
        return;
      }
      opts.onStep(op, false);
    });
  const redo = () =>
    enqueue(async () => {
      const op = history.current.redo.pop();
      if (!op) return;
      history.current.undo.push(op);
      bump((n) => n + 1);
      let done = 0;
      for (const part of partsOf(op)) {
        const now = filesRef.current.get(part.key)?.file ?? part.before ?? part.after;
        const target = mergeMaterialFiles(part.before ?? { ...part.after, annotations: [] }, part.after, now).file;
        if (!(await commit(part.home, target, { record: false }))) continue;
        done++;
        const fixed = await opts.afterStep(part, target, part.before);
        if (fixed !== target) await commit(part.home, fixed, { record: false, base: target });
      }
      if (done === 0) {
        history.current.undo.pop();
        history.current.redo.push(op);
        bump((n) => n + 1);
        return;
      }
      opts.onStep(op, true);
    });

  /**
   * Changes to several notes files at once (bulk status change, bulk delete) form one step on the undo stack: Ctrl+Z and the toast's
   * "Undo" revert everything together
   */
  const recordTogether = (saved: (false | { op: Op })[]): Op | undefined => {
    const ops = saved.flatMap((s) => (s ? [s.op] : []));
    if (ops.length === 0) return undefined;
    const op: Op = { ...ops[0], rest: ops.slice(1) };
    history.current.undo.push(op);
    if (history.current.undo.length > HISTORY_LIMIT) history.current.undo.shift();
    history.current.redo = [];
    bump((n) => n + 1);
    return op;
  };

  // A notes file was changed externally (an agent wrote back a status with sniptoss resolve, or the JSON was edited by hand): sync it in
  const onExternalChange = useEffectEvent(
    ({ home, seq, annotations: incoming }: { home: string; seq?: number; annotations: { name: string; text: string }[] }) => {
      let changed = 0;
      const next = new Map(filesRef.current);
      const { files: parsed, bad } = parseHomeFiles(incoming);
      // The notification holds all notes files of this folder: the unreadable ones are recomputed (fixed or deleted ones recover
      // automatically; one an editor hasn't finished writing is fine by the next notification)
      markUnreadable(home, bad, true);
      for (const { file: f, text } of parsed) {
        const key = fileKey(home, f.material);
        // Older than the content of this file the UI has already seen (a late notification): don't merge, or it would go back to an old
        // version (ADR-0005 item 8)
        if (olderThanSeen(key, seq)) continue;
        observe(key, seq);
        // The notification holds all notes files of this folder; skip those whose raw text equals the disk content we know (our own
        // write, or unchanged); also skip an old version that was just superseded (the notification arrived late and the disk already
        // holds the version the UI wrote afterwards)
        const known = onDisk.current.get(key);
        if (known === text || lateEcho(key, text)) continue;
        knowDisk(key, text);
        // If the UI's copy equals the disk content we last knew (no pending changes): switch straight to what is on disk; otherwise
        // three-way merge so this side's changes aren't lost
        const mine = next.get(key)?.file;
        const base = known ? parseMaterialFile(known) : undefined;
        const merged =
          !mine || (base && serializeMaterialFile(mine) === serializeMaterialFile(base)) ? f : mergeMaterialFiles(base, mine, f).file;
        if (mine && serializeMaterialFile(mine) === serializeMaterialFile(merged)) continue;
        next.set(key, { home, file: merged });
        changed++;
      }
      // The notification holds all files of this folder: one that was on disk before and is gone now = deleted externally. If this side has
      // no pending changes it is dropped too; otherwise it stays, and the write does a three-way merge treating it as "deleted by the
      // other side" (keeping only what this side changed)
      const present = new Set(parsed.map(({ file: f }) => fileKey(home, f.material)));
      for (const [key, s] of next) {
        if (keyOf(s.home) !== keyOf(home) || present.has(key) || olderThanSeen(key, seq)) continue;
        const known = onDisk.current.get(key);
        if (!known) continue; // never written to disk (just created, still being written): doesn't count
        if (serializeMaterialFile(s.file) !== serializeMaterialFile(parseMaterialFile(known))) continue;
        next.delete(key);
        knowDisk(key, null);
        changed++;
      }
      if (!changed) return;
      filesRef.current = next;
      setFiles(next);
      onNotify(intl.formatMessage({ id: "app.sync.external" }));
    },
  );
  useEffect(() => onHostEvent("annotationsChanged", onExternalChange), []);

  /**
   * Changed on the canvas first and not saved yet (waiting for the snapshot when moving a mark): only changes what the UI shows and
   * leaves filesRef alone; the following commit saves it or rolls it back
   */
  const preview = (key: string, stored: Stored) => setFiles(new Map(filesRef.current).set(key, stored));
  /**
   * The item open on the canvas with notes disappeared from the library: once the disk check confirms it is really gone, say so (items
   * removed from the library are not mentioned)
   */
  const noteLost = (key: string) => {
    lostKey.current = key;
  };
  /** Whether this notes folder has finished reading (failed reads count too) */
  const isHomeRead = (home: string) => readHomes.current.has(keyOf(home));

  return {
    files,
    filesRef,
    unreadable,
    unreadableRef,
    missing,
    homesRead,
    isHomeRead,
    openCount,
    homeFiles,
    commit,
    writeReview,
    preview,
    recordTogether,
    enqueue,
    undo,
    redo,
    canUndo: history.current.undo.length > 0,
    canRedo: history.current.redo.length > 0,
    noteLost,
  };
}

export type AnnotationStore = ReturnType<typeof useAnnotationStore>;

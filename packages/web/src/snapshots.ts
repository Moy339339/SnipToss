import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import { useIntl } from "react-intl";
import { DATA_DIR, upsertAnnotation, type Annotation, type MaterialFile } from "@sniptoss/core";
import { renderSnapshot, seekForCapture } from "./annotate";
import { isFolderKey, type AnnotationStore, type Op } from "./annotationStore";
import { call, homeJoin, logError } from "./host";
import type { Prefs } from "./prefs";
import type { Report } from "./report";
import { wantedTime } from "./scrub";
import type { Media } from "./Viewer";

// Note snapshots (split out of Workspace): one is taken from the canvas when a note is saved, a mark is moved or a color is changed, and after undo / redo those whose position or color changed are taken again

export function useSnapshots(opts: {
  mediaRef: RefObject<Media | null>;
  prefs: Prefs;
  /** The item open on the canvas (key): by the time a queued snapshot is taken, the item may have changed */
  currentPath: RefObject<string | undefined>;
  selectedKey: string | undefined;
  /** The canvas size: once present, the canvas is up and can be captured */
  dims: unknown;
  store: Pick<AnnotationStore, "enqueue" | "filesRef" | "commit">;
  report: Pick<Report, "notifyError" | "reasonOf">;
  /** The notes of this item written on older versions: their snapshots are a record of the old canvas and are never retaken from the current canvas (ADR-0008) */
  earlierOf: (key: string) => ReadonlySet<string>;
}) {
  const { mediaRef, currentPath, store } = opts;
  const { notifyError, reasonOf } = opts.report;
  const intl = useIntl();

  /**
   * Take a snapshot: for video, first seek to the note's moment. On success the path is written into annotation.snapshot.
   * On failure the cause is returned; with report = false nothing is said yet, and it is said once the note has really been saved (snapshotFailed):
   * in a folder without write permission the snapshot and the note fail together, and first showing "snapshot not generated, text saved anyway" and then "save failed" would contradict itself
   */
  const takeSnapshot = async (annotation: Annotation, home: string, report = true): Promise<unknown> => {
    const media = mediaRef.current;
    if (!media) return undefined;
    try {
      if (media instanceof HTMLVideoElement && annotation.anchor.time) await seekForCapture(media, annotation.anchor.time.start);
      const shot = await renderSnapshot(media, annotation, opts.prefs);
      if (!shot.data) throw new Error(intl.formatMessage({ id: "app.snapshot.empty" }));
      const rel = `snapshots/${annotation.id}.${shot.ext}`;
      await call("writeBase64", { home, path: `${DATA_DIR}/${rel}`, data: shot.data });
      annotation.snapshot = rel; // Record it only after the write succeeded: otherwise a failed write would leave the note with a snapshot path that does not exist
      return undefined;
    } catch (e) {
      logError("Generating snapshot", e, "warn");
      if (report) snapshotFailed(e, home);
      return e;
    }
  };
  const snapshotFailed = (e: unknown, home: string) =>
    notifyError(intl.formatMessage({ id: "app.snapshot.failed" }, { reason: reasonOf(e, home) }), e, homeJoin(home, DATA_DIR));

  /**
   * After undo / redo, notes whose position, time or mark color changed get new snapshots. Only the item open on the canvas can be captured: those of other items are recorded in staleShots
   * and filled in once they are opened and the canvas is up (otherwise a snapshot with the old position would stay, and an agent following it would look in the wrong place)
   */
  const staleShots = useRef(new Map<string, Set<string>>());
  const resnap = async (op: Op, target: MaterialFile, other?: MaterialFile) => {
    const earlier = opts.earlierOf(op.key);
    const moved = target.annotations.filter((a) => {
      const o = other?.annotations.find((x) => x.id === a.id);
      return o && !earlier.has(a.id) && (JSON.stringify(o.anchor) !== JSON.stringify(a.anchor) || o.color !== a.color);
    });
    if (moved.length === 0 || isFolderKey(op.key)) return target;
    // Decide by the latest "current item": the item may have changed while queued, and the one on the canvas may no longer be this one
    if (op.key !== currentPath.current) {
      staleShots.current.set(op.key, new Set([...(staleShots.current.get(op.key) ?? []), ...moved.map((a) => a.id)]));
      return target;
    }
    let next = target;
    for (const a of moved) {
      const copy = { ...a };
      await takeSnapshot(copy, op.home);
      next = upsertAnnotation(next, copy);
    }
    return next;
  };

  // Notes that were not on the canvas during undo / redo and whose position changed (recorded by resnap), or whose color changed (refreshShots): their snapshots are filled in once this item is open and the canvas is up.
  // A video must seek to the note's moment to capture it, return to its original position afterwards, and keep playing if it was playing
  const redoShots = (key: string) =>
    store.enqueue(async () => {
      const ids = staleShots.current.get(key);
      const stored = store.filesRef.current.get(key);
      if (!ids || !stored || currentPath.current !== key) return; // Switched away again: leave it for the next time it is opened
      staleShots.current.delete(key);
      const media = mediaRef.current;
      const was = media instanceof HTMLVideoElement ? { time: wantedTime(media), playing: !media.paused } : undefined;
      let next = stored.file;
      const earlier = opts.earlierOf(key);
      for (const id of ids) {
        const a = next.annotations.find((x) => x.id === id);
        if (!a || earlier.has(id)) continue;
        const copy = { ...a };
        await takeSnapshot(copy, stored.home);
        next = upsertAnnotation(next, copy);
      }
      if (was && media instanceof HTMLVideoElement && currentPath.current === key) {
        media.currentTime = was.time;
        if (was.playing) void media.play().catch(() => {});
      }
      if (next !== stored.file) await store.commit(stored.home, next, { record: false, base: stored.file });
    });
  const catchUp = useEffectEvent((key: string) => redoShots(key));
  const { selectedKey, dims } = opts;
  useEffect(() => {
    if (selectedKey && dims && staleShots.current.has(selectedKey)) void catchUp(selectedKey);
  }, [selectedKey, dims]);

  /**
   * Snapshots that must be redrawn although the position did not move (the mark color changed): for the item on the canvas, retake right after the write to disk finishes (queued behind the write); for other items, or before the canvas is up, fill in once they are opened.
   * Retaking does not enter the undo stack: when the color change is undone, resnap retakes it as well
   */
  const refreshShots = (key: string, ids: string[]) => {
    const earlier = opts.earlierOf(key);
    const todo = ids.filter((id) => !earlier.has(id));
    if (todo.length === 0 || isFolderKey(key)) return;
    staleShots.current.set(key, new Set([...(staleShots.current.get(key) ?? []), ...todo]));
    if (key === currentPath.current && dims) void redoShots(key);
  };

  return { takeSnapshot, snapshotFailed, resnap, refreshShots };
}

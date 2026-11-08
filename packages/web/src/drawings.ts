import type { RefObject } from "react";
import { useIntl } from "react-intl";
import {
  emptyMaterialFile,
  isWritable,
  newAnnotationId,
  removeDrawing,
  takenIds,
  upsertDrawing,
  type Annotation,
  type Drawing,
  type MaterialFile,
  type Shape,
} from "@sniptoss/core";
import type { AnnotationStore } from "./annotationStore";
import { materialMetaSize } from "./compose";
import type { Draft } from "./draft";
import { call, keyOf, logError } from "./host";
import type { useMaterialVersions } from "./materialVersions";
import type { Report } from "./report";
import type { useSnapshots } from "./snapshots";
import type { Media } from "./Viewer";

// Drawings without notes (docs/annotation-format.md, "Drawings"): a mark whose note box is left without a word stays on the item as a
// drawing, with no number. On the canvas a drawing is shown and edited like a mark, through a stand-in note (drawingNote) that the
// annotation layer draws without a number; Workspace sends what is done to it (move, recolor, delete, add a note) here. Drawings also go
// into the snapshots of the notes on the same frame, so they reach agents and Copy as Images with the picture

/** A drawing as the annotation layer takes it: a note with its one shape and no words (ShownAnnotation.drawing: no number is drawn) */
export const drawingNote = (d: Drawing): Annotation => ({
  id: d.id,
  status: "open",
  category: "change",
  body: "",
  anchor: { shapes: [d.shape], ...(d.time ? { time: d.time } : {}), ...(d.page ? { page: d.page } : {}) },
  author: "",
  created_at: d.created_at,
  updated_at: d.created_at,
  replies: [],
});

const frame = (t: number, fps: number) => Math.floor(t * fps + 1e-6);

/**
 * Whether a drawing shows at this moment: one without a time (on an image) always; on a video, a single moment only on its own frame (the
 * same rule as single-moment marks when paused) and a span from just before its start to its end. A note without a time on a video (an
 * overall comment) shows only drawings without a time
 */
export function drawingShowsAt(d: Drawing, at: number | undefined, fps = 30): boolean {
  if (!d.time) return true;
  if (at === undefined) return false;
  if (d.time.end !== undefined) return at >= d.time.start - 0.04 && at <= d.time.end;
  return frame(at, fps) === frame(d.time.start, fps) || Math.abs(at - d.time.start) < 0.002;
}

/** The drawings a note's snapshot shows: on the note's frame (its start), not made on an earlier version of the item */
export function drawingsFor(file: MaterialFile | undefined, a: Annotation, earlier: ReadonlySet<string>): Drawing[] {
  const fps = file?.material.frame_rate ?? 30;
  return (file?.drawings ?? []).filter((d) => !earlier.has(d.id) && drawingShowsAt(d, a.anchor.time?.start, fps));
}

/** A shape changed on the canvas keeps the drawing's own color (the layer works with the shape alone) */
const keepColorOf = (was: Shape, next: Shape): Shape => {
  const { color: _old, ...rest } = next;
  return was.color ? { ...rest, color: was.color } : rest;
};

export function useDrawings(opts: {
  store: Pick<AnnotationStore, "filesRef" | "commit">;
  versions: Pick<ReturnType<typeof useMaterialVersions>, "currentSha" | "rememberSha" | "earlierOf">;
  snapshots: Pick<ReturnType<typeof useSnapshots>, "refreshShots">;
  /** The item open on the canvas (its key): its size is read from the canvas when its notes file is created by a drawing */
  currentPath: RefObject<string | undefined>;
  mediaRef: RefObject<Media | null>;
  report: Pick<Report, "notifyError" | "reasonOf">;
  /** Marks were kept as drawings (the first time, a hint says what happened) */
  onKept?: () => void;
}) {
  const { filesRef, commit } = opts.store;
  const intl = useIntl();

  /** The notes whose snapshots show any of these drawings get new snapshots (they carry the drawings to agents) */
  const resnapFor = (key: string, file: MaterialFile, changed: readonly Drawing[]) => {
    const fps = file.material.frame_rate ?? 30;
    const ids = file.annotations
      .filter((a) => a.snapshot && changed.some((d) => drawingShowsAt(d, a.anchor.time?.start, fps)))
      .map((a) => a.id);
    if (ids.length) opts.snapshots.refreshShots(key, ids);
  };

  /**
   * A drawn draft was left without a word (draft.ts): each of its marks becomes a drawing on the item it was drawn on (which may no longer
   * be on the canvas), with the color it was drawn in and the frame it was drawn on. One undo step
   */
  const keep = async (draft: Draft) => {
    const item = draft.drawn?.item;
    // A pin left without words says nothing on its own: only lines, arrows, strokes and boxes stay
    const shapes = (draft.shapes ?? []).filter((s) => s.type !== "point");
    if (!item || !shapes.length) return;
    const key = keyOf(item.path);
    try {
      const stored = filesRef.current.get(key)?.file;
      if (stored && !isWritable(stored)) return;
      let file = stored;
      let sha: string | undefined;
      if (file) sha = await opts.versions.currentSha(item, file);
      else {
        sha = await call("sha256", { path: item.path });
        opts.versions.rememberSha(item, sha);
        const media = opts.currentPath.current === key ? opts.mediaRef.current : null;
        file = emptyMaterialFile({ path: item.homeRel, kind: item.kind, sha256: sha, ...(media ? materialMetaSize(media) : {}) });
      }
      const taken = new Set([...filesRef.current.values()].flatMap((s) => [...takenIds(s.file)]));
      const now = new Date().toISOString();
      const color = draft.noteColor?.color;
      const added: Drawing[] = [];
      let next = file;
      for (const s of shapes) {
        const id = newAnnotationId(taken);
        taken.add(id);
        const d: Drawing = {
          id,
          shape: s.color || !color ? s : { ...s, color },
          ...(draft.time && item.kind === "video" ? { time: draft.time } : {}),
          created_at: now,
          ...(sha ? { material_sha256: sha } : {}),
        };
        added.push(d);
        next = upsertDrawing(next, d);
      }
      if (await commit(item.home, next, { base: stored })) {
        resnapFor(key, next, added);
        opts.onKept?.();
      }
    } catch (e) {
      logError("Keeping marks as drawings", e);
      opts.report.notifyError(intl.formatMessage({ id: "app.save.failed" }, { reason: opts.report.reasonOf(e, item.home) }), e, item.home);
    }
  };

  /** Change one drawing of the item (key), or remove it (change returns undefined); one undo step, snapshots that show it are retaken */
  const update = async (key: string, id: string, change: (d: Drawing) => Drawing | undefined) => {
    const stored = filesRef.current.get(key);
    const d = stored?.file.drawings?.find((x) => x.id === id);
    if (!stored || !d) return;
    const changed = change(d);
    const next = changed ? upsertDrawing(stored.file, changed) : removeDrawing(stored.file, id);
    if (await commit(stored.home, next, { base: stored.file })) resnapFor(key, next, changed ? [d, changed] : [d]);
  };

  return {
    keep,
    /** Moved or resized on the canvas */
    move: (key: string, id: string, shape: Shape) => update(key, id, (d) => ({ ...d, shape: keepColorOf(d.shape, shape) })),
    /** Recolored from the color row or the context menu; without a color it follows Settings */
    recolor: (key: string, id: string, color: string | undefined) =>
      update(key, id, (d) => {
        const { color: _old, ...shape } = d.shape;
        return { ...d, shape: color ? { ...shape, color } : shape };
      }),
    remove: (key: string, id: string) => update(key, id, () => undefined),
  };
}

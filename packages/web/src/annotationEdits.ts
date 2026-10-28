import type { Dispatch, RefObject, SetStateAction } from "react";
import { useIntl } from "react-intl";
import { removeAnnotation, shapesOf, upsertAnnotation, type Annotation, type AnnotationStatus, type Shape } from "@sniptoss/core";
import type { Ask } from "./AskDialog";
import { folderKey, type AnnotationStore } from "./annotationStore";
import { normalizePlaceColors, recolorPlace, sameColor, withoutPlaceColors } from "./markColors";
import type { Draft } from "./draft";
import { keyOf, type MaterialEntry } from "./host";
import type { Notify } from "./report";
import type { useSnapshots } from "./snapshots";

// Editing notes that are already saved (split out of Workspace): move a mark, remove one place, change status, change mark color, delete.
// Changes spanning several notes files form a single step on the undo stack.
// A deleted note that is currently selected or being edited in the composer is cleared along with it

type Target = { a: Annotation; key: string };

export function useAnnotationEdits(opts: {
  current: MaterialEntry | undefined;
  /** The item open on the canvas (its key): used when the composer is editing a note of the item on the canvas */
  currentPath: RefObject<string | undefined>;
  selectedKey: string | undefined;
  selectedId: string | undefined;
  setSelectedId: (id: string | undefined) => void;
  selectedNote: string | undefined;
  setSelectedNote: (id: string | undefined) => void;
  setDraft: Dispatch<SetStateAction<Draft | undefined>>;
  /** Clear the checks after deleting */
  setChecked: (ids: string[]) => void;
  store: Pick<AnnotationStore, "filesRef" | "commit" | "recordTogether" | "undo" | "preview">;
  snapshots: Pick<ReturnType<typeof useSnapshots>, "takeSnapshot" | "snapshotFailed" | "refreshShots">;
  /** Show a confirm dialog */
  ask: (q: Ask) => void;
  onNotify: Notify;
  /**
   * Mark color from Settings: marks without their own color are drawn in it (needed when normalizing each place's color, see
   * normalizePlaceColors in markColors.ts)
   */
  markColor: string;
}) {
  const { current, selectedKey, selectedId, setSelectedId, selectedNote, setSelectedNote, onNotify } = opts;
  const { filesRef, commit, recordTogether, undo } = opts.store;
  const { takeSnapshot, snapshotFailed, refreshShots } = opts.snapshots;
  const intl = useIntl();

  /**
   * A mark was moved or a handle dragged on the canvas (place `part`), or one place was removed (shape omitted; with only one place left
   * it can't be removed, that would be deleting the whole note): the canvas first stays at the new position, and everything is saved
   * together once the snapshot is generated (undoable)
   */
  const changeShape = async (id: string, part: number, shape?: Shape) => {
    if (!current) return;
    const key = keyOf(current.path);
    const file = filesRef.current.get(key)?.file;
    const a = file?.annotations.find((x) => x.id === id);
    const before = a ? shapesOf(a) : [];
    if (!file || !a || part >= before.length || (!shape && before.length < 2)) return;
    // After removing a place the remaining colors may be the same again: collapse to the note's single color (per-place colors are
    // recorded only when they differ)
    const { shapes, color } = normalizePlaceColors(
      shape ? before.map((s, i) => (i === part ? shape : s)) : before.filter((_, i) => i !== part),
      a.color,
      opts.markColor,
    );
    const { color: _old, ...rest } = a;
    const updated: Annotation = {
      ...rest,
      ...(color ? { color } : {}),
      anchor: { ...a.anchor, shapes },
      updated_at: new Date().toISOString(),
    };
    opts.store.preview(key, { home: current.home, file: upsertAnnotation(file, updated) });
    const shotError = await takeSnapshot(updated, current.home, false);
    if ((await commit(current.home, upsertAnnotation(file, updated), { base: file })) && shotError) snapshotFailed(shotError, current.home);
  };

  /**
   * Changing status and deleting don't need the canvas: notes of other items (when the notes panel lists several items) are changed
   * directly; key defaults to the item on the canvas
   */
  const setStatus = (a: Annotation, status: AnnotationStatus, key = selectedKey) => key && void setStatusMany([{ a, key }], status);
  /**
   * Change the status of several notes at once (the checked ones, the D key). Written per notes file and combined into one undo step:
   * Ctrl+Z and the toast's "Undo" revert everything at once. Notes that already have this status are left alone
   */
  const setStatusMany = async (targets: Target[], status: AnnotationStatus) => {
    const byKey = new Map<string, string[]>();
    for (const t of targets) byKey.set(t.key, [...(byKey.get(t.key) ?? []), t.a.id]);
    const at = new Date().toISOString();
    let count = 0;
    const saved = await Promise.all(
      [...byKey].map(([key, ids]) => {
        const stored = filesRef.current.get(key);
        if (!stored) return false;
        // Use the note as it is now: the menu is a snapshot from when it opened, and a reply an agent wrote back meanwhile must not be
        // overwritten by it
        let next = stored.file;
        for (const id of ids) {
          const now = next.annotations.find((x) => x.id === id);
          if (!now || now.status === status) continue;
          next = upsertAnnotation(next, { ...now, status, updated_at: at });
          count++;
        }
        return next !== stored.file && commit(stored.home, next, { base: stored.file, record: false });
      }),
    );
    const op = recordTogether(saved);
    if (!op) return;
    onNotify(
      count === 1
        ? intl.formatMessage({ id: "app.status.done" }, { status })
        : intl.formatMessage({ id: "app.status.doneMany" }, { status, count }),
      { label: intl.formatMessage({ id: "app.undo.action" }), run: () => void undo(op) },
    );
  };

  /**
   * Change the mark color of several notes (number keys 1–6, the swatches in the context menu and the menu): without color = remove the
   * own color and follow Settings. Like status changes: written per notes file and combined into one undo step; notes that already have
   * this color are left alone. The marks in snapshots take the new color too (taken after the write, refreshShots).
   * For one note the change is visible on the canvas, so there is no toast; for several it says so (some may be in other items)
   */
  const setColorMany = async (targets: Target[], color: string | undefined) => {
    const byKey = new Map<string, string[]>();
    for (const t of targets) byKey.set(t.key, [...(byKey.get(t.key) ?? []), t.a.id]);
    const at = new Date().toISOString();
    const changed = new Map<string, string[]>();
    const saved = await Promise.all(
      [...byKey].map(([key, ids]) => {
        const stored = filesRef.current.get(key);
        if (!stored) return false;
        let next = stored.file;
        for (const id of ids) {
          const now = next.annotations.find((x) => x.id === id);
          // Changing the whole note: all places take this color and the per-place colors are removed
          const own = now ? shapesOf(now).some((s) => s.color !== undefined) : false;
          if (!now || !shapesOf(now).length || (sameColor(now.color, color) && !own)) continue;
          const { color: _old, ...rest } = now;
          const anchor = own ? { ...now.anchor, shapes: withoutPlaceColors(shapesOf(now)) } : now.anchor;
          next = upsertAnnotation(next, { ...rest, ...(color ? { color } : {}), anchor, updated_at: at });
          changed.set(key, [...(changed.get(key) ?? []), id]);
        }
        return next !== stored.file && commit(stored.home, next, { base: stored.file, record: false });
      }),
    );
    const op = recordTogether(saved);
    if (!op) return;
    for (const [key, ids] of changed) refreshShots(key, ids);
    const count = [...changed.values()].reduce((n, ids) => n + ids.length, 0);
    if (count > 1)
      onNotify(intl.formatMessage({ id: "app.color.doneMany" }, { count }), {
        label: intl.formatMessage({ id: "app.undo.action" }),
        run: () => void undo(op),
      });
  };

  /**
   * Change the color of place `part` only, among the several places a note marks (the place right-clicked on the canvas, or hit and then 1–6;
   * handy for saying which place needs which change by color in the comment). Without color = the color from Settings. Normalized to the
   * stored form (equal colors collapse to the note's single color), the snapshot is redrawn; undoable
   */
  const setPlaceColor = async (t: Target, part: number, color: string | undefined) => {
    const stored = filesRef.current.get(t.key);
    const now = stored?.file.annotations.find((x) => x.id === t.a.id);
    if (!stored || !now || part >= shapesOf(now).length) return;
    const r = recolorPlace(shapesOf(now), now.color, part, color, opts.markColor);
    if (JSON.stringify(r.shapes) === JSON.stringify(shapesOf(now)) && sameColor(r.color, now.color)) return;
    const { color: _old, ...rest } = now;
    const next = upsertAnnotation(stored.file, {
      ...rest,
      ...(r.color ? { color: r.color } : {}),
      anchor: { ...now.anchor, shapes: r.shapes },
      updated_at: new Date().toISOString(),
    });
    if (await commit(stored.home, next, { base: stored.file })) refreshShots(t.key, [now.id]);
  };

  /** Deleting a note asks first (Delete, the card, the context menu and the menu bar all come here); a deletion can still be undone with Ctrl+Z */
  const remove = (a: Annotation, key = selectedKey) => {
    if (key) opts.ask({ kind: "delete", annotation: a, key });
  };
  /**
   * Delete several: one note asks as a single deletion; several (the checked ones) ask once (cleanup is not split by resolved or not; the
   * user checks which ones to clean up). Same rule as status changes: with checked notes it means those, otherwise the selected note
   */
  const removeTargets = (targets: Target[]) => {
    if (targets.length === 1) remove(targets[0].a, targets[0].key);
    else if (targets.length > 1) opts.ask({ kind: "deleteMany", items: targets });
  };
  /** Delete several at once: written per notes file and combined into one undo step */
  const deleteMany = async (targets: Target[]) => {
    const byKey = new Map<string, string[]>();
    for (const t of targets) byKey.set(t.key, [...(byKey.get(t.key) ?? []), t.a.id]);
    const saved = await Promise.all(
      [...byKey].map(([key, ids]) => {
        const stored = filesRef.current.get(key);
        if (!stored) return false;
        let next = stored.file;
        for (const id of ids) next = removeAnnotation(next, id);
        return commit(stored.home, next, { base: stored.file, record: false });
      }),
    );
    const op = recordTogether(saved);
    if (!op) return;
    const gone = new Set(targets.map((t) => `${t.key}|${t.a.id}`));
    if (selectedKey && selectedId && gone.has(`${selectedKey}|${selectedId}`)) setSelectedId(undefined);
    if (selectedNote && gone.has(selectedNote)) setSelectedNote(undefined);
    closeDraftOf(gone);
    opts.setChecked([]);
    onNotify(intl.formatMessage({ id: "app.deleted.many" }, { count: targets.length }), {
      label: intl.formatMessage({ id: "app.undo.action" }),
      run: () => void undo(op),
    });
  };
  /** The item is gone: delete all of its notes (the file stays and the notes are emptied, same as deleting the last note; Ctrl+Z undoes it) */
  const deleteMissingNotes = (key: string) => {
    const stored = filesRef.current.get(key);
    if (!stored) return;
    void commit(stored.home, { ...stored.file, annotations: [] }, { base: stored.file });
    if (selectedNote?.startsWith(`${key}|`)) setSelectedNote(undefined);
  };
  const deleteAnnotation = (a: Annotation, key: string) => {
    const stored = filesRef.current.get(key);
    if (!stored) return;
    void commit(stored.home, removeAnnotation(stored.file, a.id), { base: stored.file });
    if (key === selectedKey && selectedId === a.id) setSelectedId(undefined);
    if (selectedNote === `${key}|${a.id}`) setSelectedNote(undefined);
    closeDraftOf(new Set([`${key}|${a.id}`]));
  };
  /**
   * The note being edited in the composer was deleted (the menu's "Delete Selected Note" and the canvas context menu can both delete it):
   * the composer closes with it. Otherwise it stayed open, and saving would create the note again under a new id, as if it had never been deleted
   */
  const closeDraftOf = (gone: Set<string>) =>
    opts.setDraft((d) => {
      const key = d?.folder ? folderKey(d.folder) : opts.currentPath.current;
      return d?.id && key && gone.has(`${key}|${d.id}`) ? undefined : d;
    });

  return {
    changeShape,
    setStatus,
    setStatusMany,
    setColorMany,
    setPlaceColor,
    remove,
    removeTargets,
    deleteMany,
    deleteMissingNotes,
    deleteAnnotation,
  };
}

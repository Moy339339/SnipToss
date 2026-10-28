import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useIntl } from "react-intl";
import {
  emptyMaterialFile,
  isWritable,
  newAnnotationId,
  upsertAnnotation,
  type Annotation,
  type AnnotationCategory,
  type Material,
  type Shape,
} from "@sniptoss/core";
import type { ScreenBox } from "./AnnotationLayer";
import { folderKey, type AnnotationStore } from "./annotationStore";
import type { ComposerAnchor, ComposerValue } from "./Composer";
import { cssZoom } from "./cssZoom";
import type { Draft, useDraftState } from "./draft";
import { call, homeJoin, keyOf, logError, type AppInfo, type MaterialEntry } from "./host";
import { commonFolder, relInside, type FolderTarget } from "./library";
import { normalizePlaceColors, recolorPlace } from "./markColors";
import { naturalSize } from "./mediaSize";
import type { useMaterialVersions } from "./materialVersions";
import type { usePanelScope } from "./panelScope";
import type { Prefs } from "./prefs";
import type { Report } from "./report";
import { wantedTime } from "./scrub";
import type { useSnapshots } from "./snapshots";
import type { Media } from "./Viewer";

// Opening the composer and saving what was written (split out of Workspace): after drawing a mark, timestamped comments, overall comments,
// folder comments, editing an existing note. What the composer currently holds and whether there is unsaved text is in draft.ts

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The current time of the video (seconds, three decimals; while dragging the progress bar or holding an arrow key the frame lags a
 * little, so the playhead's moment is used); none for an image
 */
export const mediaTime = (media: Media | null) => (media instanceof HTMLVideoElement ? round3(wantedTime(media)) : undefined);

/**
 * Size and duration of the item on the canvas. An item that cannot be opened or hasn't finished loading can still get an overall comment
 * ("the file is broken, re-export it"); then there is none and nothing is recorded (it used to record width and height 0 and duration NaN,
 * which becomes null in JSON)
 */
function materialMetaSize(media: Media): Pick<Material, "width" | "height" | "duration"> {
  const out: Pick<Material, "width" | "height" | "duration"> = {};
  // Original image size: an SVG uses its declared size, and an image converted by the shell uses the pre-conversion size (mediaSize.ts)
  const { w, h } = naturalSize(media);
  if (w > 0 && h > 0) Object.assign(out, { width: w, height: h });
  if (media instanceof HTMLVideoElement && Number.isFinite(media.duration) && media.duration > 0) out.duration = round3(media.duration);
  return out;
}

export function useComposer(opts: {
  appInfo?: AppInfo;
  prefs: Prefs;
  current: MaterialEntry | undefined;
  /** The item open on the canvas (its key): by the time of saving the item may have changed */
  currentPath: RefObject<string | undefined>;
  canAnnotate: boolean;
  mediaRef: RefObject<Media | null>;
  stageRef: RefObject<HTMLElement | null>;
  drafts: Pick<ReturnType<typeof useDraftState>, "draft" | "setDraft" | "draftDirty" | "unlessDirty">;
  setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedNote: (id: string | undefined) => void;
  store: Pick<AnnotationStore, "filesRef" | "commit">;
  snapshots: Pick<ReturnType<typeof useSnapshots>, "takeSnapshot" | "snapshotFailed">;
  report: Pick<Report, "notifyError" | "reasonOf">;
  /** After a folder comment is written it must be visible in the notes panel: if the notes panel doesn't list it, the scope is switched */
  scope: Pick<ReturnType<typeof usePanelScope>, "scopeKind" | "project" | "scopeMaterials" | "setPanelScope">;
  /** Switch to a path in the library */
  reveal: (path: string) => void;
  /** Pause the video if "Pause video when writing a note" is on in Settings */
  pauseVideo: () => void;
  /**
   * Which version the item is on now (materialVersions.ts): a new note records the version it is written on; editing the text of a note
   * on an earlier version doesn't retake its snapshot from the current canvas
   */
  versions: Pick<ReturnType<typeof useMaterialVersions>, "currentSha" | "rememberSha" | "earlierOf">;
  /** A new note was saved (not an edit of an old one): the first time, hints where the copy button is (onboarding.ts) */
  onSavedNew?: () => void;
}) {
  const { prefs, current, currentPath, mediaRef, stageRef, setSelectedId, setSelectedNote } = opts;
  const { draft, setDraft, draftDirty, unlessDirty } = opts.drafts;
  const { filesRef, commit } = opts.store;
  const { takeSnapshot, snapshotFailed } = opts.snapshots;
  const { notifyError, reasonOf } = opts.report;
  const intl = useIntl();

  /**
   * The category of the last new note of each item (folder comments per folder): the next one starts with it, so writing several
   * "Remove" notes in a row doesn't need switching each time. Kept in memory only; the first note of an item uses the "default category"
   * from Settings
   */
  const lastCategory = useRef(new Map<string, AnnotationCategory>());
  /** Which category a new note starts with: the last new note written on this item, otherwise the default category from Settings */
  const nextCategory = (key?: string) => (key && lastCategory.current.get(key)) || prefs.defaultCategory;
  const author = () => prefs.author.trim() || opts.appInfo?.userName || "user";

  /**
   * The composer sits next to the mark (box is the mark's bounding box on screen); an overall comment without a mark goes centered at the
   * top of the canvas area
   */
  const stageAnchor = (box?: ScreenBox): ComposerAnchor => {
    // The mark's bounding box is in screen pixels, while the composer's position is in pre-zoom units inside the canvas area (when the
    // interface size is not 100%, see cssZoom.ts)
    const s = stageRef.current!.getBoundingClientRect();
    const z = cssZoom(stageRef.current!);
    if (!box) return { x: s.width / z / 2 - 170, y: 60 };
    const avoid = {
      left: (box.left - s.left) / z,
      top: (box.top - s.top) / z,
      right: (box.right - s.left) / z,
      bottom: (box.bottom - s.top) / z,
    };
    return { x: avoid.right + 12, y: avoid.top, avoid };
  };

  /**
   * A mark was just drawn. If the note being written already has marks (the composer is open, or auto-open is off in Settings and what was
   * drawn hasn't been written yet): add it to that note with the same number, and the composer doesn't move (when many places need the same
   * change, the same sentence need not be said several times; docs/adr/0009-several-places.md).
   * at: the moment given by the canvas context menu "Add Note Here…", which also opens the composer directly (clicking in the menu means
   * a new note is wanted)
   */
  const onCreate = (shape: Shape, box: ScreenBox, at?: { time?: number }) => {
    // Add to the latest draft: when two clicks come faster than the UI refreshes, building from the draft of this render would wipe the
    // place added by the first click
    if (!at && draft?.shapes?.length && !draft.folder) return setDraft((d) => (d?.shapes ? { ...d, shapes: [...d.shapes, shape] } : d));
    opts.pauseVideo();
    const t = at ? at.time : mediaTime(mediaRef.current);
    setSelectedId(undefined);
    setDraft({
      shapes: [shape],
      time: t !== undefined ? { start: t } : undefined,
      category: nextCategory(current && keyOf(current.path)),
      body: "",
      anchor: stageAnchor(box),
      composing: at ? true : prefs.autoCompose,
    });
  };
  /**
   * Overall comment: on a video it concerns the whole video, with no time; for a specific moment use a timestamped comment ("Set time" in
   * the composer can also switch to that)
   */
  const startWhole = () => {
    if (!opts.canAnnotate) return;
    if (draftDirty()) return unlessDirty(startWhole);
    opts.pauseVideo();
    setSelectedId(undefined);
    setDraft({
      category: nextCategory(current && keyOf(current.path)),
      body: "",
      anchor: stageAnchor(),
      composing: true,
    });
  };
  /**
   * Timestamped comment (videos only): about the current frame, with no position (a comment on the whole picture of this frame, to be kept
   * apart from a comment on the whole video). Records the moment of the key press (the video pauses if "Pause video when writing a note"
   * is on in Settings, like drawing a mark); in the composer it can become a span (O), and clearing the time with × makes it an overall comment
   */
  const startTimed = () => {
    if (!opts.canAnnotate || current?.kind !== "video") return;
    if (draftDirty()) return unlessDirty(startTimed);
    opts.pauseVideo();
    const t = mediaTime(mediaRef.current);
    setSelectedId(undefined);
    setDraft({
      time: t !== undefined ? { start: t } : undefined,
      category: nextCategory(keyOf(current.path)),
      body: "",
      anchor: stageAnchor(),
      composing: true,
    });
  };
  /**
   * Write / edit a folder comment: the composer goes centered at the top of the canvas area like an overall comment; it doesn't pause the
   * video and needs nothing open on the canvas
   */
  const startFolderNote = (folder: FolderTarget, existing?: Annotation) => {
    if (draft?.folder && draft.id === existing?.id && folderKey(draft.folder) === folderKey(folder) && existing)
      return setDraft({ ...draft, composing: true });
    if (draftDirty()) return unlessDirty(() => startFolderNote(folder, existing));
    setSelectedId(undefined);
    setDraft({
      folder,
      id: existing?.id,
      category: existing?.category ?? nextCategory(folderKey(folder)),
      body: existing?.body ?? "",
      anchor: stageAnchor(),
      composing: true,
    });
  };
  /** Edit a note on the canvas */
  const startEdit = (a: Annotation) => {
    if (draft?.id === a.id && !draft.folder) return setDraft({ ...draft, composing: true }); // this note is already being edited
    if (draftDirty()) return unlessDirty(() => startEdit(a));
    // The combined bounding box of the first mark and its number: the composer covers neither (a note with several places doesn't avoid
    // the box of all of them: when the places are scattered over the canvas no side has room)
    const rects = [
      ...document.querySelectorAll(`.annot-badge[data-id="${a.id}"][data-part="0"], .annot-shape[data-id="${a.id}"][data-part="0"]`),
    ].map((el) => el.getBoundingClientRect());
    const box = rects.length
      ? {
          left: Math.min(...rects.map((r) => r.left)),
          top: Math.min(...rects.map((r) => r.top)),
          right: Math.max(...rects.map((r) => r.right)),
          bottom: Math.max(...rects.map((r) => r.bottom)),
        }
      : undefined;
    setSelectedId(a.id);
    setDraft({
      id: a.id,
      shapes: a.anchor.shapes,
      time: a.anchor.time,
      category: a.category,
      body: a.body,
      anchor: stageAnchor(box),
      composing: true,
    });
  };

  /**
   * Not saved: the composer comes back with the text just written (if still on the same item and no other composer is open), so it can be
   * saved again right away once the disk works
   */
  const reopenDraft = (opened: Draft, v: ComposerValue, materialKey: string | undefined) =>
    setDraft(
      (d) =>
        d ?? (currentPath.current === materialKey ? { ...opened, category: v.category, body: v.body, time: v.time, composing: true } : d),
    );

  const saveFolderNote = async (folder: FolderTarget, v: ComposerValue) => {
    const opened = draft;
    const key = folderKey(folder);
    const file = filesRef.current.get(key)?.file ?? emptyMaterialFile({ path: folder.rel, kind: "folder" });
    const existing = draft?.id ? file.annotations.find((a) => a.id === draft.id) : undefined;
    const taken = new Set([...filesRef.current.values()].flatMap((s) => s.file.annotations.map((a) => a.id)));
    const now = new Date().toISOString();
    const annotation: Annotation = existing
      ? { ...existing, category: v.category, body: v.body, updated_at: now }
      : {
          id: newAnnotationId(taken),
          status: "open",
          category: v.category,
          body: v.body,
          anchor: {},
          author: author(),
          created_at: now,
          updated_at: now,
          replies: [],
        };
    setDraft(undefined);
    if (!(await commit(folder.home, upsertAnnotation(file, annotation), { base: file }))) {
      if (opened) reopenDraft(opened, v, currentPath.current);
      return;
    }
    if (!existing) {
      lastCategory.current.set(key, v.category);
      opts.onSavedNew?.();
    }
    // It must be visible in the notes panel once written: if the notes panel lists it now, leave it; otherwise switch to "Entire Project",
    // and if it is a folder of another project, move the canvas into that folder
    const { scopeKind, project, scopeMaterials } = opts.scope;
    const sameHome = (m: MaterialEntry) => keyOf(m.home) === keyOf(folder.home);
    const listed =
      scopeKind === "project"
        ? !!project && keyOf(project.home) === keyOf(folder.home)
        : scopeKind === "picked" && scopeMaterials.some(sameHome) && relInside(folder.rel, commonFolder(scopeMaterials.filter(sameHome)));
    if (!listed) {
      if (!current || !sameHome(current)) opts.reveal(homeJoin(folder.home, folder.rel === "." ? "" : folder.rel));
      opts.scope.setPanelScope("project");
    }
    const id = `${key}|${annotation.id}`;
    setSelectedNote(id);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.querySelector(`[data-annot="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" })),
    );
  };

  const materialMeta = async (m: MaterialEntry): Promise<Material> => {
    const media = mediaRef.current;
    // The item path in the notes file is relative to the notes folder (agents use it to find the item in the project)
    const sha256 = await call("sha256", { path: m.path });
    opts.versions.rememberSha(m, sha256);
    const meta: Material = { path: m.homeRel, kind: m.kind, sha256 };
    return media ? { ...meta, ...materialMetaSize(media) } : meta;
  };
  /**
   * The first note on an item has to read the size and compute the fingerprint first (a video of several hundred MB takes seconds); a
   * newly written note records the item's current fingerprint (ADR-0008, usually without reading the file). During this the composer
   * says "Saving…" and another Ctrl+Enter does nothing. Without that feedback the user thought the key press had not registered and
   * pressed again, saving two identical notes (when the shell responded slowly)
   */
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const saveDraft = async (v: ComposerValue) => {
    if (draft?.folder) return saveFolderNote(draft.folder, v);
    if (!current || !draft || savingRef.current) return;
    const opened = draft;
    const materialKey = keyOf(current.path);
    const now = new Date().toISOString();
    let meta: Material | undefined;
    /**
     * Which version of the item the new note is written on: if the item is overwritten later, this note belongs to "notes on earlier
     * versions". If it can't be computed it isn't recorded (it is then treated by the rules for old notes)
     */
    let sha: string | undefined;
    if (!filesRef.current.get(materialKey) || !draft.id) {
      // The first note on this item reads the size and computes the fingerprint (a large video takes a while); on failure the composer
      // stays open and says why
      savingRef.current = true;
      setSaving(true);
      try {
        const known = filesRef.current.get(materialKey)?.file;
        if (known) sha = await opts.versions.currentSha(current, known);
        else {
          meta = await materialMeta(current);
          sha = meta.sha256;
        }
      } catch (e) {
        logError("reading item info", e);
        notifyError(intl.formatMessage({ id: "app.save.failed" }, { reason: reasonOf(e, current.home) }), e, current.home);
        return;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }
    const stored = filesRef.current.get(materialKey)?.file;
    let file = stored ?? emptyMaterialFile(meta!);
    // The first note was an overall comment written while the item could not be opened (or hadn't finished loading), so no size was
    // recorded: add it now that the canvas is up, so REVIEW.md can convert coordinates to pixels
    const media = mediaRef.current;
    if (!file.material.width && file.material.kind !== "folder" && media && isWritable(file)) {
      const sized = materialMetaSize(media);
      if (sized.width) file = { ...file, material: { ...file.material, ...sized } };
    }
    const existing = draft.id ? file.annotations.find((a) => a.id === draft.id) : undefined;
    const taken = new Set([...filesRef.current.values()].flatMap((s) => s.file.annotations.map((a) => a.id)));
    const anchor: Annotation["anchor"] = {};
    // The color of each place and of the note as a whole: places recolored by right-click while the composer was open use the new color,
    // the rest stay as they were; places drawn afterwards carry no color, and one is added when the places differ in color
    // (normalizePlaceColors)
    const colors = normalizePlaceColors(draft.shapes ?? [], draft.noteColor ? draft.noteColor.color : existing?.color, prefs.markColor);
    if (colors.shapes.length) anchor.shapes = colors.shapes;
    if (v.time) anchor.time = v.time.end !== undefined ? { start: v.time.start, end: v.time.end } : { start: v.time.start };
    const withColor = ({ color: _old, ...rest }: Annotation): Annotation => (colors.color ? { ...rest, color: colors.color } : rest);
    const annotation: Annotation = existing
      ? withColor({ ...existing, category: v.category, body: v.body, anchor, updated_at: now })
      : {
          id: newAnnotationId(taken),
          status: "open",
          category: v.category,
          body: v.body,
          anchor,
          author: author(),
          created_at: now,
          updated_at: now,
          ...(sha ? { material_sha256: sha } : {}),
          ...(colors.color ? { color: colors.color } : {}),
          replies: [],
        };
    setDraft(undefined);

    // Only the text or category changed and the position didn't: the snapshot is not redrawn. It used to be redrawn from the current canvas
    // every time, so editing a sentence after the item was replaced overwrote the original snapshot with the new picture.
    // For a note written on an earlier version the snapshot is a record of the old picture, and even a changed time doesn't retake it
    // from the current canvas (ADR-0008)
    const keepShot =
      !!existing?.snapshot &&
      (JSON.stringify(existing.anchor) === JSON.stringify(anchor) || opts.versions.earlierOf(materialKey).has(existing.id));
    const shotError = keepShot ? undefined : await takeSnapshot(annotation, current.home, false);
    // The first note saved in a project doesn't pop up "where the notes are stored" (it blocks the work and is unnecessary): the bottom
    // of the notes panel always says where, and a click opens it
    const home = current.home;
    // base is the file before the change: the size added now counts as this side's change, so the merge doesn't treat it as "deleted by
    // the other side"
    const saved = commit(home, upsertAnnotation(file, annotation), { base: stored ?? file });
    // The UI already has it (commit changes the UI first, then queues the write): select it now. It used to be selected only after the write
    // finished; when writing was slow (agents writing back densely, a network drive) the user had already clicked another card, the
    // selection jumped back to this note afterwards, and pressing Delete then deleted this one
    setSelectedId(annotation.id);
    // A card's data-annot is "item key|id" (panelScope's itemId): looking it up by id alone never scrolled a newly written note into view
    if (!existing)
      requestAnimationFrame(() =>
        document.querySelector(`[data-annot="${CSS.escape(`${materialKey}|${annotation.id}`)}"]`)?.scrollIntoView({ block: "nearest" }),
      );
    if (!(await saved)) {
      setSelectedId((id) => (id === annotation.id ? undefined : id));
      reopenDraft(opened, v, materialKey);
      return;
    }
    if (!existing) {
      lastCategory.current.set(materialKey, v.category);
      opts.onSavedNew?.();
    }
    if (shotError) snapshotFailed(shotError, home);
  };

  /**
   * Remove one mark from the note being written (the composer's "undo last place" and Alt+Z: the last place drawn; right-click on a place
   * on the canvas: that place). Not when only one is left: that would cancel the whole note
   */
  const removeDraftPlace = (part?: number) =>
    setDraft((d) =>
      d?.shapes && d.shapes.length > 1 ? { ...d, shapes: d.shapes.filter((_, i) => i !== (part ?? d.shapes!.length - 1)) } : d,
    );

  /**
   * Change the color of place `part` of the note being written (right-click on that place on the canvas; with several places, one place
   * can get a different color so the comment can refer to it by color). Without color = the color from Settings. When editing an
   * existing note, it starts from that note's original color; it is written to the file only on save
   */
  const recolorDraftPlace = (part: number, color: string | undefined) => {
    const existing =
      draft?.id && current ? filesRef.current.get(keyOf(current.path))?.file.annotations.find((a) => a.id === draft.id) : undefined;
    setDraft((d) => {
      if (!d?.shapes || part >= d.shapes.length) return d;
      const r = recolorPlace(d.shapes, d.noteColor ? d.noteColor.color : existing?.color, part, color, prefs.markColor);
      return { ...d, shapes: r.shapes, noteColor: { color: r.color } };
    });
  };

  return { onCreate, startWhole, startTimed, startFolderNote, startEdit, saveDraft, saving, removeDraftPlace, recolorDraftPlace };
}

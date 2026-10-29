import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useIntl } from "react-intl";
import { DATA_DIR, shapesOf, type Annotation, type AnnotationStatus, type MaterialKind } from "@sniptoss/core";
import { AnnotationLayer, markAt, type MarkHit, type ShownAnnotation } from "./AnnotationLayer";
import { type Tool } from "./annotate";
import { Composer } from "./Composer";
import { AskDialog, type Ask } from "./AskDialog";
import { baseName, call, homeJoin, keyOf, logError, materialUrl, onHostEvent, platform, type AppInfo, type MaterialEntry } from "./host";
import { buildMenus } from "./appMenus";
import { useNativeMenus } from "./nativeMenus";
import { ContextMenu, type MenuItem } from "./Menu";
import { annotationMenu, draftMarkMenu, materialMenu, panelMenu, stagePointAt, type StagePoint } from "./stageMenu";
import { noteColorOf, placeColorOf } from "./markColors";
import { TitleBar } from "./TitleBar";
import { folderAt, folderOfMaterial, useLibrary } from "./library";
import { LibraryPanel } from "./LibraryPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { keycaps, prettyKeys } from "./hotkey";
import { useKeys } from "./keys";
import { Sash, usePanels } from "./Panels";
import { MARK_COLORS, usePrefs } from "./prefs";
import { StageHeader } from "./StageHeader";
import { AnnotationCard } from "./AnnotationCard";
import { Viewer, type Media } from "./Viewer";
import { ZoomExtras } from "./ZoomView";
import { EyeIcon, EyeOffIcon } from "./icons";
import { useCaptureControls, useWindowState } from "./windowControls";
import { useReport, type Notify } from "./report";
import { itemId, numbered, usePanelScope, type Item } from "./panelScope";
import { useChecks, useHandoff } from "./handoff";
import { useMaterialVersions } from "./materialVersions";
import { EarlierShot } from "./EarlierShot";
import { MarkColorBar } from "./MarkColorBar";
import { AnnotationPanel } from "./AnnotationPanel";
import { blockedReason, isFolderKey, opKind, useAnnotationStore, type Op } from "./annotationStore";
import { type SeekRequest } from "./VideoPlayer";
import { IntroDialog, Welcome } from "./Welcome";
import { useOnboarding } from "./onboarding";
import { Tour } from "./Tour";
import { Hint } from "./Hint";
import { copyDiagnostics, diagnosticsText, reportIssue } from "./diagnostics";
import { useUpdates } from "./updates";
import { useHoldKeys } from "./holdKeys";
import { useLibraryActions } from "./libraryActions";
import { useDraftState } from "./draft";
import { useSnapshots } from "./snapshots";
import { mediaTime, useComposer } from "./compose";
import { useNavigation } from "./navigation";
import { useAnnotationEdits } from "./annotationEdits";

export type { Notify } from "./report";

/** Item types that can be annotated (PDF, PPT later) */
const ANNOTATABLE: MaterialKind[] = ["image", "video"];

export function WorkspaceView(props: {
  appInfo?: AppInfo;
  onHelp: () => void;
  /** Open Settings; section is which page to show first (menu "Help → About", etc.) */
  onSettings: (section?: string) => void;
  onNotify: Notify;
  /** The notes folder of the current item (the Settings window needs it) */
  onHome: (home: string | undefined) => void;
}) {
  const { onNotify } = props;
  const intl = useIntl();
  const { prefs, setPrefs } = usePrefs();
  const library = useLibrary();
  const { revealInExplorer, reasonOf, notifyError, copyReason, describeBad } = useReport(onNotify);
  const updates = useUpdates(onNotify);

  /** REVIEW.md marks which notes were written on older versions: the resolver (materialVersions) is created after the note store, so it goes through this ref */
  const earlierInRef = useRef<(home: string) => Record<string, readonly string[]>>(() => ({}));
  const store = useAnnotationStore({
    library,
    includeResolved: prefs.reviewIncludeResolved,
    onNotify,
    report: { notifyError, reasonOf, describeBad },
    afterStep: (part, target, other) => resnap(part, target, other),
    onStep: (op, redone) => notifyHistory(op, redone),
    earlierIn: (home) => earlierInRef.current(home),
  });
  const { files, filesRef, unreadable, unreadableRef, missing, openCount, homeFiles, commit, undo, redo } = store;

  const [selectedKey, setSelectedKey] = useState<string>();
  const current = selectedKey ? library.byKey.get(selectedKey) : undefined;
  const currentFile = selectedKey ? files.get(selectedKey)?.file : undefined;
  const annotations = useMemo(() => currentFile?.annotations ?? [], [currentFile]);
  // After an item is overwritten, which notes were written on an older version: not drawn on the canvas, shown as a separate section in the notes panel (materialVersions.ts, ADR-0008). Once settled or changed, that project's REVIEW.md is rewritten
  const versions = useMaterialVersions({
    files,
    library,
    selectedKey,
    onChanged: (home) => void store.writeReview(home).catch((e: unknown) => logError("Writing REVIEW.md", e, "warn")),
  });
  earlierInRef.current = versions.earlierIn;
  const currentEarlier = versions.earlierOf(selectedKey);
  /** The notes of the item on the canvas, split into sections and numbered (same as the notes panel) */
  const currentItems = useMemo(
    () => (selectedKey ? numbered(selectedKey, annotations, currentEarlier) : []),
    [selectedKey, annotations, currentEarlier],
  );
  const currentBlocked = current
    ? blockedReason(unreadable, current.home, { path: current.homeRel, kind: current.kind }, currentFile)
    : undefined;
  const canAnnotate = !!current && ANNOTATABLE.includes(current.kind) && !currentBlocked;
  /** The URL of the canvas that failed to open (reported by Viewer). The URL carries the modified time, so once the file is fixed the URL changes and it no longer counts as broken */
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const mediaBroken = !!current && brokenUrl === materialUrl(current);
  /** Marks can be drawn on the canvas: when the canvas cannot open there is no note layer and the drawing tools are grayed out, but overall comments can still be written */
  const canDraw = canAnnotate && !mediaBroken;
  /** Timestamped comments can be written: video whose canvas can open (if it cannot, there is no "this moment") */
  const canTimed = canDraw && current?.kind === "video";
  const currentPath = useRef(selectedKey);
  currentPath.current = current ? selectedKey : undefined;

  const [tool, setTool] = useState<Tool>("select");
  useEffect(() => {
    if (!canDraw && current && tool !== "select" && tool !== "hand") setTool("select");
  }, [canDraw, current, tool]);
  const [selectedId, setSelectedId] = useState<string>();
  /** The mark clicked on the canvas (which note's which mark, reported by AnnotationLayer): when a note has several marks, the number keys recolor only this one */
  const [armed, setArmed] = useState<{ id: string; part: number }>();
  /** The mark hit by a single click (no id = it belongs to the note being written): a row of colors pops up next to it (MarkColorBar) */
  const [picked, setPicked] = useState<MarkHit>();
  /** The folder comment selected in the notes panel (itemId): it is not on the canvas, so it is tracked separately from the mark selected on the canvas */
  const [selectedNote, setSelectedNote] = useState<string>();
  const [seek, setSeek] = useState<SeekRequest>();
  const [dims, setDims] = useState<{ w: number; h: number }>();
  const mediaRef = useRef<Media | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  // On the Mac: whether macOS lets the app record the screen (asked once; allowing it takes a restart of the app anyway)
  const [noScreenAccess, setNoScreenAccess] = useState(false);
  useEffect(() => {
    if (platform !== "mac") return;
    call("captureSettings")
      .then((c) => setNoScreenAccess(c.screenAccess === false))
      .catch((e) => logError("captureSettings", e));
  }, []);
  // Onboarding tour and first-use hints (onboarding.ts): the tour runs the first time an item is shown; a hint appears once the first time a video is opened and once when the first note is saved,
  // and on the Mac without the permission to record the screen, once next to Capture
  const onboarding = useOnboarding({ current, selectedKey, video: canTimed && !!dims, noScreenAccess });
  const [ask, setAsk] = useState<Ask>();
  // The note being written in the composer: draft.ts; opening the composer and saving: compose.ts (see "Drawing notes" below)
  const { draft, setDraft, liveDraft, draftDirty, unlessDirty, discardDraft } = useDraftState({
    currentPath,
    library,
    selectedKey,
    dims,
    onNotify,
    reveal: (path) => reveal(path),
    ask: setAsk,
  });
  // Note snapshots: snapshots.ts
  const { takeSnapshot, snapshotFailed, resnap, refreshShots } = useSnapshots({
    mediaRef,
    prefs,
    currentPath,
    selectedKey,
    dims,
    store,
    report: { notifyError, reasonOf },
    earlierOf: versions.earlierOf,
  });
  const layoutRef = useRef<HTMLDivElement>(null);
  const { panels, vars, toggle, toggleBoth, startDrag, reset, resetAll } = usePanels(layoutRef);

  // ---------- Which items the notes panel lists: panelScope.ts ----------
  const scope = usePanelScope({ library, files, earlierOf: versions.earlierOf, missing, selectedKey, current, prefs, setPrefs });
  const {
    onPicked,
    clearPick,
    requestClearPick,
    setPanelScope,
    project,
    scopeKind,
    grouped,
    groups,
    panelQuery,
    setPanelQuery,
    terms,
    searching,
    panelSearch,
    passes,
    revealSection,
    allItems,
    folderOpenCount,
    missingOpenCount,
    listForNav,
    openList,
  } = scope;
  /** One note of the item on the canvas */
  const itemOf = (a: Annotation): Item =>
    currentItems.find((it) => it.a.id === a.id) ?? { a, key: selectedKey!, section: "marked", index: 0 };

  useEffect(() => {
    document.title = current ? baseName(current.path) : intl.formatMessage({ id: "brand.name" });
  }, [current, intl]);

  const { onHome } = props;
  useEffect(() => onHome(current?.home), [onHome, current?.home]);

  /**
   * The notice after undo / redo: what was undone; if it is not on the item shown on the canvas, say where and offer "Go there"
   * (a fixed "Undone" would leave the user not knowing what was undone when the notes panel lists a whole project and the undo landed on another item)
   */
  const notifyHistory = (op: Op, redone: boolean) => {
    const done = intl.formatMessage({ id: redone ? "app.redo.what" : "app.undo.what" }, { what: opKind(op) });
    // A step spanning several items (bulk status change): do not say which item
    if (op.key === currentPath.current || op.rest?.length) return onNotify(done);
    if (isFolderKey(op.key)) {
      const name = folderAt(op.home, op.after.material.path).name;
      return onNotify(intl.formatMessage({ id: "app.history.onFolder" }, { done, name }));
    }
    const m = library.byKey.get(op.key);
    const name = baseName(m?.path ?? op.after.material.path);
    onNotify(
      intl.formatMessage({ id: "app.history.onMaterial" }, { done, name }),
      m ? { label: intl.formatMessage({ id: "app.history.go" }), run: () => reveal(m.path) } : undefined,
    );
  };

  // ---------- Selecting and navigating: which item is open on the canvas lives in navigation.ts ----------
  const { selectMaterial, showMaterial, reveal, stepMaterial, canStepMaterial } = useNavigation({
    library,
    prefs,
    selectedKey,
    setSelectedKey,
    store,
    folderDraft: !!draft?.folder,
    unlessDirty,
    requestClearPick,
    onShow: () => {
      setSeek(undefined);
      // A folder comment being written does not follow the item, so switching items does not lose it
      setDraft((d) => (d?.folder ? d : undefined));
      setSelectedId(undefined);
      setDims(undefined);
    },
    // Items brought in from the command line or context menu: ones recognized as moved and ones not added (not found, unsupported, ...) were queued by the shell and are only reported now
    onLoaded: (state) => {
      if (!notifyRelocated(state.relocated)) notifySkipped(state.skipped);
    },
    onNotify,
  });

  // ---------- Adding to the library, removing, clearing: libraryActions.ts ----------
  const { notifySkipped, notifyRelocated, relocateEntry, addFiles, addFolder, paste, dragging, removeEntries, clearList, pinProject } =
    useLibraryActions({ library, prefs, onNotify, reasonOf, reveal });

  /** Select a note and seek the video to its moment. If it belongs to another item (when the notes panel lists several items), switch the canvas to that item first; the selection on the left stays unchanged */
  const pickItem = (it: Item) => {
    // It is in a collapsed section (its mark was clicked on the canvas): expand that section so the card is visible
    revealSection(it);
    // Folder comments and notes whose item is gone: there is no canvas to switch to, just select this note
    if (isFolderKey(it.key) || (it.key !== selectedKey && !library.byKey.has(it.key))) {
      setSelectedId(undefined);
      setSelectedNote(itemId(it));
      requestAnimationFrame(() => document.querySelector(`[data-annot="${CSS.escape(itemId(it))}"]`)?.scrollIntoView({ block: "nearest" }));
      return;
    }
    const show = () => {
      setSelectedNote(undefined);
      setSelectedId(it.a.id);
      // On an older version: its time refers to the video before it was overwritten, so do not seek; the canvas shows the snapshot from back then (EarlierShot)
      if (it.a.anchor.time && it.section !== "earlier") setSeek({ time: it.a.anchor.time.start, nonce: Date.now() });
      requestAnimationFrame(() => document.querySelector(`[data-annot="${CSS.escape(itemId(it))}"]`)?.scrollIntoView({ block: "nearest" }));
    };
    if (it.key === selectedKey) return show();
    const m = library.byKey.get(it.key);
    if (!m) return;
    // Switching to another item: ask first about what is being written in the composer (if the answer is "keep writing", change nothing)
    const go = () => {
      showMaterial(m, true);
      show();
    };
    if (draft?.folder) go();
    else unlessDirty(go);
  };
  const pickAnnotation = (a: Annotation) => pickItem(itemOf(a));

  // ---------- Drawing notes ----------
  const pauseVideo = () => {
    if (prefs.pauseOnAnnotate && mediaRef.current instanceof HTMLVideoElement) mediaRef.current.pause();
  };
  const chooseTool = (t: Tool) => {
    const navigation = t === "select" || t === "hand";
    if (!navigation && !canDraw) return;
    if (!navigation) {
      pauseVideo();
      // Currently looking at the snapshot of a note on an older version (EarlierShot): when drawing starts, return to the current canvas rather than draw on a canvas that is not visible
      if (selectedId && currentEarlier.has(selectedId)) setSelectedId(undefined);
    }
    setTool(t);
  };

  // ---------- Hiding marks on the canvas (marks that are too close overlap; all marks can also be hidden to see the original) ----------
  // Hide all (the eye on the zoom bar, menu View, Shift+H) or hide one (the eye on a card, right-click). This only changes how you look at it: nothing is written to the note files and copying for AI is unaffected;
  // it is remembered only for this run (after a restart the marks are all there, so the notes never look lost). A hidden one is still drawn when selected: after hiding all, clicking a note = see only that note's marks
  const [marksHidden, setMarksHidden] = useState(false);
  /** Marks hidden one by one (itemId) */
  const [hiddenMarks, setHiddenMarks] = useState<ReadonlySet<string>>(() => new Set());
  const toggleMark = (it: Item) =>
    setHiddenMarks((prev) => {
      const next = new Set(prev);
      if (!next.delete(itemId(it))) next.add(itemId(it));
      return next;
    });
  /** "Hide marks" on cards and the context menu: only for notes in the canvas-marks section whose item still exists */
  const markToggle = (it: Item) =>
    it.section === "marked" && !isFolderKey(it.key) && !missing.has(it.key)
      ? { hidden: hiddenMarks.has(itemId(it)), toggle: () => toggleMark(it) }
      : undefined;

  // Hold H = temporary Hand tool, hold-to-use mode (hold C / R / B / A): holdKeys.ts
  const { handHeld } = useHoldKeys({ chooseTool, setTool, holdTools: prefs.holdTools, canDraw });
  const videoTime = () => mediaTime(mediaRef.current);

  const { onCreate, startWhole, startTimed, startFolderNote, startEdit, saveDraft, saving, removeDraftPlace, recolorDraftPlace } =
    useComposer({
      appInfo: props.appInfo,
      prefs,
      current,
      currentPath,
      canAnnotate,
      mediaRef,
      stageRef,
      drafts: { draft, setDraft, draftDirty, unlessDirty },
      setSelectedId,
      setSelectedNote,
      store,
      snapshots: { takeSnapshot, snapshotFailed },
      report: { notifyError, reasonOf },
      scope,
      reveal,
      pauseVideo,
      versions,
      onSavedNew: onboarding.savedNew,
    });
  /** The folder containing the item on the canvas (Shift+N, menu Annotate, right-click on the canvas) */
  const currentFolder = current ? folderOfMaterial(current) : undefined;
  const startCurrentFolderNote = () => currentFolder && startFolderNote(currentFolder);

  // ---------- Moving marks, changing status, deleting: annotationEdits.ts ----------
  const {
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
  } = useAnnotationEdits({
    current,
    currentPath,
    selectedKey,
    selectedId,
    setSelectedId,
    selectedNote,
    setSelectedNote,
    setDraft,
    setChecked: (ids) => setChecked(ids),
    store,
    snapshots: { takeSnapshot, snapshotFailed, refreshShots },
    ask: setAsk,
    onNotify,
    markColor: prefs.markColor,
  });

  /** Editing happens on the canvas: for a note of another item, switch the canvas first, wait for it to load (dims available), then open the composer */
  const [pendingEdit, setPendingEdit] = useState<{ key: string; id: string }>();
  const editItem = (it: Item) => {
    // Ask first, then act: when the answer is "keep writing", no pending edit (pendingEdit) may be left waiting to open
    if (draftDirty() && draft?.id !== it.a.id) return unlessDirty(() => editItem(it));
    if (isFolderKey(it.key)) {
      const stored = filesRef.current.get(it.key);
      if (stored) startFolderNote(folderAt(stored.home, stored.file.material.path), it.a);
      return;
    }
    if (missing.has(it.key)) return onNotify(intl.formatMessage({ id: "app.material.goneEdit" }));
    if (it.key === selectedKey) return startEdit(it.a);
    pickItem(it);
    setPendingEdit({ key: it.key, id: it.a.id });
  };
  useEffect(() => {
    if (!pendingEdit || pendingEdit.key !== selectedKey || !dims) return;
    setPendingEdit(undefined);
    const a = annotations.find((x) => x.id === pendingEdit.id);
    if (a) requestAnimationFrame(() => startEdit(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdit, selectedKey, dims, annotations]);
  // ---------- Handing off to AI: checking, Copy as Text / Images, see handoff.ts ----------
  const checks = useChecks(groups, listForNav);
  const { checkedList, checkedIds, setChecked, toggleCheck } = checks;
  const handoff = useHandoff({
    filesRef,
    unreadableRef,
    missing,
    commit,
    earlierOf: versions.earlierOf,
    current,
    grouped,
    openList,
    checkedList,
    prefs,
    onNotify,
    report: { notifyError, copyReason },
  });
  const { toCopy, thisKind, copyOne, copyCurrent, copyMaterials, listedMaterialCount, openItems } = handoff;
  const home = current?.home;
  const homeHasNotes = !!home && homeFiles(home).some((f) => f.annotations.length > 0);
  const revealDataDir = () => {
    if (home)
      void call("reveal", { path: homeJoin(home, DATA_DIR) }).catch(() =>
        onNotify(intl.formatMessage({ id: "settings.general.storageMissing" })),
      );
  };

  // ---------- Shortcuts ----------
  /** The note selected in the notes panel: the mark selected on the canvas, or a folder comment */
  const selectedAnnotation = annotations.find((a) => a.id === selectedId);
  const selectedNoteItem = selectedNote ? listForNav.find((it) => itemId(it) === selectedNote) : undefined;
  const selectedItem = selectedNoteItem ?? listForNav.find((it) => it.key === selectedKey && it.a.id === selectedId);
  /** Ctrl+P "Find Item": if the library is collapsed, expand it first, then put the cursor in the filter box */
  const [findNonce, setFindNonce] = useState(0);
  const findMaterial = () => {
    if (panels.left.collapsed) toggle("left");
    setFindNonce((n) => n + 1);
  };
  /** Search box: Enter selects the first match, ↓ moves into the list, Esc clears the text first (same as the library's filter box) */
  const onPanelSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && listForNav.length) {
      e.preventDefault();
      pickItem(listForNav[0]);
      e.currentTarget.blur();
    } else if (e.key === "ArrowDown" && listForNav.length) {
      e.preventDefault();
      document.querySelector<HTMLElement>(".panel-body .card")?.focus();
    } else if (e.key === "Escape" && panelQuery) {
      e.preventDefault();
      e.stopPropagation(); // Keep the global Esc from moving the cursor away: after clearing, keep typing
      setPanelQuery("");
    }
  };
  /**
   * Ctrl+F: put the cursor in the notes panel's search box (expand the panel first if it is collapsed, and wait for it to render). When it is already open, go in immediately:
   * waiting one frame every time would let text typed right after Ctrl+F land elsewhere, and a single letter would even be taken as a tool key (especially under heavy load)
   */
  const findAnnotation = () => {
    if (!panels.right.collapsed) return panelSearch.current?.select();
    toggle("right");
    requestAnimationFrame(() => panelSearch.current?.select());
  };
  /** [ ]: step between the notes visible in the notes panel; when several items are listed, stepping onto another item switches the canvas to it */
  const stepAnnotation = (dir: 1 | -1) => {
    if (listForNav.length === 0) return;
    const i = selectedItem ? listForNav.indexOf(selectedItem) : -1;
    const next = listForNav[i < 0 ? (dir > 0 ? 0 : listForNav.length - 1) : (i + dir + listForNav.length) % listForNav.length];
    pickItem(next);
  };

  /** Which notes a status change (D, Shift+D, menu Annotate, the row at the bottom) applies to: if some are checked, the checked ones; otherwise the selected note (same rule as copying) */
  const anyChecked = checkedList.length > 0;
  const statusTargets: { a: Annotation; key: string }[] = anyChecked
    ? checkedList
    : selectedNoteItem
      ? [selectedNoteItem]
      : selectedAnnotation && selectedKey
        ? [{ a: selectedAnnotation, key: selectedKey }]
        : [];
  const applyStatus = (targets: { a: Annotation; key: string }[], status: AnnotationStatus) => {
    void setStatusMany(targets, status);
    // Checked notes marked resolved while the notes panel does not list resolved ones: they vanish from the list, so clear the checks too (otherwise switching to "show resolved too" would find them still checked, and copying would include them)
    if (anyChecked && status !== "open" && !prefs.panelResolved) setChecked([]);
  };
  /**
   * Loop playback (Ctrl+L, menu): it is a setting, so it can be switched on images or with no item open (otherwise Ctrl+L would work only while a video is open, while the menu item stays enabled).
   * On video the player flashes "Loop: on / off"; elsewhere a toast says it
   */
  const toggleLoop = () => {
    setPrefs({ loop: !prefs.loop });
    if (current?.kind !== "video" || mediaBroken) onNotify(intl.formatMessage({ id: prefs.loop ? "video.loopOff" : "video.loopOn" }));
  };
  /**
   * Which notes a mark color change (number keys 1–6, menu Annotate) applies to: same as status changes (checked = the checked ones, none checked = the selected note), counting only notes with marks on the canvas;
   * overall comments and notes written on older versions have no marks to recolor (the right-click menu of a single note applies to that note only, see stageMenuItems)
   */
  const selectedMarked = selectedNoteItem ? undefined : currentItems.find((it) => it.a.id === selectedId && it.section === "marked");
  const colorTargets = anyChecked ? checkedList.filter((it) => it.section === "marked") : selectedMarked ? [selectedMarked] : [];
  /** The color the notes to recolor are drawn in now: only defined when they are all the same (that swatch is lit in the menu); a note with several marks of different colors also counts as different */
  const colorTargetsNow = (() => {
    const now = colorTargets.map((it) => noteColorOf(it.a, prefs.markColor));
    const all = new Set(now.map((c) => c?.toLowerCase()));
    return all.size === 1 ? now[0] : undefined;
  })();
  /**
   * Number keys: switch to the nth preset color; exactly the one in Settings = remove the individual color so it follows Settings.
   * When one mark of a multi-mark note was clicked on the canvas (and nothing else is checked): only that mark changes (same as picking a mark in Screen Capture; the note text can then refer to marks by color)
   */
  const colorKey = (n: number) => {
    if (colorTargets.length === 0 || draft) return false;
    const c = MARK_COLORS[n];
    const pick = c.toLowerCase() === prefs.markColor.toLowerCase() ? undefined : c;
    const place =
      !anyChecked && selectedMarked && armed?.id === selectedMarked.a.id && shapesOf(selectedMarked.a).length > 1 ? armed.part : undefined;
    if (place !== undefined) void setPlaceColor(selectedMarked!, place, pick);
    else void setColorMany(colorTargets, pick);
  };
  /** D = done, Shift+D = won't fix; if all targets are already in that state, reopen them (toggles back and forth, like Gmail's "mark as read") */
  const toggleStatus = (status: "resolved" | "wontfix") => {
    if (statusTargets.length === 0) return false;
    const pending = statusTargets.filter((t) => t.a.status !== status);
    applyStatus(pending.length > 0 ? pending : statusTargets, pending.length > 0 ? status : "open");
  };

  useKeys({
    "Ctrl+O": addFiles,
    "Ctrl+Shift+O": addFolder,
    F5: () => void library.rescan(),
    "Ctrl+ArrowDown": () => stepMaterial(1),
    "Ctrl+ArrowUp": () => stepMaterial(-1),
    "Ctrl+\\": toggleBoth,
    "Ctrl+B": () => toggle("left"),
    "Ctrl+P": () => findMaterial(),
    "Ctrl+F": () => findAnnotation(),
    "Ctrl+Alt+B": () => toggle("right"),
    V: () => chooseTool("select"),
    // H is handled separately above: a tap switches to Hand, holding is a temporary Hand
    C: () => chooseTool("point"),
    R: () => chooseTool("rect"),
    B: () => chooseTool("pen"),
    A: () => chooseTool("arrow"),
    N: startWhole,
    // Timestamped comment (video only): on images this key is not intercepted
    T: () => (canTimed ? startTimed() : false),
    // Folder comment: the folder containing the item on the canvas (other folders via right-click in the library)
    "Shift+N": () => void startCurrentFolderNote(),
    "[": () => stepAnnotation(-1),
    "]": () => stepAnnotation(1),
    "Ctrl+Z": () => void undo(),
    "Ctrl+Shift+Z": () => void redo(),
    "Ctrl+Y": () => void redo(),
    "Ctrl+Shift+A": () => void copyCurrent(),
    "Ctrl+Shift+I": () => void copyCurrent("images"),
    // Paste an image or copied files as items (Ctrl+V in an input still pastes text; keys.ts leaves it to the input)
    "Ctrl+V": () => void paste(),
    // Check / uncheck the current note (like Gmail's X); with nothing selected, or when it is not in the notes panel, leave the key to others
    X: () => (selectedItem ? toggleCheck(selectedItem) : false),
    D: () => toggleStatus("resolved"),
    "Shift+D": () => toggleStatus("wontfix"),
    "Shift+H": () => setMarksHidden((h) => !h),
    // Recolor the selected marks (the checked ones if any): 1–6 follow the order of the swatch row in Settings (like Lightroom's number keys for color labels)
    ...Object.fromEntries(MARK_COLORS.map((_, i) => [String(i + 1), () => colorKey(i)])),
    F11: () => windowCmd("fullscreen"),
    "Ctrl+L": toggleLoop,
    Escape: () => {
      if (draft) setDraft(undefined);
      else if (tool !== "select") setTool("select");
      else if (selectedId || selectedNote) {
        setSelectedId(undefined);
        setSelectedNote(undefined);
      } else if (checkedList.length > 0) setChecked([]);
    },
    Enter: () => {
      if (draft && !draft.composing) setDraft({ ...draft, composing: true });
      else if (selectedNoteItem) editItem(selectedNoteItem);
      else if (selectedAnnotation) startEdit(selectedAnnotation);
    },
    // Same as D: delete the checked notes if any are checked, otherwise the selected note (asks first)
    ...(statusTargets.length > 0 && !draft
      ? { Delete: () => removeTargets(statusTargets), Backspace: () => removeTargets(statusTargets) }
      : {}),
    // Images have no "internal paging", so ← → switch items directly; on video ← → step frames, handled in VideoPlayer
    ...(current?.kind === "image" && !draft ? { ArrowLeft: () => stepMaterial(-1), ArrowRight: () => stepMaterial(1) } : {}),
  });

  // ---------- Window (menu Window), Screen Capture (the shell's app/Capture): the state lives in the shell, see windowControls.ts ----------
  const { win, windowCmd } = useWindowState(onNotify);
  // When the window is hidden (to the tray, or hidden before a capture), stop any playing video (otherwise sound continues from an invisible window)
  useEffect(() => onHostEvent("windowHidden", () => mediaRef.current instanceof HTMLVideoElement && mediaRef.current.pause()), []);
  const { captureHotkey, captureHide, startCapture, setCaptureHideAlways } = useCaptureControls({
    onNotify,
    notifyError,
    onSettings: () => props.onSettings("capture"),
  });
  /** The capture shortcut as shown to people (key names follow the interface language): used by the welcome page, the tour and the composer */
  const captureKeys = keycaps(prettyKeys(captureHotkey), (id) => intl.formatMessage({ id }));

  // ---------- The context menu on the canvas: on a mark it is for that note, elsewhere for this item (stageMenu.tsx) ----------
  /** The context menu on the canvas and on note cards; panel = right-click on blank space in the notes panel (panelMenuItems) */
  /** item is the note that was right-clicked (part: which of its marks was hit); draftPart = which mark of the note being written was hit */
  const [stageMenu, setStageMenu] = useState<{
    x: number;
    y: number;
    item?: Item;
    part?: number;
    draftPart?: number;
    at?: StagePoint;
    panel?: boolean;
  }>();
  const onStageContextMenu = (e: React.MouseEvent) => {
    if (!current || (e.target as HTMLElement).closest(".composer, input, textarea")) return;
    e.preventDefault();
    // With a drawing tool the marks are covered by a transparent input layer, and with Hand the marks do not take the mouse: look them up by position
    const layer = stageRef.current?.querySelector(".annot-layer");
    const target = e.target as HTMLElement;
    const onMedia = !!target.closest(".zoom-view") && !target.closest(".zoom-control");
    const find = (id: string) => annotations.find((x) => x.id === id);
    const drafted = draft?.id && currentEarlier.has(draft.id) ? undefined : draft?.shapes;
    const hit = layer && onMedia ? markAt(layer, e.clientX, e.clientY, find, selectedId, drafted) : undefined;
    if (hit && hit.id === undefined) return setStageMenu({ x: e.clientX, y: e.clientY, draftPart: hit.part });
    const a = hit?.id ? find(hit.id) : undefined;
    if (a) setSelectedId(a.id);
    const at = !a && canDraw ? stagePointAt(e, stageRef.current, mediaRef.current, videoTime()) : undefined;
    setStageMenu({ x: e.clientX, y: e.clientY, item: a ? itemOf(a) : undefined, part: a ? hit!.part : undefined, at });
  };
  /** Drop a pin at the right-click position and open the composer; for video, return to the moment of the right-click (so the picture matches the recorded time) */
  const startPointAt = (at: StagePoint) => {
    if (!canDraw) return;
    if (draftDirty()) return unlessDirty(() => startPointAt(at));
    const box = { left: at.clientX, top: at.clientY, right: at.clientX, bottom: at.clientY };
    onCreate({ type: "point", x: at.x, y: at.y }, box, { time: at.time });
    const m = mediaRef.current;
    if (m instanceof HTMLVideoElement && m.paused && at.time !== undefined && Math.abs(m.currentTime - at.time) > 0.001)
      m.currentTime = at.time;
  };
  /** The menu for one note (right-click on a mark on the canvas, right-click in the notes panel and "⋯"); no it = right-click on blank canvas, at = where in the canvas the right-click landed */
  const stageMenuItems = (it?: Item, at?: StagePoint, part?: number, draftPart?: number): (MenuItem | "-")[] => {
    if (draftPart !== undefined)
      return draftMarkMenu(intl, {
        places: draft?.shapes?.length ?? 0,
        editing: !!draft?.id,
        color: {
          current: draft?.shapes?.[draftPart]?.color ?? draftColor ?? prefs.markColor,
          default: prefs.markColor,
          pick: (c) => recolorDraftPlace(draftPart, c),
        },
        remove: () => removeDraftPlace(draftPart),
        cancel: () => setDraft(undefined),
      });
    if (it) {
      const stored = filesRef.current.get(it.key);
      return annotationMenu(intl, it, {
        checked: checkedIds.has(itemId(it)),
        anyChecked,
        shotPath: it.a.snapshot && stored ? homeJoin(stored.home, `${DATA_DIR}/${it.a.snapshot}`) : undefined,
        copyOne,
        toggleCheck,
        edit: editItem,
        revealInExplorer,
        setStatus,
        remove,
        mark: markToggle(it),
        // The right-click hit one of several marks: that one mark alone can be removed (not offered when only one is left: that would delete the whole note)
        removePlace: part !== undefined && shapesOf(it.a).length > 1 && !currentBlocked ? () => void changeShape(it.a.id, part) : undefined,
        // The right-click hit one of several marks: recolor only that mark; otherwise (right-click on a card, "⋯", a note with one mark) recolor the whole note
        color:
          it.section !== "marked"
            ? undefined
            : part !== undefined && shapesOf(it.a).length > 1
              ? {
                  current: placeColorOf(it.a, part, prefs.markColor),
                  default: prefs.markColor,
                  place: true,
                  pick: (c) => void setPlaceColor(it, part, c),
                }
              : { current: noteColorOf(it.a, prefs.markColor), default: prefs.markColor, pick: (c) => void setColorMany([it], c) },
      });
    }
    if (!current) return [];
    return materialMenu(intl, current, {
      count: openItems([current]).reduce((sum, g) => sum + g.items.length, 0),
      at,
      canAnnotate,
      copy: (mode) => copyMaterials([current], baseName(current.path), undefined, mode),
      pointAt: startPointAt,
      startWhole,
      startTimed: canTimed ? startTimed : undefined,
      revealInExplorer,
    });
  };

  /** Delete everything the notes panel lists (asks first; items not listed are untouched, and the confirm dialog says how many) */
  const deleteAllListed = () =>
    listForNav.length > 0 && setAsk({ kind: "deleteAll", items: listForNav, hidden: allItems.length - listForNav.length });
  /** Right-click on blank space in the notes panel: copy, check, delete all, applying to what the panel lists right now (panelMenu in stageMenu.tsx) */
  const panelMenuItems = () =>
    panelMenu(intl, {
      listed: listForNav.length,
      checked: checkedList.length,
      canCopy: toCopy.length > 0,
      copy: (mode) => void copyCurrent(mode),
      checkAll: () => setChecked(listForNav.map(itemId)),
      uncheckAll: () => setChecked([]),
      deleteAll: deleteAllListed,
    });
  const onPanelContextMenu = (e: React.MouseEvent) => {
    // The card's own menu is already open (AnnotationCard called preventDefault first); in inputs it works as usual
    if (e.defaultPrevented || (e.target as HTMLElement).closest("input, textarea")) return;
    e.preventDefault();
    setStageMenu({ x: e.clientX, y: e.clientY, panel: true });
  };

  // ---------- Help ----------
  const [intro, setIntro] = useState(false);
  /** Help → Export Diagnostics Package…: the shell asks where to save, writes the zip and selects it in File Explorer; on cancel nothing is said */
  const exportDiagnosticsNow = async () => {
    try {
      const path = await call("exportDiagnostics", { text: diagnosticsText(props.appInfo, intl.locale) });
      if (path) onNotify(intl.formatMessage({ id: "help.exportDiagnostics.done" }, { path }));
    } catch (e) {
      logError("Exporting diagnostics package", e, "warn");
      notifyError(intl.formatMessage({ id: "help.exportDiagnostics.failed" }, { reason: reasonOf(e, "") }), e);
    }
  };
  const copyDiagnosticsNow = async () => {
    try {
      await copyDiagnostics(props.appInfo, intl.locale);
      onNotify(intl.formatMessage({ id: "help.diagnostics.done" }));
    } catch (e) {
      logError("Copying diagnostic info", e, "warn");
      notifyError(intl.formatMessage({ id: "app.error.clipboard" }), e);
    }
  };

  // ---------- Menu bar ----------
  const menus = buildMenus({
    openIntro: () => setIntro(true),
    openTour: onboarding.startTour,
    openLogs: () => revealInExplorer("@logs"),
    copyDiagnostics: () => void copyDiagnosticsNow(),
    exportDiagnostics: () => void exportDiagnosticsNow(),
    reportIssue: () => void reportIssue(intl, props.appInfo).catch((e: Error) => onNotify(e.message)),
    newerVersion: updates.newer,
    checkUpdates: () => void updates.check(),
    openNewerVersion: () => updates.newer && updates.open(updates.newer),
    intl,
    findMaterial,
    findAnnotation,
    canFindAnnotation: allItems.length > 0 || !!panelQuery,
    current,
    mediaBroken,
    canAnnotate,
    canDraw,
    startFolderNote: () => void startCurrentFolderNote(),
    folderName: currentFolder?.name,
    tool,
    chooseTool,
    startWhole,
    startTimed,
    canTimed,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    undo: () => void undo(),
    redo: () => void redo(),
    // Applies to the same note as Enter and Delete: a folder comment selected in the notes panel takes priority (a menu that only knew marks on the canvas would be all gray while a folder comment is selected)
    selected: selectedNoteItem?.a ?? selectedAnnotation,
    selectedListed: !!selectedItem,
    editSelected: () => (selectedNoteItem ? editItem(selectedNoteItem) : selectedAnnotation && startEdit(selectedAnnotation)),
    deleteSelected: () => removeTargets(statusTargets),
    listedCount: listForNav.length,
    deleteAll: deleteAllListed,
    status: {
      count: statusTargets.length,
      byCheck: anyChecked,
      notResolved: statusTargets.some((t) => t.a.status !== "resolved"),
      notWontfix: statusTargets.some((t) => t.a.status !== "wontfix"),
      notOpen: statusTargets.some((t) => t.a.status !== "open"),
    },
    setStatus: (s) => applyStatus(statusTargets, s),
    color: {
      count: colorTargets.length,
      byCheck: anyChecked,
      current: colorTargetsNow,
      pick: (col) => void setColorMany(colorTargets, col),
    },
    hasAnnotations: listForNav.length > 0,
    stepAnnotation,
    stepMaterial,
    canStepMaterial,
    copyCurrent: () => void copyCurrent(),
    copyImages: () => void copyCurrent("images"),
    canCopy: toCopy.length > 0,
    selectedChecked: !!selectedItem && checkedIds.has(itemId(selectedItem)),
    checkedCount: checkedList.length,
    checkAll: () => setChecked(listForNav.map(itemId)),
    uncheckAll: () => setChecked([]),
    addFiles,
    addFolder,
    paste: () => void paste(),
    refresh: () => void library.rescan(),
    // Same as the library: clearing works per project, and with only pinned projects there is nothing to clear (counting per entry would enable it for an unpinned file inside a pinned project while clearing nothing)
    canClear: library.projects.some((p) => !p.pinned),
    clearList: () => setAsk({ kind: "clear" }),
    revealCurrent: () => current && revealInExplorer(current.path),
    revealDataDir,
    hasNotes: homeHasNotes,
    hasEntries: library.entries.length > 0,
    openSettings: props.onSettings,
    openHelp: props.onHelp,
    openDevTools: () => void call("openDevTools").catch((e: Error) => onNotify(e.message)),
    panels: { left: !panels.left.collapsed, right: !panels.right.collapsed },
    togglePanel: toggle,
    toggleBoth,
    resetLayout: () => {
      resetAll();
      windowCmd("resetLayout");
    },
    prefs,
    setPrefs,
    marksShown: !marksHidden,
    toggleMarks: () => setMarksHidden((h) => !h),
    toggleLoop,
    panelScope: scopeKind,
    setPanelScope,
    hasProject: !!project,
    win,
    windowCmd,
    startCapture,
    captureHotkey,
  });
  // On the Mac the shell draws these menus: they are sent to it whenever they change
  useNativeMenus(menus);

  /**
   * The note being written can keep gaining marks: it already has marks, the canvas can be drawn on, and it is not written on an older version (its marks are not drawn on the current canvas).
   * While the composer is open, further drawing on the canvas all counts toward this note (ADR-0009); overall comments, timestamped comments and folder comments cannot be drawn on (so they do not silently turn into ones marked somewhere)
   */
  const draftTakesMarks = !!draft?.shapes?.length && !draft.folder && canDraw && !(draft.id && currentEarlier.has(draft.id));
  /**
   * The tool actually in effect on the canvas: while writing a note the chosen tool works as usual (further drawing is added to this note), and when marks cannot be added only Select works; while H is held it is Hand.
   * A draft whose composer did not pop up after drawing (auto-open turned off in Settings) does not hold on to the tool: drawing again adds to that note (otherwise the draft would be replaced by the newly drawn mark, or the tool would silently turn into a pan)
   */
  const activeTool: Tool = handHeld ? "hand" : draft?.composing && !draftTakesMarks ? "select" : tool;
  /** The number the note being written gets on the canvas: when editing an existing note it is its own; a new one goes at the end of the canvas-marks section */
  const draftIndex = draft?.id
    ? currentItems.find((it) => it.a.id === draft.id)?.index
    : currentItems.filter((it) => it.section === "marked").length + 1;

  // ---------- Which notes are shown on the canvas ----------
  // On video, a mark at a single moment: when paused it is drawn only on its own frame (like Frame.io); during playback it lights up for 1 second from that moment, visible as playback passes.
  // A paused mark is not kept for 3 seconds past its moment: a pin still showing on a frame 2 seconds later would look as if it were placed on that frame.
  // Same frame: by frame rate, the same slot; or less than 2 ms apart (stored times have three decimals, which also counts when exactly crossing a frame boundary). Notes with an end time follow their time range.
  // Only the canvas-marks section is drawn (numbered like the notes panel): timestamped and overall comments have no position, and positions on older versions refer to the canvas before it was overwritten (ADR-0008).
  // Hidden ones (hide all, hide one) are not drawn except the selected note; the selected one is drawn on top (so you can tell which one is selected when marks overlap)
  const shownAt = (t?: number, playing = false, fps = 30): ShownAnnotation[] =>
    currentItems
      .filter((it) => it.section === "marked")
      .filter((it) => it.a.id === selectedId || !(marksHidden || hiddenMarks.has(itemId(it))))
      .map((it) => ({ annotation: it.a, index: it.index, dim: it.a.status !== "open" }))
      .filter(({ annotation: a, dim }) => (!dim || prefs.showResolved) && a.id !== draft?.id)
      .filter(({ annotation: a }) => {
        if (t === undefined || !a.anchor.time) return true;
        const { start, end } = a.anchor.time;
        if (end !== undefined) return t >= start - 0.04 && t <= end;
        if (playing) return t >= start - 0.04 && t <= start + 1;
        const frame = (s: number) => Math.floor(s * fps + 1e-6);
        return frame(t) === frame(start) || Math.abs(t - start) < 0.002;
      })
      .sort((x, y) => Number(x.annotation.id === selectedId) - Number(y.annotation.id === selectedId));
  /** The mouse points at a card in the notes panel: its marks flash on the canvas (set on the DOM directly without re-rendering the whole workspace; it changes constantly while the panel scrolls) */
  const hoverMark = (it: Item, on: boolean) => {
    const layer = stageRef.current?.querySelector(".annot-layer");
    if (!layer) return;
    for (const el of layer.querySelectorAll(".is-hover")) el.classList.remove("is-hover");
    if (on && it.key === selectedKey && it.section === "marked")
      for (const el of layer.querySelectorAll(`[data-id="${CSS.escape(it.a.id)}"]`)) el.classList.add("is-hover");
  };
  /** The far left of the zoom bar: show / hide canvas marks. While hidden it spells out "Marks hidden", so it is visible even if forgotten */
  const marksSwitch = (
    <button
      type="button"
      className={`zoom-btn zoom-marks${marksHidden ? " is-on" : ""}`}
      onClick={() => setMarksHidden((h) => !h)}
      title={intl.formatMessage({ id: "stage.marks.toggle" }, { hidden: marksHidden ? "yes" : "no" })}
    >
      {marksHidden ? <EyeOffIcon /> : <EyeIcon />}
      {marksHidden && <span>{intl.formatMessage({ id: "stage.marks.hidden" })}</span>}
    </button>
  );

  /** Marked on the control bar: excluding notes written on older versions (their time refers to the video before it was overwritten) */
  const drawnAnnotations = useMemo(() => annotations.filter((a) => !currentEarlier.has(a.id)), [annotations, currentEarlier]);
  /** A note written on an older version is selected: the canvas area switches to the snapshot from back then (EarlierShot) */
  const earlierPick = selectedAnnotation && currentEarlier.has(selectedAnnotation.id) ? selectedAnnotation : undefined;
  /** The composer is editing a note that had its own color changed: the shape-edit preview is drawn in its color; while the composer is open, a color changed via right-click is drawn as changed */
  const draftOf = draft?.id ? annotations.find((a) => a.id === draft.id) : undefined;
  const draftColor = draft?.noteColor ? draft.noteColor.color : draftOf?.color;

  // ---------- Single click on a mark on the canvas: a row of colors pops up next to it (same as picking a mark in Screen Capture) ----------
  // For a note with several marks only the clicked one is recolored, for a single-mark note the whole note (same as the context menu). While a note is being written only that note's own marks count; nothing pops up on read-only items
  const onPick = (hit: MarkHit) => {
    if (hit.id === undefined) return setPicked(hit);
    const a = annotations.find((x) => x.id === hit.id);
    if (!a || draft || currentBlocked) return;
    if (a.id !== selectedId) pickAnnotation(a);
    setArmed({ id: a.id, part: hit.part });
    setPicked(hit);
  };
  const colorBar = (() => {
    if (!picked) return undefined;
    if (picked.id === undefined) {
      const shapes = draft?.id && currentEarlier.has(draft.id) ? undefined : draft?.shapes;
      const s = shapes?.[picked.part];
      if (!s) return undefined;
      return {
        anchor: `.annot-badge[data-draft-part="${picked.part}"]`,
        current: s.color ?? draftColor ?? prefs.markColor,
        many: shapes.length > 1,
        pick: (c: string | undefined) => recolorDraftPlace(picked.part, c),
      };
    }
    const it = currentItems.find((x) => x.a.id === picked.id && x.section === "marked");
    if (!it || draft || currentBlocked) return undefined;
    const many = shapesOf(it.a).length > 1;
    return {
      anchor: `.annot-badge[data-id="${CSS.escape(it.a.id)}"][data-part="${picked.part}"]`,
      current: many ? placeColorOf(it.a, picked.part, prefs.markColor) : (noteColorOf(it.a, prefs.markColor) ?? prefs.markColor),
      many,
      pick: (c: string | undefined) => void (many ? setPlaceColor(it, picked.part, c) : setColorMany([it], c)),
    };
  })();
  // The clicked mark is gone (composer saved / canceled, item switched, started writing a note): forget it, so the same mark of a note written later does not pop up by itself
  const pickedGone = !!picked && !colorBar;
  useEffect(() => {
    if (pickedGone) setPicked(undefined);
  }, [pickedGone]);

  const layer = (size: { w: number; h: number }, t?: number, playing?: boolean, fps?: number) => (
    <AnnotationLayer
      size={size}
      natural={dims}
      shown={shownAt(t, playing, fps)}
      draft={draft?.id && currentEarlier.has(draft.id) ? undefined : draft?.shapes}
      draftIndex={draftIndex}
      tool={activeTool}
      selectedId={selectedId}
      color={prefs.markColor}
      draftColor={draftColor}
      width={prefs.markWidth}
      onCreate={onCreate}
      onSelect={(id) => {
        const a = annotations.find((x) => x.id === id);
        if (a) pickAnnotation(a);
      }}
      onChange={(id, part, shape) => void changeShape(id, part, shape)}
      onArm={setArmed}
      onPick={onPick}
      picked={colorBar ? picked : undefined}
      onEdit={(id) => {
        const a = annotations.find((x) => x.id === id);
        if (a) startEdit(a);
      }}
      locked={!!currentBlocked}
      drawOnBlank={activeTool === "select" && (!draft?.composing || draftTakesMarks) && canDraw}
      onDrawStart={pauseVideo}
    />
  );

  // ---------- Notes panel ----------
  /** The first cell at the top: this video / this image (named the same way as in hints and the text copied for AI) */
  const thisOne = thisKind(current?.kind ?? "");
  const draftCard = draft && !draft.composing && (
    <button className="card card-draft" onClick={() => setDraft({ ...draft, composing: true })}>
      {intl.formatMessage({ id: "panel.draft" })}
    </button>
  );
  const renderItem = (it: Item) => (
    <AnnotationCard
      key={itemId(it)}
      id={itemId(it)}
      a={it.a}
      index={it.index}
      section={it.section}
      selected={isFolderKey(it.key) || missing.has(it.key) ? itemId(it) === selectedNote : it.key === selectedKey && it.a.id === selectedId}
      folder={isFolderKey(it.key)}
      checked={checkedIds.has(itemId(it))}
      mark={markToggle(it)}
      onHover={(on) => hoverMark(it, on)}
      terms={terms}
      onCheck={(range) => toggleCheck(it, range)}
      onPick={() => pickItem(it)}
      onEdit={() => editItem(it)}
      onCopy={() => copyOne(it)}
      menu={stageMenuItems(it)}
      onMenu={(e) => {
        pickItem(it);
        setStageMenu({ x: e.clientX, y: e.clientY, item: it });
      }}
    />
  );
  /** The gray text after a group title's name: the subfolder if it is in one; when items from several projects are listed, the project name goes first (otherwise two hero.png files cannot be told apart) */
  const multiHome = new Set(groups.map((g) => keyOf(g.material.home))).size > 1;
  const groupHint = (m: MaterialEntry) =>
    [...(multiHome ? [baseName(m.home) || m.home] : []), ...m.homeRel.split("/").slice(0, -1)].join(" / ");
  /** When several items are listed, how many are left out because they have no (open) notes. Not said while searching (that means no match, not no notes) */
  const hiddenGroups =
    grouped && !searching ? groups.filter((g) => !g.missing && g.key !== selectedKey && !g.items.some(passes)).length : 0;
  // When several items are listed and the item on the canvas changed (Ctrl+↓, a group title was clicked): scroll its group into view.
  // If it changed because a note of another item was clicked (a note got selected), leave it: that note scrolls into view itself
  useEffect(() => {
    if (grouped && selectedKey && !selectedId)
      document.querySelector(`[data-group="${CSS.escape(selectedKey)}"]`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  return (
    <div className="app-frame">
      <TitleBar
        menus={menus}
        win={win}
        onWindow={windowCmd}
        capture={{
          hotkey: captureHotkey,
          hide: captureHide,
          start: startCapture,
          setHide: setCaptureHideAlways,
          openSettings: () => props.onSettings("capture"),
        }}
        update={updates.newer ? { version: updates.newer.version, open: () => updates.newer && updates.open(updates.newer) } : undefined}
      />
      <div
        className={`layout fade-in${panels.left.collapsed ? " left-collapsed" : ""}${panels.right.collapsed ? " right-collapsed" : ""}`}
        ref={layoutRef}
        style={vars}
      >
        <ErrorBoundary area="library">
          <LibraryPanel
            library={library}
            collapsed={panels.left.collapsed}
            appInfo={props.appInfo}
            selectedKey={current ? selectedKey : undefined}
            openCount={openCount}
            onSelect={selectMaterial}
            onAddFiles={addFiles}
            onAddFolder={addFolder}
            onPaste={() => void paste()}
            onRemove={(entries, what) => setAsk({ kind: "remove", entries, what })}
            onClear={() => setAsk({ kind: "clear" })}
            onPin={pinProject}
            onCopy={copyMaterials}
            onCopyListed={(mode) => void copyCurrent(mode, true)}
            listed={{ count: openList.length, materials: listedMaterialCount }}
            folderCount={folderOpenCount}
            missingCount={missingOpenCount}
            hasNotes={(h) => homeFiles(h).some((f) => f.annotations.length > 0)}
            onFolderNote={startFolderNote}
            onPicked={onPicked}
            clearPick={clearPick}
            findNonce={findNonce}
            onReveal={revealInExplorer}
            onRelocate={(entry) => void relocateEntry(entry)}
            onRefresh={() => void library.rescan()}
          />
        </ErrorBoundary>

        <section className="stage-col">
          <StageHeader
            material={current}
            dims={dims}
            tool={tool}
            canAnnotate={canAnnotate}
            canDraw={canDraw}
            canUndo={store.canUndo}
            canRedo={store.canRedo}
            leftOpen={!panels.left.collapsed}
            rightOpen={!panels.right.collapsed}
            onTool={chooseTool}
            onWhole={startWhole}
            onTimed={canTimed ? startTimed : undefined}
            onUndo={() => void undo()}
            onRedo={() => void redo()}
            onToggleLeft={() => toggle("left")}
            onToggleRight={() => toggle("right")}
            onSettings={() => props.onSettings()}
            onHelp={props.onHelp}
          />
          {/* contextmenu can also be triggered from the keyboard (Shift+F10 / the menu key on a focused button in the canvas bubbles up to here); every command in the menu is also in the menu bar:
              File → Show Current Item in File Explorer, Edit → Copy Note, Annotate → Overall Comment / change status */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <main className={`stage tool-${activeTool}`} ref={stageRef as RefObject<HTMLElement>} onContextMenu={onStageContextMenu}>
            {current ? (
              <ErrorBoundary area="stage" resetKey={current.path}>
                <ZoomExtras.Provider value={marksSwitch}>
                  <Viewer
                    key={current.path}
                    material={current}
                    annotations={drawnAnnotations}
                    seek={seek}
                    onMedia={(el) => {
                      mediaRef.current = el;
                    }}
                    selectedId={selectedId}
                    onSize={setDims}
                    onBackgroundClick={() => {
                      const had = !!(selectedId || selectedNote);
                      setSelectedId(undefined);
                      setSelectedNote(undefined);
                      return had;
                    }}
                    onMarkClick={(id) => {
                      const a = annotations.find((x) => x.id === id);
                      if (a) pickAnnotation(a);
                    }}
                    layer={layer}
                    onFail={setBrokenUrl}
                    onReveal={() => revealInExplorer(current.path)}
                  />
                </ZoomExtras.Provider>
              </ErrorBoundary>
            ) : (
              <div className={library.loaded && library.entries.length === 0 ? "stage-empty is-welcome" : "stage-empty"}>
                {library.loaded && library.entries.length === 0 ? (
                  <Welcome onAddFiles={addFiles} onAddFolder={addFolder} captureKeys={captureKeys} />
                ) : (
                  library.loaded && intl.formatMessage({ id: "stage.pickFirst" })
                )}
              </div>
            )}
            {earlierPick && home && (
              <EarlierShot
                home={home}
                snapshot={earlierPick.snapshot}
                onClose={() => {
                  setSelectedId(undefined);
                  setSelectedNote(undefined);
                }}
              />
            )}
            {draft?.composing && (
              <ErrorBoundary area="composer">
                <Composer
                  key={draft.id ?? "new"}
                  anchor={draft.anchor}
                  title={
                    draft.folder
                      ? intl.formatMessage({ id: "composer.title.folder" }, { name: draft.folder.name })
                      : draft.id || draft.shapes?.length
                        ? intl.formatMessage({ id: draft.id ? "composer.title.edit" : "composer.title.new" })
                        : (timed) => intl.formatMessage({ id: timed ? "composer.title.timed" : "composer.title.whole" })
                  }
                  initial={{ category: draft.category, body: draft.body, time: draft.time }}
                  currentTime={current?.kind === "video" && !draft.folder ? () => videoTime() ?? 0 : undefined}
                  timeOptional={!draft.shapes?.length}
                  places={draft.shapes?.length ?? 0}
                  onUndoPlace={() => removeDraftPlace()}
                  keepDrawing={draftTakesMarks}
                  onSave={(v) => void saveDraft(v)}
                  saving={saving}
                  onCancel={() => setDraft(undefined)}
                  onLive={(v) => {
                    liveDraft.current = v;
                  }}
                />
              </ErrorBoundary>
            )}
            {colorBar && (
              <MarkColorBar
                key={colorBar.anchor}
                anchor={() => stageRef.current?.querySelector(colorBar.anchor)}
                current={colorBar.current}
                defaultColor={prefs.markColor}
                label={intl.formatMessage({ id: colorBar.many ? "stage.menu.placeColor" : "menu.note.color" })}
                onPick={colorBar.pick}
                onClose={() => setPicked(undefined)}
              />
            )}
          </main>
        </section>

        {/* Retry when the item or scope changes (same as the canvas area) */}
        <ErrorBoundary area="panel" resetKey={`${current?.path ?? ""}|${scopeKind}`}>
          {/* inert when collapsed: Tab cannot walk into an invisible notes panel */}
          <AnnotationPanel
            collapsed={panels.right.collapsed}
            scope={scope}
            checks={checks}
            handoff={handoff}
            files={files}
            unreadable={unreadable}
            openCount={openCount}
            current={current}
            selectedKey={selectedKey}
            annotations={annotations}
            draft={!!draft}
            draftCard={draftCard}
            currentBlocked={currentBlocked}
            annotatable={!!current && ANNOTATABLE.includes(current.kind)}
            thisOne={thisOne}
            renderItem={renderItem}
            groupHint={groupHint}
            hiddenGroups={hiddenGroups}
            selectMaterial={selectMaterial}
            onDeleteMissing={(key) => setAsk({ kind: "deleteMissing", key })}
            applyStatus={applyStatus}
            removeTargets={removeTargets}
            onPanelSearchKey={onPanelSearchKey}
            home={home}
            homeHasNotes={homeHasNotes}
            revealDataDir={revealDataDir}
            onContextMenu={onPanelContextMenu}
          />
        </ErrorBoundary>

        <Sash side="left" onPointerDown={(e) => startDrag("left", e)} onDoubleClick={() => reset("left")} />
        <Sash side="right" onPointerDown={(e) => startDrag("right", e)} onDoubleClick={() => reset("right")} />

        {dragging && (
          <div className="drop-overlay">
            <div className="drop-card">
              <div className="drop-title">{intl.formatMessage({ id: "drop.title" })}</div>
              <div className="muted">{intl.formatMessage({ id: "drop.body" })}</div>
            </div>
          </div>
        )}
        {ask && (
          <AskDialog
            ask={ask}
            onClose={() => setAsk(undefined)}
            fileOf={(key) => filesRef.current.get(key)?.file}
            projects={library.projects}
            on={{
              discardDraft,
              deleteMissing: deleteMissingNotes,
              deleteAnnotation,
              deleteMany: (items) => void deleteMany(items),
              clearList,
              removeEntries,
            }}
          />
        )}
      </div>
      {stageMenu && (
        <ContextMenu
          x={stageMenu.x}
          y={stageMenu.y}
          items={stageMenu.panel ? panelMenuItems() : stageMenuItems(stageMenu.item, stageMenu.at, stageMenu.part, stageMenu.draftPart)}
          onClose={() => setStageMenu(undefined)}
        />
      )}
      {intro && (
        <ErrorBoundary area="intro" onClose={() => setIntro(false)}>
          <IntroDialog onClose={() => setIntro(false)} onAddFiles={addFiles} onAddFolder={addFolder} captureKeys={captureKeys} />
        </ErrorBoundary>
      )}
      {onboarding.touring && (
        <ErrorBoundary area="guide" onClose={onboarding.closeTour}>
          <Tour captureKeys={captureKeys} onClose={onboarding.closeTour} />
        </ErrorBoundary>
      )}
      {onboarding.hint && (
        <ErrorBoundary area="guide" onClose={onboarding.closeHint}>
          <Hint key={onboarding.hint} id={onboarding.hint} onClose={onboarding.closeHint} />
        </ErrorBoundary>
      )}
    </div>
  );
}

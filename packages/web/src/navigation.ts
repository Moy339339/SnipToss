import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { AnnotationStore } from "./annotationStore";
import { call, keyOf, type MaterialEntry } from "./host";
import type { Library } from "./library";
import type { Prefs } from "./prefs";
import type { Notify } from "./report";

// Which item is open on the canvas (split out of Workspace): selecting, locating a path in the library, previous / next, which one to open at startup,
// and remembering "last viewed". What must be cleared from the canvas after switching items (selected mark, size, ...) is done by Workspace's onShow

/** The library state the shell hands over at startup */
type LoadState = Awaited<ReturnType<Library["load"]>>;

export function useNavigation(opts: {
  library: Library;
  prefs: Pick<Prefs, "initialSelect" | "libraryPending">;
  selectedKey: string | undefined;
  setSelectedKey: (key: string | undefined) => void;
  store: Pick<AnnotationStore, "openCount" | "isHomeRead" | "homesRead" | "filesRef" | "noteLost">;
  /** A folder comment is being written: it does not follow the item, so switching items needs no question */
  folderDraft: boolean;
  /** If the composer holds unsaved text, ask first, and run only once the user chose "discard" */
  unlessDirty: (run: () => void, keep?: () => void) => void;
  /** The user answered "keep editing": the library has already selected the clicked row, so the selection goes back to the item open on the canvas */
  requestClearPick: () => void;
  /** The item changed: clear what is on the canvas */
  onShow: () => void;
  /** The library finished loading at startup (notices the shell queued are reported now) */
  onLoaded: (state: LoadState) => void;
  onNotify: Notify;
}) {
  const { library, prefs, selectedKey, setSelectedKey, store } = opts;
  const { openCount, isHomeRead, homesRead } = store;
  const intl = useIntl();

  /** remember: record it as "last viewed" (ones selected automatically at startup need not be recorded). A folder comment being written does not follow the item, so no question is needed */
  const selectMaterial = (m: MaterialEntry, remember = true) => {
    if (keyOf(m.path) === selectedKey) return;
    if (opts.folderDraft) showMaterial(m, remember);
    // "Keep editing": the library has already selected the clicked row, so the selection goes back to the item open on the canvas (otherwise the highlight would stay on the clicked row while the canvas still shows the old item)
    else opts.unlessDirty(() => showMaterial(m, remember), opts.requestClearPick);
  };
  /** Switch over without asking about the composer (the caller has already asked) */
  const showMaterial = (m: MaterialEntry, remember: boolean) => {
    const key = keyOf(m.path);
    if (key === selectedKey) return;
    setSelectedKey(key);
    opts.onShow();
    rememberSelected(m.path, remember);
  };
  // Remember "last viewed" so the next launch continues from it (the shell's item watcher also uses it to know which one is being viewed, comparing once a second). Each write makes the shell read the disk, write, and keep a .bak:
  // holding ↓ to walk through the list does not write for every row, only the latest at most once per 300ms; the first step after a pause is written immediately (so it is remembered even if the app crashes or the machine shuts down right after the click).
  // A startup auto-selection (throttle = false) that equals the stored value is not written, and a different one is written immediately without taking up the 300ms window, so the single click that follows is still recorded right away
  const selectWrite = useRef({ timer: undefined as number | undefined, last: 0, path: "", stored: "" });
  const rememberSelected = (path: string, throttle = true) => {
    const s = selectWrite.current;
    const send = (p: string) => {
      s.stored = p;
      void call("librarySelect", { path: p }).catch(() => {}); // Failing to record it does not matter: the next launch opens the first one
    };
    if (!throttle) {
      if (keyOf(path) !== keyOf(s.stored) && s.timer === undefined) send(path);
      return;
    }
    s.path = path;
    if (s.timer !== undefined) return;
    const write = () => {
      s.timer = undefined;
      s.last = Date.now();
      send(s.path);
    };
    const wait = s.last + 300 - Date.now();
    if (wait <= 0) write();
    else s.timer = window.setTimeout(write, wait);
  };

  /**
   * Locate a path in the library: expand the folders along the way and select the item (for a folder, select the first item inside).
   * Adding to the library and scanning are asynchronous, so locate only after the list data has updated; the request is stored first and handled by the effect below.
   * Several candidates may be given and the first one in the library is used in order; if none is there, give up (otherwise it would stay pending forever, and when the last-viewed item has been removed from the library at startup the canvas would stay blank).
   * Candidates in quiet are not recorded as "last viewed" even when selected (the startup auto-selection: the last-viewed item is already recorded, and the first in the list would be selected again next time anyway)
   */
  const [pendingFocus, setPendingFocus] = useState<{ paths: string[]; quiet?: string[]; nonce: number }>();
  const reveal = (...paths: (string | null | undefined)[]) =>
    setPendingFocus({ paths: paths.filter((p): p is string => !!p), nonce: Date.now() });
  useEffect(() => {
    if (!pendingFocus || !library.loaded) return;
    // Prefer a candidate that can select an item: the last-viewed file was deleted or renamed inside its folder (an agent re-exported it), so it is still "in the library" (inside the folder entry) but has no item;
    // stopping on it would leave the canvas blank without trying the first item of the list. Only when no candidate selects an item is the first one found in the library used (expanding it)
    const path = pendingFocus.paths.find((p) => library.locate(p)?.material) ?? pendingFocus.paths.find((p) => library.locate(p));
    const hit = path && library.locate(path);
    if (!path || !hit) return setPendingFocus(undefined);
    let target = hit.material;
    // The setting "select the first one with open notes first": when a folder was added, look inside it. Wait until those projects' notes have been read before looking
    // (otherwise, when a new project is added its notes are not read yet, none is found and the first item is always selected)
    if (target && prefs.initialSelect === "firstOpen" && keyOf(target.path) !== keyOf(path)) {
      const under = keyOf(path).replace(/\\+$/, "") + "\\";
      const inside = library.ordered.filter((m) => keyOf(m.path).startsWith(under));
      if (inside.some((m) => !isHomeRead(m.home))) return;
      target = inside.find((m) => openCount(keyOf(m.path)) > 0) ?? target;
    }
    setPendingFocus(undefined);
    if (library.collapsed.has(keyOf(hit.project))) library.setProjectOpen([hit.project], true);
    if (hit.open.length) library.setOpen(hit.open, true);
    if (target) selectMaterial(target, !pendingFocus.quiet?.includes(path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus, library.loaded, library.locate, homesRead]);

  /** Ctrl+↑↓ and ← → on images: switch items in list order (collapsed folders count too and are expanded automatically on arrival) */
  const stepList = () => {
    // When the library lists only items with open notes, previous / next walk only through those, and never jump to an item invisible in the list
    const list = prefs.libraryPending
      ? library.ordered.filter((m) => openCount(keyOf(m.path)) > 0 || keyOf(m.path) === selectedKey)
      : library.ordered;
    return { list, i: list.findIndex((m) => keyOf(m.path) === selectedKey) };
  };
  const stepMaterial = (dir: 1 | -1) => {
    const { list, i } = stepList();
    if (list.length === 0) return;
    const next = list[i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + dir))];
    if (next) reveal(next.path);
  };
  /** Menu "Previous / Next Item": the side at the end of the list is grayed out (with no item selected both sides go to the first one) */
  const canStepMaterial = () => {
    const { list, i } = stepList();
    return i < 0 ? { prev: list.length > 0, next: list.length > 0 } : { prev: i > 0, next: i < list.length - 1 };
  };

  // Startup: read the library and locate the path the shell brought in (command line, context menu) or the last-viewed item, falling back to the first item
  useEffect(() => {
    library
      .load()
      .then((state) => {
        opts.onLoaded(state);
        selectWrite.current.stored = state.selected ?? "";
        const fallback = [state.selected, ...state.entries.map((e) => e.path)].filter((p): p is string => !!p);
        setPendingFocus({ paths: [...(state.focus ? [state.focus] : []), ...fallback], quiet: fallback, nonce: Date.now() });
      })
      .catch((e: Error) => opts.onNotify(intl.formatMessage({ id: "app.library.loadFailed" }, { reason: e.message })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The entry holding the current item was removed from the library: clear the canvas. If it has notes, record "not found" first (an Effect Event gets the latest notes and store, so they do not trigger this effect)
  const noteLostIfAnnotated = useEffectEvent((key: string) => {
    if (store.filesRef.current.get(key)?.file.annotations.length) store.noteLost(key);
  });
  useEffect(() => {
    if (selectedKey && library.loaded && !library.byKey.has(selectedKey)) {
      noteLostIfAnnotated(selectedKey);
      setSelectedKey(undefined);
    }
  }, [selectedKey, library.loaded, library.byKey, setSelectedKey]);

  return { selectMaterial, showMaterial, reveal, stepMaterial, canStepMaterial };
}

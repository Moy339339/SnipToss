import { useEffect, useEffectEvent, useRef } from "react";
import { useIntl } from "react-intl";
import { useFileDrop } from "./drop";
import { baseName, call, logError, onHostEvent, type AddResult, type LibraryEntry } from "./host";
import type { Library, Project } from "./library";
import type { Prefs } from "./prefs";
import type { Notify, Report } from "./report";

// Adding to and removing from the library (split out of Workspace): add files / folders, drag in, paste, locate a moved entry, remove, clear, pin,
// things opened from outside (context menu, command line), and rescanning after Settings changed which files are listed.
// Locating after something is added is done by Workspace's reveal

/**
 * File extensions that can be items (same as the shell's MaterialScanner): whether an entry that can't be found used to be a file or a
 * folder is guessed from its name
 */
const MATERIAL_FILE = /\.(png|jpe?g|jfif|jpe|pjpeg|pjp|webp|gif|apng|bmp|avif|ico|svg|tiff?|heic|heif|mp4|webm|mov|m4v|mkv|pdf|pptx?)$/i;

export function useLibraryActions(opts: {
  library: Library;
  prefs: Pick<Prefs, "kinds" | "moreFormats" | "skipDirs">;
  onNotify: Notify;
  reasonOf: Report["reasonOf"];
  /** Locate a path in the library (select the item, expand the folders on the way) */
  reveal: (...paths: (string | null | undefined)[]) => void;
}) {
  const { library, prefs, onNotify, reasonOf, reveal } = opts;
  const intl = useIntl();

  /** The explanation for what was not added: one is stated as is; several give the count and the first */
  const notifySkipped = (skipped: string[] | undefined) => {
    if (skipped?.length)
      onNotify(
        skipped.length === 1
          ? skipped[0]
          : intl.formatMessage({ id: "library.skipped.many" }, { count: skipped.length, first: skipped[0] }),
      );
  };
  /**
   * What was added is the library entry that could no longer be found (moved): the shell replaced it in place, so say so (otherwise it
   * looks like one more entry was added). Returns true if it said so
   */
  const notifyRelocated = (relocated: AddResult["relocated"]) => {
    if (!relocated?.length) return false;
    onNotify(
      intl.formatMessage({ id: "library.recognized" }, { name: baseName(relocated[0].to), to: relocated[0].to, count: relocated.length }),
    );
    return true;
  };
  /**
   * dropped: the number of files dragged in (when dragging). If the shell got no path at all (e.g. images dragged out of a browser, which
   * are not on disk) it must say so; it used to react with nothing
   */
  const afterAdd = async (task: Promise<AddResult | undefined>, dropped = 0) => {
    try {
      const r = await task;
      if (!r || r.reloading) return;
      // Say only one thing at a time: recognized → not added → already in the library → how many were added → what was dragged in is not
      // a local file
      if (!notifyRelocated(r.relocated)) {
        if (r.skipped.length) notifySkipped(r.skipped);
        else if (r.added.length === 0 && r.focus) onNotify(intl.formatMessage({ id: "app.add.exists" }));
        else if (r.added.length > 1) onNotify(intl.formatMessage({ id: "app.add.count" }, { count: r.added.length }));
        else if (dropped > 0 && r.added.length === 0) onNotify(intl.formatMessage({ id: "library.drop.noPath" }));
      }
      if (r.focus) reveal(r.focus);
    } catch (e) {
      onNotify((e as Error).message);
    }
  };
  /**
   * Point an entry that can no longer be found to a new location (library right-click "Locate…": after a folder is moved its entry is greyed
   * out in the library, and it used to have to be removed and added again). If it used to be a file (the name has an item extension) the user
   * picks a file, otherwise a folder
   */
  const relocateEntry = async (entry: LibraryEntry) => {
    const name = baseName(entry.path);
    try {
      const to = MATERIAL_FILE.test(name)
        ? (await call("pickFiles"))[0]
        : await call("pickFolder", { title: intl.formatMessage({ id: "library.relocate.title" }, { name }) });
      if (!to) return;
      const r = await library.relocate(entry.path, to);
      if (r.reloading) return;
      onNotify(intl.formatMessage({ id: "library.relocated" }, { name, to: r.to }));
      reveal(r.to);
    } catch (e) {
      onNotify(intl.formatMessage({ id: "library.relocate.failed" }, { reason: reasonOf(e, entry.path) }));
    }
  };
  const addFiles = () => void afterAdd(library.pickFiles());
  const addFolder = () => void afterAdd(library.pickFolder());
  /**
   * Ctrl+V: files and folders copied in File Explorer → same as dragging them in; an image copied from web-based AI or a chat app → the shell
   * saves it into "Pasted images", and opening it makes it ready to annotate
   */
  const paste = async () => {
    try {
      const r = await library.paste();
      if (r.empty) return onNotify(intl.formatMessage({ id: "app.paste.empty" }));
      if (!r.pasted) return void afterAdd(Promise.resolve(r));
      if (r.reloading) return;
      onNotify(intl.formatMessage({ id: "app.paste.image" }));
      reveal(r.pasted);
    } catch (e) {
      logError("paste", e);
      onNotify(intl.formatMessage({ id: "app.paste.failed" }, { reason: (e as Error).message }));
    }
  };
  const dragging = useFileDrop((dropped) => void afterAdd(library.addFiles(dropped), dropped.length));

  const removeEntries = (entries: LibraryEntry[]) =>
    void library.remove(entries.map((e) => e.path)).catch((e: Error) => onNotify(e.message));
  // Clearing works per project (pinning is also shown per project): if any entry in a project is pinned, the whole project stays. It used
  // to work per entry, and files newly added to a pinned project were cleared
  const clearList = () =>
    void library
      .remove(library.projects.filter((p) => !p.pinned).flatMap((p) => p.entries.map((e) => e.path)))
      .catch((e: Error) => onNotify(e.message));
  const pinProject = (p: Project, pinned: boolean) =>
    void library
      .pin(
        p.entries.map((e) => e.path),
        pinned,
      )
      .catch((e: Error) => onNotify(e.message));

  // Settings changed which files are listed (item kinds, more formats, skipped folders): rescan 0.3 seconds after the user stops changing
  // it, no need to press F5 (it used to be needed, and the description said so; the shell's item watcher looks at the items only, so when
  // skipping a folder that has no items inside, the gray line at its end never changed)
  const listRules = JSON.stringify([prefs.kinds, prefs.moreFormats, prefs.skipDirs]);
  const listRulesSeen = useRef(listRules);
  const listLoaded = useEffectEvent(() => library.loaded);
  const rescan = useEffectEvent(() => void library.rescan());
  useEffect(() => {
    if (listRulesSeen.current === listRules) return;
    listRulesSeen.current = listRules;
    if (!listLoaded()) return;
    const timer = window.setTimeout(rescan, 300);
    return () => clearTimeout(timer);
  }, [listRules]);

  // While the app is open something else was opened from the context menu / command line: the shell has already added it to the library,
  // and here the library is refreshed and located
  const onMaterialsChanged = useEffectEvent((entries: string[]) => void library.changed(entries));
  useEffect(() => onHostEvent("materialsChanged", ({ entries }) => onMaterialsChanged(entries)), []);
  const onLibraryChanged = useEffectEvent(
    ({ focus, skipped, relocated }: { focus: string | null; skipped: string[]; relocated?: AddResult["relocated"] }) =>
      void library.sync().then(() => {
        // Opening a moved project from the context menu also says "recognized" (it used to be said only when dragging in or choosing a folder)
        if (!notifyRelocated(relocated)) notifySkipped(skipped);
        reveal(focus);
      }),
  );
  useEffect(() => onHostEvent("libraryChanged", (e) => onLibraryChanged(e)), []);

  return { notifySkipped, notifyRelocated, relocateEntry, addFiles, addFolder, paste, dragging, removeEntries, clearList, pinProject };
}

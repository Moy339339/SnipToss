import { useCallback, useMemo, useRef, useState } from "react";
import { NOTE_SECTIONS, sectionOf, type Annotation, type MaterialKind, type NoteSection } from "@sniptoss/core";
import type { Stored } from "./annotationStore";
import { compareNames } from "./collate";
import { homeJoin, keyOf, type MaterialEntry } from "./host";
import { commonFolder, folderAt, folderOfMaterial, relInside, type FolderTarget, type useLibrary } from "./library";
import type { Prefs } from "./prefs";
import { annotationMatches, searchTerms } from "./search";

// Which items the notes panel lists (the notes of one project should be viewable and selectable together on the right; clicking on the left and then going back to the right to act would be too disjointed). Split out of Workspace.

/** One entry in the notes panel: a note + which item it belongs to (with a project or several items selected on the left, the right side lists the notes of several items at once) */
export interface Item {
  a: Annotation;
  /** The item's key */
  key: string;
  /** Which section it belongs to: marks on the canvas / timestamped comments / overall comments / written on older versions (docs/adr/0008-earlier-versions.md) */
  section: NoteSection;
  /** Its number within the section: the canvas ones match the numbers of the marks on the canvas; timestamped comments, overall comments and older-version notes are each numbered from 1 */
  index: number;
}
/** A note id is unique only within one item, so across items the item has to be included */
export const itemId = (it: Item) => `${it.key}|${it.a.id}`;

const NONE: ReadonlySet<string> = new Set();
/**
 * Arrange the notes of one item (or one folder) as they appear in the notes panel: on the canvas → timestamped comments → overall comments → written on older versions, each section numbered from 1.
 * Within a section by the order written; timestamped comments by time (they are not drawn on the canvas, so the numbers need not match it, and reading from front to back suits watching the video).
 * Numbers count resolved notes too (the "also show resolved" switch does not make numbers jump). If overall comments were numbered together with the canvas ones, "2" could not be found on the canvas
 */
export function numbered(key: string, annotations: readonly Annotation[], earlier: ReadonlySet<string> = NONE): Item[] {
  return NOTE_SECTIONS.flatMap((s) => {
    const inSection = annotations.filter((a) => (earlier.has(a.id) ? "earlier" : sectionOf(a)) === s);
    if (s === "timed") inSection.sort((x, y) => x.anchor.time!.start - y.anchor.time!.start); // Stable sort: ones at the same moment keep the order they were written
    return inSection.map((a, i): Item => ({ a, key, section: s, index: i + 1 }));
  });
}

export function usePanelScope(opts: {
  library: Pick<ReturnType<typeof useLibrary>, "projects" | "ordered">;
  files: ReadonlyMap<string, Stored>;
  /** The notes of this item written on older versions (materialVersions.ts) */
  earlierOf: (key: string) => ReadonlySet<string>;
  /** Notes files whose item is gone (keys) */
  missing: ReadonlySet<string>;
  selectedKey: string | undefined;
  current: MaterialEntry | undefined;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
}) {
  const { library, files, earlierOf, missing, selectedKey, current, prefs, setPrefs } = opts;
  // The notes panel switches its own scope at the top: "This video" = list only the one on the canvas; "Entire project" (the default) = everything in its project, grouped by item, with a blue line on the group open on the canvas.
  // With several selected on the left (marquee, Ctrl / Shift click, Ctrl+A, a click on a project or folder row), the selected ones are listed temporarily and the top gets an extra "Selected" cell; clicking blank space on the left, Esc, or switching back at the top restores the normal view.
  // Whatever is listed is what "Select all" and "Copy for AI" apply to
  /** The project of the item that was last open on the canvas: after the item disappears (deleted, renamed) and the canvas is cleared, the notes panel stays on this project so its notes remain visible */
  const [lastHome, setLastHome] = useState<string>();
  const [picked, setPicked] = useState<{ materials: MaterialEntry[]; custom: boolean }>({ materials: [], custom: false });
  const onPicked = useCallback((ms: MaterialEntry[], custom: boolean, home?: string) => {
    setPicked((prev) =>
      prev.custom === custom && prev.materials.length === ms.length && prev.materials.every((m, i) => m.path === ms[i].path)
        ? prev
        : { materials: ms, custom },
    );
    // The clicked project has no item that can be opened (all items moved away, only notes remain): the notes panel follows this project, and its notes are visible in the "item not found" group
    if (home && ms.length === 0) setLastHome(keyOf(home));
  }, []);
  /** When it changes, the library drops its multi-selection (the scope was switched at the top) */
  const [clearPick, setClearPick] = useState(0);
  const requestClearPick = () => setClearPick((n) => n + 1);
  const selectedProject = useMemo(
    () => (selectedKey ? library.projects.find((p) => p.materials.some((m) => keyOf(m.path) === selectedKey)) : undefined),
    [library.projects, selectedKey],
  );
  // Record it when the project changes (by comparing with the previous render during rendering, the React docs' "adjusting state based on the previous render" pattern; an effect would render one extra time)
  const [seenProject, setSeenProject] = useState(selectedProject);
  if (selectedProject !== seenProject) {
    setSeenProject(selectedProject);
    if (selectedProject) setLastHome(keyOf(selectedProject.home));
  }
  const project = selectedProject ?? (!selectedKey && lastHome ? library.projects.find((p) => keyOf(p.home) === lastHome) : undefined);

  const scopeMaterials = useMemo(() => {
    const keys = new Set<string>();
    if (picked.custom) for (const m of picked.materials) keys.add(keyOf(m.path));
    else if (prefs.panelScope === "project" && project) for (const m of project.materials) keys.add(keyOf(m.path));
    if (selectedKey) keys.add(selectedKey);
    return library.ordered.filter((m) => keys.has(keyOf(m.path)));
  }, [picked, prefs.panelScope, project, selectedKey, library.ordered]);
  /** Which cell at the top is lit: when several are selected on the left and the selection happens to be exactly this project / just this one item, that cell is lit as well */
  const scopeKind: "material" | "project" | "picked" = !picked.custom
    ? prefs.panelScope
    : scopeMaterials.length <= 1
      ? "material"
      : project && scopeMaterials.length === project.materials.length && scopeMaterials.every((m) => project.materials.includes(m))
        ? "project"
        : "picked";
  const setPanelScope = (s: "material" | "project") => {
    setPrefs({ panelScope: s });
    requestClearPick();
  };
  // Folder comments (since format version 3): "Entire project" lists all of them in this project; when several items are selected on the left (e.g. a folder row was clicked),
  // it lists those of the folder containing them and its subfolders; "This image" does not list them (Copy for AI then hands over only that one item), with a note at the top. They are placed before the items
  const folderGroups = useMemo(() => {
    if (scopeKind === "material") return [];
    const bases = new Map<string, string>(); // notes folder → list the comments of this folder (including subfolders)
    if (scopeKind === "project" && project) bases.set(keyOf(project.home), ".");
    else
      for (const h of new Set(scopeMaterials.map((m) => keyOf(m.home))))
        bases.set(h, commonFolder(scopeMaterials.filter((m) => keyOf(m.home) === h)));
    const out: { folder: FolderTarget; key: string; items: Item[] }[] = [];
    for (const [key, s] of files) {
      const base = bases.get(keyOf(s.home));
      if (s.file.material.kind !== "folder" || base === undefined || !relInside(s.file.material.path, base)) continue;
      out.push({
        folder: folderAt(s.home, s.file.material.path),
        key,
        items: numbered(key, s.file.annotations),
      });
    }
    const rank = (g: (typeof out)[number]) => (g.folder.rel === "." ? "" : g.folder.rel);
    return out.sort((a, b) => keyOf(a.folder.home).localeCompare(keyOf(b.folder.home)) || compareNames(rank(a), rank(b)));
  }, [scopeKind, project, scopeMaterials, files]);
  /** Notes whose item is gone (missing): listed under "Entire project", or when the canvas was cleared (the open item disappeared), at the end and labeled "item not found" */
  const missingGroups = useMemo(() => {
    if (!project || scopeKind === "picked" || (scopeKind === "material" && current)) return [];
    const home = keyOf(project.home);
    return [...files]
      .filter(([key, s]) => missing.has(key) && keyOf(s.home) === home)
      .map(([key, s]) => ({
        material: goneEntry(s.home, s.file.material),
        key,
        items: numbered(key, s.file.annotations),
        missing: true,
      }))
      .sort((a, b) => compareNames(a.material.homeRel, b.material.homeRel));
  }, [project, scopeKind, current, files, missing]);
  const grouped = scopeMaterials.length > 1 || folderGroups.length > 0 || missingGroups.length > 0;
  const groups = useMemo(
    () => [
      ...(grouped ? scopeMaterials : current ? [current] : []).map((material) => {
        const key = keyOf(material.path);
        const items = numbered(key, files.get(key)?.file.annotations ?? [], earlierOf(key));
        return { material, key, items, missing: false };
      }),
      ...missingGroups,
    ],
    [grouped, scopeMaterials, current, files, missingGroups, earlierOf],
  );
  // Notes panel search: looks in the note text and the replies. While searching, "what is listed" is what was found: Select all and Copy for AI with nothing checked apply only to those (one rule, see copyCurrent)
  const [panelQuery, setPanelQuery] = useState("");
  const terms = useMemo(() => searchTerms(panelQuery), [panelQuery]);
  const searching = terms.length > 0;
  const panelSearch = useRef<HTMLInputElement>(null);
  // Filtering (the funnel menu: only notes on the canvas, or only overall comments): filters by section and is stored in the settings; folder comments count as overall comments.
  // Collapsing (a click on a section title): one section of one item, remembered only for this run. Both follow the same rule as search: filtered-out and collapsed notes do not count as "listed",
  // and Select all, Copy with nothing checked, and [ ] ignore them (ones that were checked are dropped too, like "no invisible checks left" in handoff.ts); the section title still shows how many there are
  const kindShown = (it: Item) => !prefs.panelHidden.includes(it.section);
  /** Item key + section: the collapsed ones */
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() => new Set());
  const sectionKey = (key: string, section: NoteSection) => `${key}|${section}`;
  const isCollapsed = (key: string, section: NoteSection) => collapsedSections.has(sectionKey(key, section));
  const toggleSection = (key: string, section: NoteSection) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (!next.delete(sectionKey(key, section))) next.add(sectionKey(key, section));
      return next;
    });
  /** The selected note is in a collapsed section (its mark was clicked on the canvas, or [ ] stepped to it): expand that section so the card is visible */
  const revealSection = (it: Item) => {
    if (isCollapsed(it.key, it.section)) toggleSection(it.key, it.section);
  };
  /** It has a place in the notes panel: status, search and filter all match (collapsed ones count too: the section title counts them) */
  const passes = (it: Item) => (prefs.panelResolved || it.a.status === "open") && annotationMatches(it.a, terms) && kindShown(it);
  /** Visible: it has a place in the notes panel and its section is not collapsed */
  const visible = (it: Item) => passes(it) && !isCollapsed(it.key, it.section);
  /** Hidden only by the filter (status and search both match): when empty, say "nothing matches the filter" instead of "no notes" */
  const filteredOut = (it: Item) => (prefs.panelResolved || it.a.status === "open") && annotationMatches(it.a, terms) && !kindShown(it);
  const allItems = [...folderGroups.flatMap((g) => g.items), ...groups.flatMap((g) => g.items)];
  /** Which kinds the filter menu lists: timestamped comments exist only for video, so they are listed only when a video is listed (or such notes already exist) */
  const kinds = NOTE_SECTIONS.filter(
    (s) => s !== "timed" || scopeMaterials.some((m) => m.kind === "video") || allItems.some((it) => it.section === "timed"),
  );
  /** Filtering: one of the listed kinds is filtered out (if only timestamped comments are filtered out and images are listed now, it does not count) */
  const filtering = kinds.some((s) => prefs.panelHidden.includes(s));
  /** How many open folder comments there are for folder rel (including subfolders; not given = all) in one notes folder. With deep = false only this folder's own are counted */
  const folderOpenCount = useCallback(
    (home: string, rel = ".", deep = true) => {
      let n = 0;
      for (const s of files.values()) {
        const m = s.file.material;
        if (m.kind !== "folder" || keyOf(s.home) !== keyOf(home)) continue;
        if (deep ? !relInside(m.path, rel) : m.path.toLowerCase() !== rel.toLowerCase()) continue;
        n += s.file.annotations.filter((a) => a.status === "open").length;
      }
      return n;
    },
    [files],
  );
  /** How many open notes of items that are gone there are in one notes folder (they are listed under "Entire project" too, so the count includes them) */
  const missingOpenCount = (home: string) =>
    [...missing].reduce((n, key) => {
      const s = files.get(key);
      return s && keyOf(s.home) === keyOf(home) ? n + s.file.annotations.filter((a) => a.status === "open").length : n;
    }, 0);
  /** How many open folder comments there are for the folder containing the item on the canvas and each level above it (with "This image" selected, a note at the top mentions them) */
  const aboveOpen = current
    ? [...files.values()].reduce((n, s) => {
        const m = s.file.material;
        const dir = folderOfMaterial(current).rel;
        return m.kind === "folder" && keyOf(s.home) === keyOf(current.home) && relInside(dir, m.path)
          ? n + s.file.annotations.filter((a) => a.status === "open").length
          : n;
      }, 0)
    : 0;
  /** What is visible in the notes panel ([ ] steps through these, and "Select all" checks these) */
  const listForNav = allItems.filter(visible);
  /** What has a place in the notes panel (including ones in collapsed sections): "No …" is said only when there are none at all */
  const passingCount = allItems.filter(passes).length;
  /** What Copy hands over when nothing is checked: the open ones among those listed */
  const openList = allItems.filter((it) => it.a.status === "open" && visible(it));
  /** While searching without showing resolved notes: how many matches there are among resolved ones (mentioned when the result is empty, and a click shows them) */
  const resolvedHits =
    searching && !prefs.panelResolved
      ? allItems.filter((it) => it.a.status !== "open" && annotationMatches(it.a, terms) && kindShown(it)).length
      : 0;

  return {
    onPicked,
    clearPick,
    requestClearPick,
    setPanelScope,
    project,
    scopeMaterials,
    scopeKind,
    folderGroups,
    grouped,
    groups,
    panelQuery,
    setPanelQuery,
    terms,
    searching,
    panelSearch,
    filtering,
    kinds,
    passes,
    visible,
    filteredOut,
    isCollapsed,
    toggleSection,
    revealSection,
    passingCount,
    allItems,
    folderOpenCount,
    missingOpenCount,
    aboveOpen,
    listForNav,
    openList,
    resolvedHits,
  };
}

/** The "item" of the group of notes whose item is gone: assembled from the path recorded in the notes file (it has no URL or size and cannot be opened) */
function goneEntry(home: string, m: { path: string; kind: string }): MaterialEntry {
  return { path: homeJoin(home, m.path), rel: m.path, kind: m.kind as MaterialKind, size: 0, mtime: 0, home, homeRel: m.path, url: "" };
}

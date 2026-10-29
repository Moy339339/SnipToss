import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pathSep, type MaterialKind } from "@sniptoss/core";
import { compareNames } from "./collate";
import {
  addDropped,
  baseName,
  call,
  dirName,
  homeJoin,
  keyOf,
  type AddResult,
  type LibraryEntry,
  type MaterialEntry,
  type ScanResult,
} from "./host";

// The data of the library on the left: entries (the shell stores them in settings.json), the items scanned from each entry, project
// groups, folder trees, expansion state. Every add / remove / change is handed to the shell first (it writes to disk), and then the state
// here is updated.
//
// Grouping follows the sidebar "by project" of the Codex / Claude Code desktop apps: a project = the folder where notes are stored (the
// notes folder, the one holding .sniptoss), and entries are grouped by it automatically, with no manual sorting. The notes of a project
// live in the same .sniptoss, so "Copy for AI" can copy a whole project at once.

/** One folder inside a folder entry */
export interface TreeFolder {
  /** Absolute path */
  path: string;
  name: string;
  folders: TreeFolder[];
  files: MaterialEntry[];
}

/** Builds a tree from the items' relative paths: folders first, files after, each sorted by name (numbers by value) */
function buildTree(root: string, materials: MaterialEntry[]): TreeFolder {
  const top: TreeFolder = { path: root, name: baseName(root), folders: [], files: [] };
  const index = new Map<string, TreeFolder>([["", top]]);
  for (const m of materials) {
    const parts = m.rel.split("/");
    let parent = top;
    let rel = "";
    for (const part of parts.slice(0, -1)) {
      rel = rel ? `${rel}/${part}` : part;
      let f = index.get(rel);
      if (!f) {
        f = { path: homeJoin(root, rel), name: part, folders: [], files: [] };
        index.set(rel, f);
        parent.folders.push(f);
      }
      parent = f;
    }
    parent.files.push(m);
  }
  const sort = (f: TreeFolder) => {
    f.folders.sort((a, b) => compareNames(a.name, b.name));
    f.files.sort((a, b) => compareNames(baseName(a.path), baseName(b.path)));
    f.folders.forEach(sort);
  };
  sort(top);
  return top;
}

const walkFiles = (f: TreeFolder, visit: (m: MaterialEntry) => void) => {
  f.folders.forEach((d) => walkFiles(d, visit));
  f.files.forEach(visit);
};

/** The keys of all files and folders in the tree */
function treeKeys(tree: TreeFolder): Set<string> {
  const out = new Set<string>();
  const walk = (f: TreeFolder) => {
    for (const d of f.folders) {
      out.add(keyOf(d.path));
      walk(d);
    }
    for (const m of f.files) out.add(keyOf(m.path));
  };
  walk(tree);
  return out;
}

/** One project in the library */
export interface Project {
  /** The project folder = the notes folder */
  home: string;
  key: string;
  /** All entries belonging to this project (pinning and removing work on the project as a whole) */
  entries: LibraryEntry[];
  /**
   * Entries listed separately under the project. When the project folder itself is a folder entry its contents are listed directly under
   * the project, and what remains here is what its scan can't see (things skipped inside the folder: hidden ones, ones in bin / dist,
   * disabled kinds; added individually; placed after the tree)
   */
  shown: LibraryEntry[];
  /** The tree of the project folder, when it is itself an entry */
  tree?: TreeFolder;
  /** The entry the tree comes from */
  root?: LibraryEntry;
  pinned: boolean;
  /** All items of the project, in display order */
  materials: MaterialEntry[];
  /** Some folder has too many items and only this many were listed (the shell's limit); undefined if none */
  truncatedAt?: number;
}

/**
 * The folder that a folder comment is about (since format version 3: an "overall comment" covers a single item, and there is also one for
 * a whole folder). rel is relative to the notes folder (forward slashes), . = the notes folder itself
 */
export interface FolderTarget {
  home: string;
  rel: string;
  name: string;
}

const folderName = (home: string, rel: string) => (rel === "." ? baseName(home.replace(/[\\/]+$/, "")) || home : rel.split("/").pop()!);

/** Notes folder + relative path → FolderTarget */
export const folderAt = (home: string, rel: string): FolderTarget => ({ home, rel, name: folderName(home, rel) });

/** A folder inside the notes folder (absolute path) → FolderTarget; none if it is not inside this notes folder */
export function folderTarget(home: string, path: string): FolderTarget | undefined {
  const base = home.replace(/[\\/]+$/, "");
  const k = keyOf(path).replace(/\\+$/, "");
  if (k === keyOf(base)) return { home, rel: ".", name: folderName(home, ".") };
  if (!k.startsWith(keyOf(base) + "\\")) return undefined;
  const rel = path
    .replace(/[\\/]+$/, "")
    .slice(base.length + 1)
    .replaceAll("\\", "/");
  return { home, rel, name: folderName(home, rel) };
}

/** The folder an item is in */
export function folderOfMaterial(m: MaterialEntry): FolderTarget {
  const i = m.homeRel.lastIndexOf("/");
  return folderAt(m.home, i < 0 ? "." : m.homeRel.slice(0, i));
}

/** The folder that several items (in the same notes folder) have in common */
export function commonFolder(materials: MaterialEntry[]): string {
  const dirs = materials.map((m) => folderOfMaterial(m).rel);
  if (dirs.length === 0 || dirs.includes(".")) return ".";
  let parts = dirs[0].split("/");
  for (const d of dirs.slice(1)) {
    const ps = d.split("/");
    let n = 0;
    while (n < parts.length && n < ps.length && parts[n].toLowerCase() === ps[n].toLowerCase()) n++;
    parts = parts.slice(0, n);
  }
  return parts.length ? parts.join("/") : ".";
}

/** Folder rel is inside base (including base itself) */
export const relInside = (rel: string, base: string) => {
  const r = rel.toLowerCase();
  const b = base.toLowerCase();
  return b === "." || r === b || r.startsWith(b + "/");
};

/**
 * What a folder entry doesn't list: unsupported files and skipped folders (they used to be silently left out).
 * It is attached to the last row of the entry when expanded, adding a gray line under that row; it is not a row of its own, so the
 * keyboard, multi-selection and marquee selection need not care about it
 */
export interface FolderNote {
  others?: { count: number; exts: string[] };
  /** Less common formats left out while More formats is off (the note says where to turn it on) */
  moreOff?: { count: number; exts: string[] };
  skipped?: string[];
}

/** One row shown in the library */
export type Row =
  | { type: "project"; id: string; project: Project; depth: 0 }
  | { type: "entry"; id: string; entry: LibraryEntry; project: Project; depth: 1; tree?: TreeFolder; material?: MaterialEntry }
  | { type: "folder"; id: string; folder: TreeFolder; entry: LibraryEntry; depth: number; note?: FolderNote }
  | { type: "file"; id: string; material: MaterialEntry; entry: LibraryEntry; depth: number; hint?: string; note?: FolderNote };

/**
 * Subtitles (the containing folder) for projects with the same name: taken from the bottom up, to the level that tells them apart from
 * the other projects of the same name (paths used to be shortened from the start, and when the difference was near the front several
 * subtitles looked identical). E:\a\clientA\v1, E:\a\clientB\v1 → clientA\v1, clientB\v1
 */
export function distinctPlaces(dirs: string[]): string[] {
  const parts = dirs.map((d) => d.split(/[\\/]/));
  const seps = dirs.map(pathSep);
  const tail = (p: string[], n: number, sep: string) => p.slice(-n).join(sep);
  return parts.map((p, i) => {
    for (let n = 1; n < p.length; n++) {
      const mine = tail(p, n, seps[i]).toLowerCase();
      if (parts.every((q, j) => j === i || tail(q, n, seps[j]).toLowerCase() !== mine)) return tail(p, n, seps[i]);
    }
    return p.join(seps[i]);
  });
}

/** What the scan result of this folder entry leaves unlisted */
export function folderNote(s: ScanResult | undefined): FolderNote | undefined {
  if (!s || (!s.others && !s.moreOff && !s.skippedDirs?.length)) return undefined;
  return { others: s.others ?? undefined, moreOff: s.moreOff ?? undefined, skipped: s.skippedDirs?.length ? s.skippedDirs : undefined };
}

const inside = (k: string, folderKey: string) => k.startsWith(folderKey.endsWith("\\") ? folderKey : folderKey + "\\");

/**
 * Extensions that can be annotated, same as the shell's MaterialScanner.Kinds (when an individually added file isn't listed, this tells
 * whether its kind is turned off in Settings or it is not supported)
 */
const KIND_OF_EXT: Record<string, MaterialKind> = Object.fromEntries([
  ..."png jpg jpeg jfif jpe pjpeg pjp webp gif apng bmp avif ico svg tif tiff heic heif".split(" ").map((x) => [x, "image"] as const),
  ...["mp4", "webm", "mov", "m4v", "mkv"].map((x) => [x, "video"] as const),
]);
export const kindOfExt = (ext: string): MaterialKind | undefined => KIND_OF_EXT[ext.replace(/^\./, "").toLowerCase()];

/** Images the UI cannot display and that the shell converts to PNG first (same as the shell's DecodedImages.Needs) */
export const needsDecode = (path: string) => /\.(tiff?|heic|heif)$/i.test(path);

/** Vector images: drawn at the size needed, see mediaSize.ts */
export const isSvg = (path: string) => /\.svg$/i.test(path);

/**
 * Which entry a path belongs to: the entry itself, or inside the entry's folder (a drive-root entry E:\ already ends with \, and
 * appending another one used to fail to match, so filter results were empty)
 */
export function entryContaining(entries: LibraryEntry[], path: string): LibraryEntry | undefined {
  const k = keyOf(path);
  return entries.find((e) => k === keyOf(e.path) || inside(k, keyOf(e.path)));
}

/**
 * The "where" line under a project row: the parent of the project folder, with the user folder written as ~ (like the recent projects of
 * VS Code and Codex); a drive root has no parent and nothing is written
 */
export function projectPlace(home: string): string | undefined {
  const parent = dirName(home);
  if (keyOf(parent).replace(/\\+$/, "") === keyOf(home).replace(/\\+$/, "")) return undefined;
  // Windows: E:\Users\name; macOS: /Users/name (Linux's /home/name is written the same way)
  return parent.replace(/^[a-z]:\\users\\[^\\]+(?=\\|$)/i, "~").replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** The display name of a project: the name of the project folder (E:\ for a drive root) */
export const projectName = (p: Project) => baseName(p.home) || p.home;

/** All items in a folder tree (in list order) */
export const treeMaterials = (f: TreeFolder): MaterialEntry[] => [...f.folders.flatMap(treeMaterials), ...f.files];

/** The parent path relative to the project folder (empty if directly inside the project folder) */
export function relParent(home: string, path: string): string {
  const base = home.replace(/[\\/]+$/, "");
  const parent = dirName(path);
  return parent.length > base.length && keyOf(parent).startsWith(keyOf(base) + "\\") ? parent.slice(base.length + 1) : "";
}

/** Row i is an unpinned project while the nearest project before it is pinned */
export function prevProjectPinned(rows: Row[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const r = rows[j];
    if (r.type === "project") return r.project.pinned;
  }
  return false;
}

/** The item this row refers to (file rows, entries of a single file) */
export const materialOf = (row: Row) => (row.type === "file" ? row.material : row.type === "entry" ? row.material : undefined);
/** The folder path this row refers to (folder rows, folder entries), which can be expanded and collapsed */
export const folderPathOf = (row: Row) =>
  row.type === "folder" ? row.folder.path : row.type === "entry" && row.entry.kind === "folder" ? row.entry.path : undefined;

// ---------- How the list is ordered (pure functions: useLibrary computes them from the latest entries, scan results and expansion state;
// split out of the hook so vitest can test them directly) ----------

/** The tree of each folder entry (key = keyOf of the entry path) */
export function entryTrees(entries: LibraryEntry[], scans: Map<string, ScanResult>): Map<string, TreeFolder> {
  const map = new Map<string, TreeFolder>();
  for (const e of entries) {
    const s = scans.get(keyOf(e.path));
    if (s?.kind === "folder") map.set(keyOf(e.path), buildTree(e.path, s.materials));
  }
  return map;
}

/**
 * Groups entries by project. Project order: pinned ones first; the rest by the earliest position of the project's entries in the list
 * (newly added entries go first, so the project that last received something is on top)
 */
export function groupProjects(entries: LibraryEntry[], scans: Map<string, ScanResult>, trees: Map<string, TreeFolder>): Project[] {
  const map = new Map<string, Project>();
  for (const e of entries) {
    const ek = keyOf(e.path);
    // Before the scan finishes, group by the containing folder; once done, regroup under the real notes folder
    const home = scans.get(ek)?.project ?? (e.kind === "folder" ? e.path : dirName(e.path));
    const key = keyOf(home);
    let p = map.get(key);
    if (!p) map.set(key, (p = { home, key, entries: [], shown: [], pinned: false, materials: [] }));
    p.entries.push(e);
    if (e.pinned) p.pinned = true;
    const cut = scans.get(ek)?.truncatedAt;
    if (cut) p.truncatedAt = cut;
    if (e.kind === "folder" && ek === key) {
      p.root = e;
      p.tree = trees.get(ek);
    }
  }
  const seen = new Set<string>();
  for (const p of map.values()) {
    // When the project folder itself is an entry, entries inside its tree are no longer listed separately. The rest is as inside a
    // folder: folders first, sorted by name
    const inTree = p.root && p.tree && p.entries.length > 1 ? treeKeys(p.tree) : undefined;
    p.shown = p.entries
      .filter((e) => e !== p.root && !inTree?.has(keyOf(e.path)))
      .sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || compareNames(baseName(a.path), baseName(b.path)));
    const push = (m: MaterialEntry) => {
      const k = keyOf(m.path);
      if (seen.has(k)) return;
      seen.add(k);
      p.materials.push(m);
    };
    if (p.tree) walkFiles(p.tree, push);
    for (const e of p.shown) {
      const tree = trees.get(keyOf(e.path));
      if (tree) walkFiles(tree, push);
      else scans.get(keyOf(e.path))?.materials.forEach(push);
    }
  }
  // sort is stable: projects that are both pinned or both unpinned keep their original order
  return [...map.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/**
 * The rows to show in the library: only expanded projects and folders show their contents (expanded = expanded folders, collapsed =
 * collapsed projects, both as keyOf)
 */
export function listRows(
  projects: Project[],
  scans: Map<string, ScanResult>,
  trees: Map<string, TreeFolder>,
  expanded: Set<string>,
  collapsed: Set<string>,
): Row[] {
  const out: Row[] = [];
  const walk = (f: TreeFolder, entry: LibraryEntry, depth: number) => {
    for (const sub of f.folders) {
      out.push({ type: "folder", id: `${keyOf(entry.path)}|d|${keyOf(sub.path)}`, folder: sub, entry, depth });
      if (expanded.has(keyOf(sub.path))) walk(sub, entry, depth + 1);
    }
    for (const m of f.files) out.push({ type: "file", id: `${keyOf(entry.path)}|f|${keyOf(m.path)}`, material: m, entry, depth });
  };
  /**
   * A folder entry fully expanded: what isn't listed (unsupported files, skipped folders) is attached to its last row; if there is no row
   * at all, the entry's own row says it
   */
  const walkEntry = (tree: TreeFolder, entry: LibraryEntry, depth: number) => {
    const from = out.length;
    walk(tree, entry, depth);
    const note = folderNote(scans.get(keyOf(entry.path)));
    const last = out[out.length - 1];
    if (note && out.length > from && (last.type === "folder" || last.type === "file")) out[out.length - 1] = { ...last, note };
  };
  for (const p of projects) {
    out.push({ type: "project", id: `p|${p.key}`, project: p, depth: 0 });
    if (collapsed.has(p.key)) continue;
    if (p.tree && p.root) walkEntry(p.tree, p.root, 1);
    for (const e of p.shown) {
      const tree = trees.get(keyOf(e.path));
      const material = e.kind === "file" ? scans.get(keyOf(e.path))?.materials[0] : undefined;
      out.push({ type: "entry", id: `${keyOf(e.path)}|e`, entry: e, project: p, depth: 1, tree, material });
      if (tree && expanded.has(keyOf(e.path))) walkEntry(tree, e, 2);
    }
  }
  return out;
}

/** The position of a path in the library: its project (notes folder), the folders to expand, and the item to select */
export interface Located {
  project: string;
  open: string[];
  material?: MaterialEntry;
}

/**
 * Finds a path's position in the library: returns its project, the folders to expand and the item to select.
 * A file → itself; a folder (the entry itself or a subfolder inside an entry) → the first item inside
 */
export function locateIn(
  path: string,
  projects: Project[],
  scans: Map<string, ScanResult>,
  trees: Map<string, TreeFolder>,
): Located | undefined {
  const k = keyOf(path);
  const inEntry = (e: LibraryEntry, isRoot: boolean) => {
    const ek = keyOf(e.path);
    if (ek === k && e.kind === "file") return { open: [], material: scans.get(ek)?.materials[0] };
    const tree = trees.get(ek);
    if (!tree || !(k === ek || inside(k, ek))) return undefined;
    // Walk down from the entry to this path, and expand every folder on the way (the project folder itself is handled by the project's expansion)
    const open: string[] = isRoot ? [] : [e.path];
    let f: TreeFolder | undefined = tree;
    while (f && keyOf(f.path) !== k) {
      const hit = f.files.find((m) => keyOf(m.path) === k);
      if (hit) return { open, material: hit };
      f = f.folders.find((d) => k === keyOf(d.path) || inside(k, keyOf(d.path)));
      if (f) open.push(f.path);
    }
    if (!f) return { open };
    // A folder: select the first item inside, and expand the subfolders on the way too, so the selected row is visible
    const first = (x: TreeFolder): { material: MaterialEntry; via: string[] } | undefined => {
      if (x.folders.length === 0 && x.files[0]) return { material: x.files[0], via: [] };
      for (const d of x.folders) {
        const hit = first(d);
        if (hit) return { material: hit.material, via: [d.path, ...hit.via] };
      }
      return x.files[0] ? { material: x.files[0], via: [] } : undefined;
    };
    const hit = first(f);
    return { open: [...open, ...(hit?.via ?? [])], material: hit?.material };
  };
  for (const p of projects) {
    // When the project folder itself is an entry, look first among the separately listed ones (only what isn't in the tree is listed
    // separately), then in the tree
    for (const e of p.root ? [...p.shown, p.root] : p.shown) {
      const hit = inEntry(e, e === p.root);
      if (hit) return { project: p.home, ...hit };
    }
  }
  return undefined;
}

export function useLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [scans, setScans] = useState(() => new Map<string, ScanResult>());
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const [loaded, setLoaded] = useState(false);
  // Callbacks must read the latest expansion / collapse / scan results without the callbacks themselves changing (they are handed
  // elsewhere as dependencies): keep them in refs, updated right after commit (this used to be written during render, which trips
  // react(refs); a layout effect is used so they are updated before the user can click, matching the effect of writing during render)
  const expandedRef = useRef(expanded);
  const collapsedRef = useRef(collapsed);
  const scansRef = useRef(scans);
  useLayoutEffect(() => {
    expandedRef.current = expanded;
    collapsedRef.current = collapsed;
    scansRef.current = scans;
  }, [expanded, collapsed, scans]);

  const scan = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    const results = await call("scan", { paths });
    setScans((prev) => {
      const next = new Map(prev);
      for (const r of results) next.set(keyOf(r.entry), r);
      return next;
    });
  }, []);

  /**
   * Re-read the entries (order, pinning, whether they still exist) and scan those not scanned yet; when rescan is a list of paths those
   * are rescanned too (the items were changed externally)
   */
  const refreshEntries = useCallback(
    async (rescan: "new" | "all" | string[] = "new") => {
      const state = await call("library");
      setEntries(state.entries);
      // Drop the scan results of entries no longer in the library: if the disk changed after removal, they must be rescanned when added back
      // (the pre-removal results used to be reused, so new files didn't appear and deleted ones stayed; the shell has also forgotten its
      // fingerprint, so adding it back doesn't push "items changed")
      const listed = new Set(state.entries.map((e) => keyOf(e.path)));
      const known = new Map([...scansRef.current].filter(([k]) => listed.has(k)));
      if (known.size !== scansRef.current.size) {
        scansRef.current = known;
        setScans((prev) => new Map([...prev].filter(([k]) => listed.has(k))));
      }
      const again = new Set(Array.isArray(rescan) ? rescan.map(keyOf) : []);
      const need = state.entries
        .filter((e) => rescan === "all" || again.has(keyOf(e.path)) || !known.has(keyOf(e.path)))
        .map((e) => e.path);
      await scan(need);
      return state;
    },
    [scan],
  );

  /** At startup: read the list, scan everything, restore the expanded / collapsed state */
  const load = useCallback(async () => {
    const state = await call("library");
    setEntries(state.entries);
    setExpanded(new Set(state.expanded.map(keyOf)));
    setCollapsed(new Set(state.collapsed.map(keyOf)));
    await scan(state.entries.map((e) => e.path));
    setLoaded(true);
    return state;
  }, [scan]);

  // Expanded folders and collapsed projects: saved a little after a change, so repeated clicks don't write to disk continuously
  const persistTimers = useRef<Record<string, number>>({});
  const persist = useCallback((method: "libraryExpanded" | "libraryCollapsed", set: Set<string>) => {
    clearTimeout(persistTimers.current[method]);
    persistTimers.current[method] = window.setTimeout(() => void call(method, { paths: [...set] }), 400);
  }, []);
  const setOpen = useCallback(
    (paths: string[], open: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const p of paths) {
          if (open) next.add(keyOf(p));
          else next.delete(keyOf(p));
        }
        persist("libraryExpanded", next);
        return next;
      });
    },
    [persist],
  );
  const toggleOpen = useCallback((path: string) => setOpen([path], !expandedRef.current.has(keyOf(path))), [setOpen]);
  const setProjectOpen = useCallback(
    (homes: string[], open: boolean) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const h of homes) {
          if (open) next.delete(keyOf(h));
          else next.add(keyOf(h));
        }
        persist("libraryCollapsed", next);
        return next;
      });
    },
    [persist],
  );
  const toggleProject = useCallback((home: string) => setProjectOpen([home], collapsedRef.current.has(keyOf(home))), [setProjectOpen]);

  const afterAdd = useCallback(
    async (r: AddResult) => {
      if (!r.reloading) await refreshEntries("new");
      return r;
    },
    [refreshEntries],
  );

  const ops = {
    load,
    toggleOpen,
    setOpen,
    toggleProject,
    setProjectOpen,
    add: useCallback(async (paths: string[]) => afterAdd(await call("libraryAdd", { paths })), [afterAdd]),
    addFiles: useCallback(async (files: File[]) => afterAdd(await addDropped(files)), [afterAdd]),
    /**
     * Ctrl+V: files from the clipboard (same as dragging them in) or an image (the shell saves it into the "Pasted images" folder). If
     * that folder is already in the library it has to be rescanned for the new image to be listed
     */
    paste: useCallback(async () => {
      const r = await call("pasteClipboard");
      if (!r.empty && !r.reloading) await refreshEntries(r.pasted ? [dirName(r.pasted)] : "new");
      return r;
    }, [refreshEntries]),
    pickFiles: useCallback(async () => {
      const paths = await call("pickFiles");
      return paths.length ? afterAdd(await call("libraryAdd", { paths })) : undefined;
    }, [afterAdd]),
    pickFolder: useCallback(async () => {
      const path = await call("pickFolder", {});
      return path ? afterAdd(await call("libraryAdd", { paths: [path] })) : undefined;
    }, [afterAdd]),
    /**
     * Point an entry that can no longer be found to a new location (right-click "Locate…"); if the new location is on a drive that is
     * mapped only after the page loaded, the shell reloads the page (reloading)
     */
    relocate: useCallback(
      async (from: string, to: string) => {
        const r = await call("libraryRelocate", { from, to });
        if (!r.reloading) await refreshEntries("new");
        return r;
      },
      [refreshEntries],
    ),
    remove: useCallback(
      async (paths: string[]) => {
        const removed = await call("libraryRemove", { paths });
        await refreshEntries("new");
        return removed;
      },
      [refreshEntries],
    ),
    pin: useCallback(
      async (paths: string[], pinned: boolean) => {
        await call("libraryPin", { paths, pinned });
        await refreshEntries("new");
      },
      [refreshEntries],
    ),
    /** Rescan all entries (files were added to or deleted from folders) */
    rescan: useCallback(() => refreshEntries("all"), [refreshEntries]),
    /** The shell changed the list (something new was opened from the context menu): re-read the entries and scan only the new ones */
    sync: useCallback(() => refreshEntries("new"), [refreshEntries]),
    /**
     * The files of these entries were changed externally: rescan (item URLs carry the modification time, so after the scan the URL
     * changes and the canvas naturally switches to the new one)
     */
    changed: useCallback((paths: string[]) => refreshEntries(paths), [refreshEntries]),
  };

  // ---------- Derived data (how it is computed is in the pure functions above) ----------

  const trees = useMemo(() => entryTrees(entries, scans), [entries, scans]);

  const projects = useMemo(() => groupProjects(entries, scans, trees), [entries, scans, trees]);

  /** All items in display order (whether or not projects and folders are expanded); a file contained by two entries is counted once */
  const ordered = useMemo(() => projects.flatMap((p) => p.materials), [projects]);

  const byKey = useMemo(() => new Map(ordered.map((m) => [keyOf(m.path), m])), [ordered]);

  /** The notes folders in use (original case, deduplicated) */
  const homes = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of ordered) map.set(keyOf(m.home), m.home);
    // An entry that can't be found: if the .sniptoss of its project still exists it is read anyway (it used to read none, so the notes
    // panel did not show them while agents saw them in REVIEW.md)
    for (const s of scans.values()) if (s.keptHome) map.set(keyOf(s.keptHome), s.keptHome);
    return [...map.values()];
  }, [ordered, scans]);

  const rows = useMemo(() => listRows(projects, scans, trees, expanded, collapsed), [projects, scans, trees, expanded, collapsed]);

  const locate = useCallback((path: string) => locateIn(path, projects, scans, trees), [projects, scans, trees]);

  return { entries, scans, trees, projects, expanded, collapsed, rows, ordered, byKey, homes, loaded, locate, ...ops };
}

export type Library = ReturnType<typeof useLibrary>;

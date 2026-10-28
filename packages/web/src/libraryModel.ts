import { useCallback, useMemo } from "react";
import { useIntl } from "react-intl";
import { baseName, keyOf, type AppInfo, type LibraryEntry, type MaterialEntry } from "./host";
import {
  distinctPlaces,
  folderNote,
  folderPathOf,
  folderTarget,
  materialOf,
  projectName,
  projectPlace,
  treeMaterials,
  type FolderTarget,
  type Library,
  type Project,
  type Row,
  type TreeFolder,
} from "./library";
import { shortList } from "./LibraryParts";

// How a library row is read and acted on (split out of LibraryPanel): the name, the count on the right, expand / collapse, which items it
// covers, copy, removing from the library. Only functions over a row, holding no state (expansion is kept in library)

/** What is being removed from the library: one entry / a whole project / several selected rows (count = number of selected rows) */
export type RemoveTarget = { kind: "entry" | "project"; name: string } | { kind: "picked"; count: number };

export function useRowModel(opts: {
  library: Library;
  /** The rows currently listed (the count on a project row depends on which rows are listed below it) */
  rows: Row[];
  appInfo?: AppInfo;
  openCount: (materialKey: string) => number;
  folderCount: (home: string, rel?: string, deep?: boolean) => number;
  missingCount: (home: string) => number;
  onCopy: (materials: MaterialEntry[], label: string, folder?: FolderTarget, mode?: "text" | "images") => void;
  onRemove: (entries: LibraryEntry[], what: RemoveTarget) => void;
}) {
  const { library, rows, openCount } = opts;
  const intl = useIntl();
  /**
   * A project's name: the folder for images pasted with Ctrl+V (the app's own pasted folder) is shown as "Pasted images", and the others
   * use the folder name
   */
  const pastedKey = opts.appInfo?.pastedDir ? keyOf(opts.appInfo.pastedDir) : undefined;
  // useCallback: sameNamePlaces below depends on it, and if it were unstable that would be recomputed on every render
  const nameOf = useCallback(
    (p: Project) => (pastedKey && keyOf(p.home) === pastedKey ? intl.formatMessage({ id: "library.pasted" }) : projectName(p)),
    [pastedKey, intl],
  );

  const countOf = (materials: MaterialEntry[]) => materials.reduce((n, m) => n + openCount(keyOf(m.path)), 0);

  /**
   * Projects with the same name: the subtitle goes down to the level where they can be told apart (project key → subtitle); projects with
   * unique names aren't in it
   */
  const sameNamePlaces = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const p of library.projects) {
      const k = nameOf(p).toLowerCase();
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const out = new Map<string, string>();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const places = distinctPlaces(g.map((p) => projectPlace(p.home) ?? ""));
      g.forEach((p, i) => out.set(p.key, places[i]));
    }
    return out;
  }, [library.projects, nameOf]);

  /**
   * The folder has no item that can be annotated: the subtitle explains, and also mentions unsupported files and skipped folders if there
   * are any (like the gray line at the end when there are items)
   */
  const emptyNote = (s: Parameters<typeof folderNote>[0]) => {
    const note = folderNote(s);
    const parts = [
      note?.others &&
        intl.formatMessage({ id: "library.note.others" }, { count: note.others.count, exts: shortList(intl, note.others.exts) }),
      note?.moreOff &&
        intl.formatMessage({ id: "library.note.moreOff" }, { count: note.moreOff.count, exts: shortList(intl, note.moreOff.exts) }),
      note?.skipped && intl.formatMessage({ id: "library.note.skipped" }, { names: shortList(intl, note.skipped) }),
    ].filter((x): x is string => !!x);
    return parts.length
      ? intl.formatMessage({ id: "library.noMaterialsWith" }, { detail: parts.join(intl.formatMessage({ id: "list.semi" })) })
      : intl.formatMessage({ id: "library.noMaterials" });
  };

  const isOpen = (path: string) => library.expanded.has(keyOf(path));
  const projectOpen = (p: Project) => !library.collapsed.has(p.key);
  const canExpand = (row: Row) => row.type === "project" || !!folderPathOf(row);
  const expandedRow = (row: Row) => (row.type === "project" ? projectOpen(row.project) : !!folderPathOf(row) && isOpen(folderPathOf(row)!));
  const toggleRow = (row: Row) => {
    if (row.type === "project") library.toggleProject(row.project.home);
    else if (folderPathOf(row)) library.toggleOpen(folderPathOf(row)!);
  };
  const setRowOpen = (row: Row, open: boolean) => {
    if (row.type === "project") library.setProjectOpen([row.project.home], open);
    else if (folderPathOf(row)) library.setOpen([folderPathOf(row)!], open);
  };

  /** Which items a row covers and what it is called: used for copying for AI */
  const scopeOf = (row: Row): { materials: MaterialEntry[]; label: string } => {
    if (row.type === "project") return { materials: row.project.materials, label: nameOf(row.project) };
    if (row.type === "folder") return { materials: treeMaterials(row.folder), label: row.folder.name };
    if (row.type === "entry" && row.tree) return { materials: treeMaterials(row.tree), label: baseName(row.entry.path) };
    const m = materialOf(row);
    // An entry that can't be found or isn't supported has no item, and its name is still given (Ctrl+C used to say "No open notes in “”")
    return { materials: m ? [m] : [], label: m ? baseName(m.path) : row.type === "entry" ? baseName(row.entry.path) : "" };
  };
  /** The items covered by several rows together: deduplicated, in list order */
  const materialsOf = (rs: Row[]) => {
    const keys = new Set(rs.flatMap((r) => scopeOf(r).materials.map((m) => keyOf(m.path))));
    return library.ordered.filter((m) => keys.has(keyOf(m.path)));
  };
  /** The folder a project / folder row refers to (used for writing folder comments and counting them) */
  const folderOfRow = (row: Row): FolderTarget | undefined => {
    if (row.type === "project") return folderTarget(row.project.home, row.project.home);
    if (row.type === "entry") return row.entry.kind === "folder" ? folderTarget(row.project.home, row.entry.path) : undefined;
    if (row.type === "folder") {
      const p = library.projects.find((x) => x.entries.includes(row.entry));
      return p && folderTarget(p.home, row.folder.path);
    }
    return undefined;
  };
  const copyRow = (row: Row, mode: "text" | "images" = "text") => {
    const { materials, label } = scopeOf(row);
    opts.onCopy(materials, label, folderOfRow(row), mode);
  };
  /**
   * How many notes a right-click copy on this row hands over: those of the items + folder comments + (on the project row) the group of
   * items that can't be found, same as Workspace's copyMaterials
   */
  const rowCopyCount = (row: Row) => {
    const folder = folderOfRow(row);
    return (
      countOf(scopeOf(row).materials) +
      (folder ? opts.folderCount(folder.home, folder.rel) : 0) +
      (folder?.rel === "." ? opts.missingCount(folder.home) : 0)
    );
  };
  const removeRow = (row: Row) => {
    if (row.type === "project") opts.onRemove(row.project.entries, { kind: "project", name: nameOf(row.project) });
    else if (row.type === "entry") opts.onRemove([row.entry], { kind: "entry", name: baseName(row.entry.path) });
  };

  /**
   * The count on a folder row: collapsed = all items inside + the folder comments of it and its subfolders;
   * expanded, the items' counts are on the rows below, and only its own folder comments remain here (a subfolder's are on the subfolder's row)
   */
  const folderRowCount = (row: Row, tree: TreeFolder) => {
    const t = folderOfRow(row);
    const open = isOpen(tree.path);
    const own = t ? opts.folderCount(t.home, t.rel, !open) : 0;
    return open ? own : countOf(treeMaterials(tree)) + own;
  };
  /**
   * The open-note count on the right of a row. A project row shows the total (same as "Entire Project" in the notes panel: items' notes +
   * folder comments + the group of items that can't be found)
   */
  const badgeOf = (row: Row): number => {
    if (row.type === "project")
      return countOf(row.project.materials) + opts.folderCount(row.project.home) + opts.missingCount(row.project.home);
    if (row.type === "folder") return folderRowCount(row, row.folder);
    if (row.type === "file") return openCount(keyOf(row.material.path));
    if (row.tree) return folderRowCount(row, row.tree);
    return row.material ? openCount(keyOf(row.material.path)) : 0;
  };
  /**
   * The count written on row i (a project row): collapsed it shows the total; expanded, the rows below have their own counts, and here
   * only what none of them counts is written: the project folder's own comments and the group of items that can't be found
   * (nothing was written when expanded, so these were visible nowhere)
   */
  const projectBadge = (i: number) => {
    const row = rows[i];
    const total = badgeOf(row);
    if (row.type !== "project" || !projectOpen(row.project)) return total;
    let shown = 0;
    for (let k = i + 1; k < rows.length && rows[k].type !== "project"; k++) shown += badgeOf(rows[k]);
    return Math.max(0, total - shown);
  };

  return {
    nameOf,
    sameNamePlaces,
    countOf,
    emptyNote,
    isOpen,
    projectOpen,
    canExpand,
    expandedRow,
    toggleRow,
    setRowOpen,
    scopeOf,
    materialsOf,
    folderOfRow,
    copyRow,
    rowCopyCount,
    removeRow,
    badgeOf,
    projectBadge,
  };
}

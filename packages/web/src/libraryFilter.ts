import { useMemo } from "react";
import { baseName, keyOf, type MaterialEntry } from "./host";
import { entryContaining, folderTarget, treeMaterials, type Library, type Row } from "./library";

// Which rows the library lists (split out of LibraryPanel): normally library.rows (project → entry → folder tree);
// with text in the filter box they are flattened to the matching items; with "show only items with open notes" on, only rows that have
// open notes below them are kept

export function useShownRows(opts: {
  library: Library;
  /** The text in the filter box */
  query: string;
  /** Keep only those with open notes */
  pendingOnly: boolean;
  /** Number of open notes of an item */
  openCount: (materialKey: string) => number;
  /** How many open folder comments there are */
  folderCount: (home: string, rel?: string, deep?: boolean) => number;
  /** How many open notes in this notes folder belong to items that can't be found */
  missingCount: (home: string) => number;
}): Row[] {
  const { library, query, pendingOnly, openCount } = opts;
  const entryOf = (m: MaterialEntry) => entryContaining(library.entries, m.path);

  /**
   * Whether open notes exist below this row (of items, folder comments, or the group of items that can't be found in a project).
   * With "show only items with open notes" on only these rows are kept; expanding and collapsing work as usual
   */
  const hasPending = (row: Row): boolean => {
    const any = (ms: MaterialEntry[]) => ms.some((m) => openCount(keyOf(m.path)) > 0);
    const folderNotes = (home: string, path: string) => {
      const t = folderTarget(home, path);
      return !!t && opts.folderCount(t.home, t.rel) > 0;
    };
    if (row.type === "project")
      return any(row.project.materials) || opts.folderCount(row.project.home) > 0 || opts.missingCount(row.project.home) > 0;
    if (row.type === "entry")
      return row.tree
        ? any(treeMaterials(row.tree)) || folderNotes(row.project.home, row.entry.path)
        : !!row.material && any([row.material]);
    if (row.type === "folder") {
      const home = treeMaterials(row.folder)[0]?.home ?? library.projects.find((p) => p.entries.includes(row.entry))?.home;
      return any(treeMaterials(row.folder)) || (!!home && folderNotes(home, row.folder.path));
    }
    return any([row.material]);
  };

  // The open counts follow the notes: openCount and folderCount are new on every render, so they trigger a recompute only while "show
  // only open" is on. Compute them into variables first and then put those into the dependencies: the dependency list cannot contain
  // expressions (react-hooks/exhaustive-deps)
  const pendingOpenCount = pendingOnly ? opts.openCount : undefined;
  const pendingFolderCount = pendingOnly ? opts.folderCount : undefined;
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pendingOnly ? library.rows.filter(hasPending) : library.rows;
    // Flattened while filtering: items whose name, folder or project name contains the keyword, with a line below saying the project and folder
    return library.ordered
      .filter((m) => `${baseName(m.home)}/${m.homeRel}`.toLowerCase().includes(q) && (!pendingOnly || openCount(keyOf(m.path)) > 0))
      .flatMap((m): Row[] => {
        const entry = entryOf(m);
        if (!entry) return [];
        const hint = [baseName(m.home) || m.home, ...m.homeRel.split("/").slice(0, -1)].join(" / ");
        return [{ type: "file", id: `q|${keyOf(m.path)}`, material: m, entry, depth: 0, hint }];
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.rows, library.ordered, library.entries, query, pendingOnly, pendingOpenCount, pendingFolderCount]);
}

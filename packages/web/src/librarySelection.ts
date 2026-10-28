import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keyOf, type LibraryEntry, type MaterialEntry } from "./host";
import { materialOf, type Library, type Row } from "./library";
import type { RemoveTarget, useRowModel } from "./libraryModel";

// Multi-selection in the library (split out of LibraryPanel): the cursor, the selected rows, and the start of a Shift range; it follows
// the item open on the canvas, reports the selected scope to the notes panel, and re-selects in the tree after the filter is cleared

export function useLibrarySelection(opts: {
  library: Library;
  rows: Row[];
  /** The text in the filter box (when cleared, what was selected during filtering is re-selected in the tree) */
  query: string;
  selectedKey: string | undefined;
  /** When it changes, cancel the multi-selection and select only the item open on the canvas */
  clearPick: number;
  onPicked: (materials: MaterialEntry[], custom: boolean, home?: string) => void;
  onSelect: (m: MaterialEntry) => void;
  openCount: (materialKey: string) => number;
  onCopyListed: (mode: "text" | "images") => void;
  onRemove: (entries: LibraryEntry[], what: RemoveTarget) => void;
  model: Pick<ReturnType<typeof useRowModel>, "materialsOf" | "removeRow">;
  revealRow: (id: string | undefined) => void;
}) {
  const { library, rows, query, selectedKey, onPicked, openCount, revealRow } = opts;
  const { materialsOf, removeRow } = opts.model;
  const [cursor, setCursor] = useState<string>();
  /**
   * The selected rows (multi-selection). Single click = select only this row and open it; Ctrl-click = add / remove; Shift-click = range
   * from the row clicked last to this one
   */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string>(undefined);
  const pickOnly = (id: string) => {
    setPicked(new Set([id]));
    anchor.current = id;
  };

  /** The selected rows that are still visible (rows in collapsed projects and folders don't count; their items are carried by the level above) */
  const pickedRows = rows.filter((r) => picked.has(r.id));
  const multi = pickedRows.length > 1;
  const rowOfKey = (key: string | undefined) =>
    key
      ? rows.find((r) => {
          const m = materialOf(r);
          return m && keyOf(m.path) === key;
        })
      : undefined;
  /** Select only the item currently open on the canvas (click on blank list space, press Esc) */
  const pickCurrent = () => {
    const row = rowOfKey(selectedKey);
    if (row) {
      setCursor(row.id);
      pickOnly(row.id);
    } else setPicked(new Set());
  };

  // The selected item changed (Ctrl+↓, ← → on an image, locating after a drag-in, clicking another item's note in the notes panel): the
  // cursor follows it and scrolls it into view. If it is still within the selected scope (viewing items one by one while a whole project
  // or several items are selected) the selection is untouched and the notes panel on the right keeps showing the whole scope; if not,
  // only it is selected. It follows only when "selected" changes; when expanding or collapsing folders the cursor stays where it is (rows
  // and selected rows are read from latest, updated after commit)
  const latest = useRef({ rows, pickedRows });
  useLayoutEffect(() => {
    latest.current = { rows, pickedRows };
  });
  /**
   * A single click / Enter on a project or folder row also opened an item inside it: the cursor stays on that row and does not jump to that item
   * (with the keyboard, Enter used to open the folder and the cursor jumped inside, so another Enter could not collapse it, unlike a
   * double mouse click)
   */
  const keepCursor = useRef<{ row: string; key: string }>(undefined);
  /** This row also opened the item inside it with key: the cursor doesn't follow for this item change */
  const holdCursor = (row: string, key: string) => {
    keepCursor.current = { row, key };
  };
  useEffect(() => {
    const keep = keepCursor.current;
    keepCursor.current = undefined;
    if (!selectedKey) return;
    const { rows: rs, pickedRows: prs } = latest.current;
    if (keep?.key === selectedKey && prs.some((r) => r.id === keep.row)) return;
    const row = rs.find((r) => {
      const m = materialOf(r);
      return m && keyOf(m.path) === selectedKey;
    });
    if (!row) return;
    setCursor(row.id);
    if (!materialsOf(prs).some((m) => keyOf(m.path) === selectedKey)) pickOnly(row.id);
    requestAnimationFrame(() => revealRow(row.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Tell the outside the selected scope (with a multi-selection the notes panel on the right lists them). pickedRows is a new array on
  // every render, so compare by the id string
  const pickedKey = pickedRows.map((r) => r.id).join("\n");
  useEffect(() => {
    const one = pickedRows.length === 1 ? pickedRows[0] : undefined;
    const home = one && (one.type === "project" || one.type === "entry") ? one.project.home : undefined;
    onPicked(materialsOf(pickedRows), pickedRows.length > 1 || (pickedRows.length === 1 && !materialOf(pickedRows[0])), home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, library.ordered, onPicked]);
  useEffect(() => {
    if (opts.clearPick) pickCurrent();
    // Only when the scope on top of the notes panel was switched (clearPick changed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.clearPick]);

  // Clearing the filter: the items selected while filtering are re-selected in the tree (the row ids differ, and after clearing the
  // selection highlight used to vanish), and collapsed folders are expanded first.
  // Those rows exist only after the next render, so it is noted down first; this effect must come before the one below (it runs first in
  // the same commit and can't be used up before the expansion)
  const repick = useRef<string[]>(undefined);
  const pickKeys = (keys: string[]) => {
    const hit = rows.filter((r) => {
      const m = materialOf(r);
      return m && keys.includes(keyOf(m.path));
    });
    if (hit.length === 0) return pickCurrent();
    setPicked(new Set(hit.map((r) => r.id)));
    setCursor(hit[0].id);
    anchor.current = hit[0].id;
    requestAnimationFrame(() => revealRow(hit[0].id));
  };
  useEffect(() => {
    if (!repick.current) return;
    pickKeys(repick.current);
    repick.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const lastQuery = useRef("");
  useEffect(() => {
    const was = lastQuery.current;
    lastQuery.current = query.trim();
    if (!was || lastQuery.current) return;
    const keys = [...picked].filter((id) => id.startsWith("q|")).map((id) => id.slice(2));
    if (keys.length === 0) return pickCurrent();
    let opening = false;
    for (const k of keys) {
      const hit = library.locate(k);
      if (!hit) continue;
      if (library.collapsed.has(keyOf(hit.project))) {
        library.setProjectOpen([hit.project], true);
        opening = true;
      }
      if (hit.open.some((p) => !library.expanded.has(keyOf(p)))) {
        library.setOpen(hit.open, true);
        opening = true;
      }
    }
    if (opening) repick.current = keys;
    else pickKeys(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const togglePick = (row: Row) => {
    setCursor(row.id);
    anchor.current = row.id;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };
  /**
   * Select the range from the anchor row to row i. If the anchor is no longer visible (in a collapsed folder, or the filter changed the
   * rows) start from the cursor row, and if there is none either select only this row (it used to start from the first row)
   */
  const pickRange = (i: number) => {
    const at = (id: string | undefined) => (id === undefined ? -1 : rows.findIndex((r) => r.id === id));
    const a = [at(anchor.current), at(cursor), i].find((k) => k >= 0)!;
    anchor.current = rows[a]?.id;
    const [from, to] = a < i ? [a, i] : [i, a];
    setPicked(new Set(rows.slice(from, to + 1).map((r) => r.id)));
    setCursor(rows[i]?.id);
    revealRow(rows[i]?.id);
  };
  /**
   * If the items covered by the selected rows don't include the one open on the canvas: open the first of them that has open notes (or
   * the first item). Done after marquee selection and select-all
   */
  const openFirstOf = (rs: Row[]) => {
    const materials = materialsOf(rs);
    if (materials.length && !materials.some((m) => keyOf(m.path) === selectedKey))
      opts.onSelect(materials.find((m) => openCount(keyOf(m.path)) > 0) ?? materials[0]);
  };
  const pickAll = () => {
    setPicked(new Set(rows.map((r) => r.id)));
    openFirstOf(rows);
  };
  /** The entries among several rows that can be removed from the library (a project = all of its entries) */
  const entriesOf = (rs: Row[]) => [
    ...new Set(rs.flatMap((r) => (r.type === "project" ? r.project.entries : r.type === "entry" ? [r.entry] : []))),
  ];
  /**
   * Among the selected rows those that can be removed: project rows and single entry rows (an entry whose project is also selected isn't
   * counted separately). The confirm dialog counts "these N items" by it; it used to count entries, so selecting two projects could say
   * "these 5 items"
   */
  const removableOf = (rs: Row[]) => {
    const projects = new Set(rs.flatMap((r) => (r.type === "project" ? [r.project.key] : [])));
    return rs.filter((r) => r.type === "project" || (r.type === "entry" && !projects.has(r.project.key)));
  };
  const copyPicked = (mode: "text" | "images" = "text") => opts.onCopyListed(mode);
  const removePicked = () => {
    const rs = removableOf(pickedRows);
    if (rs.length === 1) removeRow(rs[0]);
    else if (rs.length) opts.onRemove(entriesOf(rs), { kind: "picked", count: rs.length });
  };

  return {
    cursor,
    setCursor,
    picked,
    setPicked,
    anchor,
    pickOnly,
    holdCursor,
    pickedRows,
    multi,
    rowOfKey,
    pickCurrent,
    togglePick,
    pickRange,
    openFirstOf,
    pickAll,
    removableOf,
    copyPicked,
    removePicked,
  };
}

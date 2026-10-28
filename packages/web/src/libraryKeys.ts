import { useRef, type RefObject } from "react";
import { keyOf, type MaterialEntry } from "./host";
import { materialOf, type Row } from "./library";
import type { useRowModel } from "./libraryModel";
import type { useLibrarySelection } from "./librarySelection";

// Clicks and keyboard of the library (split out of LibraryPanel): single / double click on a row, Enter to open, arrow keys to move and
// expand / collapse, Enter / ↓ / Esc in the filter box. The order of the checks matters: Ctrl+↑↓ etc. are left to the global handlers; ←
// → on an item row and Space on the item open on the canvas are left to the canvas (video frame stepping, playback)

export function useListKeys(opts: {
  rows: Row[];
  list: RefObject<HTMLDivElement | null>;
  query: string;
  setQuery: (q: string) => void;
  selectedKey: string | undefined;
  onSelect: (m: MaterialEntry) => void;
  openCount: (materialKey: string) => number;
  selection: ReturnType<typeof useLibrarySelection>;
  model: ReturnType<typeof useRowModel>;
  revealRow: (id: string | undefined) => void;
}) {
  const { rows, list, query, selectedKey, onSelect, openCount, revealRow } = opts;
  const { cursor, setCursor, picked, pickOnly, holdCursor, pickedRows, multi, rowOfKey, pickCurrent } = opts.selection;
  const { togglePick, pickRange, pickAll, copyPicked, removePicked } = opts.selection;
  const { canExpand, expandedRow, toggleRow, setRowOpen, scopeOf, copyRow, removeRow } = opts.model;

  /** Which row's expansion the last single click toggled (the second click of a double-click uses it to decide whether to toggle again) */
  const toggledBy = useRef<string>(undefined);
  /**
   * Single click, Enter: select only this row. The first click on a project or folder selects it (the notes panel on the right shows all
   * the notes inside) and expands it if collapsed; only a click while it is already the only selection collapses it, otherwise a click on
   * the tree to see a whole project's notes would fold the tree
   */
  const activate = (row: Row) => {
    const only = picked.size === 1 && picked.has(row.id);
    setCursor(row.id);
    pickOnly(row.id);
    toggledBy.current = only || !expandedRow(row) ? row.id : undefined;
    if (toggledBy.current) toggleRow(row);
    const m = materialOf(row);
    if (m) return onSelect(m);
    // Project or folder: if the item open on the canvas is not inside it, open the first item inside that has open notes (or the first item),
    // otherwise the right side lists this project's notes while the canvas shows an item of another project
    const { materials } = scopeOf(row);
    if (materials.length && !materials.some((x) => keyOf(x.path) === selectedKey)) {
      const open = materials.find((x) => openCount(keyOf(x.path)) > 0) ?? materials[0];
      holdCursor(row.id, keyOf(open.path));
      onSelect(open);
    }
  };
  /** Single click on a row: Ctrl adds / removes, Shift selects a range, double-clicking a project or folder toggles expansion once */
  const onRowClick = (e: React.MouseEvent, row: Row, i: number) => {
    if (e.ctrlKey || e.metaKey) togglePick(row);
    else if (e.shiftKey) pickRange(i);
    else if (e.detail === 2 && canExpand(row)) {
      // Double-clicking a project or folder toggles expansion once in total (as in File Explorer). It used to expand on the first click
      // and collapse again on the second
      if (toggledBy.current !== row.id) toggleRow(row);
      toggledBy.current = undefined;
    } else activate(row);
  };

  /**
   * In the filter box: Enter opens the first matching item (focus returns to the canvas, ready to annotate); ↓ enters the list and goes
   * down from the first row; Esc first clears the keyword, and only a second press leaves the filter box (like VS Code's quick open)
   */
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      const firstMaterial = rows.find((r) => materialOf(r));
      if (!firstMaterial) return;
      e.preventDefault();
      activate(firstMaterial);
      e.currentTarget.blur();
    } else if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      list.current?.focus();
      moveTo(0);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation(); // keep the global Esc from moving the caret away: after clearing the keyword, typing continues
      opts.setQuery("");
    }
  };

  const moveTo = (i: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!row) return;
    setCursor(row.id);
    pickOnly(row.id);
    const m = materialOf(row);
    if (m) onSelect(m);
    revealRow(row.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.id === cursor);
    const row = rows[i];
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "c") {
      if (multi && row && picked.has(row.id)) copyPicked();
      else if (row) copyRow(row);
      return done();
    }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "a") {
      pickAll();
      return done();
    }
    // When there is no anchor or it is no longer visible, pickRange starts from the cursor row
    if (e.shiftKey && !e.ctrlKey && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      pickRange(Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
      return done();
    }
    if (e.key === "Escape" && pickedRows.some((r) => r !== rowOfKey(selectedKey))) {
      pickCurrent();
      return done();
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        moveTo(i + 1);
        break;
      case "ArrowUp":
        moveTo(i < 0 ? 0 : i - 1);
        break;
      // ← → on an item row are left to the canvas (video frame stepping, switching items for images): after clicking an item row focus is
      // in the list, and these two keys used to do nothing
      case "ArrowRight":
        if (row && !canExpand(row)) handled = false;
        else if (row && !expandedRow(row)) setRowOpen(row, true);
        else if (row) moveTo(i + 1);
        break;
      case "ArrowLeft":
        if (row && !canExpand(row) && materialOf(row)) handled = false;
        else if (row && canExpand(row) && expandedRow(row)) setRowOpen(row, false);
        else if (row && row.depth > 0) {
          // Jump to the parent level (folder or project)
          let j = i - 1;
          while (j > 0 && rows[j].depth >= row.depth) j--;
          moveTo(j);
        }
        break;
      case " ":
        // The item already open on the canvas: Space plays / pauses (after clicking a video row, Space plays right away; the list used to
        // swallow it and only K worked)
        if (row && materialOf(row) && keyOf(materialOf(row)!.path) === selectedKey && picked.size <= 1) handled = false;
        else if (row) activate(row);
        break;
      case "Enter":
        if (row) activate(row);
        break;
      case "Delete":
        if (multi && row && picked.has(row.id)) removePicked();
        else if (row) removeRow(row);
        break;
      // Backspace does nothing in the list: it used to bubble up as "delete the selected note", deleting the one on the canvas while
      // focus was in the list
      case "Backspace":
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return { onRowClick, onSearchKey, onKey };
}

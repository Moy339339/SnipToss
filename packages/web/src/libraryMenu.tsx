import { useState, type RefObject } from "react";
import { useIntl } from "react-intl";
import { DATA_DIR } from "@sniptoss/core";
import { cssZoom } from "./cssZoom";
import type { useFreshMarks } from "./freshMarks";
import { homeJoin, keyOf, type LibraryEntry, type MaterialEntry } from "./host";
import {
  ChevronIcon,
  ClearListIcon,
  CloseIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  KindIcon,
  NoteIcon,
  PinIcon,
  RefreshIcon,
  SparkIcon,
} from "./icons";
import { treeMaterials, type FolderTarget, type Library, type Project, type Row } from "./library";
import type { useRowModel } from "./libraryModel";
import type { useLibrarySelection } from "./librarySelection";
import type { MenuItem } from "./Menu";

// The library's context menu (split out of LibraryPanel): right-click on a row offers that item's actions plus Clear, and right-click on
// blank list space offers the whole list's actions; a right-click on one of several selected rows acts on all of them. A menu opened by
// keyboard (Shift+F10, the menu key) is placed under the cursor row. The gray text on the right of the menu holds only shortcuts and
// counts, and explanations go in the tooltip (same as the menu bar)

export function useLibraryMenu(opts: {
  library: Library;
  rows: Row[];
  list: RefObject<HTMLDivElement | null>;
  offsets: Float64Array;
  listPad: () => number;
  revealRow: (id: string | undefined) => void;
  openCount: (materialKey: string) => number;
  /** The open notes the notes panel lists: how many, spread over how many items (shown in the context menu on a multi-selection) */
  listed: { count: number; materials: number };
  hasNotes: (home: string) => boolean;
  on: {
    addFiles: () => void;
    addFolder: () => void;
    paste: () => void;
    clear: () => void;
    refresh: () => void;
    reveal: (path: string) => void;
    folderNote: (folder: FolderTarget) => void;
    pin: (project: Project, pinned: boolean) => void;
    relocate: (entry: LibraryEntry) => void;
  };
  selection: ReturnType<typeof useLibrarySelection>;
  model: ReturnType<typeof useRowModel>;
  fresh: ReturnType<typeof useFreshMarks>;
}) {
  const { library, rows, list, openCount, on } = opts;
  const { cursor, setCursor, picked, multi, pickOnly, pickedRows, removableOf, pickAll, copyPicked, removePicked } = opts.selection;
  const { folderOfRow, rowCopyCount, scopeOf, copyRow, canExpand, expandedRow, toggleRow, removeRow } = opts.model;
  const { newIn, markSeen } = opts.fresh;
  const intl = useIntl();
  /** The context menu; no row = right-click on blank list space; keyboard = opened by keyboard (focus goes to the first entry) */
  const [menu, setMenu] = useState<{ x: number; y: number; row?: Row; keyboard?: boolean }>();

  /**
   * Open the context menu by keyboard (Shift+F10, the menu key): the menu of the cursor row, placed under that row (it used to pop up the
   * whole list's menu, so Pin to Top, Locate… were impossible by keyboard)
   */
  const keyboardMenu = () => {
    const el = list.current;
    const i = rows.findIndex((r) => r.id === cursor);
    if (!el || i < 0) return false;
    const row = rows[i];
    opts.revealRow(row.id);
    if (!(multi && picked.has(row.id))) pickOnly(row.id);
    // The menu is positioned in screen pixels, while the row's position is pre-zoom
    const r = el.getBoundingClientRect();
    const zoom = cssZoom(el);
    const bottom = r.top + (opts.listPad() + opts.offsets[i + 1] - el.scrollTop) * zoom;
    setMenu({ x: r.left + 24 * zoom, y: Math.min(r.bottom, Math.max(r.top, bottom)), row, keyboard: true });
    return true;
  };
  /** Right-click on a row: on one of the already selected rows it keeps the multi-selection; elsewhere it selects only this row */
  const openRowMenu = (e: React.MouseEvent, row: Row) => {
    e.preventDefault();
    setCursor(row.id);
    if (!(multi && picked.has(row.id))) pickOnly(row.id);
    setMenu({ x: e.clientX, y: e.clientY, row });
  };
  /** Right-click on blank list space (those on rows have already called preventDefault); one opened by keyboard lands on the focused list */
  const onAsideContextMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented || (e.target as HTMLElement).closest("input")) return;
    e.preventDefault();
    // Opened by keyboard (Shift+F10, the menu key): button is -1 and the event lands on the focused list, not on a row
    if (e.button !== 2 && e.target === list.current && keyboardMenu()) return;
    setMenu({ x: e.clientX, y: e.clientY, keyboard: e.button !== 2 });
  };

  // The whole list's actions: used both by right-click on blank list space and by the last section of a row's right-click
  const addItems = (): MenuItem[] => [
    { label: intl.formatMessage({ id: "menu.file.addFiles" }), icon: <FilePlusIcon />, hint: "Ctrl O", onClick: on.addFiles },
    {
      label: intl.formatMessage({ id: "menu.file.addFolder" }),
      icon: <FolderPlusIcon />,
      hint: "Ctrl Shift O",
      onClick: on.addFolder,
    },
    {
      label: intl.formatMessage({ id: "menu.file.paste" }),
      hint: "Ctrl V",
      title: intl.formatMessage({ id: "menu.file.pasteTitle" }),
      onClick: on.paste,
    },
  ];
  /** "Mark All as Seen": appears only when there are new items below, with the number on the right */
  const seenItems = (ms: MaterialEntry[]): MenuItem[] => {
    const n = newIn(ms);
    return n > 0
      ? [
          {
            label: intl.formatMessage({ id: "library.menu.markSeen" }),
            hint: intl.formatMessage({ id: "library.newCount" }, { count: n }),
            onClick: () => markSeen(ms),
          },
        ]
      : [];
  };
  const clearItem = (): MenuItem => ({
    label: intl.formatMessage({ id: "menu.file.clear" }),
    icon: <ClearListIcon />,
    title: intl.formatMessage({ id: "menu.file.clearTitle" }),
    onClick: on.clear,
    disabled: library.projects.every((p) => p.pinned),
    danger: true,
  });
  const listItems = (): (MenuItem | "-")[] => [
    { label: intl.formatMessage({ id: "sc.list.all" }), hint: "Ctrl A", onClick: pickAll, disabled: rows.length === 0 },
    "-",
    ...addItems(),
    "-",
    {
      label: intl.formatMessage({ id: "library.menu.refresh" }),
      icon: <RefreshIcon />,
      hint: "F5",
      onClick: on.refresh,
      disabled: library.entries.length === 0,
    },
    ...seenItems(library.ordered),
    {
      label: intl.formatMessage({ id: "library.menu.collapseAll" }),
      icon: <ChevronIcon />,
      onClick: () => {
        library.setOpen([...library.expanded], false);
        library.setProjectOpen(
          library.projects.map((p) => p.home),
          false,
        );
      },
      disabled: library.projects.length === 0,
    },
    "-",
    clearItem(),
  ];

  /**
   * The two entries "Copy as Text" (for AI that can read local files) and "Copy as Images" (for web-based AI and chat apps): the right
   * side says how many notes will be copied, and they are greyed out when there are none
   */
  const copyItems = (n: number, withNotes: number, run: (mode: "text" | "images") => void): MenuItem[] => {
    return [
      {
        label: intl.formatMessage({ id: "app.copy.toAi" }),
        icon: <SparkIcon />,
        hint:
          n === 0
            ? intl.formatMessage({ id: "library.menu.noOpen" })
            : `${intl.formatMessage({ id: "library.menu.copyCount" }, { materials: withNotes, count: n })} · Ctrl C`,
        title: intl.formatMessage({ id: "app.copy.asText.hint" }),
        onClick: () => run("text"),
        disabled: n === 0,
      },
      {
        label: intl.formatMessage({ id: "app.copy.asImages" }),
        icon: <KindIcon kind="image" />,
        title: intl.formatMessage({ id: "app.copy.asImages.hint" }),
        onClick: () => run("images"),
        disabled: n === 0,
      },
    ];
  };

  const menuItems = (row?: Row): (MenuItem | "-")[] => {
    if (!row) return listItems();
    // Right-click on one of several selected rows: act on all of them together
    if (multi && picked.has(row.id)) {
      const removable = removableOf(pickedRows).length;
      return [
        ...copyItems(opts.listed.count, opts.listed.materials, copyPicked),
        "-",
        ...(removable
          ? [
              {
                label: intl.formatMessage({ id: "library.menu.removeMany" }, { count: removable }),
                icon: <CloseIcon />,
                hint: "Delete",
                title: intl.formatMessage({ id: "library.menu.removeHint" }),
                onClick: removePicked,
              },
            ]
          : []),
        "-",
        clearItem(),
      ];
    }
    const reveal = (path: string, label = intl.formatMessage({ id: "settings.reveal" })): MenuItem => ({
      label,
      icon: <FolderIcon />,
      onClick: () => on.reveal(path),
    });
    const target = folderOfRow(row);
    const copy = copyItems(rowCopyCount(row), scopeOf(row).materials.filter((m) => openCount(keyOf(m.path)) > 0).length, (mode) =>
      copyRow(row, mode),
    );
    const toggle: MenuItem[] = canExpand(row)
      ? [
          {
            label: intl.formatMessage({ id: expandedRow(row) ? "library.menu.collapse" : "library.menu.expand" }),
            icon: <ChevronIcon />,
            onClick: () => toggleRow(row),
          },
        ]
      : [];
    // Folder comments: can be written from both project rows and folder rows
    const note: MenuItem[] = target
      ? [{ label: intl.formatMessage({ id: "menu.note.folder" }), icon: <NoteIcon />, onClick: () => on.folderNote(target) }]
      : [];
    let own: (MenuItem | "-")[];
    if (row.type === "project") {
      const p = row.project;
      own = [
        ...copy,
        ...note,
        "-",
        ...toggle,
        ...seenItems(p.materials),
        {
          label: intl.formatMessage({ id: p.pinned ? "library.menu.unpin" : "library.menu.pin" }),
          icon: <PinIcon />,
          title: p.pinned ? undefined : intl.formatMessage({ id: "library.menu.pinHint" }),
          onClick: () => on.pin(p, !p.pinned),
        },
        reveal(p.home, intl.formatMessage({ id: "library.menu.openProject" })),
        // Before any note has been written this folder doesn't exist (it used to be clickable anyway and reported the raw "not found" text)
        { ...reveal(homeJoin(p.home, DATA_DIR), intl.formatMessage({ id: "menu.file.revealNotes" })), disabled: !opts.hasNotes(p.home) },
        "-",
        {
          label: intl.formatMessage({ id: "library.menu.removeProject" }),
          icon: <CloseIcon />,
          hint: "Delete",
          title: intl.formatMessage({ id: "library.menu.removeHint" }),
          onClick: () => removeRow(row),
        },
      ];
    } else if (row.type === "entry") {
      const { entry } = row;
      // Not found (moved, renamed): the first entry is "Locate…"; after pointing it to the new location it is replaced in place, keeping
      // its pin and position
      const locate: (MenuItem | "-")[] =
        entry.kind === "missing"
          ? [
              {
                label: intl.formatMessage({ id: "library.relocate" }),
                icon: <FolderIcon />,
                title: intl.formatMessage({ id: "library.relocate.hint" }),
                onClick: () => on.relocate(entry),
              },
              "-",
            ]
          : [];
      own = [
        ...locate,
        ...copy,
        ...note,
        "-",
        ...toggle,
        ...seenItems(scopeOf(row).materials),
        ...(entry.kind !== "missing" ? [reveal(entry.path)] : []),
        "-",
        {
          label: intl.formatMessage({ id: "library.menu.remove" }),
          icon: <CloseIcon />,
          hint: "Delete",
          title: intl.formatMessage({ id: "library.menu.removeHint" }),
          onClick: () => removeRow(row),
        },
      ];
    } else if (row.type === "folder") {
      own = [...copy, ...note, "-", ...toggle, ...seenItems(treeMaterials(row.folder)), reveal(row.folder.path)];
    } else {
      own = [...copy, "-", reveal(row.material.path)];
    }
    return [...own, "-", clearItem()];
  };

  return { menu, closeMenu: () => setMenu(undefined), menuItems, openRowMenu, onAsideContextMenu };
}

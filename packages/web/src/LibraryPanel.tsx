import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { MaterialKind } from "@sniptoss/core";
import type { AppInfo, LibraryEntry, MaterialEntry } from "./host";
import { CloseIcon, FilePlusIcon, FilterIcon, FolderPlusIcon, SearchIcon } from "./icons";
import { usePrefs } from "./prefs";
import { prevProjectPinned, type FolderTarget, type Library, type Project } from "./library";
import { ContextMenu } from "./Menu";
import { Wordmark } from "./Wordmark";
import { VersionTag } from "./LibraryParts";
import { useFreshMarks } from "./freshMarks";
import { useShownRows } from "./libraryFilter";
import { useVirtualRows } from "./virtualRows";
import { useRowModel, type RemoveTarget } from "./libraryModel";
import { useLibrarySelection } from "./librarySelection";
import { useMarquee } from "./libraryMarquee";
import { useListKeys } from "./libraryKeys";
import { useLibraryMenu } from "./libraryMenu";
import { LibraryRow, rowDomId } from "./LibraryRow";

/**
 * Order of the kinds in the footer stats (it used to follow the kind of the first item in the list, giving "1 video · 2 images" when a
 * video came first)
 */
const KIND_ORDER: MaterialKind[] = ["image", "video", "pdf", "slides"];

/**
 * The library on the left, grouped "by project" like the sidebar of Codex / Claude Code: a project = the folder where notes are stored,
 * and anything dragged in joins its project automatically. Projects can be collapsed, pinned (kept when the library is cleared) and
 * removed from the library as a whole (files are not deleted); hover or right-click copies a whole project's notes for AI.
 * Keyboard: ↑↓ move, →← expand / collapse, Enter opens, Delete removes, Ctrl+C copies the notes of the row under the cursor for AI.
 */
export function LibraryPanel(props: {
  library: Library;
  /**
   * The library panel is collapsed: inert, so Tab cannot enter (focus used to get into the invisible list, and Delete popped up an
   * invisible removal)
   */
  collapsed?: boolean;
  /** Info about the app itself: the version at the bottom left is checked against the UI */
  appInfo?: AppInfo;
  selectedKey?: string;
  /** Number of open notes of an item */
  openCount: (materialKey: string) => number;
  onSelect: (m: MaterialEntry) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  /** Ctrl+V: adds an image from the clipboard or copied files to the library */
  onPaste: () => void;
  /** Remove from the library (asks first); what decides how the confirm dialog words it */
  onRemove: (entries: LibraryEntry[], what: RemoveTarget) => void;
  onClear: () => void;
  onPin: (project: Project, pinned: boolean) => void;
  onReveal: (path: string) => void;
  /** Point an entry that can no longer be found to a new location (right-click "Locate…") */
  onRelocate: (entry: LibraryEntry) => void;
  onRefresh: () => void;
  /**
   * Right-click a row to copy for AI: the open notes of these items. label is the name shown in the toast; folder: the row clicked is a
   * project / folder row, so its folder comments are included (the project row also covers the group of items that can't be found, like
   * "Entire Project" in the notes panel)
   */
  onCopy: (materials: MaterialEntry[], label: string, folder?: FolderTarget, mode?: "text" | "images") => void;
  /**
   * Right-click copy with several rows selected: hands over everything open that the notes panel lists (the notes panel then lists
   * exactly the selected ones, so both sides hand over the same)
   */
  onCopyListed: (mode: "text" | "images") => void;
  /** The open notes the notes panel lists: how many, spread over how many items (shown in the context menu on a multi-selection) */
  listed: { count: number; materials: number };
  /** How many open folder comments there are: without rel = all in this notes folder; deep = false counts only this folder itself, not subfolders */
  folderCount: (home: string, rel?: string, deep?: boolean) => number;
  /**
   * How many open notes in this notes folder belong to items that can't be found (counted in the project row, like "Entire Project" in
   * the notes panel)
   */
  missingCount: (home: string) => number;
  /** Whether this notes folder has any notes (only then is there a .sniptoss folder to open) */
  hasNotes: (home: string) => boolean;
  /** Right-click on a project / folder row: "Write Folder Comment" */
  onFolderNote: (folder: FolderTarget) => void;
  /**
   * Which items the selected rows cover (in list order). custom = several rows selected, or a project / folder selected: the notes panel
   * on the right temporarily lists these, otherwise it follows its own scope
   */
  /**
   * home: the project of a single clicked project / entry (when a project has no openable item, the notes panel uses it to know which
   * project to list)
   */
  onPicked: (materials: MaterialEntry[], custom: boolean, home?: string) => void;
  /** When it changes, cancel the multi-selection and select only the item open on the canvas (the scope on top of the notes panel was switched) */
  clearPick: number;
  /** When it changes, put the caret in the filter box and select its text (Ctrl+P "Find Item") */
  findNonce?: number;
}) {
  const { library, openCount } = props;
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Ctrl+P "Find Item": the caret goes into the filter box and the old text is selected (typing straight away replaces the keyword)
  useEffect(() => {
    if (!props.findNonce) return;
    search.current?.focus();
    search.current?.select();
  }, [props.findNonce]);

  const { prefs, setPrefs } = usePrefs();
  const pendingOnly = prefs.libraryPending;

  // The "New" markers in the list: freshMarks.ts
  const fresh = useFreshMarks({ library, selectedKey: props.selectedKey });
  // Which rows are listed (filtering, only items with open notes): libraryFilter.ts
  const rows = useShownRows({
    library,
    query,
    pendingOnly,
    openCount,
    folderCount: props.folderCount,
    missingCount: props.missingCount,
  });

  // Virtual scrolling: virtualRows.ts
  const { offsets, first, last, gapAbove, listPad, layout, revealRow } = useVirtualRows(rows, list);
  // How a row is read and acted on: libraryModel.ts
  const model = useRowModel({
    library,
    rows,
    appInfo: props.appInfo,
    openCount,
    folderCount: props.folderCount,
    missingCount: props.missingCount,
    onCopy: props.onCopy,
    onRemove: props.onRemove,
  });
  const { toggleRow, removeRow, badgeOf, projectBadge } = model;

  // Multi-selection: librarySelection.ts
  const selection = useLibrarySelection({
    library,
    rows,
    query,
    selectedKey: props.selectedKey,
    clearPick: props.clearPick,
    onPicked: props.onPicked,
    onSelect: props.onSelect,
    openCount,
    onCopyListed: props.onCopyListed,
    onRemove: props.onRemove,
    model,
    revealRow,
  });
  const { cursor, setCursor, picked, setPicked, anchor, pickCurrent, openFirstOf } = selection;
  const cursorIndex = useMemo(() => rows.findIndex((r) => r.id === cursor), [rows, cursor]);
  // Marquee selection: libraryMarquee.ts
  const { marquee, onListPointerDown } = useMarquee({ list, rows, picked, setPicked, anchor, layout, listPad, openFirstOf });

  // Clicks and keyboard: libraryKeys.ts
  const { onRowClick, onSearchKey, onKey } = useListKeys({
    rows,
    list,
    query,
    setQuery,
    selectedKey: props.selectedKey,
    onSelect: props.onSelect,
    openCount,
    selection,
    model,
    revealRow,
  });
  // Context menu: libraryMenu.tsx
  const { menu, closeMenu, menuItems, openRowMenu, onAsideContextMenu } = useLibraryMenu({
    library,
    rows,
    list,
    offsets,
    listPad,
    revealRow,
    openCount,
    listed: props.listed,
    hasNotes: props.hasNotes,
    on: {
      addFiles: props.onAddFiles,
      addFolder: props.onAddFolder,
      paste: props.onPaste,
      clear: props.onClear,
      refresh: props.onRefresh,
      reveal: props.onReveal,
      folderNote: props.onFolderNote,
      pin: props.onPin,
      relocate: props.onRelocate,
    },
    selection,
    model,
    fresh,
  });

  const counts = useMemo(() => {
    const c: Partial<Record<MaterialKind, number>> = {};
    for (const m of library.ordered) c[m.kind] = (c[m.kind] ?? 0) + 1;
    return c;
  }, [library.ordered]);

  return (
    // The list's actions are all in the context menu (no dropdown buttons in the title bar). Right-click on a row offers that item's
    // actions plus Clear; right-click elsewhere offers the whole list's actions. contextmenu can also come from the keyboard: with the
    // list focused, Shift+F10 / the menu key bubbles up to here, and onAsideContextMenu recognizes it and puts the menu under the cursor
    // row (libraryMenu.tsx)
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <aside className="sidebar" inert={props.collapsed} onContextMenu={onAsideContextMenu}>
      <div className="ws-header lib-header" title={intl.formatMessage({ id: "library.headerTitle" })}>
        <div className="ws-title brand">
          <Wordmark size="header" />
        </div>
        {/* Always-visible add buttons (once the list has content there is no other add button in the window). Two icons you click
            directly, no dropdown (no dropdown buttons in the title bar) */}
        <div className="lib-header-actions">
          <button className="hdr-btn" onClick={props.onAddFiles} title={intl.formatMessage({ id: "library.add.files" })}>
            <FilePlusIcon />
          </button>
          <button className="hdr-btn" onClick={props.onAddFolder} title={intl.formatMessage({ id: "library.add.folder" })}>
            <FolderPlusIcon />
          </button>
        </div>
      </div>
      {library.entries.length > 0 && (
        <label className="search">
          <SearchIcon />
          <input
            ref={search}
            name="item-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={intl.formatMessage({ id: "library.search.placeholder" })}
            spellCheck={false}
            title={intl.formatMessage({ id: "library.search.title" })}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery("")} title={intl.formatMessage({ id: "panel.search.clear" })}>
              <CloseIcon />
            </button>
          )}
          {/* List only items with open notes; the same option is in the View menu */}
          <button
            className={`search-filter${pendingOnly ? " is-on" : ""}`}
            aria-pressed={pendingOnly}
            onClick={() => setPrefs({ libraryPending: !pendingOnly })}
            title={intl.formatMessage({ id: pendingOnly ? "library.pending.off" : "library.pending.on" })}
          >
            <FilterIcon />
          </button>
        </label>
      )}
      <div
        className="material-list lib-list"
        ref={list}
        role="tree"
        tabIndex={0}
        aria-label={intl.formatMessage({ id: "settings.advanced.list" })}
        // Tells screen readers about the keyboard cursor (the row moved with ↑↓): focus stays on the list and the cursor row only has styling.
        // With virtual scrolling it points at nothing when the cursor row is outside the rendered range (moving the cursor scrolls to it first)
        aria-activedescendant={cursorIndex >= first && cursorIndex < last ? rowDomId(cursorIndex) : undefined}
        onKeyDown={onKey}
        onPointerDown={onListPointerDown}
        // A click on blank space cancels the multi-selection and keeps only the item open on the canvas (as in File Explorer; after
        // select-all a click on blank space used to be unable to deselect)
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest(".lib-row, .lib-empty")) pickCurrent();
        }}
      >
        <div className="marquee" ref={marquee} />
        <div className="lib-spacer" style={{ height: offsets[first] }} />
        {rows.slice(first, last).map((row, k) => {
          const i = first + k;
          return (
            <LibraryRow
              key={row.id}
              row={row}
              index={i}
              library={library}
              model={model}
              count={row.type === "project" ? projectBadge(i) : badgeOf(row)}
              newIn={fresh.newIn}
              gap={gapAbove(i)}
              sep={row.type === "project" && !row.project.pinned && prevProjectPinned(rows, i)}
              selected={picked.has(row.id)}
              isCursor={row.id === cursor}
              selectedKey={props.selectedKey}
              onClick={(e) => onRowClick(e, row, i)}
              onContextMenu={(e) => openRowMenu(e, row)}
              onTwisty={() => {
                setCursor(row.id);
                toggleRow(row);
              }}
              onPin={props.onPin}
              onRemove={() => removeRow(row)}
            />
          );
        })}
        <div className="lib-spacer" style={{ height: offsets[rows.length] - offsets[last] }} />
        {library.loaded && library.entries.length === 0 && (
          // How to use it is written in the middle of the canvas (Welcome); this only describes the list itself and doesn't repeat "drag files in"
          <div className="lib-empty">
            <div className="lib-empty-title">{intl.formatMessage({ id: "library.empty.title" })}</div>
            <p className="muted">{intl.formatMessage({ id: "library.empty.body" })}</p>
          </div>
        )}
        {rows.length === 0 && (query || (pendingOnly && library.entries.length > 0)) && (
          <div className="list-empty">
            {intl.formatMessage({ id: query ? "library.search.none" : "library.pending.none" })}
            {pendingOnly && (
              <button className="link-btn" onClick={() => setPrefs({ libraryPending: false })}>
                {intl.formatMessage({ id: "library.pending.showAll" })}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        {/* Nothing is written until the list has loaded (at startup it used to flash "the list is empty" first) */}
        <span className="footer-stats">
          {!library.loaded
            ? ""
            : library.projects.length > 0
              ? [
                  intl.formatMessage({ id: "library.stats.projects" }, { count: library.projects.length }),
                  // A whole sentence with plurals ("2 images"), not "kind name + number" pieces: word order, plurals and whether it can
                  // be abbreviated are up to the message in each language (e.g. the Russian word for "images" is long and would be cut
                  // off)
                  ...KIND_ORDER.filter((k) => counts[k]).map((k) =>
                    intl.formatMessage({ id: "library.stats.kind" }, { kind: k, count: counts[k] }),
                  ),
                ].join(" · ")
              : intl.formatMessage({ id: "library.stats.empty" })}
        </span>
        <VersionTag info={props.appInfo} />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.row)} focusFirst={menu.keyboard} onClose={closeMenu} />}
    </aside>
  );
}

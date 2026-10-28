import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import { baseName, keyOf, type MaterialEntry } from "./host";
import { ChevronIcon, CloseIcon, FileIcon, FolderIcon, KindIcon, PinIcon } from "./icons";
import { kindOfExt, materialOf, projectPlace, relParent, type Library, type Project, type Row } from "./library";
import type { useRowModel } from "./libraryModel";
import { MidName, NoteLine, TailPath } from "./LibraryParts";

// One row of the library (split out of LibraryPanel): icon, name, subtitle (where it is / why there are no items / not found), "New", the
// open-note count, and Pin and Remove on hover. The outer .lib-row-wrap[data-index] is what virtual scrolling uses to measure row height
// (virtualRows.ts) and [data-row] is what marquee selection uses (libraryMarquee.ts); change them together

/** DOM id of a row (by its index in the list): the list's aria-activedescendant points at it */
export const rowDomId = (index: number) => `lib-row-${index}`;

export function LibraryRow(props: {
  row: Row;
  /** Which row */
  index: number;
  library: Library;
  model: ReturnType<typeof useRowModel>;
  /** Open-note count on the right */
  count: number;
  newIn: (ms: MaterialEntry[]) => number;
  /** 8 of space above (a project row that is not the first row) */
  gap: boolean;
  /** Draw a divider between pinned projects and the rest */
  sep: boolean;
  selected: boolean;
  isCursor: boolean;
  /** The item open on the canvas */
  selectedKey: string | undefined;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** The small triangle on the left was clicked: only toggles expansion, doesn't select the row */
  onTwisty: () => void;
  onPin: (project: Project, pinned: boolean) => void;
  onRemove: () => void;
}) {
  const { row, library, count, selected } = props;
  const { nameOf, sameNamePlaces, emptyNote, canExpand, expandedRow, scopeOf } = props.model;
  const intl = useIntl();
  const stop = (run: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    run();
  };

  let name: string;
  let sub: string | undefined;
  /** The subtitle is a path; when it doesn't fit, the start is shortened */
  let tail = false;
  let icon: React.ReactNode;
  let kindClass: string;
  const m = materialOf(row);
  const project = row.type === "project" ? row.project : undefined;
  const removable = row.type === "project" || row.type === "entry";
  if (row.type === "project") {
    const p = row.project;
    name = nameOf(p);
    // Projects with the same name show the path down to the level where they differ, instead of shortening from the start
    const distinct = sameNamePlaces.get(p.key);
    sub = distinct ?? projectPlace(p.home);
    tail = distinct === undefined;
    icon = <FolderIcon />;
    kindClass = "folder";
    // Don't conclude "no items" before the scan result is back (at startup every project used to show "contains nothing that can be annotated" first)
    const scanned = p.entries.every((e) => library.scans.has(keyOf(e.path)));
    if (scanned && p.materials.length === 0 && p.entries.every((e) => e.kind !== "missing")) {
      sub = emptyNote(p.root && library.scans.get(keyOf(p.root.path)));
      tail = false;
    }
    if (p.truncatedAt) {
      sub = intl.formatMessage({ id: "library.truncated" }, { limit: p.truncatedAt });
      tail = false;
    }
  } else if (row.type === "folder") {
    name = row.folder.name;
    icon = <FolderIcon />;
    kindClass = "folder";
  } else if (row.type === "file") {
    name = baseName(row.material.path);
    sub = row.hint;
    icon = <KindIcon kind={row.material.kind} />;
    kindClass = row.material.kind;
  } else {
    name = baseName(row.entry.path);
    // A whole drive being absent (USB stick unplugged, network drive not connected) is worded differently from a file being gone: the
    // former fixes itself when plugged back in, so don't let people think it was deleted and remove it from the library
    sub =
      row.entry.kind !== "missing"
        ? relParent(row.project.home, row.entry.path) || undefined
        : intl.formatMessage({ id: row.entry.offline ? "library.offline" : "library.missing" });
    if (row.entry.kind === "folder") {
      icon = <FolderIcon />;
      kindClass = "folder";
      if (row.tree && row.tree.files.length === 0 && row.tree.folders.length === 0)
        sub = emptyNote(library.scans.get(keyOf(row.entry.path)));
      const cut = library.scans.get(keyOf(row.entry.path))?.truncatedAt;
      if (cut) sub = intl.formatMessage({ id: "library.truncated" }, { limit: cut });
    } else if (row.material) {
      icon = <KindIcon kind={row.material.kind} />;
      kindClass = row.material.kind;
    } else {
      icon = <FileIcon />;
      kindClass = "missing";
      // The file is still there but the scan didn't list it: a format that is currently unsupported (e.g. a PDF or PPT that could be
      // added individually before). It used to say nothing, and clicking did nothing. A recognized format never ends up here (an
      // individually added file is not subject to the kind switches in Settings) unless it was just deleted: the next refresh marks it as
      // not found, so nothing is written here
      if (row.entry.kind === "file" && library.scans.has(keyOf(row.entry.path))) {
        const ext = /\.[^.\\/]+$/.exec(row.entry.path)?.[0].toLowerCase();
        if (!(ext && kindOfExt(ext))) sub = intl.formatMessage({ id: "library.unsupported" }, { ext: ext ?? "none" });
      }
    }
  }
  // "New": the row of a single item says "New"; a collapsed project / folder says how many new items are inside (when expanded the rows
  // below say it themselves, like the open-note count)
  const single = row.type === "file" || (row.type === "entry" && !row.tree);
  const fresh = single || !expandedRow(row) ? props.newIn(scopeOf(row).materials) : 0;
  /** The item open on the canvas but not among the selected rows (Ctrl-click removed it, or other rows were selected): marked in a lighter style */
  const current = !selected && !!m && keyOf(m.path) === props.selectedKey;
  const path =
    row.type === "project"
      ? row.project.home
      : row.type === "folder"
        ? row.folder.path
        : row.type === "file"
          ? row.material.path
          : row.entry.path;
  const expandable = canExpand(row);
  return (
    <div className={`lib-row-wrap${props.gap ? " has-gap" : ""}`} data-index={props.index}>
      {props.sep && <div className="lib-sep" />}
      {/* The row itself takes no focus: the keyboard is handled by the outer role="tree" list (onKey in libraryKeys.ts: ↑↓ Home End move
          the cursor, ← → expand / collapse, Enter / Space open, Delete removes; Shift+F10 / the menu key opens this row's menu); the cursor
          is marked with is-cursor and screen readers hear it through the list's aria-activedescendant (rowDomId) */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */}
      <div
        id={rowDomId(props.index)}
        data-row={row.id}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={expandable ? expandedRow(row) : undefined}
        aria-selected={selected}
        className={[
          "lib-row",
          selected && "is-selected",
          current && "is-current",
          props.isCursor && "is-cursor",
          project && "is-project",
          sub && "has-sub",
          removable && "has-actions",
          project?.pinned && "is-pinned",
          row.type === "entry" && row.entry.kind === "missing" && "is-missing",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ "--depth": row.depth } as CSSProperties}
        onClick={props.onClick}
        onContextMenu={props.onContextMenu}
        title={path}
      >
        {/* The small triangle is only a mouse shortcut: by keyboard use the list's → to expand and ← to collapse (libraryKeys.ts); Enter
            also toggles a project / folder */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <span
          className={`lib-twisty${expandable && expandedRow(row) ? " is-open" : ""}`}
          onClick={expandable ? stop(props.onTwisty) : undefined}
        >
          {expandable && <ChevronIcon />}
        </span>
        <span className={`kind kind-${kindClass}`}>{icon}</span>
        <span className="lib-text">
          <MidName name={name} />
          {sub && (tail ? <TailPath path={sub} /> : <span className="lib-sub">{sub}</span>)}
        </span>
        {fresh > 0 && (
          <span className="lib-new" title={intl.formatMessage({ id: "library.newTitle" })}>
            {intl.formatMessage({ id: single ? "library.new" : "library.newCount" }, { count: fresh })}
          </span>
        )}
        {count > 0 && <span className="badge">{count}</span>}
        {removable && (
          <span className="lib-actions">
            {project && (
              <button
                className={`lib-act lib-pin${project.pinned ? " is-on" : ""}`}
                title={intl.formatMessage({ id: project.pinned ? "library.menu.unpin" : "library.pinTitle" })}
                onClick={stop(() => props.onPin(project, !project.pinned))}
              >
                <PinIcon filled={project.pinned} />
              </button>
            )}
            <button
              className="lib-act"
              title={intl.formatMessage({ id: project ? "library.removeProjectTitle" : "library.removeTitle" })}
              onClick={stop(props.onRemove)}
            >
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
      {(row.type === "folder" || row.type === "file") && row.note && <NoteLine note={row.note} depth={row.depth} />}
    </div>
  );
}

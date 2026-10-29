import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import {
  DATA_DIR,
  isWritable,
  NOTE_SECTIONS,
  pathSep,
  slugFor,
  type Annotation,
  type AnnotationStatus,
  type NoteSection,
} from "@sniptoss/core";
import { fileKey, type Stored } from "./annotationStore";
import { KeepPunctuation } from "./KeepPunctuation";
import { CheckBox } from "./Checkbox";
import type { useChecks, useHandoff } from "./handoff";
import { annotationPath, baseName, homeJoin, keyOf, type MaterialEntry } from "./host";
import {
  BanIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DoneIcon,
  FilterIcon,
  FolderIcon,
  KindIcon,
  MoreIcon,
  ReopenIcon,
  SearchIcon,
  SparkIcon,
  TrashIcon,
} from "./icons";
import { Menu, type MenuItem } from "./Menu";
import { itemId, type Item, type usePanelScope } from "./panelScope";
import { usePrefs } from "./prefs";

// The notes panel on the right (split out of Workspace): the scope switch on top (this video / whole project / selected), search and
// filter, notices for files that cannot be read, cards grouped by item (sections inside a group: canvas marks, overall comments,
// earlier versions, ADR-0008; each section has a collapsible title row), bulk status changes when notes are checked, select-all and
// copy-for-AI at the bottom, and where the notes are stored. Workspace passes in all data and actions

export function AnnotationPanel(props: {
  /** Collapsed (inert: Tab cannot enter the invisible notes panel) */
  collapsed: boolean;
  scope: ReturnType<typeof usePanelScope>;
  checks: ReturnType<typeof useChecks>;
  handoff: ReturnType<typeof useHandoff>;
  files: ReadonlyMap<string, Stored>;
  unreadable: ReadonlyMap<string, string>;
  openCount: (key: string) => number;
  current: MaterialEntry | undefined;
  selectedKey: string | undefined;
  /** Notes of the item on the canvas */
  annotations: Annotation[];
  /** A note is being written (composer open or draft card shown) */
  draft: boolean;
  /** Draft card when the composer did not pop up after drawing */
  draftCard: ReactNode;
  /** Why the notes of the item on the canvas cannot be changed */
  currentBlocked: string | undefined;
  /** The item on the canvas can be annotated (image, video) */
  annotatable: boolean;
  /** "this image" / "this video" */
  thisOne: string;
  renderItem: (it: Item) => ReactNode;
  /** Gray text after the name in a group title */
  groupHint: (m: MaterialEntry) => string;
  /** How many items are not listed because they have no (open) notes */
  hiddenGroups: number;
  selectMaterial: (m: MaterialEntry) => void;
  /** The group of an item that no longer exists: delete its whole notes file (asks first) */
  onDeleteMissing: (key: string) => void;
  applyStatus: (targets: Item[], status: AnnotationStatus) => void;
  removeTargets: (targets: Item[]) => void;
  onPanelSearchKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Notes folder of the item on the canvas */
  home: string | undefined;
  homeHasNotes: boolean;
  revealDataDir: () => void;
  /** Right-click on blank space in the notes panel (a right-click on a card is handled by the card itself) */
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const intl = useIntl();
  const { prefs, setPrefs } = usePrefs();
  const {
    scopeKind,
    setPanelScope,
    project,
    scopeMaterials,
    allItems,
    folderOpenCount,
    missingOpenCount,
    panelQuery,
    setPanelQuery,
    panelSearch,
    aboveOpen,
    grouped,
    folderGroups,
    groups,
    filtering,
    kinds,
    passes,
    visible,
    filteredOut,
    isCollapsed,
    toggleSection,
    passingCount,
    searching,
    listForNav,
    resolvedHits,
  } = props.scope;
  const { checkedIds, checkedList, toggleGroup, allChecked, toggleAll } = props.checks;
  const { copyCurrent, toCopy, copyTitle, copied } = props.handoff;
  const {
    collapsed,
    files,
    unreadable,
    openCount,
    current,
    selectedKey,
    annotations,
    draft,
    draftCard,
    currentBlocked,
    annotatable,
    thisOne,
    renderItem,
    groupHint,
    hiddenGroups,
    selectMaterial,
    onDeleteMissing,
    applyStatus,
    removeTargets,
    onPanelSearchKey,
    home,
    homeHasNotes,
    revealDataDir,
  } = props;
  const anyChecked = checkedList.length > 0;
  /**
   * The cards of one item, in sections (ADR-0008): canvas marks → overall comments → earlier versions. Each section has a title row
   * (collapse arrow, name, count, then a rule), and clicking it collapses / expands the section (sections must be clearly
   * separated and collapsible). items are those of this item that have a place in the notes panel (passes).
   * The folder-comment group has no sections: its title already says it
   */
  const sectioned = (key: string, items: Item[]) =>
    NOTE_SECTIONS.flatMap((s) => {
      const inSection = items.filter((it) => it.section === s);
      if (inSection.length === 0) return [];
      const open = !isCollapsed(key, s);
      const name = intl.formatMessage({ id: `panel.section.${s}` });
      return [
        <button
          key={`${key}#${s}`}
          type="button"
          className={`note-section is-${s}`}
          aria-expanded={open}
          onClick={() => toggleSection(key, s)}
          title={intl.formatMessage({ id: "panel.section.toggle" }, { open: open ? "yes" : "no", name })}
        >
          <span className={`lib-twisty${open ? " is-open" : ""}`}>
            <ChevronIcon />
          </span>
          <span className="note-section-title">{name}</span>
          <span className="note-section-count">{inSection.length}</span>
          <span className="note-section-rule" />
        </button>,
        ...(open
          ? [
              ...(s === "earlier"
                ? [
                    <p key={`${key}#${s}#hint`} className="note-section-hint">
                      {intl.formatMessage({ id: "panel.section.earlierHint" })}
                    </p>,
                  ]
                : []),
              ...inSection.map(renderItem),
            ]
          : []),
      ];
    });
  /**
   * Filter (funnel menu): one entry per section (greyed out when it is the last one on, so the notes panel is never emptied
   * completely), plus "resolved notes". Timestamped comments exist only for videos: that entry appears only when a video is listed
   * (or such notes already exist) (kinds, computed by panelScope)
   */
  const shownKinds = kinds.filter((s) => !prefs.panelHidden.includes(s));
  const filterItems: (MenuItem | "-")[] = [
    ...kinds.map((s): MenuItem => ({
      label: intl.formatMessage({ id: `panel.section.${s}` }),
      checked: shownKinds.includes(s),
      disabled: shownKinds.length === 1 && shownKinds[0] === s,
      onClick: () =>
        setPrefs({ panelHidden: prefs.panelHidden.includes(s) ? prefs.panelHidden.filter((x) => x !== s) : [...prefs.panelHidden, s] }),
    })),
    "-",
    {
      label: intl.formatMessage({ id: "panel.filter.resolved" }),
      title: intl.formatMessage({ id: "panel.filter.resolvedTitle" }),
      checked: prefs.panelResolved,
      onClick: () => setPrefs({ panelResolved: !prefs.panelResolved }),
    },
    ...(filtering
      ? ["-" as const, { label: intl.formatMessage({ id: "panel.filter.clear" }), onClick: () => setPrefs({ panelHidden: [] }) }]
      : []),
  ];
  const clearFilter = () => setPrefs({ panelHidden: [] });
  /** The line under the search box while filtering: "Showing only canvas marks and overall comments — Clear filter" */
  const filterBar = filtering && allItems.length > 0 && (
    <div className="filter-bar" role="status">
      <FilterIcon />
      <span className="filter-bar-text">
        {intl.formatMessage(
          { id: "panel.filter.bar" },
          {
            // All the listed kinds got filtered out (only timestamped comments were kept on a video, then an image was opened):
            // say truthfully which kinds are shown
            kinds: intl.formatList(
              (shownKinds.length > 0 ? shownKinds : NOTE_SECTIONS.filter((s) => !prefs.panelHidden.includes(s))).map((s: NoteSection) =>
                intl.formatMessage({ id: `panel.section.${s}` }),
              ),
              { type: "conjunction" },
            ),
          },
        )}
      </span>
      <button type="button" className="filter-bar-clear" onClick={clearFilter}>
        {intl.formatMessage({ id: "panel.filter.clear" })}
      </button>
    </div>
  );
  return (
    // Right-click on blank space offers actions for the whole notes panel (copy, check, delete all); right-click on a card is for that
    // note (the card opens its own menu). Every command in the menu is also in the menu bar's Edit and Annotate menus, which is the keyboard route
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <aside className="panel" inert={collapsed} onContextMenu={props.onContextMenu}>
      <div className="panel-header">
        {/* What the notes panel lists (having to click in the library first to see everything and then come back here to act is too
            disjointed, so it switches here). The numbers are open note counts */}
        <div className="segmented scope-switch" role="radiogroup" aria-label={intl.formatMessage({ id: "panel.scope.label" })}>
          <button
            type="button"
            role="radio"
            aria-checked={scopeKind === "material"}
            className={`seg${scopeKind === "material" ? " is-on" : ""}`}
            disabled={!current}
            onClick={() => setPanelScope("material")}
            title={intl.formatMessage({ id: "panel.scope.thisTitle" }, { this: thisOne })}
          >
            {/* A label written separately for the button (sentence-initial capital, Russian nominative); not the same form as thisOne
                (app.kind.this) embedded in sentences */}
            <span className="seg-label">{intl.formatMessage({ id: "panel.scope.thisLabel" }, { kind: current?.kind ?? "" })}</span>
            <span className="seg-count">{selectedKey ? openCount(selectedKey) : 0}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scopeKind === "project"}
            className={`seg${scopeKind === "project" ? " is-on" : ""}`}
            disabled={!project}
            onClick={() => setPanelScope("project")}
            title={
              project
                ? intl.formatMessage({ id: "panel.scope.projectTitle" }, { name: baseName(project.home) || project.home })
                : intl.formatMessage({ id: "panel.scope.projectTitleNone" })
            }
          >
            <span className="seg-label">{intl.formatMessage({ id: "panel.scope.project" })}</span>
            <span className="seg-count">
              {project
                ? project.materials.reduce((n, m) => n + openCount(keyOf(m.path)), 0) +
                  folderOpenCount(project.home) +
                  missingOpenCount(project.home)
                : 0}
            </span>
          </button>
          {scopeKind === "picked" && (
            <button
              type="button"
              role="radio"
              aria-checked
              className="seg is-on"
              title={intl.formatMessage({ id: "panel.scope.pickedTitle" }, { count: scopeMaterials.length })}
            >
              <span className="seg-label">{intl.formatMessage({ id: "panel.scope.picked" })}</span>
              {/* Like the two segments beside it this counts all open notes and doesn't change with the search */}
              <span className="seg-count">{allItems.filter((it) => it.a.status === "open").length}</span>
            </button>
          )}
        </div>
      </div>
      {(allItems.length > 0 || panelQuery) && (
        <label className="search panel-search">
          <SearchIcon />
          <input
            ref={panelSearch}
            name="note-filter"
            value={panelQuery}
            onChange={(e) => setPanelQuery(e.target.value)}
            onKeyDown={onPanelSearchKey}
            placeholder={intl.formatMessage({ id: "panel.search.placeholder" })}
            spellCheck={false}
            title={intl.formatMessage({ id: "panel.search.title" })}
          />
          {panelQuery && (
            <button className="search-clear" onClick={() => setPanelQuery("")} title={intl.formatMessage({ id: "panel.search.clear" })}>
              <CloseIcon />
            </button>
          )}
          {/* Filter (the same funnel as in the library filter box): which sections to list and whether to list resolved notes.
              A separate "also show resolved" switch used to sit at the top right and was merged in here */}
          <Menu
            trigger={() => <FilterIcon />}
            items={filterItems}
            align="right"
            anchorClosest=".panel-search"
            buttonClass={`search-filter panel-filter${filtering ? " is-on" : ""}`}
            title={intl.formatMessage({ id: "panel.filter.title" })}
          />
        </label>
      )}
      {filterBar}
      <div className="panel-body">
        {[...unreadable.values()].map((e) => (
          <div key={e} className="error">
            {e}
          </div>
        ))}
        {[...files.values()]
          .filter((s) => !isWritable(s.file))
          .map((s) => (
            <div key={fileKey(s.home, s.file.material)} className="error">
              {intl.formatMessage(
                { id: "app.file.newer" },
                { schema: s.file.schema, path: annotationPath(s.home, slugFor(s.file.material.path, s.file.material.kind)) },
              )}
            </div>
          ))}
        {/* With "this image" selected, folder comments are not listed (copying for AI hands over only this item's notes); mention how
            many the enclosing folder has */}
        {scopeKind === "material" && aboveOpen > 0 && (
          <button
            type="button"
            className="folder-hint"
            onClick={() => setPanelScope("project")}
            title={intl.formatMessage({ id: "panel.folderHint.title" }, { this: thisOne, count: aboveOpen })}
          >
            <FolderIcon />
            <span className="folder-hint-text">{intl.formatMessage({ id: "panel.folderHint.text" }, { count: aboveOpen })}</span>
            <span className="folder-hint-go">{intl.formatMessage({ id: "panel.folderHint.go" })}</span>
          </button>
        )}
        {!grouped && draftCard}
        {grouped &&
          folderGroups.map((g) => {
            // Folder comments have no sections and cannot be collapsed: what is listed is what is visible
            const shown = g.items.filter(visible);
            if (shown.length === 0) return null;
            const n = shown.filter((it) => checkedIds.has(itemId(it))).length;
            return (
              <section key={g.key} className="annot-group" data-group={g.key}>
                <div
                  className="group-head is-folder"
                  title={intl.formatMessage(
                    { id: "panel.folderGroup.title" },
                    { path: homeJoin(g.folder.home, g.folder.rel === "." ? "" : g.folder.rel) },
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={n === shown.length ? true : n > 0 ? "mixed" : false}
                    className="card-check"
                    title={intl.formatMessage({ id: n === shown.length ? "panel.folderGroup.uncheck" : "panel.folderGroup.check" })}
                    onClick={() => toggleGroup(shown)}
                  >
                    <CheckBox checked={n === shown.length} mixed={n > 0 && n < shown.length} />
                  </button>
                  <span className="group-name">{g.folder.name}</span>
                  <span className="group-hint">{intl.formatMessage({ id: "panel.folderGroup.hint" })}</span>
                  <span className="group-count">{shown.length}</span>
                </div>
                {shown.map(renderItem)}
              </section>
            );
          })}
        {grouped
          ? groups.map((g) => {
              /** Those with a place in the notes panel (including ones in collapsed sections); the checkbox covers the visible ones (shown) */
              const listed = g.items.filter(passes);
              const shown = listed.filter(visible);
              const isCurrent = g.key === selectedKey && !g.missing;
              // When several items are listed, ones without notes take no space (a line at the bottom covers them) and the one open on the canvas
              // is always there; while searching it is not listed either if it has no match (except when a note is being written)
              if (listed.length === 0 && !(isCurrent && (!searching || draft))) return null;
              const n = shown.filter((it) => checkedIds.has(itemId(it))).length;
              return (
                <section key={g.key} className="annot-group" data-group={g.key}>
                  {/* Clicking the title to switch to this item is only a mouse shortcut: by keyboard use [ ] to step between notes (across items,
                      the canvas follows), Tab onto a card of this group (focusing selects it and switches), Ctrl+↑↓ or the library;
                      the checkbox and delete button inside are real buttons */}
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <div
                    className={`group-head${isCurrent ? " is-current" : ""}${g.missing ? " is-missing" : ""}`}
                    onClick={() => !isCurrent && !g.missing && selectMaterial(g.material)}
                    title={
                      g.missing
                        ? intl.formatMessage({ id: "panel.missing.title" }, { path: g.material.path })
                        : isCurrent
                          ? intl.formatMessage({ id: "panel.group.currentTitle" }, { path: g.material.path })
                          : intl.formatMessage({ id: "panel.group.openTitle" }, { path: g.material.path })
                    }
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={shown.length > 0 && n === shown.length ? true : n > 0 ? "mixed" : false}
                      className="card-check"
                      disabled={shown.length === 0}
                      title={intl.formatMessage({ id: n === shown.length && n > 0 ? "panel.group.uncheck" : "panel.group.check" })}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGroup(shown);
                      }}
                    >
                      <CheckBox checked={shown.length > 0 && n === shown.length} mixed={n > 0 && n < shown.length} />
                    </button>
                    <span className="group-name">{baseName(g.material.path)}</span>
                    {g.missing ? (
                      <span className="tag tag-warn">{intl.formatMessage({ id: "panel.missing.tag" })}</span>
                    ) : (
                      groupHint(g.material) && <span className="group-hint">{groupHint(g.material)}</span>
                    )}
                    {listed.length > 0 && <span className="group-count">{listed.length}</span>}
                    {g.missing && (
                      <Menu
                        trigger={() => <MoreIcon />}
                        items={[
                          {
                            label: intl.formatMessage({ id: "panel.missing.delete" }),
                            title: intl.formatMessage({ id: "panel.missing.deleteTitle" }),
                            danger: true,
                            onClick: () => onDeleteMissing(g.key),
                          },
                        ]}
                        align="right"
                        buttonClass="act"
                        title={intl.formatMessage({ id: "panel.missing.more" })}
                      />
                    )}
                  </div>
                  {isCurrent && draftCard}
                  {sectioned(g.key, listed)}
                  {listed.length === 0 && !(isCurrent && draft) && !searching && !(isCurrent && g.items.length === 0 && currentBlocked) && (
                    <div className="group-empty">
                      {intl.formatMessage({
                        id: g.items.some(filteredOut)
                          ? "panel.filter.none"
                          : g.items.length > 0
                            ? "panel.group.allDone"
                            : "panel.group.none",
                      })}
                    </div>
                  )}
                </section>
              );
            })
          : groups.map((g) => sectioned(g.key, g.items.filter(passes)))}
        {grouped && hiddenGroups > 0 && (
          <div className="group-rest">
            {intl.formatMessage(
              { id: filtering ? "panel.rest.filtered" : prefs.panelResolved ? "panel.rest.none" : "panel.rest.noOpen" },
              { count: hiddenGroups },
            )}
          </div>
        )}
        {searching && passingCount === 0 && (
          <div className="panel-empty" role="status">
            <KeepPunctuation>
              {intl.formatMessage({ id: "panel.search.none" }, { query: panelQuery.trim() })}
              {resolvedHits > 0 && (
                <>
                  <p>{intl.formatMessage({ id: "panel.search.inResolved" }, { count: resolvedHits })}</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small panel-empty-action"
                    onClick={() => setPrefs({ panelResolved: true })}
                  >
                    {intl.formatMessage({ id: "panel.search.showResolved" })}
                  </button>
                </>
              )}
            </KeepPunctuation>
          </div>
        )}
        {/* The notes file cannot be read: the red bar on top already says so, so don't also write "no notes" or "not supported" here
            (both would be wrong: it may hold notes, and the item can be annotated) */}
        {!searching && !grouped && current && passingCount === 0 && !draft && (annotations.length > 0 || !currentBlocked) && (
          <div className="panel-empty">
            <KeepPunctuation>
              {allItems.some(filteredOut) ? (
                <>
                  {intl.formatMessage({ id: "panel.filter.none" })}
                  <div>
                    <button type="button" className="btn btn-secondary btn-small panel-empty-action" onClick={clearFilter}>
                      {intl.formatMessage({ id: "panel.filter.clear" })}
                    </button>
                  </div>
                </>
              ) : annotations.length > 0 ? (
                intl.formatMessage({ id: "panel.empty.allDone" })
              ) : annotatable ? (
                <>
                  {intl.formatMessage({ id: "panel.empty.none" })}
                  <p>{intl.formatMessage({ id: "panel.empty.hint" })}</p>
                </>
              ) : (
                intl.formatMessage({ id: "stage.unsupported" }, { kind: intl.formatMessage({ id: `kind.${current.kind}` }) })
              )}
            </KeepPunctuation>
          </div>
        )}
      </div>
      {/* When notes are checked, an extra row appears at the bottom: "N selected" on the left, bulk status changes on the right (like Gmail's
      toolbar after checking); buttons that don't apply are not shown. "N selected" used to share the place of "Select all" below, and at a
      320-wide notes panel the two copy buttons squeezed it down to "Se…" */}
      {anyChecked && (
        <div className="panel-batch" role="toolbar" aria-label={intl.formatMessage({ id: "panel.batch.label" })}>
          <span className="batch-count" aria-live="polite">
            {intl.formatMessage({ id: "panel.batch.count" }, { count: checkedList.length })}
          </span>
          {(
            [
              ["resolved", <DoneIcon key="i" />],
              ["wontfix", <BanIcon key="i" />],
              ["open", <ReopenIcon key="i" />],
            ] as const
          ).map(
            ([s, icon]) =>
              checkedList.some((it) => it.a.status !== s) && (
                <button
                  key={s}
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => applyStatus(checkedList, s)}
                  title={intl.formatMessage({ id: "panel.batch.title" }, { status: s, count: checkedList.length })}
                >
                  {icon}
                  <span>{intl.formatMessage({ id: "menu.note.status" }, { status: s })}</span>
                </button>
              ),
          )}
          {/* Delete a hand-picked set of notes (cleanup is not split by resolved or not; the user checks which ones to clean up); asks first.
              Icon only: with text in a 320-wide notes panel it wraps to a second row and ends up alone at the bottom left */}
          <button
            type="button"
            className="btn btn-ghost btn-small btn-danger batch-delete"
            onClick={() => removeTargets(checkedList)}
            aria-label={intl.formatMessage({ id: "panel.batch.delete" })}
            title={intl.formatMessage({ id: "panel.batch.deleteTitle" }, { count: checkedList.length })}
          >
            <TrashIcon />
          </button>
        </div>
      )}
      {/* Handing over to AI: select-all on the left, buttons on the right. The checkbox lines up with the ones on the cards. When several
          items are listed, select-all and copy span items */}
      {listForNav.length > 0 && (
        <div className="panel-dock">
          <button
            type="button"
            role="checkbox"
            aria-checked={allChecked ? true : checkedList.length > 0 ? "mixed" : false}
            className="dock-all"
            onClick={toggleAll}
            title={intl.formatMessage({ id: allChecked ? "panel.dock.uncheckAll" : "panel.dock.checkAll" })}
          >
            <CheckBox checked={allChecked} mixed={checkedList.length > 0 && !allChecked} />
            <span className="dock-all-text">{intl.formatMessage({ id: "panel.dock.all" })}</span>
          </button>
          {/* The two copy buttons form a group: when one row is too narrow the whole group wraps to a second row, right-aligned, unsplit */}
          <div className="dock-buttons">
            {/* For web-based AI and chat apps: one image per note (they cannot read local paths) */}
            <button
              type="button"
              className="btn btn-secondary btn-small dock-images"
              onClick={() => void copyCurrent("images")}
              disabled={toCopy.length === 0}
              title={intl.formatMessage({ id: "app.copy.asImages.title" })}
            >
              <KindIcon kind="image" />
              <span>{intl.formatMessage({ id: "app.copy.asImages.button" })}</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-small dock-copy"
              onClick={() => void copyCurrent()}
              disabled={toCopy.length === 0}
              title={copyTitle}
            >
              {copied ? <CheckIcon /> : <SparkIcon />}
              {/* "Copied" and the original label are stacked in the same cell, so the button doesn't widen or narrow */}
              <span className="dock-copy-label" aria-live="polite">
                <span className={copied ? "is-hidden" : undefined}>{intl.formatMessage({ id: "panel.dock.copy" })}</span>
                <span className={copied ? undefined : "is-hidden"}>{intl.formatMessage({ id: "panel.dock.copied" })}</span>
              </span>
            </button>
          </div>
        </div>
      )}
      {home && (
        <div className="panel-footer">
          {homeHasNotes ? (
            <button
              className="footer-link"
              onClick={revealDataDir}
              title={intl.formatMessage({ id: "panel.footer.title" }, { path: homeJoin(home, DATA_DIR) })}
            >
              <FolderIcon />
              <span>
                {intl.formatMessage({ id: "panel.footer.saved" }, { path: `${baseName(home) || home}${pathSep(home)}${DATA_DIR}` })}
              </span>
            </button>
          ) : (
            <span>{intl.formatMessage({ id: "panel.footer.auto" })}</span>
          )}
        </div>
      )}
    </aside>
  );
}

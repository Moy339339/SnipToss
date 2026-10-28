import type { Annotation, AnnotationStatus } from "@sniptoss/core";
import type { IntlShape } from "react-intl";
import type { Tool } from "./annotate";
import { versionLabel } from "./brand";
import type { MaterialEntry, NewerVersion, WindowAction, WindowState } from "./host";
import { prettyKeys } from "./hotkey";
import { pressKey } from "./keys";
import { markColorRow } from "./markColors";
import type { MenuItem } from "./Menu";
import type { TopMenu } from "./MenuBar";
import { mnemonic } from "./mnemonic";
import type { Prefs } from "./prefs";

/** State and actions the menu bar needs, handed over by Workspace */
export interface MenuContext {
  current?: MaterialEntry;
  /** The item on the canvas cannot be opened (broken image, unsupported codec): nothing to zoom, no video to play */
  mediaBroken: boolean;
  canAnnotate: boolean;
  /** Can draw marks on the canvas (when the canvas cannot be opened only overall comments can be written) */
  canDraw: boolean;
  tool: Tool;
  chooseTool: (t: Tool) => void;
  startWhole: () => void;
  /** Timestamped comment: the current frame of the video, no position */
  startTimed: () => void;
  /** A timestamped comment can be written: the canvas shows a video that can be opened */
  canTimed: boolean;
  /** Write a folder comment: for the folder holding the item on the canvas (the name is shown in the menu; none when no item is open) */
  startFolderNote: () => void;
  folderName?: string;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** The selected note: a mark on the canvas, or a folder comment selected in the notes panel (the same note that Enter and Delete act on) */
  selected?: Annotation;
  /** The selected note is listed in the notes panel (X to check only works on listed ones) */
  selectedListed: boolean;
  editSelected: () => void;
  deleteSelected: () => void;
  /** How many notes the notes panel lists; Delete All Notes… (asks first) */
  listedCount: number;
  deleteAll: () => void;
  /**
   * Which notes a status change applies to (checked ones if any are checked, otherwise the selected note): how many, whether it goes by
   * the checkboxes, and whether any of them is not done / not won't-fix / not open
   */
  status: { count: number; byCheck: boolean; notResolved: boolean; notWontfix: boolean; notOpen: boolean };
  setStatus: (s: AnnotationStatus) => void;
  /**
   * Which notes a mark color change applies to (same rule as status, counting only those with a mark on the canvas): current = the color
   * they are drawn in now (only when all agree); pick with undefined = follow Settings
   */
  color: { count: number; byCheck: boolean; current?: string; pick: (color: string | undefined) => void };
  hasAnnotations: boolean;
  stepAnnotation: (dir: 1 | -1) => void;
  stepMaterial: (dir: 1 | -1) => void;
  /**
   * Whether there is a previous / next item to go to (greyed out at the ends, or when the library shows only open items and there are
   * none); scans the list, so it is computed only when the menu opens
   */
  canStepMaterial: () => { prev: boolean; next: boolean };
  copyCurrent: () => void;
  /** Copy the same set as images (for web-based AI and chat apps) */
  copyImages: () => void;
  /**
   * There is something to copy (same as the two copy buttons at the bottom of the notes panel: some are checked, or the listed ones
   * include open notes); also possible when the item can't be found but the notes panel still lists its notes
   */
  canCopy: boolean;
  /**
   * Checking (decides which notes "copy for AI" hands over in the notes panel): whether the selected note is checked, and how many are
   * checked in total
   */
  selectedChecked: boolean;
  checkedCount: number;
  checkAll: () => void;
  uncheckAll: () => void;
  addFiles: () => void;
  addFolder: () => void;
  /** Ctrl+V: adds an image from the clipboard or files copied in File Explorer to the library */
  paste: () => void;
  refresh: () => void;
  canClear: boolean;
  clearList: () => void;
  revealCurrent: () => void;
  revealDataDir: () => void;
  /** The project holding the item on the canvas already has notes (.sniptoss exists) */
  hasNotes: boolean;
  /** The library has something in it (refresh covers the folders in the library: it is most needed when the only entry is an empty folder) */
  hasEntries: boolean;
  openSettings: (section?: string) => void;
  openHelp: () => void;
  openDevTools: () => void;
  /** Help menu: intro, open the log folder, copy diagnostic info, report an issue */
  openIntro: () => void;
  /** Help → "Feature Tour": walk through the onboarding again (Tour.tsx) */
  openTour: () => void;
  openLogs: () => void;
  copyDiagnostics: () => void;
  exportDiagnostics: () => void;
  reportIssue: () => void;
  /**
   * Check for updates (updates.ts): once a newer version is known this entry becomes "Download New Version X…" and opens the download
   * page directly
   */
  newerVersion: NewerVersion | null;
  checkUpdates: () => void;
  openNewerVersion: () => void;
  panels: { left: boolean; right: boolean };
  togglePanel: (side: "left" | "right") => void;
  toggleBoth: () => void;
  /** Window back to its default size, centered, and both side panels back to their default width */
  resetLayout: () => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** Marks on the canvas are shown (Shift+H, the eye on the zoom bar; remembered for this run only) */
  marksShown: boolean;
  toggleMarks: () => void;
  /** Loop playback (Ctrl+L): a setting, so it can be toggled even without a video open */
  toggleLoop: () => void;
  /**
   * What the notes panel lists (same as the switch on top of the notes panel); the current one, which is picked when several rows are
   * selected on the left
   */
  panelScope: "material" | "project" | "picked";
  setPanelScope: (s: "material" | "project") => void;
  /** There is a project to list (same as whether the "Entire Project" segment on top of the notes panel can be clicked) */
  hasProject: boolean;
  win: WindowState;
  windowCmd: (action: WindowAction) => void;
  /** Screen Capture (the shell's global shortcut can also start it) */
  startCapture: () => void;
  /** The Screen Capture shortcut, e.g. "Ctrl+Alt+P"; empty if unset or not registered */
  captureHotkey: string;
  /** New menu entries use messages (the rest will be converted too) */
  intl: IntlShape;
  /** Find item (Ctrl+P): the caret goes to the library's filter box */
  findMaterial: () => void;
  /** Find note (Ctrl+F): the caret goes to the notes panel's search box; greyed out when the notes panel has no notes at all */
  findAnnotation: () => void;
  canFindAnnotation: boolean;
}

/** Tools: the message for the name is tool.<tool> (shared by the menu, toolbar and shortcut list); key is the shortcut */
export const TOOLS: { tool: Tool; key: string }[] = [
  { tool: "select", key: "V" },
  { tool: "hand", key: "H" },
  { tool: "point", key: "C" },
  { tool: "rect", key: "R" },
  { tool: "pen", key: "B" },
  { tool: "arrow", key: "A" },
];

/**
 * The contents of the menu bar. Shortcuts are shown on the right, consistent with docs/shortcuts.md and ShortcutHelp;
 * an entry with a shortcut simply presses that key (pressKey), so the menu and the shortcut always do the same thing.
 * Wording follows docs/design-rules.md "6 · Copy"
 */
export function buildMenus(c: MenuContext): TopMenu[] {
  const t = (id: string, values?: Record<string, string | number>) => c.intl.formatMessage({ id }, values);
  const noMaterial = !c.current;
  // An item that cannot be opened shows only an explanation on the canvas, and nothing handles the zoom and playback keys (the menu used
  // to look only at the kind, so entries were enabled but did nothing)
  const isVideo = c.current?.kind === "video" && !c.mediaBroken;
  /** The canvas shows an item that can be zoomed (image, video; a PDF or presentation is only a line of placeholder text for now) */
  const noZoom = !c.current || (c.current.kind !== "image" && c.current.kind !== "video") || c.mediaBroken;
  const key = (id: string, hint: string, keys: string, disabled = false): MenuItem => ({
    label: t(id),
    hint,
    disabled,
    onClick: () => pressKey(keys),
  });

  return [
    {
      ...mnemonic(t("menu.top.file")),
      items: () => [
        { label: t("menu.file.capture"), hint: prettyKeys(c.captureHotkey), onClick: c.startCapture },
        "-",
        { label: t("menu.file.addFiles"), hint: "Ctrl O", onClick: c.addFiles },
        { label: t("menu.file.addFolder"), hint: "Ctrl Shift O", onClick: c.addFolder },
        { label: t("menu.file.paste"), hint: "Ctrl V", title: t("menu.file.pasteTitle"), onClick: c.paste },
        {
          label: t("menu.file.find"),
          hint: "Ctrl P",
          title: t("menu.file.findTitle"),
          onClick: c.findMaterial,
          disabled: !c.hasEntries,
        },
        "-",
        { label: t("menu.file.revealCurrent"), onClick: c.revealCurrent, disabled: noMaterial },
        { label: t("menu.file.revealNotes"), onClick: c.revealDataDir, disabled: !c.hasNotes },
        "-",
        { label: t("menu.file.refresh"), hint: "F5", onClick: c.refresh, disabled: !c.hasEntries },
        { label: t("menu.file.clear"), title: t("menu.file.clearTitle"), danger: true, onClick: c.clearList, disabled: !c.canClear },
        "-",
        { label: t("cmd.settings"), hint: "Ctrl ,", onClick: () => c.openSettings() },
        "-",
        // Closing the window (Alt F4, the × in the title bar) only hides it when "keep in tray" is on; this really quits
        { label: t("menu.file.exit"), onClick: () => c.windowCmd("quit") },
      ],
    },
    {
      ...mnemonic(t("menu.top.edit")),
      items: () => [
        { label: t("cmd.undo"), hint: "Ctrl Z", onClick: c.undo, disabled: !c.canUndo },
        { label: t("cmd.redo"), hint: "Ctrl Shift Z", onClick: c.redo, disabled: !c.canRedo },
        "-",
        {
          label: c.checkedCount > 0 ? t("menu.edit.copyChecked", { count: c.checkedCount }) : t("app.copy.toAi"),
          hint: "Ctrl Shift A",
          title: c.canCopy ? t("app.copy.asText.hint") : t("app.copy.title.none"),
          onClick: c.copyCurrent,
          disabled: !c.canCopy,
        },
        {
          label: c.checkedCount > 0 ? t("menu.edit.copyCheckedImages", { count: c.checkedCount }) : t("app.copy.asImages"),
          hint: "Ctrl Shift I",
          title: c.canCopy ? t("app.copy.asImages.hint") : t("app.copy.title.none"),
          onClick: c.copyImages,
          disabled: !c.canCopy,
        },
        "-",
        {
          label: t("menu.edit.find"),
          hint: "Ctrl F",
          title: t("panel.search.title"),
          onClick: c.findAnnotation,
          disabled: !c.canFindAnnotation,
        },
        { label: t("menu.edit.editNote"), hint: "Enter", onClick: c.editSelected, disabled: !c.selected },
        // Same as status changes: with checked notes it applies to those, otherwise to the selected note
        {
          label: c.status.byCheck ? t("menu.edit.deleteChecked", { count: c.status.count }) : t("menu.edit.deleteNote"),
          hint: "Delete",
          onClick: c.deleteSelected,
          disabled: c.status.count === 0,
          danger: true,
        },
        // Everything the notes panel lists (same as right-click on blank space in the notes panel); unlisted notes are untouched
        {
          label: t("menu.edit.deleteAll"),
          title: t("menu.edit.deleteAllTitle"),
          onClick: c.deleteAll,
          disabled: c.listedCount === 0,
          danger: true,
        },
      ],
    },
    {
      ...mnemonic(t("menu.top.view")),
      items: () => [
        { label: t("menu.view.left"), hint: "Ctrl B", checked: c.panels.left, onClick: () => c.togglePanel("left") },
        { label: t("menu.view.right"), hint: "Ctrl Alt B", checked: c.panels.right, onClick: () => c.togglePanel("right") },
        {
          label: t(c.panels.left || c.panels.right ? "menu.view.hideBoth" : "menu.view.showBoth"),
          hint: "Ctrl \\",
          onClick: c.toggleBoth,
        },
        { label: t("menu.view.resetLayout"), title: t("menu.view.resetLayoutTitle"), onClick: c.resetLayout },
        "-",
        key("menu.view.fit", "Shift 1", "Shift+1", noZoom),
        key("menu.view.fill", "Shift 2", "Shift+2", noZoom),
        key("menu.view.actual", "Shift 0", "Shift+0", noZoom),
        key("menu.view.zoomIn", "Ctrl +", "Ctrl+=", noZoom),
        key("menu.view.zoomOut", "Ctrl -", "Ctrl+-", noZoom),
        "-",
        { label: t("menu.view.prevItem"), hint: "Ctrl ↑", onClick: () => c.stepMaterial(-1), disabled: !c.canStepMaterial().prev },
        { label: t("menu.view.nextItem"), hint: "Ctrl ↓", onClick: () => c.stepMaterial(1), disabled: !c.canStepMaterial().next },
        {
          label: t("menu.view.libraryPending"),
          checked: c.prefs.libraryPending,
          onClick: () => c.setPrefs({ libraryPending: !c.prefs.libraryPending }),
        },
        "-",
        {
          label: t("menu.view.blur"),
          checked: c.prefs.backdrop === "blur",
          onClick: () => c.setPrefs({ backdrop: c.prefs.backdrop === "blur" ? "plain" : "blur" }),
        },
        { label: t("menu.view.showMarks"), hint: "Shift H", checked: c.marksShown, onClick: c.toggleMarks },
        {
          label: t("menu.view.showResolved"),
          checked: c.prefs.showResolved,
          onClick: () => c.setPrefs({ showResolved: !c.prefs.showResolved }),
        },
        "-",
        {
          label: t("menu.view.scopeMaterial"),
          checked: c.panelScope === "material",
          onClick: () => c.setPanelScope("material"),
          disabled: noMaterial,
        },
        {
          label: t("menu.view.scopeProject"),
          checked: c.panelScope === "project",
          onClick: () => c.setPanelScope("project"),
          disabled: !c.hasProject,
        },
        {
          label: t("menu.view.panelResolved"),
          checked: c.prefs.panelResolved,
          onClick: () => c.setPrefs({ panelResolved: !c.prefs.panelResolved }),
        },
      ],
    },
    {
      ...mnemonic(t("menu.top.note")),
      items: () => [
        ...TOOLS.map((tool): MenuItem => ({
          label: t(`tool.${tool.tool}`),
          hint: tool.key,
          checked: c.tool === tool.tool,
          onClick: () => c.chooseTool(tool.tool),
          disabled: !c.canDraw && tool.tool !== "select" && tool.tool !== "hand",
        })),
        { label: t("menu.note.timed"), hint: "T", title: t("menu.note.timedTitle"), onClick: c.startTimed, disabled: !c.canTimed },
        { label: t("menu.note.whole"), hint: "N", title: t("menu.note.wholeTitle"), onClick: c.startWhole, disabled: !c.canAnnotate },
        {
          label: c.folderName ? t("menu.note.folderNamed", { name: c.folderName }) : t("menu.note.folder"),
          hint: "Shift N",
          title: t("menu.note.folderTitle"),
          onClick: c.startFolderNote,
          disabled: !c.folderName,
        },
        "-",
        { label: t("menu.note.prev"), hint: "[", onClick: () => c.stepAnnotation(-1), disabled: !c.hasAnnotations },
        { label: t("menu.note.next"), hint: "]", onClick: () => c.stepAnnotation(1), disabled: !c.hasAnnotations },
        "-",
        // Checking: copy for AI and bulk status changes apply only to the checked notes
        { label: t("menu.note.check"), hint: "X", checked: c.selectedChecked, onClick: () => pressKey("X"), disabled: !c.selectedListed },
        { label: t("menu.note.checkAll"), onClick: c.checkAll, disabled: !c.hasAnnotations },
        {
          label: t("menu.note.uncheckAll"),
          hint: c.checkedCount > 0 ? t("panel.batch.count", { count: c.checkedCount }) : undefined,
          onClick: c.uncheckAll,
          disabled: c.checkedCount === 0,
        },
        "-",
        // All three entries are always present (unusable ones are greyed out) so positions don't jump; when notes are checked the label
        // says it applies to the checked ones
        ...(["resolved", "wontfix", "open"] as const).map((s): MenuItem => ({
          label: t(c.status.byCheck ? "menu.note.statusChecked" : "menu.note.status", { status: s, count: c.status.count }),
          hint: s === "resolved" ? "D" : s === "wontfix" ? "Shift D" : undefined,
          onClick: () => c.setStatus(s),
          disabled: !(s === "resolved" ? c.status.notResolved : s === "wontfix" ? c.status.notWontfix : c.status.notOpen),
        })),
        "-",
        // The swatch tooltips mention the number keys 1–6; with nothing whose color can change (nothing selected, or an overall comment
        // selected) the whole row is greyed out
        markColorRow(c.intl, {
          label: c.color.byCheck ? t("menu.note.colorChecked", { count: c.color.count }) : t("menu.note.color"),
          current: c.color.current,
          defaultColor: c.prefs.markColor,
          disabled: c.color.count === 0,
          pick: c.color.pick,
        }),
      ],
    },
    {
      ...mnemonic(t("menu.top.play")),
      items: () => [
        key("menu.play.toggle", t("key.space"), "Space", !isVideo),
        "-",
        key("menu.play.back5", "J", "J", !isVideo),
        key("menu.play.forward5", "L", "L", !isVideo),
        key("menu.play.back1", "Shift ←", "Shift+ArrowLeft", !isVideo),
        key("menu.play.forward1", "Shift →", "Shift+ArrowRight", !isVideo),
        key("menu.play.prevFrame", "←", "ArrowLeft", !isVideo),
        key("menu.play.nextFrame", "→", "ArrowRight", !isVideo),
        key("menu.play.start", "Home", "Home", !isVideo),
        key("menu.play.end", "End", "End", !isVideo),
        "-",
        key("menu.play.slower", ",", ",", !isVideo),
        key("menu.play.faster", ".", ".", !isVideo),
        // Mute is a toggle (remembered) and shows a check mark like loop playback
        { ...key("menu.play.mute", "M", "M", !isVideo), checked: c.prefs.muted },
        "-",
        // A setting (remembered), so it can be ticked even without a video open
        { label: t("menu.play.loop"), hint: "Ctrl L", checked: c.prefs.loop, onClick: c.toggleLoop },
      ],
    },
    {
      ...mnemonic(t("menu.top.window")),
      items: () => [
        { label: t("menu.window.minimize"), onClick: () => c.windowCmd("minimize") },
        {
          label: t(c.win.maximized ? "menu.window.restore" : "menu.window.maximize"),
          onClick: () => c.windowCmd("maximize"),
          disabled: c.win.fullscreen,
        },
        { label: t("menu.window.fullscreen"), hint: "F11", checked: c.win.fullscreen, onClick: () => c.windowCmd("fullscreen") },
        "-",
        {
          label: t("menu.window.topmost"),
          title: t("menu.window.topmostTitle"),
          checked: c.win.topmost,
          onClick: () => c.windowCmd("topmost"),
        },
      ],
    },
    {
      ...mnemonic(t("menu.top.help")),
      items: () => [
        { label: t("menu.help.intro"), title: t("menu.help.introTitle"), onClick: c.openIntro },
        { label: t("menu.help.tour"), title: t("menu.help.tourTitle"), onClick: c.openTour },
        { label: t("cmd.shortcuts"), hint: "? / F1", onClick: c.openHelp },
        { label: t("menu.help.handoff"), onClick: () => c.openSettings("ai") },
        "-",
        { label: t("menu.help.logs"), title: t("menu.help.logsTitle"), onClick: c.openLogs },
        { label: t("menu.help.diagnostics"), title: t("menu.help.diagnosticsTitle"), onClick: c.copyDiagnostics },
        { label: t("menu.help.exportDiagnostics"), title: t("menu.help.exportDiagnosticsTitle"), onClick: c.exportDiagnostics },
        { label: t("menu.help.report"), title: t("menu.help.reportTitle"), onClick: c.reportIssue },
        "-",
        { label: t("menu.help.devTools"), title: t("menu.help.devToolsTitle"), onClick: c.openDevTools },
        "-",
        c.newerVersion
          ? {
              label: t("menu.help.updateAvailable", { version: versionLabel(c.newerVersion.version) }),
              title: t("menu.help.updateAvailableTitle"),
              onClick: c.openNewerVersion,
            }
          : { label: t("menu.help.checkUpdates"), title: t("menu.help.checkUpdatesTitle"), onClick: c.checkUpdates },
        { label: t("menu.help.about", { app: t("brand.name") }), onClick: () => c.openSettings("about") },
      ],
    },
  ];
}

import type { Annotation, AnnotationStatus } from "@sniptoss/core";
import type { IntlShape } from "react-intl";
import type { Tool } from "./annotate";
import { versionLabel } from "./brand";
import { platform, type MaterialEntry, type NewerVersion, type WindowAction, type WindowState } from "./host";
import { prettyKeys } from "./hotkey";
import { runCommand } from "./commandKeys";
import { menuKeyOf, shortcutHint, type CommandId } from "./commands";
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
  /** The notes panel lists something, or the item on the canvas has only drawings left; Delete All Notes… (asks first) */
  canDeleteAll: boolean;
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
  /**
   * Help → "Tutorial": the tutorial again, on the sample picture (as the welcome page's button), never on the user's own item, where "Next"
   * would write sample notes into their project. Absent when the shell can't add the sample
   */
  openTour?: () => void;
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

/** Tools: the message for the name is tool.<tool> (shared by the menu, toolbar and shortcut list); command is the one that picks it (commands.ts) */
export const TOOLS: { tool: Tool; command: CommandId }[] = [
  { tool: "select", command: "tool.select" },
  { tool: "hand", command: "tool.hand" },
  { tool: "point", command: "tool.point" },
  { tool: "rect", command: "tool.rect" },
  { tool: "pen", command: "tool.pen" },
  { tool: "arrow", command: "tool.arrow" },
];

/**
 * The contents of the menu bar. The key on the right is the command's first key as it is now (Settings → Keyboard Shortcuts), none when it
 * has none. An entry whose action lives where its key is handled (zoom, playback) runs that command (runCommand), so the menu and the
 * shortcut always do the same thing. Wording follows docs/design-rules.md "6 · Copy"
 */
export function buildMenus(c: MenuContext): TopMenu[] {
  const t = (id: string, values?: Record<string, string | number>) => c.intl.formatMessage({ id }, values);
  const bindings = c.prefs.keybindings;
  /** The key a command has now, in the menus' spelling */
  const h = (id: CommandId) => shortcutHint(id, bindings);
  const noMaterial = !c.current;
  // An item that cannot be opened shows only an explanation on the canvas, and nothing handles the zoom and playback keys (the menu used
  // to look only at the kind, so entries were enabled but did nothing)
  const isVideo = c.current?.kind === "video" && !c.mediaBroken;
  /** The canvas shows an item that can be zoomed (image, video; a PDF or presentation is only a line of placeholder text for now) */
  const noZoom = !c.current || (c.current.kind !== "image" && c.current.kind !== "video") || c.mediaBroken;
  const run = (label: string, id: CommandId, disabled = false): MenuItem => ({
    label: t(label),
    hint: h(id),
    disabled,
    keys: menuKeyOf(id, bindings),
    onClick: () => void runCommand(id),
  });

  return [
    {
      ...mnemonic(t("menu.top.file")),
      items: () => [
        { label: t("menu.file.capture"), hint: prettyKeys(c.captureHotkey), onClick: c.startCapture },
        "-",
        { label: t("menu.file.addFiles"), hint: h("file.addFiles"), onClick: c.addFiles },
        { label: t("menu.file.addFolder"), hint: h("file.addFolder"), onClick: c.addFolder },
        { label: t("menu.file.paste"), hint: h("file.paste"), onClick: c.paste },
        {
          label: t("menu.file.find"),
          hint: h("file.find"),
          onClick: c.findMaterial,
          disabled: !c.hasEntries,
        },
        "-",
        { label: t("menu.file.revealCurrent"), onClick: c.revealCurrent, disabled: noMaterial },
        { label: t("menu.file.revealNotes"), onClick: c.revealDataDir, disabled: !c.hasNotes },
        "-",
        { label: t("menu.file.refresh"), hint: h("file.refresh"), onClick: c.refresh, disabled: !c.hasEntries },
        { label: t("menu.file.clear"), danger: true, onClick: c.clearList, disabled: !c.canClear },
        "-",
        // On the Mac the app menu has Settings…, About and Quit, so these three are Windows only (menuModel.ts)
        { label: t("cmd.settings"), hint: h("app.settings"), only: "windows", onClick: () => c.openSettings() },
        "-",
        // Closing the window (Alt F4, the × in the title bar) only hides it when "keep in tray" is on; this really quits
        { label: t("menu.file.exit"), only: "windows", onClick: () => c.windowCmd("quit") },
        // The Mac's ⌘W, at the end of the File menu as in every Mac app: the same as the window's red button (with "keep running in the menu
        // bar" on the app stays; ⌘Q in the app menu quits). Ctrl+W is not a window key on Windows
        ...(platform === "mac"
          ? [{ label: t("menu.file.closeWindow"), hint: h("window.close"), onClick: () => c.windowCmd("close") }]
          : []),
      ],
    },
    {
      ...mnemonic(t("menu.top.edit")),
      items: () => [
        { label: t("cmd.undo"), hint: h("edit.undo"), role: "undo", onClick: c.undo, disabled: !c.canUndo },
        { label: t("cmd.redo"), hint: h("edit.redo"), role: "redo", onClick: c.redo, disabled: !c.canRedo },
        "-",
        {
          label: c.checkedCount > 0 ? t("menu.edit.copyChecked", { count: c.checkedCount }) : t("app.copy.toAi"),
          hint: h("note.copyText"),
          title: c.canCopy ? undefined : t("app.copy.title.none"),
          onClick: c.copyCurrent,
          disabled: !c.canCopy,
        },
        {
          label: c.checkedCount > 0 ? t("menu.edit.copyCheckedImages", { count: c.checkedCount }) : t("app.copy.asImages"),
          hint: h("note.copyImages"),
          title: c.canCopy ? undefined : t("app.copy.title.none"),
          onClick: c.copyImages,
          disabled: !c.canCopy,
        },
        "-",
        {
          label: t("menu.edit.find"),
          hint: h("note.find"),
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
          onClick: c.deleteAll,
          disabled: !c.canDeleteAll,
          danger: true,
        },
      ],
    },
    {
      ...mnemonic(t("menu.top.view")),
      items: () => [
        { label: t("menu.view.left"), hint: h("view.toggleLeft"), checked: c.panels.left, onClick: () => c.togglePanel("left") },
        { label: t("menu.view.right"), hint: h("view.toggleRight"), checked: c.panels.right, onClick: () => c.togglePanel("right") },
        {
          label: t(c.panels.left || c.panels.right ? "menu.view.hideBoth" : "menu.view.showBoth"),
          hint: h("view.toggleBoth"),
          onClick: c.toggleBoth,
        },
        { label: t("menu.view.resetLayout"), onClick: c.resetLayout },
        "-",
        run("menu.view.fit", "view.fit", noZoom),
        run("menu.view.fill", "view.fill", noZoom),
        run("menu.view.actual", "view.actual", noZoom),
        run("menu.view.zoomIn", "view.zoomIn", noZoom),
        run("menu.view.zoomOut", "view.zoomOut", noZoom),
        "-",
        {
          label: t("menu.view.prevItem"),
          hint: h("view.prevItem"),
          onClick: () => c.stepMaterial(-1),
          disabled: !c.canStepMaterial().prev,
        },
        { label: t("menu.view.nextItem"), hint: h("view.nextItem"), onClick: () => c.stepMaterial(1), disabled: !c.canStepMaterial().next },
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
        { label: t("menu.view.showMarks"), hint: h("view.marks"), checked: c.marksShown, onClick: c.toggleMarks },
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
          hint: h(tool.command),
          checked: c.tool === tool.tool,
          onClick: () => c.chooseTool(tool.tool),
          disabled: !c.canDraw && tool.tool !== "select" && tool.tool !== "hand",
        })),
        { label: t("menu.note.timed"), hint: h("note.timed"), onClick: c.startTimed, disabled: !c.canTimed },
        { label: t("menu.note.whole"), hint: h("note.whole"), onClick: c.startWhole, disabled: !c.canAnnotate },
        {
          label: c.folderName ? t("menu.note.folderNamed", { name: c.folderName }) : t("menu.note.folder"),
          hint: h("note.folder"),
          onClick: c.startFolderNote,
          disabled: !c.folderName,
        },
        "-",
        { label: t("menu.note.prev"), hint: h("note.prev"), onClick: () => c.stepAnnotation(-1), disabled: !c.hasAnnotations },
        { label: t("menu.note.next"), hint: h("note.next"), onClick: () => c.stepAnnotation(1), disabled: !c.hasAnnotations },
        "-",
        // Checking: copy for AI and bulk status changes apply only to the checked notes
        {
          label: t("menu.note.check"),
          hint: h("note.check"),
          checked: c.selectedChecked,
          onClick: () => runCommand("note.check"),
          disabled: !c.selectedListed,
        },
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
          hint: s === "resolved" ? h("note.done") : s === "wontfix" ? h("note.wontfix") : undefined,
          onClick: () => c.setStatus(s),
          disabled: !(s === "resolved" ? c.status.notResolved : s === "wontfix" ? c.status.notWontfix : c.status.notOpen),
        })),
        "-",
        // The swatch tooltips mention the number keys 1–8; with nothing whose color can change (nothing selected, or an overall comment
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
        run("menu.play.toggle", "play.toggle", !isVideo),
        "-",
        run("menu.play.back5", "play.back5", !isVideo),
        run("menu.play.forward5", "play.forward5", !isVideo),
        run("menu.play.back1", "play.back1", !isVideo),
        run("menu.play.forward1", "play.forward1", !isVideo),
        run("menu.play.prevFrame", "play.prevFrame", !isVideo),
        run("menu.play.nextFrame", "play.nextFrame", !isVideo),
        run("menu.play.start", "play.start", !isVideo),
        run("menu.play.end", "play.end", !isVideo),
        "-",
        run("menu.play.slower", "play.slower", !isVideo),
        run("menu.play.faster", "play.faster", !isVideo),
        // Mute is a toggle (remembered) and shows a check mark like loop playback
        { ...run("menu.play.mute", "play.mute", !isVideo), checked: c.prefs.muted },
        "-",
        // A setting (remembered), so it can be ticked even without a video open
        { label: t("menu.play.loop"), hint: h("play.loop"), checked: c.prefs.loop, onClick: c.toggleLoop },
      ],
    },
    {
      ...mnemonic(t("menu.top.window")),
      items: () => [
        // ⌘M minimizes on the Mac, as in every Mac app; on Windows the title bar's button does it, and Ctrl+M is not a window key there
        {
          label: t("menu.window.minimize"),
          hint: platform === "mac" ? h("window.minimize") : undefined,
          onClick: () => c.windowCmd("minimize"),
        },
        {
          label: t(c.win.maximized ? "menu.window.restore" : "menu.window.maximize"),
          onClick: () => c.windowCmd("maximize"),
          disabled: c.win.fullscreen,
        },
        {
          label: t("menu.window.fullscreen"),
          hint: h("window.fullscreen"),
          checked: c.win.fullscreen,
          onClick: () => c.windowCmd("fullscreen"),
        },
        "-",
        {
          label: t("menu.window.topmost"),
          checked: c.win.topmost,
          onClick: () => c.windowCmd("topmost"),
        },
      ],
    },
    {
      ...mnemonic(t("menu.top.help")),
      items: () => [
        { label: t("menu.help.intro"), onClick: c.openIntro },
        // The same Tutorial as the welcome page's button (on the sample picture); none when the shell can't add the sample
        { label: t("welcome.sample"), onClick: () => c.openTour?.(), disabled: !c.openTour },
        { label: t("cmd.shortcuts"), hint: h("app.shortcuts"), onClick: c.openHelp },
        { label: t("menu.help.handoff"), onClick: () => c.openSettings("ai") },
        "-",
        { label: t("menu.help.logs"), onClick: c.openLogs },
        { label: t("menu.help.diagnostics"), onClick: c.copyDiagnostics },
        { label: t("menu.help.exportDiagnostics"), onClick: c.exportDiagnostics },
        { label: t("menu.help.report"), onClick: c.reportIssue },
        "-",
        // The Mac app has no developer tools of its own (WebKit's inspector needs Safari's Develop menu); its logs and diagnostics package are enough
        { label: t("menu.help.devTools"), only: "windows", onClick: c.openDevTools },
        "-",
        c.newerVersion
          ? {
              label: t("menu.help.updateAvailable", { version: versionLabel(c.newerVersion.version) }),
              onClick: c.openNewerVersion,
            }
          : { label: t("menu.help.checkUpdates"), onClick: c.checkUpdates },
        { label: t("menu.help.about", { app: t("brand.name") }), only: "windows", onClick: () => c.openSettings("about") },
      ],
    },
  ];
}

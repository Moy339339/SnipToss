# SnipToss: Design and Roadmap

## The problem

People have change requests for what Claude Code and Codex generate (images, video, web pages, mini programs, PDFs, PPTs, …).
The agent has to learn **quickly and precisely** which item, which position / time / element, and what it should become.
The priority is that agents can read the result efficiently; the interface should make marking things up smooth for people:
fast, no stutter, no flash, with the polish of mature software.

## Overall shape

```
User ──▶ SnipToss.exe (standalone window: WPF shell + WebView2 UI) ──write──▶ <the item's notes home>/.sniptoss/
                                                                                │
Codex / Claude Code ◀──── read REVIEW.md and snapshots (the "Copy as Text" text points to them) ────┘
```

- **A standalone desktop app** (not something used in a browser). The shell is .NET 10 WPF; the UI is drawn in WebView2.
  - Why not Tauri: Tauri needs a Rust toolchain and C++ build tools, which makes the development environment large; WPF and WebView2 ship with Windows.
  - Why not Electron: it bundles a whole Chromium, which is heavy in both size and memory and contradicts "lightweight".
  - Why a web UI: images, video and PDF render natively; a hand-drawn UI gives the finest control; web items need a browser engine anyway.
- **Notes live in `.sniptoss/` inside the item's own project**: wherever an agent works, it finds the notes in that project,
  and relative paths are enough to locate the item; when the project is moved or renamed, the notes go with it. If notes were kept centrally in the
  program's folder, an agent would have to know where the program is installed, and the paths would break as soon as the project moved.
- **The left panel is a library of items, not "open a folder"**: files and folders you drag in or add stay in the library,
  and may come from different drives and different projects; a folder expands into a tree; entries can be pinned to the top (kept when the library is cleared),
  removed, or cleared (none of these delete files, and each asks for confirmation first).
  The library is stored as `Library` in `%APPDATA%\SnipToss\settings.json` (together with the expanded state and the last selected item).
  It stores absolute paths. When a project is moved, its entry turns gray (the notes are in the project's own `.sniptoss` and are unaffected): right-click → Locate… and
  point it at the new location to swap the entry in place (pinned state and position unchanged);
  when the new location is added again, an entry with the same name whose old one is really gone is recognized and swapped in place; when the whole drive is absent,
  the entry says its drive isn't connected rather than that it was deleted. Only one window is open: when the app is already running,
  "Open with SnipToss" in the context menu, or dropping onto a shortcut, hands the path to the open window (`SingleInstance` in `app/Program.cs`, over a named pipe).
- **The library groups entries by project** (modeled on the desktop clients of Codex and Claude Code): both sidebars group by project (working folder);
  in Codex a project is a folder with conversations filed under it; Claude Code groups by working directory ("Group by project") by default.
  Here a **project is a notes home** (the folder that holds `.sniptoss`), and entries are grouped under it automatically with no manual filing (during a scan the shell computes a `project` for each entry).
  So "a group in the library" and "the notes that sit together on disk" are the same thing and cannot disagree. When the project folder is itself a folder entry, its contents are listed
  directly under the project; otherwise the entries that belong to this project (files and subfolders dragged in on their own) are listed. Projects are expanded by default; collapsed ones are recorded in `Collapsed`; pinning and removing work per project.
  Claude Code's "custom groups" are not offered: grouping is by project only (custom groups would be one more thing to manage).
- **Each item's notes home** (the folder that holds `.sniptoss`; `HomeFinder` in `app/Library.cs`):
  1. Search upward from the folder the item is in for an existing `.sniptoss`; if one is found, use it. This project has been annotated before, so keep using the same one, and an agent only has to read one place;
  2. If there is none: for an item that came from a folder entry in the library, use that folder; for a file added on its own, use the folder it is in.
  `.sniptoss` is created only when the first note is really written. `material.path` in a notes file stays relative to the notes home, so the format an agent sees is unchanged.
  REVIEW.md summarizes all the notes of one notes home.
- **Handing off to an AI = copy and paste into the conversation**: a note is saved into `.sniptoss/` as soon as it is written (REVIEW.md + one snapshot per note + JSON);
  the bottom of the notes panel says where it is stored, and one click opens the folder. Copying is uniformly called "Copy Notes as Text" (the button at the bottom of the notes panel is called "Copy as Text";
  the name makes clear that what leaves is a text description, while the items and snapshots stay local and web-based AI cannot use them. The toolbar does not carry this button):
  there is a single rule for the scope: **checked = the checked notes; nothing checked = all the open notes the notes panel currently lists**. The button at the bottom of the notes panel, `Ctrl+Shift+A` and the Edit menu
  all follow it. To hand over just one thing: right-click a note / the copy button on a card = this note; right-click on the canvas = the item on the canvas (same as right-clicking its row in the Library);
  right-click a row in the Library = that row (a project = the whole project, same as the notes panel's "Project": it includes folder comments and the group of missing items;
  a folder = all items inside it + its folder comments); right-click while several Library rows are selected = whatever the notes panel currently lists.
  All entry points are computed by the same rule, so the canvas right-click, a Library multi-selection, the counts on project rows and the content actually copied agree. Every copy shows a notice saying how many items and notes were copied.
  The first time a note is written in a project, no "where the notes are saved" notice is shown (it gets in the way, and the line at the bottom of the notes panel already says); right-clicking a note → "Show Snapshot in Folder" selects that image directly (so people can see where notes are stored).
- **Two kinds of handoff, by destination** (when a copy holds both image and text, each program picks one: some chat apps take the image, some web-based AI take the text;
  people using web-based AI or chat apps cannot read local paths). Next to every Copy as Text entry there is also **Copy as Images** (`Ctrl+Shift+I`):
  - Copy as Text = plain text, for local Claude Code and Codex (they can read local files; as soon as the clipboard holds an image they take only the image, so no image can be mixed in);
  - Copy as Images = one image per note (drawn by the shell, `app/HandoffImages.cs`: "project / file" on top + this note's snapshot + a notes area in the same style as Screen Capture, `NotesBlock`;
    the font size scales with the image width so the text is still readable after an AI shrinks the image). With one image, the clipboard holds the image. With several, they are saved as image files (`%LOCALAPPDATA%\SnipToss\handoff`, kept for 7 days)
    and put on the clipboard as files, so a web page receives several at one paste (checked in Edge: the page receives that many `File` objects). Neither mixes in text: a browser drops the text when files are present,
    and when both image and text are present some web-based AI take only the text.
  - No "one big stitched long image": with many video notes the image gets too tall, and the text is unreadable once an AI shrinks it.
- **Copy button + checkboxes at the bottom of the notes panel**: the notes in the list can be turned into a message for an AI in one go, and can also be checked one by one or all at once to say which ones to hand over.
  An action bar 44 high at the bottom: "Select all" on the left, the blue primary button on the right.
  Each card has a checkbox at its top left, on the same vertical line as the "Select all" one. **Nothing checked = all open notes; something checked = only the checked ones.**
  The button always reads "Copy as Text" and shows no count (if it read "Copy 1 for AI", seeing "1" with nothing checked would suggest that one note is checked); how many are checked is written on the left, where "Select all" becomes "N selected";
  the notice after copying says how many notes were handed over. `Ctrl+Shift+A` and the Edit menu do the same thing.
  "Selected" is used only in this bar; on cards and in menus the action is called "check", kept apart from "select" (the one note that is open). Checks are kept in memory only and are cleared when the notes panel changes its scope.
- **Which items the notes panel lists** (the items of one project are scattered across the library; on the right you want to see all their notes and select all in one click).
  **The notes panel itself switches between "This video / Project"** at the top; the default is Project, stored in settings (`panelScope`);
  a multi-selection in the Library (marquee, Ctrl / Shift click, Ctrl+A, clicking a project or folder row) temporarily lists just the selected ones, with an extra "Selected" option at the top; clearing the multi-selection or switching back at the top restores the previous scope.
  Whatever is listed is what "Select all" and "Copy as Text" act on.
  A first design followed only the Library selection (click a project on the left and the right lists the whole project); in use you had to **go left to click the project, then come back right to act, which felt disjointed**,
  so the scope switch lives on the notes panel itself and a Library multi-selection is only a temporary override.
  When several items are listed they are grouped by item (group titles stick to the top; clicking one opens that item; the group title's checkbox checks all of that item's notes; items without notes take no space,
  and a line at the bottom, "N more items…", covers them); the item open on the canvas is always among them, with a blue line to the left of its group title.
  Clicking another item's note, or `[` `]`, moves to it: the canvas switches and the Library selection stays (the Library changes to select only the new item only when it is not within the selected range);
  changing status, deleting and copying do not need to switch the canvas, while editing switches to the item and then opens the composer. The two tabs "Open / All" gave way to the scope switch and became a toggle at the top right,
  "Show resolved notes" (`panelResolved`, now in the funnel menu inside the search box, next to the filter by type);
  the small "Overall comment" icon that used to sit there was removed (the toolbar has the same button).
- **Notes panel search** (with many notes, scrolling is the only way to find one): a filter box at the top (like the Library's; `Ctrl+F`, menu Edit → Find Note…), searching the note text and replies;
  every space-separated word must be present; matches on a card get a pale-blue wash (`--hit`). While searching, **"what is listed" means "what was found"**, so "Select all" and "Copy as Text" with nothing checked cover only those
  (the same as the copy-scope rule above); the counts on the scope options do not change. When nothing is found it says so, and when resolved notes match it offers "Show resolved notes".
  Not done: `Ctrl+P` searching item names and note text at once. Two boxes that each do their own job are easier to understand; revisit if it is really needed.
- **The Library works like File Explorer** (a drag with the left button draws a marquee, the way a normal tool behaves): press and drag to marquee-select,
  Ctrl+drag to add, dragging to an edge scrolls automatically; clicking empty space or `Esc` clears the multi-selection. After a marquee or a click on a project row, if the item open on the canvas is not among the selected ones,
  the first selected item that has open notes is opened, so the right side does not list one thing while the canvas shows another.
  Clicking a project row becomes "select + expand if collapsed"; only when it is already the sole selection does another click collapse it (otherwise a single click on the tree would fold it).
  Checkboxes default to unchecked (rather than all checked): with everything checked by default a column of cards is a column of blue ticks, which draws the eye; with "nothing checked = all", the panel is quiet in normal use and you check only when you want to pick a few.
  The copied content is generated by `renderHandoff` in `core`: **the note text is written straight in**. The AI can start working on receipt, without having to find `.sniptoss` itself (AIs often cannot find those files).
  Files are written as **positions within the project**: the full path of the project folder is written once at the start, and each file also gets its full path after it: when the project has moved or the AI works somewhere else,
  the full path does not match, but the position within the project can still be found. A position is first put in words, "top left of the frame (x 12%–52%, y 8%–18%)", and then in pixels
  (x=230 alone does not let you picture where it is; the pixels are for those who crop or redraw a region programmatically).
  **It does not tell the AI to run a command to mark a note as done afterwards** (only what to change goes to the AI; when it finishes, a new item is produced and re-imported, and the notes on the old item stay as a record),
  and no `sniptoss.cmd` is put into the project any more (one left by an earlier version is deleted when the project is opened).
  It started as a single sentence pointing to REVIEW.md, but that file covers the whole notes home, so the scope was unclear, and it was replaced.
  **Nothing is written into the instruction files that agents read in the project**: notes are a one-off task, not a standing rule of the project, and writing them there would mean every agent session carries them.
  Exporting a zip bundle of notes was also removed: it is not needed and the menu only got more complicated.
- **A standard menu bar at the top of the window** (like ordinary desktop software, with everything you would expect):
  File / Edit / View / Annotate / Playback / Window / Help (`MenuBar.tsx` + `appMenus.tsx`). It follows Windows conventions: Alt+letter, tap Alt and then a letter, F10;
  arrow keys move within menus, and moving the mouse over another menu switches to it. Each item shows its shortcut on the right; clicking an item that has a shortcut simulates pressing that key (`pressKey` in `keys.ts`),
  so a menu item and its shortcut always do the same thing and never exist as two copies. The menu bar is drawn with web technology (dark like the rest of the UI, in the same menu style), not as a WPF native menu (which is hard to theme dark, and all the actions live in the UI anyway).
  In Window, minimize, maximize, full screen (F11) and always on top (remembered) are done by the shell (`MainWindow.Command`).
- **Default window layout**: the first time it opens, the window is 80% of the width and 85% of the height of the work area of the screen under the mouse, centered, at most 1920 × 1200 (anything larger only widens the canvas);
  minimum 960 × 600; a screen smaller than that gets a maximized window filling it, and the minimum size also shrinks with the screen (`WindowPlacement.DefaultOn`).
  All of the above is computed in DIPs using that screen's own scale, while position and size are always stored in physical pixels: each screen can have a different scale, so no DIP coordinate is valid for all screens.
  Library 260 (draggable, 180–520), notes panel 320 (240–640) (`Panels.tsx`). After that, the size, position and panel widths the user sets are remembered;
  menu View → Reset Layout puts the window and both panels back to the default (the window stays on the screen it is on now). On a 2560 × 1440 screen that gives 1920 × 1183, with a canvas of about 1320.
  A fixed 1360 × 860 would fill only half of a large screen and might not fit on a small one.
- **Note cards do not show the 6-character ID** (a string of letters and digits means nothing to a reader): the ID is for pointing at one note in the notes file, in REVIEW.md and on the command line; it is shown only as the ordinal when hovering over a card,
  and the Copy as Text content does not carry it (notes are referred to by ordinal).
- **Snapshots are the key for agents**: an agent cannot watch a video and is not good at picturing a position from coordinates. Each note gets one snapshot
  (the region boxed on the original image / that frame of the video / that page of the PDF / that element of the web page), and both Claude Code and Codex can look at the image directly.

## What is supported

Principle: **everything can degrade to "one picture + a position + text"**; types that can supply more structure (time, page number, web element, mini program page path) record it in addition,
and the more precise the information an agent gets, the more precise its changes.

| Type | How it is shown | How the position is recorded | Extra information for the agent | Phase |
|---|---|---|---|---|
| Images (png jpg webp gif bmp avif ico svg; tiff and heic are converted to PNG by the shell) | Native | Rectangle / point / freehand / arrow, normalized coordinates | Pixel coordinates | 2 |
| **Screen Capture** (anywhere on the screen) | Not in the library: press the shortcut, then select and mark up on the frozen screen; when finished, the image together with its notes goes to the clipboard (see below) | Pixel coordinates within the selection | Numbered notes + screenshot file path | ✅ |
| **Screenshots** (clipboard paste, a grab of one window, an Android phone screenshot via adb) as items | Saved as `.sniptoss/captures/*.png` and annotated as an image | Same as images | Source (which window / which phone / when) | Right after 2 |
| Video (mp4 webm mov m4v mkv) | Native + a custom player bar | Time point / time range + a region of the canvas | Timecode, snapshot of that frame | 3 |
| **Web pages**: local html, a local dev server (localhost), live URLs | An embedded real browser (a second WebView2) in which click, press and scroll work normally | "Pick element" mode picks an element, or a free rectangle | CSS selector, element text, URL, viewport size, scroll position, element snapshot | 4 |
| **Mini programs** (WeChat native) | Connect to WeChat DevTools and grab the simulator view, see below | Page + region / element | Page path (e.g. `pages/index/index`), page parameters, the wxml of the framed component | Together with Screenshots |
| PDF | pdf.js | Page + region | Page number | 5 |
| PPT / PPTX | PowerPoint installed on the computer exports each slide as an image | Slide + region | Slide number; mapped to the shape name where possible (PowerPoint can read the position of each shape) | 5 |
| Word | Word installed on the computer exports a PDF | Page + region | Page number | After 5 |
| Markdown / text / code | Source | Line range + the quoted text | Line numbers, quoted text | Later |
| Audio | Waveform | Time point / time range | Timecode | Later |
| Everything else (desktop programs, games, apps…) | Via Screenshots | Same as images | Source | Together with Screenshots |

**Screen Capture**: temporary notes on anywhere on the screen, like a common screenshot tool with the addition of writing notes:

- Done natively in the shell (`app/Capture/`, WPF), not in WebView2: it has to appear the instant the shortcut is pressed, and across several displays and different scale factors it has to align to physical pixels.
  There is one `CaptureOverlay` layer (the frozen picture) per display, and the selection can be on only one of them (`CaptureSession.Owner`).
- A global shortcut (`GlobalHotKey`, default `Ctrl+Alt+A`) + a button at the right of the title bar + the File menu + the tray. Starting from the title bar button captures from inside this window, and hides this window first by default;
  the small arrow beside the button holds only a checkable "Hide This Window While Capturing" (the same as that setting) and "Capture Settings…".
  Screen Capture has to keep working after the window is closed, so closing the window hides it to the tray by default (`Tray`, can be turned off in Settings); start-at-login passes `--tray`, which goes to the tray only.
- Tools: Rectangle, Ellipse, Arrow, Pen, Pixelate, Text; plus two more: Pin (a numbered note point) and Overall comment. After a rectangle / ellipse / arrow / pen stroke is drawn, the note box pops up next to it.
  The note box is the same as the main app's composer (category + input + Cancel / Save); once a tool is chosen, the pointer becomes that tool's small icon (`ToolCursors`, same as `cursors.ts` in the main app).
  The text for the AI and the notes area under the image are written the same way, and the way a position is written is the same as in the main app:
  "1. Change · Region: top left of the frame (x 13%–38%, y 17%–33%), x=75 y=75 w=150 h=75 px: note text" (Pen and Pixelate give a "Freehand mark", Arrow gives its start and end, Pin and Text give a "Point"); coordinates are physical pixels within the screenshot with the top left as 0, 0,
  and numbers use a fixed format that does not follow the system locale. The wording on both sides is in the messages `ai.where.*` and runs against the same golden file `tests/golden/where.zh-CN.json`.
  The marks on the screen and the composited image go through the same `MarkPainter`.
- **The clipboard holds only an image** (bitmap + PNG), with the notes drawn below the picture (the setting "Include notes in the image", on by default; the "Extra instructions" text is drawn in too).
  Putting image and text together did not work: when both are present, the Codex desktop app pastes only the image (openai/codex#15436), Claude Code on Windows takes only the image on `Ctrl+V`
  (in practice it becomes `[Image #N]`), while some web-based AI take only text and drop the image, so the result differs depending on where you paste. With only an image, every destination gets the same picture.
  Only when "Include notes in the image" is off are image + text put on the clipboard together (otherwise the notes would be lost). Captures are saved in `%LOCALAPPDATA%\SnipToss\captures` (kept for 30 days, configurable),
  with file names like `capture-2026-10-22_14-03-05.png` (Gregorian calendar, fixed format, no language, no spaces; older builds used `截图批注 2026-10-22 14-03-05.png`, which cleanup still recognizes).
  A screen capture is temporary and one-off: it does not go into the library, and there is no retrieving it afterwards.
- Input methods are turned off on the capture overlay (`InputMethod.IsInputMethodEnabled`) and turned on only in the box you type into: with a Chinese input method on, R / A / B would be swallowed as pinyin.

**Mini programs** (WeChat native first; uni-app / Taro possibly later):

1. **Connect to the DevTools (the main route)**: WeChat's official `miniprogram-automator` connects through the automation port to a WeChat DevTools that is **already open**
   (`cli auto --project <project> --auto-port 9420`; in the DevTools, "Settings → Security Settings → Service Port" must be on).
   In SnipToss, "Grab mini program": `miniProgram.currentPage()` gives the page path and parameters, and `miniProgram.screenshot()` gives the simulator view directly
   (returned as base64, so no window grab and no border), which is saved as a screenshot item to annotate. When a region is drawn, `page.$$()` then fetches the position and size of each element,
   finds which component the box encloses and records its wxml fragment, so the agent can go to the specific `.wxml` file and line.
2. **Screenshot fallback**: when the automation port is not open, grab the DevTools window, or use adb to grab the screen of a real Android phone, and annotate it as an image; the page path is entered by hand.
3. What uni-app / Taro can build as an H5 version goes through the web page mode directly.

## Shortcuts

See [`shortcuts.md`](shortcuts.md). Key points: a single key switches tools; video follows video-editor habits (Space/K, J/L, I/O, ←→ frame by frame);
pressing a tool key during video playback pauses and starts annotating automatically; `?` shows all of them.

## The three layers an agent reads

| Layer | How | For |
|---|---|---|
| 1 | The text from "Copy as Text"; `.sniptoss/REVIEW.md` + `snapshots/` | Any agent, zero configuration. The user copies the notes (original text + position within the project + snapshot) and pastes them into the conversation; an agent working in the project can also read REVIEW.md itself |
| 2 | The `sniptoss` CLI: `list --json`, `review` | When filtering is needed. `resolve` / `wontfix` still exist, but neither the copied text nor REVIEW.md tells an agent to write a status back |
| 3 | A skill / MCP server (later) | Codex and Claude Code both support skills and MCP, so this can become a ready-made "read the notes" workflow |

## Connecting other agents later

The focus is Codex and Claude Code, but other AIs will come, so **the core is not tied to any one vendor**:

- Layers 1 and 2 only require that the agent "can read files and run commands", which the mainstream coding agents all can do; switching vendor needs no change to the data or to the CLI.
- The "Copy as Text" content is plain text and carries absolute paths, so it works the same pasted into any vendor's conversation, with no per-agent project instruction files.
- The only thing that differs per vendor is the layer 3 skill / MCP: one is produced per vendor format; MCP is a common protocol, so one version mostly works for all.
- Adding a new agent does not touch the data format of `.sniptoss/`.

## Technical choices

| Part | Choice | Why |
|---|---|---|
| Window shell | .NET 10 WPF + WebView2 (`app/`) | The program itself is 1.8 MB; .NET 10 is LTS, supported until 2028-11 |
| UI | TypeScript + Vite + React (`packages/web`) | |
| Notes logic | `packages/core`, pure TS, no file system access | Shared by the UI and the CLI |
| Command line for agents | `packages/cli` (Node) | |
| Reading items | Each drive used in the library is mapped to a WebView2 virtual host (`vol-e.sniptoss.example` = `E:\`), read natively | Video scrubbing (Range requests) is handled by WebView2. The mapping only takes effect for later navigations: at startup the drives in the library are mapped first; if something newly added is on a drive that has not been mapped, it is mapped, the page is reloaded once and navigated back (`MainWindow.ReloadIfNewVolume`) |
| Snapshot generation | Drawn with canvas in the UI | No dependency on ffmpeg, and fast |
| PPT / Word | Exported by the PowerPoint / Word installed on the computer (COM) | Office must be installed; there is no LibreOffice route |

## Experience baseline

- No white flash at startup: the window, the title bar, the WebView2 background and the web page background all share one color (`Bg` in `app/MainWindow.cs` = `--bg` in `styles.css`).
- Startup to usable: 0.74–0.78 s warm, about 1.4 s cold (measured on .NET 10; `SNIPTOSS_PERF_LOG` can record it). The window itself appears immediately.
- Playback, dragging and drawing a box do not go through a React re-render: high-frequency updates (playhead, timecode, the box being dragged) change the DOM directly, with no dropped frames at 60 fps.
- The program never modifies the items themselves, only writes `.sniptoss/` (a hard restriction in `app/Bridge.cs`).

## Phases

1. ✅ **Skeleton**: data format, `core`, CLI, desktop shell, browsing items
2. ✅ **Image and video notes**: point / box / pen / arrow / overall comment, writing comments, saving JSON, generating snapshots and `REVIEW.md`; video with time points / time ranges;
   undo and redo; Copy as Text (three layers: one note / the current item / the whole project); the library grouped by project; settings; context menu integration; live sync of changes made outside
   Next: **Screen Capture** (paste, window grab, adb) + mini program grabbing
3. (merged into 2)
4. **Web page notes**: embedded browser + element picking; then mini program automation
5. **PDF**, then **PPT / Word**
6. **The agent loop**: mark stale notes after an item changes, skill / MCP server
7. **Packaging and release** (after the features are done and the bugs tested out): Windows installer + portable build, Mac (Apple Silicon) DMG / portable build

## Options at install time

- **"Add to the File Explorer context menu" is checked by default.** As in the VS Code installer, the user can untick it.
  Checked = at install time, write the HKCU registry entries set by `ShellIntegration.Set(true)`; uninstalling removes them.
- The portable build has no install step and does not change the system itself: the context menu is still switched on by hand in Settings → System (a development build is the same, which is why it is not visible by default).

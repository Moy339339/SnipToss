# Keyboard shortcuts

Principles:

- **Single keys switch tools** (like Figma): no need to take a hand off the keyboard to click the toolbar. Single-key shortcuts are disabled automatically while the cursor is in a text field, so typing (including with an IME such as Chinese) is unaffected.
- **Video follows the conventions of video editors**: Space / K play and pause, J / L rewind and fast-forward, I / O set a time range, ←/→ step frames.
- **One key does “pause + start annotating”**: pressing a tool key while a video is playing first pauses on the current frame and then enters the tool (can be turned off in Settings → Annotations → “Pause video when choosing an annotation tool”).
- **The same key means the same thing across items**: `[` `]` are always the previous / next note, and ← → are always “back / forward within this item” (a frame in a video, a page in a PDF; an image has no internal pages, so it switches items).
- Press `?` at any time to see all shortcuts; custom shortcuts will be supported later.

## On the Mac

The tables in this file are written for Windows. On the Mac the same shortcuts apply with these changes, and the interface shows them with the Mac's symbols (⌃ ⌥ ⇧ ⌘, in that order, no space before the key: `Ctrl Shift Z` is shown as ⇧⌘Z):

- **`Ctrl` is the Command key (⌘)**, so `Ctrl O` is ⌘O and `Ctrl Shift O` is ⇧⌘O. The real Control key (⌃) is not used by any shortcut: in a text box it moves the caret, as on the rest of the system.
- **`Alt` is the Option key (⌥)**. Option changes the character a key types (Option+Z types Ω), so a shortcut with Option goes by the key position: ⌥Z is the key that has Z on a US layout.
- In a text box the Mac's own editing keys belong to the box and are not shortcuts: ⌘Z, ⇧⌘Z, ⌘A, ⌘C, ⌘X, ⌘V, ⌥← ⌥→ (by word), ⌥⌫ ⌥⌦ (delete a word), ⌘↑ ⌘↓ (start or end of the text).
- Enter is ↩, Delete is ⌦, Backspace is ⌫, Esc is ⎋; Space, Home and End stay words.
- The shortcuts that are Windows conventions have no Mac counterpart yet: `Alt F4`, the menu bar's `Alt` / `F10`, and the Win key in the Screen Capture shortcut.
Status: ✅ implemented　⏳ to be done together with the corresponding feature

## General

| Key | Action | Status |
|---|---|---|
| `Ctrl+O` | Add files to the library (multiple selection allowed) | ✅ |
| `Ctrl+Shift+O` | Add a folder to the library | ✅ |
| `Ctrl+,` | Settings | ✅ |
| Drag into the window (anywhere) | Adds it to the library and jumps to it; files, folders and several at once all work; anything already in the library (or inside a folder in the library) isn't added twice and is simply located. Dragging onto the desktop shortcut and right-click → “Open with SnipToss” work the same way, and if the app is already running the request is handed to the running window | ✅ |
| `F5` | Refresh the library (files added to or deleted from folders) | ✅ |
| `Ctrl+↑` / `Ctrl+↓` | Previous / next item (in library order, collapsed folders included; the folder expands automatically when you switch into it) | ✅ |
| `Ctrl+B` | Collapse / expand the library on the left | ✅ |
| `Ctrl+Alt+B` | Collapse / expand the notes panel on the right | ✅ |
| `Ctrl+\` | Hide / show both side panels: if either is open, both are collapsed; only when both are collapsed are both expanded | ✅ |
| `Ctrl+Shift+A` | Copy notes as text (same as the button at the bottom of the notes panel and Edit → Copy Notes as Text): copies only the checked notes if any are checked, otherwise every open note listed in the notes panel (when the notes panel's scope is “Project”, that means the whole project); paste into a Codex / Claude Code conversation | ✅ |
| `Ctrl+Shift+I` | The same set, copied as images (same as “Copy as Images” at the bottom of the notes panel and Edit → Copy Notes as Images; “Copy Notes as Images” in the various right-click menus hands over only the note that was right-clicked): one image per note, for web-based AI and chat apps that can't read local files. With one image, the clipboard holds an image; with several, they are placed as image files (a web page takes several in a single paste); no text is included either way | ✅ |
| `X` | Check / uncheck the selected note (only checked notes are copied as text); you can also click the checkbox at the top left of a note card, `Shift`-click to check a range (it can span items), the checkbox of a group title checks all notes of one item, and “Select all” at the bottom of the notes panel checks or unchecks everything at once; the last `Esc` in its chain clears the checks. Checks are cleared only when the selection on the left changes (the notes panel changes scope); switching items inside a selected project does not clear them | ✅ |
| `Alt+F` `E` `V` `N` `P` `W` `H` | Open the menu bar's File / Edit / View / Annotate / Playback / Window / Help (the letters of the English and Chinese interfaces; other languages mark their own letters in the messages, for example in German `Alt+D` opens “Datei”, while Japanese, Korean and Russian use the same letters as Chinese — see `packages/web/src/mnemonic.ts`; for non-Latin keyboard layouts such as Russian the key is matched by position). First tap `Alt` (or `F10`, as in Windows) once to enter the menu bar — the mnemonic letters appear and “File” is highlighted — then press a letter, or use `←` `→` to move the highlight between menu names and `↓` / `Enter` / `Space` to open one; menu names are not in the `Tab` order (as in Windows programs). Inside a menu, `↑↓` choose (`Home` `End` jump to the first or last item), `←→` switch menus, `Alt`+letter switches straight to that menu, `Enter` / `Space` activate the item (on key down), `Tab` does not leave the menu, and `Esc` or `F10` again closes it, after which keyboard focus returns to where it was before the menu opened; while a dialog is open `Alt` does not enter the menu bar, and neither does holding `Alt` while clicking the mouse and then releasing it | ✅ |
| `F11` | Full screen / leave full screen (the Window menu also has Minimize, Maximize and Always on Top) | ✅ |
| Drag a side panel's edge | Adjust the width; dragging to the narrowest collapses it automatically; double-click the edge to restore the default width (widths and collapsed state are remembered) | ✅ |
| `?` or `F1` | Keyboard shortcuts | ✅ |
| `Esc` | Close a floating layer / cancel the current operation / leave the tool | ✅ |
| `Ctrl+P` | Find an item: the cursor goes into the library's filter box (expanding the library first if it is collapsed); type a few characters and press Enter to open the first match; ↓ moves into the list; Esc first clears the keyword and pressing it again leaves (File → Find Item…) | ✅ |
| `[` / `]` | Previous / next note (jumps automatically to its time or page); when the notes panel lists several items, going to a note on another item switches the canvas to that item | ✅ |
| `Ctrl+F` | Find notes: the cursor goes into the search box at the top of the notes panel (expanding the panel first if it is collapsed) and searches the note text and replies; separate several words with spaces (every word must match, case-insensitive); the matched text is highlighted on the cards. Enter selects the first match, ↓ moves into the list (on a card, ↑ ↓ go to the previous / next card and select it, Home / End jump to the first or last, and ↑ on the first card returns to the search box), and Esc first clears the text and then leaves. **While a search is active, “what is listed” means the matches**: Select all, and Copy as Text when nothing is checked, apply only to the matches; the counts on the scope switch do not change. When nothing matches, a message says so, and when resolved notes match, a “Show resolved notes” option is offered (Edit → Find Note…) | ✅ |
| `D` / `Shift+D` | Mark as done / mark as won't fix. **Applies to the checked notes when any are checked, otherwise to the selected note** (same rule as copying); if the target notes are already all in that state, pressing again reopens them (it toggles back and forth, like Gmail's “Mark as read”). When notes are checked, the bottom of the notes panel gains a row “Mark as Done / Mark as Won't Fix / Reopen”; changing notes across several items in one go is still a single undo step | ✅ |
| `1` ~ `6` | Change the mark color: 1–6 follow the order of the color swatches in Settings (orange, red, yellow, green, blue, purple). **Applies to the checked notes when any are checked, otherwise to the selected note** (same as `D`), and counts only notes that have a mark on the canvas (an overall comment or a note on an earlier version has no mark to recolor). Pressing the number of the mark color currently set in Settings = back to the default, after which the note follows the Settings value. “Color” in the right-click menu of a mark or card and Annotate → Mark Color are the same row of swatches (hovering shows the number key); a single click on a mark on the canvas also pops this row up next to it (see “Single-click a mark” under “Annotation tools” below). The marks on the canvas, the numbers in the notes panel, the playback bar, snapshots and Copy as Images all change; the color is written into the notes file (`color`) and can be undone. **For a note with several marks: click one of them on the canvas and then press the key to change only that mark** (written into that mark's own `color`; right-clicking that mark on the canvas shows “Color of This Mark”); pressing it with the note selected from the notes panel changes the whole note. Number keys are matched by key position: on a French layout the keys that type `&` `é` when pressed alone still count as 1, 2 | ✅ |
| `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y`) | Undo / redo (creating, editing, changing status and deleting can all be undone) | ✅ |
| `Ctrl+V` | Add from the clipboard (same as File → Add from Clipboard and right-clicking empty space in the library): files and folders copied in File Explorer = dragging them in; an image (copied from web-based AI or a chat app) is saved in the app's own “Pasted Images” folder (`%LOCALAPPDATA%\SnipToss\pasted`; nothing is added to your projects), appears in the library as a project of its own, and can be annotated as soon as it is opened. If the clipboard holds neither, a message says so. With the cursor in a text field, pasting text works as usual | ✅ |

## Screen Capture (anywhere on the screen)

A global shortcut that works in other programs too (also with the window closed, since the app stays in the tray). The default is `Ctrl+Alt+A` (the same combination as common screenshot tools; `Alt+A` is often taken by other programs). Windows treats AltGr as `Ctrl+Alt`:
if, on a keyboard layout installed on the computer, it types a character (such as ą in Polish), the app switches automatically at startup to `Shift+PrintScreen` (trying `Ctrl+PrintScreen` and then `Ctrl+Shift+PrintScreen` if that is taken) and shows a notice once;
a combination you record yourself is used as is even if it types a character, and the Settings page says which character it will block.
In Settings → Screen Capture, click the shortcut box and record a new one directly (while recording, `Esc` cancels and `Backspace` / `Delete` clear it). It can also be started from “Capture” at the right of the title bar, the File menu (Capture Screen…) and the tray's right-click menu.

| Key | Action | Status |
|---|---|---|
| `Ctrl+Alt+A` (changeable) | Start a screen capture: a frozen image is laid over each monitor | ✅ |
| Hover + click | Select the window under the pointer (the whole screen if there is no window) | ✅ |
| Drag | Pull out a box; drag inside the box to move it, pull the eight handles / edges to resize it; while dragging, the magnifier shows pixels and color | ✅ |
| `↑ ↓ ← →` | Move the selection by 1 pixel (10 with `Shift`); once something is drawn, the selection is locked | ✅ |
| `R` `O` `A` `B` | Rectangle / ellipse / arrow / pen; after drawing, a note box pops up next to the mark (words for the AI); with `Shift` held, rectangle and ellipse become a square / circle | ✅ |
| In the note box | Same as the main window's note box: `Alt+1~4` switch category (Change / Remove / Add / Question; a new note starts with the previous note's category), `Enter` saves (`Shift+Enter` for a new line); you can also click Save and Cancel. **While the box is open, keep marking in the selection with Pin / Rectangle / Ellipse / Arrow / Pen — all of it counts toward this note** (same number, title “Note 1 · 3 marks”, ADR-0009); `Alt+Z` removes the last mark added this way (Undo on the toolbar also removes it first). `Esc` means **don't write this note**: the box and arrow stay on the image (a screenshot can have drawings without notes) and a newly placed pin is removed along with it — in the main window `Esc` cancels the mark together with the note, because the main window has no marks without a note (each side keeps its own way) | ✅ |
| `M` | Pixelate (paint over what you don't want the AI to see) | ✅ |
| `T` | Text: write directly on the image; click elsewhere or press `Esc` when done | ✅ |
| `C` | Pin: click once to place a numbered dot and write words for the AI (same as the main window's Pin) | ✅ |
| `N` | Overall comment: words that don't refer to a particular position | ✅ |
| Click a number | Edit that note | ✅ |
| Click a mark (number or line) | Selects it (a blue dashed frame on a white ground; the pointer turns into a hand over it), and the row of colors on the sub-toolbar changes only it; if it has a note, that note opens at the same time. While the note box is open, clicking one of this note's marks also just selects it: the box stays open and no new mark is added (once a note marks several places, one of them can be given a different color so the note can refer to it). Clicking elsewhere, switching tools, right-clicking or pressing `Esc` releases it | ✅ |
| `1` ~ `6` | Change color (same order as the sub-toolbar: orange, red, yellow, green, blue, purple; the numeric keypad works too): with a mark selected it changes only that mark and the color for later drawing stays as it was (same as the main window); with nothing selected it sets the color for later drawing. Digits typed in the note box are text | ✅ |
| `Ctrl+Z`, “Undo” on the toolbar | Undo the last stroke (while the note box is open it first just cancels the note being written; while a text box is open it undoes the text being written); changing a mark's color counts as a stroke. There is no redo: `Ctrl+Shift+Z` is not handled | ✅ |
| `Enter`, double-click inside the box, `Ctrl+C`, ✓ Finish | Finish: the image goes to the clipboard (with the numbered notes attached below it when there are notes) and a copy of the screenshot is saved. When “Include notes in the image” is turned off in Settings, the notes are not attached below the image; the image and the text for the AI both go to the clipboard instead | ✅ |
| `Esc` | With a mark selected, first releases it; otherwise cancels the capture (if notes were written, a warning comes first and a second press discards them); right-click = select again (while nothing has been drawn yet) | ✅ |

Pasting: both the Codex desktop app and Claude Code take `Ctrl+V` and paste an image (text on the clipboard does not come through), which is why the notes are written below the image.

## Library (left panel, when focused)

The list holds the files and folders you drag or add, **grouped by project** like the Codex / Claude Code sidebars: project = the folder where the notes are stored (the one holding `.sniptoss`);
whatever is dragged in is filed under its project automatically, and a project's notes are stored together. Removing and clearing only take things out of the list and never delete files. Pinning is per project; pinned projects are listed first and are kept when the list is cleared.
Mouse: clicking a project or folder selects it (expanding it if it is collapsed, and, if the item open on the canvas isn't inside it, opening the first item inside it that has open notes); it collapses only if clicked again while it is already the only selection;
double-clicking a project or folder expands / collapses it once (as in File Explorer); the small arrow on the left expands / collapses it directly. Hovering a project shows “Pin to Top” and × (remove from the list); hovering a separately added file shows ×.
If a subfolder is added first and its parent folder later, the subfolder merges into the parent (an item is listed in one place only); files that scanning skipped inside a folder (hidden ones, ones inside folders such as `bin` or `dist`,
kinds turned off in Settings) can be dragged in individually and are listed after the project tree. The filter matches name, containing folder and project name; after the filter is cleared, whatever was selected while filtering stays selected in the tree.
**Multi-select** works as in File Explorer: a click selects only that row (and opens it), `Ctrl`-click adds or removes, `Shift`-click selects a range, **holding the left button and dragging draws a selection marquee** (`Ctrl`-drag adds;
dragging to the top or bottom edge of the list scrolls it automatically; starting on a row also works, and a press without dragging is still a click), `Ctrl+A` or right-click on empty space → “Select all”; **clicking empty space in the list** (or `Esc`) returns to selecting only the item open on the canvas.
When a marquee or select-all finishes and the item open on the canvas is not among the selected ones, the first selected item that has open notes is opened.
**The notes panel on the right** has its own switch at the top, “This video / Project” (the default is Project, grouped by item; inside each item the notes are split into the sections “Canvas marks / Timestamped notes / Overall notes / Notes on an earlier version” (timestamped notes exist only on videos);
clicking a section title collapses it; the funnel in the search box filters by type and chooses whether resolved notes are shown; collapsed sections and filtered-out or unmatched notes all count as not “listed”). If several items are selected here, the notes panel temporarily lists the selected ones (an extra cell “Selected” appears at the top),
and clearing the multi-selection or switching back at the top restores it. Clicking a group title opens that item; clicking a note on another item also switches the canvas to that item, and the selection on the left does not change.
The list's actions are all in the **context menu** (there are no buttons on the title bar; with the keyboard, `Shift+F10` or the Menu key opens the menu for the row under the cursor): right-clicking a project gives Copy as Text, Copy as Images, Add Folder Comment…, Collapse / Expand, Pin to Top,
Open Project Folder / Open Notes Folder and Remove Project from List (a folder row also has “Add Folder Comment…”; when copying as text, the folder comments of that folder and its subfolders go along with it);
right-clicking an item or a folder gives Copy, Show in File Explorer and so on; right-clicking one of several selected rows makes Copy and Remove apply to all selected rows;
right-clicking empty space gives Select all, Add Files / Folder, Add from Clipboard, Refresh, Mark All as Seen (only when there are items marked “New”), Collapse All and Clear Library…. Remove and Clear both show a confirmation dialog first (Enter confirms, Esc cancels),
and focus returns to the list afterwards; pinned projects are not cleared.

**Copy Notes as Text** (no button on the toolbar; the button is at the bottom of the notes panel, next to the checking). The scope follows just one rule:
**anything checked = the checked notes; nothing checked = every open note currently listed in the notes panel**. The “Copy as Text” button at the bottom of the notes panel, `Ctrl+Shift+A` and the Edit menu all follow it
(how many are checked is written at the bottom left as “N selected” and may span items; when the notes panel's scope is “Project”, that means the whole project, including folder comments and the “Item missing” group).
To hand over just one thing: right-clicking a note (a mark on the canvas, a card in the notes panel) or a card's copy button = that one note; **right-clicking the canvas = the item shown on the canvas** (the same as right-clicking its row in the library; the context menu holds only options that are useful); right-clicking a row in the library = that row
(project = the whole project, the same as the notes panel's “Project” hands over; folder = all the items in it, together with the folder comments of that folder and its subfolders);
with several rows selected in the library, right-clicking one of them = what the notes panel is listing at that moment (the “Selected” cell at the top). “Copy as Images” (`Ctrl+Shift+I`) has the same scope. The message shown after copying says how many notes were handed over.

| Key | Action | Status |
|---|---|---|
| `↑` / `↓` | Previous row / next row (landing on an item opens it) | ✅ |
| `→` / `←` | On project and folder rows: expand / collapse, and `←` on a folder inside another goes back up one level; on an item row they keep their usual meaning, stepping frames (video) / switching items (image), and after clicking an item row you do not need to click the canvas again | ✅ |
| `Enter` / `Space` | Open the item, or expand / collapse a project or folder (same as a mouse click: when a folder is opened the cursor stays on the folder, and pressing again collapses it); `Space` on the row of the item open on the canvas plays / pauses (click a video row and press Space to play right away) | ✅ |
| `Home` / `End` | First row / last row | ✅ |
| `Shift+↑` / `Shift+↓` | Extend the selection over consecutive rows | ✅ |
| `Ctrl+A` | Select all | ✅ |
| Hold the left button and drag | Marquee select (`Ctrl`-drag adds) | ✅ |
| `Ctrl+C` | Copy the open notes of the selected rows as text: project = the whole project, folder = all items in it (with the folder comments), item = itself; with several rows selected = what the notes panel is listing at that moment | ✅ |
| `Delete` | Remove the selected projects or entries from the list (confirm first; files and notes are not deleted). `Backspace` does nothing in the list (so it does not delete the note selected on the canvas) | ✅ |
| `Esc` | During a multi-selection, return to selecting only the item open on the canvas (same as clicking empty space in the list) | ✅ |
| `Shift+F10` / Menu key | Open the context menu of the row under the cursor (things that exist only in the menu — Pin to Top, Locate…, opening the folder — can be done from the keyboard too) | ✅ |

## Annotation tools (shared by images, videos, PDF, slides and screenshots)

| Key | Action | Status |
|---|---|---|
| `V` | Select: click a mark to select its note; once selected, drag it to move it and drag the white handles to resize it (8 on a box, the two ends of an arrow); **dragging on empty space = drawing a rectangle** (same as `R`; the note box pops up as usual — Select is the default tool, and a beginner who drags on the image should get a reaction). To pan, use the Hand, hold `H`, or use the middle button or the wheel | ✅ |
| `H` | Hand: drag the canvas (the cursor is a hand) | ✅ |
| Hold `H` | Temporarily switches to the Hand; releasing it returns to the previous tool; only a plain tap of H switches to the Hand for good (like “hold a tool key to use it temporarily” in Photoshop). Space is not used for holding because it conflicts with Space for video playback | ✅ |
| `C` | Pin: click once on the canvas and write the note on the spot (right-clicking empty canvas → “Add Note Here…” also drops a pin at the right-click position and pops up the note box directly) | ✅ |
| `R` | Rectangle: drag out a rectangle | ✅ |
| `B` | Pen: circle things freehand | ✅ |
| `A` | Arrow | ✅ |
| Hold `C` `R` `B` `A` | **Hold mode** (Settings → Advanced → “Hold to switch tools”, **off by default**, only takes effect when turned on; while it is off, a single press switches tools and does not switch back by itself): while held, temporarily switches to that tool and marks as usual; on release, returns to Select (whatever the previous tool was), and a half-written note carries on — the note box takes focus only after release, so the held letter is not typed into it. A hold counts if the tool was used while the key was down or the key is held for more than 0.35 seconds; a plain tap still switches for good. Unlike holding `H`, which returns to the previous tool on release | ✅ |
| `T` | **Timestamped comment** (video only): about the current video frame, with no position. In the note box, `O` can turn it into a time range, and removing the time with × turns it into an overall comment. The notes panel has a separate section “Timestamped notes”, sorted by time; it is not drawn on the canvas (it has no position), but the playback bar has a dot for it. The “Timestamped” button on the toolbar for videos, Annotate → Add Timestamped Comment… and the canvas right-click menu do the same thing. `M` is mute, hence T (Time) | ✅ |
| `N` | Overall comment: no position, about this **one** item shown on the canvas (on a video = the whole video, with no time) | ✅ |
| `Shift+N` | **Folder comment**: the folder that holds the item shown on the canvas, covering every item in it (subfolders included). For other folders and the whole project, right-click their row in the library → “Add Folder Comment…”; the Annotate menu has it too (not on the canvas right-click: that click is on this item, and the entry there would be confusing). When the notes panel is set to “Project” it is listed first as a group of its own (group title “Whole folder”); when it is set to “This image” / “This video” it is not listed, but a line at the top says how many folder comments the item's folder has (“N folder comments”), and clicking “View project” there switches to the whole project | ✅ |
| `Enter` / `Ctrl+Enter` | Save the note being written; `Shift+Enter` for a new line (as in Screen Capture and AI dialogs; while an IME is choosing characters, Enter belongs to the IME). When focus is not in the note box, use `Ctrl+Enter` | ✅ |
| `Alt+1` ~ `Alt+4` | While writing a note, switch category: Change / Remove / Add / Question | ✅ |
| `Alt+Z` | When a note has several marks, remove the last one placed (the ↶ beside “3 marks” in the note box's title row does the same; when only one mark is left it is not removed — what you want then is to cancel the whole note). **While the note box is open, keep drawing on the canvas and it all counts toward this note** (when many places need the same change, you don't have to say it several times; ADR-0009): the same number, and Pin, Rectangle, Arrow and Pen all work (switch on the toolbar; dragging on empty space with Select draws a rectangle too), the note box does not move and focus returns to the input; right-click one of the marks → “Remove This Mark”. An overall comment or timestamped comment (which have no marks) cannot be drawn on while open | ✅ |
| Single-click a mark | **Changes the color of this mark** (the same as clicking a mark in Screen Capture): a blue ring appears around the number, and a row of 6 colors pops up next to the number (above it, or below if there is no room or it would cover the note box); click one to change to it, and the bar stays open; `1`–`6` match the swatches. For a note with several marks only the clicked one changes; for a note with a single mark the whole note changes. Both numbers and lines can be clicked; with Select, clicking an existing mark selects it, and **with a drawing tool, clicking on a mark without dragging also counts as clicking it and does not drop a new mark** (a drag draws as usual); while the note box is open, clicking one of the marks being written also works, and the box does not close (clicking another note's mark still adds a mark to this one). Clicking elsewhere or pressing `Esc` closes the bar (`Esc` closes only this row and does not cancel the note being written). It does not pop up while a mark is being dragged to move it, nor on read-only items | ✅ |
| `↑` `↓` `←` `→` | Nudge the mark selected by clicking on the canvas by 1 pixel, or by 10 with `Shift` held (the new position is shown beside it). A mark selected from the notes panel does not count; ← → still step frames / switch items | ✅ |
| `Delete` / `Backspace` | Delete a note (confirm first; to delete everything the notes panel lists, right-click empty space in the notes panel or use “Delete All Notes…” in the Edit menu; a deletion can still be undone with Ctrl+Z, and deleting several at once is also a single step). **Deletes the checked notes when any are checked, otherwise the selected note** (same as `D`); when notes are checked, the row at the bottom of the notes panel also has “Delete” (pick which ones to delete yourself when cleaning up notes, rather than by whether they have been handled) | ✅ |
| `Enter` | Edit the selected note; when a mark has been drawn but the note box has not opened (“Open the note box after drawing a mark” is turned off in Settings), starts writing the note | ✅ |
| `Esc` | Close the color bar popped up by a single click on a mark → cancel the note being written → return to the Select tool → deselect | ✅ |

After a mark is drawn, the input appears next to the mark automatically and you can just type (can be turned off in Settings). When one comment covers several places, keep marking on the canvas while the note box is open (see `Alt+Z` above). Every tool has a button on the toolbar, and hovering shows its shortcut.

Pixel precision: pins, rectangles and arrows snap to whole pixels of the item (freehand does not snap, so the line stays smooth); while drawing, moving or pulling a handle, the pixel position and size are shown beside the pointer.
To mark precisely, zoom in first (Ctrl+wheel); at 100% one screen pixel = one pixel of the item.
The pointer of the drawing tools is a rounded arrow plus a small tool badge (for the Pin tool, a pin); the tip is the point where the mark lands, and the color follows the mark color (the one in Settings; a color changed on a single note does not affect the pointer).

You can start a stroke from the empty area outside the canvas: while drawing it follows your hand (the part outside the canvas is visible too), and on release only the part inside the canvas is recorded —
a box keeps the area that overlaps the canvas, an arrow keeps the segment inside the canvas, and a freehand stroke is clipped to the canvas (if it leaves and comes back it is split into several segments, and never runs as a straight line along the edge).
If it is entirely outside the canvas it does not count; with the Pin tool, a click outside the canvas does not drop a pin.

## Canvas (images, videos; later PDF and slides)

The default is “Fit to Window”: shown in full and following the window size; where it doesn't fill the space, the surround is filled with a blurred copy of the canvas itself (Settings → General can switch it back to a solid color).
The small control at the bottom right shows the current scale; clicking the scale opens a menu: Fit / Fill / 50% / 100% / 200% / blurred-surround switch.

| Key | Action | Status |
|---|---|---|
| `←` / `→` (images) | Previous / next item (when focus is on a folder or project row in the library, expand / collapse instead) | ✅ |
| `Ctrl+Wheel` (trackpad two-finger pinch) | Zoom around the mouse | ✅ |
| `Ctrl+=` (`Ctrl++` also works) / `Ctrl+-` | Zoom in / out (written `Ctrl +` `Ctrl -` in menus and tooltips) | ✅ |
| `Shift+1` or `Ctrl+0` | Fit to window | ✅ |
| `Shift+2` | Fill the window: covers the whole canvas area, and the overflow is seen by scrolling the wheel or dragging with `H` held; also follows the window size | ✅ |
| `Shift+0` | Actual size (100%) | ✅ |
| Double-click the canvas | Fit to window ↔ 100% | ✅ |
| `Shift+H` | Show / hide the marks on the canvas (for when marks overlap and you want to see the original): the same as the eye at the far left of the zoom bar at the bottom right of the canvas and View → Show Canvas Marks. While they are hidden the zoom bar says “Marks hidden”; the selected note still draws its mark (after hiding everything, clicking one note = seeing only that one). To hide just one: the eye on a note card on hover, or right-click → “Hide Mark”. All of these only change how things are viewed, do not change the notes files or copying, and everything is shown again after the app restarts | ✅ |
| Drag with the Hand tool / middle-button drag / wheel (when zoomed in) | Pan (with the Select tool, a left-button drag on empty space draws a rectangle) | ✅ |
| Hold `H` and drag | Pan (works with any tool) | ✅ |

## Video

| Key | Action | Status |
|---|---|---|
| `Space` / `K` | Play / pause (acts on key down; holding the key does not toggle back and forth) | ✅ |
| `J` / `L` | Back / forward 5 seconds | ✅ |
| `←` / `→` | Previous / next frame (pauses first) | ✅ |
| `Shift+←` / `Shift+→` | Back / forward 1 second | ✅ |
| `Home` / `End` | Jump to the start / end | ✅ |
| `,` / `.` | Slower / faster (0.25× to 2×) | ✅ |
| `M` | Mute / unmute (there is a volume slider next to the mute button; the volume and the mute state are both remembered) | ✅ |
| `↑` / `↓` | Volume up / down 10% (when muted, `↑` also unmutes, while `↓` only shows the “Muted” notice and leaves the volume alone) | ✅ |
| `Ctrl+L` | Loop / stop looping (as in Premiere; a plain `L` is forward 5 seconds). It can also be toggled with the loop button to the right of “1×” on the playback bar, the Playback menu, and Settings → Annotations; it is remembered and stays the same when you switch videos or restart the app. It is a setting, so it can be set in advance while on an image or with no video open (a toast confirms it) | ✅ |
| `Alt+I` / `Alt+O` | While writing a note: set the video's current position as the start / end of this time range (when the cursor is not in the input, a plain `I` / `O` also works; you can also click the time in the input or “Set as range”). By default a note corresponds only to the moment the mark was drawn; set a range only when the comment covers a span (for example, a subtitle from when it appears to when it disappears) | ✅ |
| `C` `R` `B` `A` `N` during playback | Automatically pauses on the current frame and enters the corresponding tool (when Settings → Annotations → “Pause video when choosing an annotation tool” is on; on by default) | ✅ |

## PDF / slides

| Key | Action | Status |
|---|---|---|
| `←` / `→`, `PageUp` / `PageDown` | Previous page / next page | ⏳ |
| `Home` / `End` | First page / last page | ⏳ |

## Web pages

A web page is a real page that can be clicked and scrolled normally; to annotate, switch to “pick element” mode.

| Key | Action | Status |
|---|---|---|
| `Ctrl+Shift+C` | Toggle “Browse” / “Pick element to annotate” (the same key as the element picker in the browser's developer tools) | ⏳ |
| `Esc` | Return to browsing | ⏳ |
| `F5` / `Ctrl+R` | Refresh the page | ⏳ |
| `Alt+←` / `Alt+→` | Back / forward | ⏳ |

In pick-element mode, the single keys of the group “Annotation tools” above still work (for example, `R` for a free-form rectangle, not limited to one element).

# SnipToss Interface Design Rules

Status: applies in full to the main interface (menu bar, library, toolbar, canvas, playback bar, notes panel, note box, menus, tooltips);
Settings, Keyboard Shortcuts and confirmation dialogs only need to use tokens (levels B / C) · Version: 2026-10-16
Principle: **a value that is not in this file is not a legitimate decision.** To use a number the tables don't have, first add an entry here (with the derivation and measurements), or go back to a value from the tables.
A judgement made after seeing the finished UI may amend this file (state the reason and record it in the change log).

The actual token values are at the top of `packages/web/src/styles.css`; `node scripts/check-design.mjs` checks the CSS for values outside the tables.
It cannot check alignment or translucent overlays: measure those in the running UI and inspect magnified screenshots (see “Checks” at the end).

These rules were written for the Chinese interface text. Where a rule is specifically about Chinese typography or wording, the Chinese characters are kept in the examples; other examples are translated.

## 0 · Frame of reference

- **F1 Which world it belongs to**: a desktop review table, like Frame.io's review panel or Figma's comment layer. The item is the star; the interface is the dark table around it,
  with tools on both sides that don't compete with the canvas for attention.
- **F2 What it is not**: not a web admin console (screens of cards, gradient buttons), not an IDE or terminal (monospace type, one character per cell).
  Lists (library, notes) are flat rows: hover raises a background, only the selected row stands out; no stacks of outlined cards. List entries use an arrow pointer, not a hand.
  The pointer over the canvas is not a crosshair either: too much like engineering software, no warmth.
- **F3 Direct communication**: a control says what it does at a glance; the copy is professional and concise, understandable to a beginner without being chatty (see “6 · Copy”), and avoids ambiguous words
  (“end point” is easily read as the end of the video).
- **F5 Signature**: **note orange** (`--mark`, which users can change in Settings) belongs only to “the note itself”: the marks and numbers on the canvas, the note positions on the playback bar,
  the outline of the selected note entry and the number on it, and the small dot before the open count in the library. The one exception is the background of the × at the top right of Settings on hover (see S4). Every other interaction (selection, checking, primary button, progress, focus)
  uses blue (lines and text `--accent`, solid fills `--accent-fill`). **Blue is for interaction only**: the category “Change” uses purple, and the icons for item kinds are always neutral gray (told apart by shape alone).
  Exception: the blue and orange in the **logo** (app icon, the combined logo at the top of the library) are brand colors that follow the icon master `design/icon/sniptoss.svg` and the `Wordmark` component, and do not change with the note color the user picks.
  The space around the canvas can be filled with a blurred copy of the canvas itself (`Ambient.tsx`; Settings can switch it back to a solid color).

## 1 · Gates

**G1 Chinese text size ≥ 12px**
- Derivation: on a 1× display (`devicePixelRatio = 1`), Microsoft YaHei UI strokes at 11px clump together.
- Measured: the footer “4 projects · Images 5 · Videos 4”, the path subtitles and the category on cards were all 11px; magnified, the strokes clump.
- 11px (`--fs-micro`) is only for densely set pure digits and code: pixel readouts, the hover time on the playback bar, code snippets in Settings.
- Counter-examples: path subtitles at 11px; keycaps at 11px (keycaps contain “Hold H” and “Wheel”).
- A related trap: **when a whole element has `opacity < 1`, the text inside falls back from ClearType to grayscale antialiasing**, looking blurry and disabled
  (measured: the zoom bar at 0.6 when idle; the text chroma dropped from 168 to 0). Permanent elements are not faded as a whole; only the disabled state uses `--disabled`.

**G2 Text contrast ≥ 4.5:1, measured against the background it actually sits on**
- `--muted` went from `#74747c` (3.71:1 on the side-panel background) to `#8a8a92`, then to `#92929a` (side panel 5.56, hover background 4.62, selected row 4.56, card 5.07;
  `#8a8a92` was only 4.1 on hover and selected rows, so hovered project paths and menu shortcuts failed).
- **White text on a solid blue** (primary buttons, “Save” in the note box) uses `--accent-fill #386be0` (4.83:1), hover `#3b6fe8` (4.54), pressed `#3567dc` (5.09).
  White on `--accent #5b8cff` is only 3.16, so `--accent` is only used for lines and text (5.43 on the side panel). The current tool, checked checkboxes and switches that are on also use solid blue: one blue per thing.
- With a blurred surround, the darkening under the playback bar goes up to 160px at 0.75 so the timecode has enough contrast on a bright canvas.
- Exceptions: the disabled state is not counted; the white note number on note orange is only 2.85:1 — the color is chosen by the user, and the number is recognized by shape (circle / pin) and position, so it is not adjusted separately.

**G3 State is not conveyed by color alone**
- Selection needs a change of shape or outline, not just a darker shade of the same background.
- Counter-examples (fixed): the category buttons in the note box had a 16% colored background at rest and 22% when selected; a selected tab was only `#232327` on `#1b1b1e` (1.09:1).
  Now: categories are gray text + a colored dot at rest, and only the selected one gets the category color as background and outline; selected items in tabs and wells are a light background + an outline.
- The selected library row: `--accent-soft` background + a `--accent-edge` outline (measured: with the background alone, the luminance differs from hover by only 4% in grayscale).
  Several consecutive selected rows merge into one block, outlined only around the outside.
- **Focus**: always `--accent`, 2px. Small controls (buttons, checkboxes) draw it outside (offset 2); large areas (inputs, lists) draw it inside (offset −2);
  the keyboard cursor in a list is 1px (rows are adjacent; 2px is too heavy). Don't hard-code `rgba(91, 140, 255, …)`.

## 2 · Structure

**S1 Rhythm unit 4px.** Body text 13px on a 20px line height = 5 units; controls of 24 / 28 / 32 = 6 / 7 / 8 units.
A half step of 2px is only for tight gaps between controls (between buttons inside a well — a recessed group such as the tool group — and the well's own padding).

**S2 Type scale** (only these levels; line heights are always whole pixels)

| token | size / line height | role |
|---|---|---|
| `--fs-micro` | 11 / 16 | densely set pure digits and code: pixel readouts, hover time on the playback bar, code in Settings |
| `--fs-caption` | 12 / 16 (18 for running text) | secondary information: paths, footers, hints, categories, timecodes, counts, numbers, keycaps |
| `--fs-body` | 13 / 20 | interface default: list names, note text, menu items, buttons (including 28-high compact buttons); menu names in the title bar (as in Codex) |
| `--fs-title` | 15 / 22 | dialog titles, the main line of an empty canvas, the speed indicator in the middle of the canvas |
| `--fs-heading` | 18 / 26 | Settings page titles, the drop hint |
| `--fs-display` | 30 / 1 | **logo only**: the product name in Settings → About (twice the 15 at the top of the library) |

The Chinese product name (超级批注) uses its own brand font (Noto Sans SC Medium, subset to just those four characters by `scripts/build-brand-font.mjs`) with 0.03em letter spacing,
not the interface font: 15px bold Chinese clumps into a dark smear, and Medium plus a little tracking comes closest, on a 1× display, to the weight of a Codex title (compared 1:1 in the window against nine candidates).
This font has a single weight, so writing 400 in the CSS means “use it as it is”, not the interface font's 400.

- 12 and 13 differ by only 1px, and the eye can't tell them apart as two levels — **when two adjacent levels appear together they must also differ by one color level** (13 uses `--text`, 12 uses `--text-2` or `--muted`).
- Only the weights 400 and 600. Microsoft YaHei UI has no 500: writing 500 leaves Chinese unchanged and makes Latin text bolder, so a single word gets mixed weights.
- **Button text is always 400, including the primary button** (as with WinUI's accent button; the blue fill is what sets it apart): white 600 text is the heaviest text in the notes panel and makes the button look a size larger than the text beside it.
  The same goes for “Finish” and “Save” on the capture overlay (WPF). Exception: the danger button in a confirmation dialog (red text on a pale red fill) is 600 — it has no solid fill, so weight and color set it apart.
- Derivation: when the line height is fractional (the old `1.5` gave 19.5px), text lands on half pixels.
- Counter-example: 12.5px menu bar text (a half-pixel size).

**S3 Spacing comes only from the table**: `2 4 6 8 12 16 20 24 32 40 48`. 1px is only for outlines and dividers.
- **Tight inside, loose outside**: spacing inside a group ≤ half the spacing between groups. Example: in the library, rows of the same project are 0 apart and projects 8 apart;
  in a note entry the title row and the body are 8 apart, and entries are 12 + 2 + 12 apart (the entry's own padding + a 2 gap, so the hover and selected backgrounds don't touch).
- Icon and text: 6 in 24 / 28-high controls, 8 in 32-high controls. **A dot and the text it labels: 4** (6 reads as two separate things).

**S4 Size table**

| use | height |
|---|---|
| Checkbox (note entries, “Select all” at the bottom of the notes panel): corner radius 4, an unchecked box is a `--muted` outline, checked is an `--accent-fill` fill with a white tick; the click area on an entry extends 4 on every side | 16 |
| Badges and labels (numbers, categories, the statuses “Done / Won't fix”, “Overall”, keycaps) | 20 |
| Small controls (inline actions, actions on a note entry, the clear button, the time in the note box) | 24 |
| The × at the top right of confirmation and info dialogs: 8 outside the content line on the right, the glyph's edge on the content line; vertically on the same center line as the title row | 28 |
| The × at the top right of Settings: like the close button at the top right of a window, flush with the top and right edges (the dialog's corner radius clips its corner); on hover the whole block turns `--mark` and the cross turns white (the same color as the marks on the canvas); the scrollbar of the content area starts below it. No dialog × shows a tooltip (everyone knows ×); the name is for screen readers only | 46 × 32 |
| Compact controls (tool buttons and options inside a well, list rows, the search box, zoom buttons, compact buttons; “Select all”, “Copy as Images” and “Copy as Text” at the bottom of the notes panel; group titles, section titles and the filter row of the notes panel) | 28 |
| Standard controls (buttons, inputs, menu items, playback bar buttons); **everything in the title bar** (buttons, tabs, the tool-group well) | 32 |
| The title bar at the top of the window (menu bar + Capture + the three window buttons) and the two side footers: **+ 1 for the line**; the line doesn't eat into the content, which is a full 32 | 32 + 1 |
| Menu names and “Capture” in the title bar: the hover background block | 28 |
| The three window buttons (minimize / maximize / close): as in the system, 46 wide, as high as the title bar, 10px line glyphs | 46 × 32 |
| On the Mac the title bar has no window buttons of its own: the system's three (12 each, 8 apart) sit over its left end, and the strip leaves this much width for them (`--mac-traffic-inset`); in full screen they are hidden and the width is released (to be checked on a real Mac) | 78 |
| The title bars of the three columns (library / toolbar / notes), whose lower edges join into one line: **+ 1 for the line**; 32 controls with 6 above and below | 44 + 1 |
| The “hand off to AI” action bar at the bottom of the notes panel (“Select all” + the primary button, both 28, 8 above and below), + the line on its upper edge; the footer right below it draws no upper line. The button isn't 32: it is an action under a list, and a 32 blue block holding only 13px text looks empty and a size larger than the text beside it | 44 + 1 |
| The logo at the top of the library: icon 20 (on a 1× display the version drawn on the pixel grid, on high-DPI displays the vector master) + gap 8 + product name 15; doubled in Settings → About | 20 |
| Playback bar: the top 16 is the gap to the canvas (the time bubble floats there: on hover, drag and click it follows the mouse, on keyboard seeks it follows the playhead; 15 / 600, `--floating` background); the controls, the track and the orange note bars above the track are all in the lower 32 | 48 |

Icons: 16 is the norm; 14 when set beside 12px text (footer links, row actions); 12 for the clear cross and the small dropdown arrow inside a button.
The expand arrow in lists is 16 (its ink is about 8 × 5): at 12 the ink is only 6 × 4 and doesn't look clickable.

**S5 Alignment: every column has a content line, and it only counts once measured** (measured from the column's inner edge, outline excluded)
- **Container edge 8**: clickable background blocks (library rows, the search box, note entries, tabs, toolbar buttons, menu bar items) sit 8 from the column edge, **on both left and right**.
  In scrolling lists (library, notes panel) the right-hand 8 is given to the scrollbar: the scrollbar is 8 wide and `scrollbar-gutter: stable` always reserves it,
  so a row's right edge is always on the 8 line and does not narrow when the list grows a scrollbar.
- **Library content line 16**: title text, the search icon, the expand arrow of project rows, footer text = 8 + control padding 8. The first label of the menu bar is at 16 as well.
- **Notes panel: two lines**: 20 (entry 8 from the edge + 12 padding) holds the checkbox, the text of the first cell of the scope switch at the top (well padding 2 + option side padding 10, an exception registered in `check-design`), and the icons in the footer;
  **44 (= 20 + checkbox 16 + 8) holds all text**: the entry's number, body and replies, “Select all / N selected” at the bottom, “Saved in” (a 14 icon placed in a 16-wide cell).
  The checkbox has its own column on the left and the text another — the same grammar as the left panel's “icon column, text column”, and also how Frame.io and Figma lay out their comment panels (F1).
  When the notes panel is grouped by item (a project or several items are selected on the left), group titles sit on the same two lines: the group's checkbox at 20, the item name (13 / 600) at 44,
  followed by gray text with the folder it is in (prefixed with the project name when spanning projects), and the count on the right; the group open on the canvas has an `--accent` vertical bar on its left, like “currently open” in the library.
  16 between groups (2 between entries inside a group); group titles stick to the top (`top: -8` covers the notes panel's top padding).
  **Sections inside a group** (canvas marks → timestamped comments → overall comments → notes on earlier versions; timestamped comments exist only on videos): each section has a title row, also on the same two lines — the collapse arrow (16) at 20 and the name (12 / 600 `--text-2`) at 44,
  the count right after the name (`--muted`), then a 1px `--border` line stretching to the right: it shows at a glance where a section starts and is one level lighter than the group title (13 / 600 `--text`, sticky).
  The whole row is a button (hover `--hover`), with 8 extra between sections. When filtering by type, the row under the search box has: a funnel icon at 20, “Showing only …” at 44, and “Clear filter” as blue text on the right.
- **Canvas column**: the first and last buttons of the toolbar and the playback bar are 8 from the edge (icons at 16); **the tool group is exactly centered in the canvas column**
  (the left and right blocks are `flex: 1 1 0`, equal width; the left one holds the side-panel button and the file name).
  The zoom bar at the bottom right is a visible box: **align the box's edge with the glyph edge of the toolbar icons** (both at 16), not the “+” inside the box.
  The leftmost cell of the zoom bar is the eye for “show / hide canvas marks”, separated from the zoom buttons by a vertical rule; when marks are hidden this cell widens and reads “Marks hidden”, with a light background + outline (the same as a selected cell in a well, G3).
  It controls how the canvas is displayed, so it sits with zoom and not in the centered tool group of the toolbar (that is “what to draw”).
  **When the canvas is “fit”, the margin is also 16**, for images and videos alike (the `margin` of `ZoomView`; the video is already padded by 16 outside, so pass 0); centered positions are rounded.
- **The bottom row of the window**: the text of the two side footers and the playback bar's controls share one center line (the playback bar's controls sit in the 32 below it).
- **Tree**: indent 20 = a child row's expand arrow sits exactly under the parent row's icon (arrow 16 + 4 + half of the 16 icon).
- **Optical correction**: the action bar of a note entry floats at the right of the title row, extending 6 beyond the right edge (button padding 4 + 2 of inset in the glyph itself),
  so the glyph edge of “⋯” aligns with the right edge of the body text; `top` 10 = padding 12 − (button 24 − title row 20) / 2, on the same center line as the title row. Valid only for this set of 16px line icons.
  **The 66 at the right of the title row belongs to the action bar on hover** (the copy-as-text and “⋯” buttons + a 16 fade on their left): nothing that still needs reading on hover is placed there.
  At the narrowest notes panel (240), the text of the title row (number, category, “Overall”) reaches 164 at most and the action bar starts at 159, overlapping only the few palest pixels of the fade.
  No more action buttons can be added: each one adds 26 to the left, which in a narrow panel first covers “Overall” and then the category. The time of a video note goes at the start of the body (as in Frame.io), not in the title row.
  **Exception: entries in the canvas-marks section** have one more button, an eye (hide this mark on the canvas), and the action bar is 92 wide: entries in this section have no “Overall” label,
  so at 240 wide the category reaches 127 at most (the longest across languages is Russian “Изменить”; English is 121), the action bar starts at 134 (the head of the fade), and the category isn't covered (measured language by language at 240 wide). Other sections keep two buttons.
  An entry whose mark is hidden shows a struck-through eye (14, `--muted`) after the category at all times, not only on hover.
- **Note entry padding 12 / 12 / 8** (top, sides, bottom): the lower part of a 20-high body line is empty by about 4, so the ink ends up 12 from both top and bottom; this shows when the entry has a background.
- Counter-examples (fixed): left panel title 14, search box 10, list 6, footer 14 — four lines; the tool group 22px off to the right; the timecode 7.5px higher than the footer text;
  list rows 10 shorter on the right than the search box (the space went to the scrollbar); images 24 from the edge and videos 16, so the canvas edge jumped when switching items; the Settings × 9 higher than the page title;
  the Settings × lined up with the page title beside it, 23 from the top (it didn't look like it was in the corner, too low); moved to 11 from the top and right it still didn't reach the corner; a dialog × showing a “Close (Esc)” tooltip on hover.

**S6 Concentric corner radii**: when a child is ≤ 4px from its container's edge, container radius = child radius + gap.

| token | value | used for |
|---|---|---|
| `--r-tag` | 4 | keycaps, status labels (Done / Won't fix), the hover time on the playback bar, the clear button, code snippets |
| `--r-control` | 6 | buttons, inputs, list rows, tabs, menu items, tooltips |
| `--r-group` | 8 | wells (6 + 2): tool group, category picker, zoom bar; note entries, toasts |
| `--r-menu` | 10 | menus (6 + 4), all four corners the same |
| `--r-dialog` | 12 | note box, dialogs, Settings, the drop frame |

Round badges, switches and dots use `999px` / `50%`; small parts under 8px (playback bar track, handles) use 2px.
Consecutive selected list rows merge into one block, with no rounded corners at the seams.

**S7 Light and shadow**: only two levels of drop shadow, with light from straight above.
`--shadow-pop` (menus, tooltips, toasts, the zoom bar, the pixel readout); `--shadow-dialog` (note box, dialogs).
Small things on top of the canvas (numbers, handles, the playhead) use `--shadow-on-media`; numbers also get a 1px `--casing` ring (see S10).
Outlines on floating layers are always an inner shadow `inset 0 0 0 1px`, which takes no space.

**S8 Motion**: `--dur-fast` 120ms (hover color changes), `--dur` 160ms (appear, disappear, expand), `--dur-slow` 200ms (side panels collapsing and expanding).
Easing is always `--ease`. Exception: the blurred background around the canvas fades in over 360ms; the slowness is so it doesn't flash when switching items.

**S9 Line breaking**
- The interface's own explanatory text (setting descriptions, empty states, confirmation dialogs, shortcut descriptions) **breaks only at punctuation and spaces**:
  `word-break: keep-all` + `overflow-wrap: anywhere` (breaking character by character only when a whole sentence has no punctuation and doesn't fit). Not used for note text written by the user.
- A parenthetical at the end of a shortcut description goes on its own line, one level smaller (`ShortcutRow`), so it doesn't crowd the main description.
- **No space after full-width punctuation.** A paragraph written across two lines in JSX folds the line break into a space (“对话框。 标题栏”): keep a paragraph on one line, and use `<br />` for a deliberate break.
- **When a path doesn't fit, elide whole segments from the start**: `…\projects\examples`, never half a folder name (`TailPath` in `LibraryPanel`); the user profile folder is written `~`.
  Several projects are often on the same drive under the same user folder and begin identically; what tells them apart is the tail. The full path goes in the tooltip.
- Counter-examples (fixed): in Settings the two characters of one word (周 / 围) were split across lines; a stranded single character (也 / 行) in the shortcut list; the paths of three projects all shown as “C:\Users\alex\AppData\L…”.

**S10 Marks on the canvas are sized in screen pixels**: the canvas is scaled as a whole by `ZoomView` with a CSS `transform: scale()`,
so the line width of marks (the thickness in Settings), the dark edge, the selection halo and the hit area (14) must all be multiplied by `--inv-zoom` to come out as the written number on screen.
The same goes for numbers, pins, handles, arrowheads and the canvas's thin border (`scale(var(--inv-zoom))` / `calc(… * var(--inv-zoom))`).
- Derivation: in Chromium, `vector-effect: non-scaling-stroke` only cancels the SVG's own transform, not the CSS scaling of the surrounding HTML.
- Measured: a 1920-wide image at “fit” is 0.37×, so a 2px box shrinks to 0.75px; measured pixel by pixel there is only one row on the top edge and the color is washed out;
  the halo shrinks to half a pixel and can't be seen; the hit area shrinks from 14 to 5. On cyan and magenta canvases the box is nearly impossible to find.
- **Put a 1px solid dark edge under every line** (`--casing`, line width + 2, `annot-casing` in `AnnotationLayer`), and a 1px dark ring around numbers.
  Don't rely on a blurred halo: orange against red is 1.64:1 and against magenta 1.25:1, and a blurred halo only darkens its surroundings by 4% on a bright canvas (measured), while a solid edge separates on any canvas.

**S11 A floating layer sits next to the thing it explains, without covering it**: the note box is placed first to the right of the mark, then on the left if that doesn't fit, then below, then above,
and only if none fits (the mark takes up almost the whole canvas) is it clamped into the canvas. 12 from the canvas edge and 12 from the mark. Positions are rounded, never on fractional pixels.
When editing an existing note, the mark and its number together count as the bounding box.

## 5 · System (color tokens, one role per value)

| token | role | not for |
|---|---|---|
| `--bg` | window background, the canvas, recessed areas (inputs, tool group, category picker) | card backgrounds |
| `--surface` | side panels, the toolbar | floating layers |
| `--surface-2` | raised things: menus, tooltips, the note box, the selected tab | hover; the selected list item (darker than `--hover`, so the layering would invert) |
| `--hover` | hover; the selected note entry (plus the note-orange outline, so it is at least as strong as hover) | the selected library row (uses `--accent-soft` + outline) |
| `--hover-over` | small blocks laid over a row's background (white 7%): hover on small buttons in a row, labels such as “Overall” and “Done” — still a distinct block when the row's hover or selection changes its background | hover of the row itself |
| `--danger` / `--warn` | danger (red text, delete) / caution (yellow) | category colors |
| `--text` / `--text-2` / `--muted` | primary / secondary / tertiary text | — |
| `--accent` | lines and text for interaction: progress, focus, the vertical bar for “currently open”, the line for dragging a side panel; `--accent-soft` the background of a selected row, `--accent-edge` the outline of a selected row | notes; backgrounds for white text |
| `--accent-fill` | solid fill for interaction, with white text and white glyphs on top: primary button, current tool, checked checkbox, switch that is on (one level each for hover / pressed, white text passes 4.5 on all) | lines and text |
| `--hit` | background of search hits (notes panel search; pale blue 30%: search is interaction; `--text` on it is 8.9:1) | selected rows (use `--accent-soft`) |
| `--mark` | the note itself (see F5) | general emphasis |
| `--cat-*` | the four categories: Change (purple) / Remove / Add / Question. In a note entry only the colored text (right after the orange number, no dot); in the note box gray text + a colored dot at rest, and only the selected one gets a background | other states; blue (blue is interaction) |
| `--floating` | things on top of the canvas: the zoom bar, the speed indicator, the pixel readout; (the finish toast of Screen Capture in the shell doesn't use it: it uses the opaque `--border-strong` gray, `NativeUi.ToastSurface`) | menus (menus use `--surface-2`) |
| `--scrim` / `--backdrop` | covers the window during a drop / darkens behind a dialog | — |
| `--disabled` | overall opacity of the disabled state (0.4), one value for all controls | “a bit fainter” on permanent elements (see the trap in G1) |
| `--dim` | marks and numbers on the canvas that are not at this moment (video, 0.5) | things in lists (use color to make them fainter) |
| `--casing` | the lines on top of the canvas, the 1px dark ring around numbers (see S10) | drop shadows |
| `--close` | the red of the window close button on hover (as the system, #c42b1c) | other dangerous actions (use `--danger`) |
| `--checker` | the checkerboard behind images with transparency (SVG, PNG with alpha), alternating with white squares; 8px squares on screen, tiled the same way in screenshots | any other background in the interface |

**The Screen Capture overlay (`app/Capture`, drawn with WPF, not CSS)**: colors, radii and type sizes are copied from the tokens above at the top of `CaptureOverlay.cs`;
change both sides together when a token changes. The toolbar = a floating layer (`--surface-2` fill, `--border-strong` outline, radius 10, buttons 32, icons 16 / 1.3 line width),
the current tool has an `--accent-fill` fill and a white icon (as in the main toolbar), and “Finish” is the only primary button (also `--accent-fill`).
Outside the selection is darkened by 50% black; the selection has a 1px `--accent` outline and 7px white handles.
The small note box follows the main interface's note box (width 360 — at 340 the four categories don't fit on one line in Italian, German, Russian and Portuguese — padding 12, radius 12, category well + input + Cancel / Save), and its button is called “Save”: the toolbar already has “Finish”.

Monospace type is only for real code (paths and extensions in Settings). Timecodes and keycaps use the interface font with tabular figures (`tabular-nums`).

**How shortcuts are written**: key names separated by a space, no plus sign — “Ctrl Shift O”, “Ctrl Alt A” (the same in menus, tooltips, Settings, the capture overlay and the tray;
`GlobalHotKey.Pretty` and `splitKey` follow this). The Keyboard Shortcuts list draws them as keycaps. The shortcut table in code (`useKeys`) still writes `Ctrl+O`; that is for the program.

**Tooltips**: one kind for the whole window (`Tooltip.tsx`): write `title` or `data-tip` on the element, and after 350ms a `--surface-2` bubble appears 8 below the element,
flips above if there is no room below, and is kept 8 inside the window on the left and right (an element with `data-tip-side="top"` on an outer element goes up first: for the color strip above a mark on the canvas, a tooltip below would cover that mark); a shortcut in parentheses at the end (“Settings (Ctrl ,)”) is split off, right-aligned and one gray level lighter, as in menus.
The system `title` tooltip is not used (its look and delay differ from the custom one), nor is CSS `::after` (the side panel's overflow would clip it, and it would go out of bounds at the edge).

**The bottom toast bar** (`Toast` in `App.tsx`): centered on the canvas area, 8 above the zoom bar (which sits above a video's play bar), so it never covers the play bar or the zoom bar; without a canvas, 24 above the window bottom.
A floating layer must not cover controls: check what it lands on, at the minimum window size too. Three kinds: transient (3.2 seconds, 6 with a button; time doesn't run while the mouse rests on it); persistent (data-related notes, closed only by clicking “OK”);
**error**: a red exclamation mark in front (`--danger`), a × on the right to close, read out by screen readers immediately (`role="alert"`), and it stays until dismissed; the text includes “what to do”
and comes with a button you can act on — “Open Folder” when it is known to be a disk problem in a specific folder, “Retry” for a failed copy, otherwise “Open Log Folder”; a button that opens something leaves the toast up so you can compare.
Raw browser or system English is never shown directly (the original goes to the log). The error toast of the capture overlay (WPF, `Toast.ShowError`) follows the same pattern:
it stays until dismissed, is closed by × or Esc, where the image was saved is written as a clickable path (clicking selects it in File Explorer), the system's original text goes in a small box where it can be selected and copied, and “Open Log Folder” is at the bottom right.

**Two kinds of dialog and floating layer**: confirmation dialogs, Settings and Keyboard Shortcuts are dialogs (`--surface` fill, title 15/600, `--shadow-dialog`, the background darkened);
the note box is a floating layer attached to the mark (`--surface-2` fill, title 13/600, no darkening: you need to see the canvas while writing).
In dangerous menu items, the text and the icon turn red together.
**Menu placement and keyboard**: a menu-bar menu opens only below its name (moving it up would cover the name); a context menu flips above when there is no room below; when the whole menu doesn't fit in the window it is height-limited and scrolls inside, instead of pushing the first items out of the window. `Enter` / `Space` activate the current item on key down, and `Tab` doesn't leave the menu; when the menu closes, keyboard focus returns to where it was before opening (as with dialogs). Menus on the title bar (the menu bar, the small arrow beside “Capture”) always open 4 below the lower edge of the title bar (`placeBelowTitlebar`); the distance from the menu to the button and to the window edge scales with “Interface size”. A dropdown button carries `aria-haspopup` / `aria-expanded`, and when you Tab to it and press `Enter` / `Space`, focus goes to the first item. Menu names are not in the `Tab` order (as in Windows programs): the keyboard route is a single press of `Alt` / `F10`, which highlights “File”, then `←` `→` to switch and `↓` / `Enter` / `Space` to open. Items that toggle (Mute, Loop, Always on Top) all carry a check mark so the current on / off state is visible; items that don't apply are grayed out (for example Zoom and Playback when the item can't be opened), rather than left clickable and doing nothing.
Mouse following (moving across menu names switches menus, a hovered item takes focus) always requires **the mouse actually moving** (`pointermove`), not `pointerenter`: after the keyboard switches menus, the browser fires a synthetic “enter” for a mouse that hasn't moved, and the menu would switch back to the one under the mouse. While a menu is open, keys without Ctrl / Alt have even their default action blocked so they don't reach the input behind (as with Windows menus).
List-like things (note cards, the library) use `↑` `↓` to move between entries and `Home` / `End` to jump to the ends, selecting as they go; those keys no longer fall through to the canvas to step frames or change volume.
**The gray text at the right of a menu holds only counts and shortcuts** (“2 notes · Ctrl Shift A”, “Shift N”); descriptions of purpose and how the scope is counted go in the hover tooltip (`title`), not in the right column — descriptions mixed into the right column widen the menu and leave it ragged. Context menus follow the left panel's context menu in giving items icons, rather than only a few of them.
The dangerous button in a confirmation dialog (Remove, Clear, Delete) is **red text on a 14% red fill** (`.btn-danger-soft`, 22% on hover), with text-to-fill contrast 4.8:1;
no solid red — it is the only colored element in a confirmation dialog, and solid red would be too loud.

**The tour and first-use hints** (`Tour.tsx`, `Hint.tsx`, `onboarding.ts`): the onboarding flow must be short.
The tour covers only the main points, in **3 steps** (drawing tools → notes panel → Capture), each a title plus one or two sentences; it runs once automatically the first time an item is shown, can be skipped at any time, and can be taken again from Help → Feature Tour.
It is a dialog: the whole window is darkened (the outer shadow of the highlight frame, the same as `--backdrop`), the highlight frame is 4 larger than the target with a 2px `--accent` ring, and the description card looks like a confirmation dialog (`--surface`, title 15 / 600, `--shadow-dialog`), one step narrower (340, padding 16 20 20);
the card sits next to the target (S11: below → above → left → right, 12 from the target and 8 from the window edge). There is no separate welcome page: when the list is empty, the message in the middle of the canvas is the starting point.
Finer details are not added as tour steps but as **first-use hints**: shown once, next to the control, as a floating layer (`--surface-2`, `--shadow-pop`, the same radius as menus, a small tip pointing at the middle of the control),
without darkening and without taking focus; a click elsewhere dismisses it and that click takes effect as usual; once shown, it doesn't appear again. The first-use explanation of the capture overlay (WPF) is written below the magnifier and follows the cursor; it goes away after the first completed capture.

**Ask before changing things**: removing from the list, clearing and deleting notes always show a confirmation dialog first (`Confirm.tsx`: a × at the top right, a question as the title, the name of the thing being changed in the description in `--text` and in quotation marks,
“Cancel” on the left and the dangerous action on the right, Enter confirms and Esc cancels); the action happens only after confirmation, and no toast with “Undo” follows (confirm before changing; don't rely on undo afterwards).

**Dialog keyboard handling is the same everywhere** (a dialog that misses it goes wrong, e.g. pressing F1 and then Esc while writing a note closes the note box together with the unsaved text): on open, focus goes into the dialog
(onto the default button if there is one, onto the content area if it is view-only), Tab / Shift+Tab cycle only inside it, Esc closes it, closing returns focus to where it was before opening, and it carries `aria-modal`;
it closes on **pressing down** on the backdrop, but not when you press inside the dialog and release outside after dragging.
New dialogs use `Sheet.tsx` (view-only) or `useDialogFocus` from `Menu.tsx` + `useKeys(…, { modal: true })`.
The error page for the whole window layer and the startup-failure page bring their own title bar with only the three window buttons (the system title bar has been removed, and without it the window couldn't be closed).

## 6 · Copy

A beginner must be able to understand it, but it isn't chatty: like professional software, written and professional in tone. Reference the Chinese versions of Office, Adobe and macOS.
All interface text (menus, buttons, settings, messages, dialogs, empty states, Screen Capture, text for AI) follows this section; new text always goes into messages (ADR-0001).

**W1 Register**: written, concise, declarative. No “you”, no colloquial words (the Chinese copy avoids 一下, 啦, 吧, 的话, 免得, 弄, 搞, 挪, 腾出点), no metaphors, no exclamation marks or rhetorical questions.
**W2 How each place is written**
- Menu items and buttons: a verb–object phrase (“Copy as Text”, “Open Log Folder”); add “…” when a click opens a dialog first.
- Settings: the label is a noun or a verb–object phrase, and a switch's label states the behavior when on (“Keep running in the tray when the window is closed”); the description is one sentence stating the effect or consequence, without repeating the label.
- Messages: success states the result (“Copied 3 notes”); an error states the cause + what to do, in no more than two sentences.
- Empty states: what this place is + what to do next.
**W3 Wording**: one name for one thing throughout, following the existing wording in the messages (the Chinese–English table is the glossary `i18n/glossary.md`); no coined terms (in the Chinese copy: 回写 “write-back”, 闭环 “closed loop”, 待核对 “to be verified”).
**W4 Punctuation and format**: full-width Chinese punctuation; names, file names and button names inside running text go in 「」; a half-width space between Chinese and Latin letters or digits; dates as 「10 月 20 日」, time in 24-hour form 「10:32」.
**W5 For a global audience**: the software faces users all over the world, so its text must work in every country. Products that are popular or usable only in some countries or regions are not named (WeChat, QQ, ChatGPT…);
use generic terms: “chat apps”, “web-based AI”, “AI tools” (in Chinese 聊天软件, 网页版 AI). Only Claude Code and Codex, which this product integrates with specifically, are named.
Examples, defaults and the reasons given in descriptions likewise shouldn't assume the habits of one region.

| Colloquial (no longer used) | Professional |
|---|---|
| So SnipToss itself doesn't end up in the capture | Hide the main window before capturing to keep it out of the image |
| If you don't write anything, nothing is attached | Leave empty to attach nothing |
| You haven't taken a screenshot yet, the folder isn't made yet | The screenshot folder has not been created yet |
| The disk is full, free up some space and try again | Not enough disk space. Free up space and try again |
| Click once to record a new shortcut | Click to record a new shortcut |
| First pick an item on the left | No item selected |

## Applicability levels

| level | unit | what must pass |
|---|---|---|
| A | library, toolbar, canvas, playback bar, notes panel, note box | all rules + magnified screenshots of each area (2–3×) + measured alignment |
| B | menus, tooltips, empty states, confirmation dialogs | gates + tokens + line breaking |
| C | Settings, Keyboard Shortcuts | tokens + line breaking |

## Retired (with the mechanism that killed each)

- The open count in the library as a **solid orange circle** — ruled out by F5: it has the same shape as the number on a note card (also a solid orange circle) with a different meaning,
  one is “how many” and the other “which one”; a column of solid orange dots in a side panel also competes with the canvas.
- The open count as a **pale orange capsule** (18% orange laid on a near-black background) — it turns brownish and looks disabled. Now it is “a small orange dot + a gray number”.
- The zoom bar at **0.6 opacity as a whole when idle** — ruled out by the G1 trap and by G2: the text falls back to grayscale antialiasing, and “Fit” is only 3.45:1. Now it is permanent and opaque.
- A **small colored block as the card's category background** — every card in a column had a block of color and it looked fragmented; it also didn't look like the options with dots in the note box.
  Later changed to “color dot + colored text”, and then the dot was removed too (see below).
- The dropdown under the menu bar with a **smaller radius on its top-left corner** (meant to attach it to the menu bar) — it was still 3px from the menu bar and didn't actually attach, and looked like a rendering error. All four corners are the same.
- Timecodes in Cascadia Mono — ruled out by F2: it feels like a terminal and gives two letterforms next to the interface font. Now the interface font + tabular figures.
- The settings button as “a circle + eight short lines” — at 16px it reads as a sun (brightness), not a gear. Now a six-tooth gear.
- `−` `+` `×` as text for the zoom buttons, the time clear button and the Settings close button — glyph weight follows the font and isn't the same family as the neighboring 1.3px line icons. Now icons.
- After a removal, a **toast saying “Removed … from the list; the files are still there  Undo”**, and **solid red** (`--danger-solid`) for the dangerous button in a confirmation dialog —
  the former was replaced by confirming first; the latter was too loud and became red text on a pale fill.
- The “currently open” marker of a list row drawn as the left line of an `inset` shadow — it bends into a bracket following the row's rounded corners. Now a straight 2px vertical bar.
- A **bitmap wordmark** at the top of the left panel (scaled to 20 high) — ugly at small sizes.
  Mechanism: a bitmap scaled to 20px is blurry, the strokes in the bitmap were never aligned, and small type has no pixel alignment; system-rendered text does. Now real text + the pixel-grid icon.
  **If the logo is used at a small size in future, don't make a bitmap**; large posters and promotional images are a separate matter.
- **A count on the bottom button of the notes panel** (“Copy 1 note to AI”) — when nothing is checked it still said “1 note”, which made people think one was checked.
  The button is always “Copy as Text”, and how many are checked is written on its left as “N selected”.
- **Cards with a background and an outline** for the notes panel — ruled out by F2: four notes are four boxes and eight horizontal edges, and a whole column of box lines looks fragmented;
  the library on the left is flat rows, so one window had two list grammars. Now flat, and only the selected entry stands out.
- The card's **action row expanding underneath on hover** — everything below moved down by 32, the whole column jumped as the mouse swept down, and automated tests missed clicks because of it.
  Now it floats at the right of the title row and takes no space (as in Gmail's list), with a 16 fade on its left.
- Done / Won't fix cards at **`opacity: 0.6` as a whole** — the G1 trap (permanent elements faded as a whole, text falls back to grayscale antialiasing). Now the text drops one color level.
- Keeping mark line width constant on screen with **`vector-effect: non-scaling-stroke`** — see the mechanism in S10: it ignores the outer CSS scaling.
- The note box **clamped into the canvas when it doesn't fit** — when there was no room on the right it sat directly on top of the mark just drawn (measured: it covered it completely). Now it switches sides (S11).
- Project paths **elided from the end** — several projects start the same, all showing as “C:\Users\alex\AppData\L…”, so you couldn't tell which was which.

- The primary button with **white text on `--accent #5b8cff`** — 3.16:1, failing G2. The solid fill moved to the darker `--accent-fill`.
- The category “Change” in **blue** (`#8fb0ff`), video icons in **blue** and folders in **yellow** — ruled out by F5 and F2: blue was doing three jobs (interaction, category, item kind),
  and “● Change” next to the blue primary button looks like a link; the yellow folder was the brightest column of color in the left panel and made the whole panel look like an IDE's file explorer.
- **Two tooltip systems** (CSS-drawn in the toolbar, the system `title` elsewhere) and **four ways to write shortcuts** (“Ctrl Shift O”, “Ctrl + Alt + A”, “Ctrl+Wheel”, keycaps) —
  the same thing in several looks. Now one tooltip and one way of writing.
- `opacity: 0.7` on the small dropdown arrow inside a button, `opacity: 0.8` on the category dot in the note box, 0.4 for faded marks on the canvas and 0.5 for their numbers — opacities outside the table,
  two values for the same “faded”. Now the dropdown arrow uses `--muted`, the dot isn't faded, and faded marks and numbers both use `--dim`. `check-design` gained an opacity check.

- The selected note entry in **`--surface-2`** — darker than hover's `--hover` (1.10 against 1.20 on the panel background), so while the mouse swept over other entries the one being hovered looked more “raised” than the selected one.
  Now selected = `--hover` + a note-orange outline.
- A checked note entry **filled with pale blue** — checking a few in a row gave a stack of rounded blue cards (the look F2 had just retired), and in grayscale it couldn't be told from hover.
  Now checking adds no background; the blue checkbox and “N selected” at the bottom show it.
- The **time of a video note in the title row** — on hover the action bar floated up and covered half the end time, so it was hidden exactly when you wanted to read or click it. Moved to the start of the body.
- A note with no mark showed a **bare gray word** (“整体”, “overall”) after the category — the same size and right next to it, so “删除 整体” (“Remove Overall”) read as one phrase, “删除整体” (“delete the whole”). Now a small label on a gray background with the full name (“整体意见”, “Overall comment”; the English interface says “Overall”), in the same style as the tool names.
- A bar with a line **counting the line in its height** (title bar 32, three-column title bars 44) — the content area was left with only 31 / 43, so a 32 control had 6 above and 5 below and the menu names landed at y 1.5.
  Now height = content + 1 for the line. This was measured pixel by pixel.
- The playback bar drawing **how far it has buffered** — items are all local files, so buffering means nothing; and at 0 seconds that lit bar looked like part had already played. Removed.
- The note box's input with the **browser's own drag corner** — a diagonal-stripe patch at the bottom right, not the same family as everything else. Replaced by growing with the text (3–8 lines).
- The Keyboard Shortcuts list **cut off flat at the bottom with no ×** — the scrollbar is hidden until needed, so you couldn't see it could scroll; Settings and the confirmation dialog both have a ×, this one didn't. Now a fade at the bottom + a × at the top right.
- The Settings × **placed inside the scrolling content area**, and the content area **not reserving room for the scrollbar** — the × moved with the scroll; switching pages made the whole right-hand column jump by 8.

- The **body of a note entry starting at 20, going under the checkbox** — the title row's text was at 82 (after the checkbox, number and dot) and the body at 20, so the left side of each entry alternated high and low,
  and a column of them formed a sawtooth; the left panel's two-line items (name + path) sit on one line, so comparing the two columns made the notes list look rough.
  Now the body and replies are at 44. Aligning to the category text (72) was tried: at 320 wide the body is left with only 227 and a single sentence wraps to three lines, so no.
- **Two-line rows in the left panel** (a project's name + location, a separately added file + its folder) with **arrow and icon centered on the two lines together** — the icon landed between the name and the gray text and the name looked like it floated above the icon.
  Now the arrow, icon, count and button on the right all center on the first line (the name) (`.lib-row.has-sub`), and the gray text sits below the name on the same left line.
- A **colored dot on a note entry's category** — right after the 20 orange number, “big circle, small circle, text” crowded into 40px; the text is already in the category color, so the dot said it twice.
- The primary button at **weight 600** and the bottom buttons of the notes panel at **32 high** — it was the only bold text in the whole panel and the blue block was large, two levels heavier than “N selected” beside it.
  The size relationship between button and text was off. Now 28 high and 400.
- The notes panel scope **following only the selection in the left panel** (click a project on the left and only then does the right list the whole project) — you had to go to the left, click the project, and come back to the right, which felt disjointed.
  Now the top of the notes panel switches “this video / entire project” itself, and a multi-selection in the left panel is only a temporary override. The “Open / All” tabs at the top became a switch at the top right, and the small “Overall” icon was removed (the toolbar has it).
- Notes panel sections with **just a 12px gray one-line title** for “Overall” and “Notes on an earlier version”, and none for the canvas section — unattractive and the boundaries unclear.
  Small text sandwiched between cards doesn't read as a boundary, the first section had no title, and it couldn't be collapsed. Now every section has a title row (collapse arrow + name + count + a line), see S5.
- **Five action buttons** floating on a note entry on hover (edit, copy, done, won't fix, delete; about 150 wide) — once the notes panel is narrow they sit right over the category and only a fading “修” (the first character of 修改, “Change”) remains.
  Now only copy-to-AI and “⋯” (= the right-click menu) remain, 66 wide, as in the comment panels of Figma and Frame.io.

## Change log

| date | rule | change |
|---|---|---|
| 2026-10-16 | all | First version: induced from measuring the existing interface, to raise the polish of the main interface (type, the size relationships between visual elements, spacing) |
| 2026-10-16 | S4, S5, S2, G1, S9, Sy1 | Tool group 22px off to the right, bottom row off by 7.5px, three left lines in the notes panel, uneven top and bottom on cards, a translucent zoom bar that looked washed out, tab selection shown by background only, and several mismatches between rules and implementation. Changed to: all title bar controls 32; notes panel content lines 20; the bottom row on one center line; numbers and counts unified at 12; line-breaking rules and tokens such as `--disabled` added. Not adopted: aligning the “+” in the zoom bar with the toolbar icons — the zoom bar has a visible box, and the box edge is its visual edge |
| 2026-10-16 | Sy1, Retired | After a removal no toast with “Undo” any more; confirm first instead: removing, clearing and deleting notes all confirm first; confirmation dialogs get a × at the top right and the dangerous button becomes red text on a pale fill; `--danger-solid` deleted |
| 2026-10-16 | S2, S4, Sy1 | The menu bar moved to the very top of the window, and the logo and name moved to the left panel (following the Codex desktop app), and Capture added. Changed to: system title bar removed, menu names 13px with mnemonic letters hidden at rest; sizes for the three window buttons and `--close` added; the look of the capture overlay written into the System section |
| 2026-10-16 | S4, F5 | The product name and icon made into a combined logo, 20 high; a button + checking added at the bottom of the notes panel: checkbox 16, bottom action bar 44; checking uses blue; the blue and orange of the logo are brand colors and not bound by F5 |
| 2026-10-16 | S2, S4, Retired | The bitmap wordmark was blurry at small sizes: the logo became real text (bundled Noto Sans SC Medium subset, 15, letter spacing 0.03em) + the pixel-grid icon; `--fs-display` added. A button that said “1 note” when nothing was checked was read as one checked: the button no longer shows a count, and “N selected” sits on its left |
| 2026-10-16 | F2, F5, G2, G3, S3–S11, Sy, Retired | Raised the polish, mainly of the notes panel. Changed to: mark line width in screen pixels + a 1px solid dark edge (S10); the notes panel became a flat list, actions float at the right of the title row, and Done no longer fades the whole entry; the note box doesn't cover the mark (S11); the scrollbar yields the right-hand 8; canvas margin unified at 16; `--accent-fill`, `--muted #92929a`, Change turned purple, item-kind icons desaturated; outline on the selected row; one tooltip, one way to write shortcuts; paths elided as whole segments from the start. Not adopted: solid icons for play / volume (a media-player convention), changing the pen icon to a pencil (the pencil already means “edit”), removing the focus ring from the default button of a confirmation dialog (it shows which one Enter hits), moving “files are not deleted” and “pinned ones are kept” out of the right column of the menu (they carry information) |
| 2026-10-16 | S4, S5, Sy, Retired | Changed to: video time moved into the body; selection = `--hover` + orange outline, checking adds no background; the bare word “整体” (“overall”) changed to the label “整体意见” (“Overall comment”); bars with a line get + 1; entry padding 12 / 12 / 8; replies on Done notes drop to `--muted`; the copy icon on entries changed to a sparkle icon; duplicate removed from the Keyboard Shortcuts list, × and fade added; the Settings × moved out of the scrolling area, scrollbar reserves its space, and navigation selection gets an outline; “Clear Library…” in the File menu turned red; buffered segment removed; input grows with the text. Not adopted: attaching the number to the corner of the box (it would cover the handles; it is only ambiguous when marks overlap), moving the “Overall” icon in by 2 (it breaks “clickable blocks are 8 from the column edge”), changing every “Copy note info to AI” into “Copy to AI” (the long form is the unified name; the button's shorter text is only because of lack of room) |
| 2026-10-16 | S2, S4, S5, Sy, Retired | The blue button at the bottom of the notes panel was out of proportion with the text beside it, and the notes list was rougher than the left panel: candidate styles were injected into a test instance and compared side by side in screenshots — body aligned at 44 / 72, button 32 / 28 × 600 / 400, category with or without the dot. Decided: body and replies start at 44 (two lines in the notes panel: 20 for the checkbox, 44 for the text); no color dot on the category; primary button always 400 (also on the capture overlay), and “Select all” and the button at the bottom 28. Not adopted: aligning to 72 (too narrow); making the number double as the checkbox with the checkbox shown only on hover (the checked state would be invisible) |
| 2026-10-16 | S5, Retired | In a narrow notes panel the action bar on hover covered “Change”: the action bar reduced from five buttons to two (copy to AI, “⋯” = the right-click menu), the space yielded at the right of the title row reduced from 150 to 66; measured at 240 wide that it doesn't cover the category. Not adopted: keeping a “Done” tick (three buttons are 92 wide and cover “Overall” in a narrow panel; AI marks it done itself when it finishes, and few are marked by hand) |
| 2026-10-16 | S4, S5 | Items of the same project are scattered through the list, and you want every note on the right with one-click select-all: the notes panel follows the left panel's selection and groups by item (logic in design.md “Which items the notes panel lists”); group titles 28 high, two lines the same as entries, sticky, 16 between groups, a blue line on the open group (as in the library). Not adopted: an item-kind icon before the group name (the name would be pushed to 68, off the 44 line) |
| 2026-10-16 | S5, Retired | A scope that only follows the left panel means going back and forth between the two sides, which is disjointed; left-button drag marquee selection added to the left panel: the top of the notes panel became a scope switch (a well, 32 high, options 28, text 13, open counts one gray level lighter), the first cell's text lands on content line 20 by 2 + 10; a “also show resolved” switch, on = light background + outline (same as a selected well cell); the marquee in the left panel = `--accent-soft` fill + 1px `--accent` line; no tooltip bubble while a drag is in progress. Not adopted: making the scope a dropdown menu (two clicks before you can see the options) |
| 2026-10-20 | F3, 6 | Copy changed to a written, professional register: F3 drops the “plain talk” wording; “6 · Copy” added (register, how each place is written, wording, punctuation). All rewritten: every piece of interface text extracted into messages, core and the shell changed in place; tool names “Point” → “Pin”, “Box” → “Rectangle” (in the Chinese interface) |
| 2026-10-20 | W5 | A menu named a product popular only in some regions: W5 added; “WeChat” and “ChatGPT” all replaced by “chat apps” and “web-based AI”; the line in the menu is “For web-based AI and chat apps” |
| 2026-10-20 | Sy1 | Search added to the notes panel, with the matched text highlighted on cards: `--hit` (pale blue 30%) added. `--accent-soft` isn't used: at 14% on the card background you can't see which characters matched; yellow isn't used: it collides with the yellow of the category Question |
| 2026-10-21 | Sy1, 6 | The right-click menu on empty canvas looked awkward: the right column of the menu holds only counts and shortcuts, with descriptions in the hover tooltip (written into the paragraph “Two kinds of dialog and floating layer” above); every item in the context menu gets an icon; “Overall comment…” became “Add Overall Comment…” (W2 verb–object phrase); “Add Note Here…” added |
| 2026-10-23 | S4, S5, Retired | The earlier section layout of the notes panel was unattractive and its boundaries unclear; it should be collapsible and let you see only canvas marks or only overall comments; nearby marks on the canvas overlap, so there should be a way to hide all marks and see the original: each section has a title row (collapse arrow at 20, name at 44, count, a line stretching to the right, 8 extra between sections); the funnel for filtering by type moved into the notes panel's search box (as in the left panel), and the “also show resolved” switch at the top right merged into the same menu; entries in the canvas-marks section get an eye in their action bar (92 wide, measured language by language at 240 wide so it doesn't cover the category); an eye added at the far left of the zoom bar to show / hide marks, reading “Marks hidden” while hidden. Not adopted: a background band behind the section title (heavier than the group title, inverting the hierarchy); the hide switch in the middle of the toolbar (that is the drawing tools); “Marks hidden” as a separate toast floating at the corner of the canvas (that cell of the zoom bar says it itself, one thing fewer) |
| 2026-10-27 | Sy1 | A tour added (step-by-step “Next”, like Adobe's) and small hints at first use; the onboarding flow must be short: the paragraph “The tour and first-use hints” added: the tour is 3 steps and looks like a dialog; finer details become hints shown once at the point of use that don't block the work; no separate welcome page |
| 2026-10-28 | S4, F5 | When dragging the playback bar you couldn't tell which moment you had reached, and the Settings × wasn't in the corner: the time bubble above the playback bar now appears on drag, click and keyboard seek (15 / 600, `--floating` fill; before, only on hover and at size 11); the Settings × sits in the corner like the window close button (46 × 32) and turns `--mark` on hover (the one exception to F5); dialog × buttons show no tooltip. Not adopted: aligning the × with the “Settings” title and 11 from the corner (it still didn't look like it reached the corner) |
| 2026-10-28 | Sy1 | Now that SVG can be annotated, the common black line icons were invisible on the dark canvas: images with transparency get a light checkerboard behind them (white + `--checker`, as in image editors), tiled the same way in screenshots; when the system extension is missing and a HEIC can't be opened, two buttons sit side by side below the description (go to the Microsoft Store + Show in File Explorer). Not adopted: filling the transparent area with white (white icons would disappear); doing it only for SVG (PNG icons with alpha are invisible too) |

## Checks

```powershell
node scripts/check-design.mjs              # CSS values outside the tables: font size / line height / spacing / radius / weight / color / disabled opacity
```

Actual font sizes in the interface (first start a test instance, see CONTRIBUTING.md “Run a test instance”; before starting, set `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'`, and `cdp-eval.mjs` connects to this port by default):

```powershell
node scripts/cdp-eval.mjs "[...new Set([...document.querySelectorAll('body *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => { const s = getComputedStyle(e); return s.fontSize + '/' + s.lineHeight + '/' + s.fontWeight })])].sort().join(' ')"
```

Alignment: use `getBoundingClientRect` to measure the distance of key elements from the column edge (each line in S5), then magnify a screenshot 2–3× and look at the glyph edges.

# ADR-0009 One note, several marks (format sniptoss/5)

- Status: accepted (2026-10-25)
- Related: `docs/annotation-format.md` (`anchor.shapes`); ADR-0006 (the procedure for changing the format, when to bump the major version)

## Context
Many things that need changing need the same change ("make all three of these buttons rounded"). Before, each place was a separate note, so the same sentence had to be written several times, and a repeated comment is hard to phrase clearly.
What is needed: after the first mark is placed and the note box has opened, the user can **keep clicking elsewhere outside the box without saving first**; those marks share one number, and the last comment written applies to all of them.
Every marking tool should work this way (point, rectangle, arrow, pen), for instance several rectangles at once.

Before, a note had a single `anchor.shape`. While the note box was open, the canvas tool was forced to Select, and clicking on the canvas added nothing.

## Decision
1. **Format**: `anchor.shape` (one) becomes `anchor.shapes` (an array of one or more marks), bumping the version to `sniptoss/5`.
   A single mark is also written as an array, so an agent only has to understand one form. An older program that meets `shapes` treats the note as having no position (an overall comment), which counts as "an older reader would misread"; per ADR-0006 item 2 this bumps the major version, and a separate `docs/schema/sniptoss-5.schema.json` is published.
   When reading `pizhu/1`–`sniptoss/4`, `shape` is turned into a one-element `shapes` (`parseMaterialFile` in core `store.ts`); a `sniptoss/5` file where someone followed the old documentation and hand-wrote `shape` without `shapes` is read the same way. An empty array counts as none.
   The marks of one note share the number, snapshot, time and page; their order is the order they were drawn and has no other meaning.
2. **Drawing**: while the note box is open and the note already has marks, the canvas tool is no longer forced to Select; the marking tool the user picked draws as usual (with the Select tool, dragging on blank space still draws a rectangle). What is drawn belongs to this note and carries the same number;
   the note box does not move, and focus returns to the input so typing continues. For overall comments without marks, timestamped comments, folder comments and notes written on an earlier version, drawing while the box is open is still not allowed (an overall comment must not quietly turn into one pinned to some place).
   When "Open the note box after drawing a mark" is off in Settings: with no box open and a finished mark still there, drawing again adds to that note (it used to replace it); press Esc to start over.
3. **Fixing a mistake**: in the note box, "Undo last mark" (Alt+Z, the same group as the other Alt keys in the box); right-click one mark → "Remove This Mark" (not offered when only one mark is left: what is wanted then is to cancel the whole note).
   For saved notes: each mark can be dragged, resized by its handles, and nudged with the arrow keys on its own (the one that was clicked moves); right-click a mark → "Remove This Mark"; double-click to edit also lets you add more.
4. **Handing it over**: every mark is drawn in the snapshot (when the area outside a rectangle is dimmed, all the rectangles stay lit); Copy as Text and REVIEW.md write "2 places — …; …", and when such notes exist the text opens with one more sentence,
   "Where a note marks several places, the comment applies to every one of them."; Copy as Images uses the snapshot and the same position text.
5. **Screen Capture (the capture overlay behind the global hotkey) does the same**: while the overlay's note box is open, you can keep clicking positions without the box going away.
   The overlay's mark (`Mark`) gains `Lead`: the marks added afterwards point to the first one, and the note's text, category and number are recorded on the first one (`Head`); the marks added afterwards draw the first one's number.
   When the note box is open, the note being written is pinned to a place, the Pin / Rectangle / Ellipse / Arrow / Pen tool is selected and the click is inside the selection (not on another note's number): the click adds another mark, the box neither closes nor moves, and the keyboard returns to the box
   (`OverlayStateMachine.Down` / `StartMark` / `FinishMark`).
   Everything else stays "click elsewhere = done writing": a click outside the selection, a click with Pixelate / Text / no tool selected, a click with Rectangle selected that is not dragged out, a click while an overall comment is open. Switching to another tool that can mark a position on the toolbar does not close the box; switching to Pixelate or Text still finishes the note first.
   The box title is "Note 1 · 3 marks". Undo (toolbar, Ctrl+Z) first removes what was added afterwards, the last added first, and only when none are left does it cancel the note; `Alt+Z` in the box removes only the ones added afterwards.
   Esc / cancel: the ones added afterwards are taken back (the numbered dots are removed; rectangles and arrows stay as plain drawing), and when editing an old note its original marks are left alone; saving with all the text deleted = discarding the note (all numbered dots removed, rectangles kept).
   The overlay has no context menu (right-click means reselect / cancel), so there is no "Remove This Mark" there. The caption under the composed image and the text for AI say "3 places — …; …" (`Mark.WhereAll`, messages shared with the main app), and the text opens with one more sentence,
   "Where a note marks several places, the comment applies to every one of them."
6. **Each mark can be recolored on its own in the capture overlay**: once a note has several marks (one number), you should be able to click one of them and change just its color, so the comment can describe them by color.
   Each mark in the overlay already remembered its own color; what is added here is only "click to pick": clicking a mark (its number or its line) selects it, and the sub-toolbar's color and the keys `1`–`6` change only that mark (`OverlayStateMachine.Picked`); while the note box is open, clicking one of this note's marks also selects it, without closing the box or adding a mark.
   When the marks have different colors, the text for AI puts the color in front of each, "(yellow) Region: …", so it can be matched with a comment saying "the yellow one…".
   The main app followed (Beta 80): each item of `shapes` can carry `color` (an optional field; no major version bump). When the marks' colors differ, every mark records its own and the note-level `color` records the first mark's;
   when they are the same again, the note-level one is dropped. This way core (command line, REVIEW.md) can state each mark's color without knowing the user's settings. Entry points: right-click a mark on the canvas → "Color of This Mark", click a mark and press 1–6,
   right-click a mark while the note box is open; recoloring the whole note changes all its marks together. The rules are in the UI's `markColors.ts` (`normalizePlaceColors`, `recolorPlace`).
   The Beta 80 entry points were not discoverable enough: after clicking you could only press 1–6 or right-click, a left click gave no hint that the color could be changed; with the note box open, clicking the marks being written did nothing.
   So the main app now follows the overlay too: **a single click on a mark = pick it, and a row of colors pops up next to its number** (`MarkColorBar`, Beta 81); with a drawing tool, a click on a mark that is not dragged also picks it (as in the overlay),
   and with the note box open, clicking one of this note's marks also picks it, without closing the box.

## Rejected alternatives
- **Keep `shape` and add `more_shapes`**: one thing in two fields, so agents must look at both; an older program would treat `shape` as all the positions, and after a change the position would no longer match `more_shapes`.
- **Several notes sharing a group id** (each mark still a note, shown together by `group`): the agent reads several identical comments, which is exactly the repetition to avoid; status and deletion would also have to be handled per group, which is far more complex.
- **`shape` for one mark and `shapes` for several**: two forms, and every reader has to handle both.

## Consequences
- Files of `sniptoss/4` and earlier are read as before; a file the program has modified is written back as `sniptoss/5`, and **Beta 76 and earlier programs open it read-only** (ADR-0006 item 4).
- Numbering, hiding, status and deletion still work per note; "move", "Remove This Mark" and "recolor" (see item 6) can work per mark.

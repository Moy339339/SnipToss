# Annotation data format `sniptoss/5` (SnipToss)

A Chinese version is in [annotation-format.zh-CN.md](annotation-format.zh-CN.md); this English document is the reference if they differ.

This document is **the contract for agents**: what the annotation tool writes and what an agent reads are both defined here.
Only changes that an older app would misread (removing a field, changing a meaning or a unit) bump the major version; adding optional fields does not, and this document notes which version introduced them. Newer apps always read files written by every earlier version.

**JSON Schema**: `docs/schema/sniptoss-5.schema.json` (JSON Schema 2020-12). Use it to validate the output of your own scripts and plugins.
It describes what the files the app writes look like (every field is present); reading is more lenient, see "Reading rules" below.
One rule the Schema cannot express: the `id` of a note must not be repeated within the same file.

Versions:

| Version | Change |
|---|---|
| `sniptoss/5` (2026-10-25) | **A note can mark several places**: `anchor.shape` (one shape) becomes `anchor.shapes` (an array of one or more shapes; the comment applies to every one of them). When an earlier version is read, `shape` becomes a `shapes` with a single entry, and the file is written back as `sniptoss/5`. Older apps cannot understand it (they would treat the note as having no position), so the major version is bumped |
| `sniptoss/4` (2026-10-17) | Rename (content identical to `pizhu/3`): the data folder `.pizhu/` is now `.sniptoss/`, and the write-back command `pizhu` is now `sniptoss`. See "Migrating from pizhu" at the end |
| `pizhu/3` (2026-10-17) | Adds **comments on a whole folder**: `material.kind` can be `folder`; one notes file per folder (file name below), covering all items in the folder, including subfolders |
| `pizhu/2` (2026-10-15) | Freehand `path` gets an optional `breaks`: when a stroke leaves the frame and comes back, only the parts inside the frame are recorded, and the parts are not joined by a line |
| `pizhu/1` | First version. A subset of the newer versions and read as usual; a file the app modifies is written back in the current version |

Additions that only add optional content do not bump the version number; from 1.0.0 on, the document states from which app version they exist. Everything described here is already in 1.0.0, including the optional `project.json` (the language of REVIEW.md), a note's `material_sha256` (which version of the item it was written on), a note's `color` (a color picked for its marks) and a `color` on each entry of `anchor.shapes` (a color picked for one place).

## Where it lives

Notes travel with the item. They live in `.sniptoss/` under the root folder of the project that contains the item (like `.git/`):

```
<project>/
  .sniptoss/
    REVIEW.md                      # generated automatically: a summary of all open notes; agents read this first
    project.json                   # settings for this notes folder: which language REVIEW.md is written in (see "Notes folder settings" below)
    annotations/
      assets__hero.png.json        # one file per item; file name = the relative path with / replaced by __
      video__intro.mp4.json
      @folder.json                 # comments on a whole folder (since pizhu/3): this one is for the folder that holds .sniptoss itself
      assets__ui@folder.json       #   the subfolder assets/ui; items always have an extension (.png.json), so the names cannot collide
    snapshots/
      k3f9a2.png                   # one snapshot per note: the original image with the position boxed / the video frame / the PDF page
    .gitignore                     # ignores only the temporary files made while writing (*.tmp) and locks (*.lock); the app adds one if it has written something and there is none; an existing one is left alone
```

Whether the notes themselves are committed to git is up to the user; the app does not ignore them on the user's behalf.

- Paths are always forward-slash paths **relative to the folder that contains `.sniptoss/`**, such as `assets/hero.png`.
- `REVIEW.md` and `snapshots/` can both be regenerated from `annotations/*.json`; **the real data lives only in the JSON**.
- **The file name is only a human-friendly label; which item a file belongs to is determined by `material.path` inside the file.** Do not derive the path from the file name when reading.
  For file names longer than 200 characters (the item is nested deep in the project): the last 120 characters of the name are kept and `~` plus a fingerprint of the whole path
  (64-bit FNV-1a, 16 hex digits) is appended, e.g. `…__layer8__final-draft.png~1f3a9c0b7d2e4f68.json` (NTFS allows at most 255 characters per path component). The rule is `slugFor` in core.
- File names can collide: `a__b.png` and `a/b.png` at the project root both map to `a__b.png.json`. When the app finds that "this name already belongs to another item", it does not write and asks for a rename;
  it never merges the notes of two items into one file.

## Notes folder settings `project.json` (optional)

```json
{
  "language": "en"
}
```

- `language`: the language `REVIEW.md` is written in (language codes: `zh-CN`, `zh-TW`, `en`, `ja`, `ko`, `fr`, `de`, `es`, `it`, `pt-BR`, `ru`). Both the `REVIEW.md` the app writes and the command `sniptoss review` follow it.
- The first time the app needs to write `REVIEW.md` and this file does not exist yet, it creates one: if the folder **already has** a `REVIEW.md` (written by an earlier version, always in Chinese), it records `zh-CN`; otherwise it records the interface language at that moment (command line: the system display language).
- After that it **does not follow the interface language**: when several people use different languages in the same project, `REVIEW.md` is not rewritten back and forth (docs/adr/0001-i18n.md, item 7). To change the language, edit this file by hand: the command line follows it the next time it runs; the app picks it up after it is reopened, the next time it writes `REVIEW.md`.
- When reading: if the file is missing, is not valid JSON, or `language` is not recognized, decide again by the rule above (an unrecognized value is not overwritten; it is left as it is). More fields may be added later; a reader ignores fields it does not recognize.
- The text handed over by "Copy as Text" does not look at this file; it follows the interface language (it is what the person at that moment gives to their own AI).

## Notes file per item: `annotations/<slug>.json`

```jsonc
{
  "schema": "sniptoss/5",
  "material": {
    "path": "assets/hero.png",          // relative path
    "kind": "image",                    // image | video | pdf | slides
    "sha256": "9f2c…",                  // SHA-256 of the item when the first note was written; each note also records its own (material_sha256), which takes precedence
    "width": 1920, "height": 1080,      // pixel size of an image/video; not written for pdf/slides, see each page
    "duration": 63.2,                   // video only: seconds
    "pages": [{ "width": 960, "height": 540 }]  // pdf/slides only: the size of each page (PDF points / slide pixels)
  },
  "annotations": [ /* see below */ ]
}
```

Where `width` / `height` come from for some image types:

- **SVG**: its own `width` / `height` (converted to pixels); when they're missing, the width and height of its `viewBox`. Multiplying back gives coordinates in the SVG (add the `viewBox` origin when it doesn't start at 0)
- **TIFF, HEIC / HEIF**: the pixel size after applying the orientation recorded in the file; for a multi-page TIFF, the first page

### Comments on a whole folder (since `pizhu/3`)

Remarks that are not about one particular file but about a whole folder ("this batch is too dark overall, brighten all of it"). **They cover all items in that folder, including subfolders.**

```jsonc
{
  "schema": "sniptoss/5",
  "material": {
    "path": "assets/ui",                // relative path of the folder; "." = the folder that holds .sniptoss itself
    "kind": "folder"                    // no sha256, no size
  },
  "annotations": [ /* as below; anchor is an empty object {}, and there is no snapshot */ ]
}
```

## A single note (an entry of `annotations`)

```jsonc
{
  "id": "k3f9a2",                       // 6 lowercase letters/digits; SnipToss avoids existing ids, so it is unique within the project (readers can only rely on uniqueness within one file); agents use it to refer to a note
  "status": "open",                     // open | resolved (done) | wontfix (won't fix)
  "category": "change",                 // change (modify) | remove (delete) | add (new) | question
  "body": "The title text is too thin; switch to a bolder sans-serif face",
  "anchor": {
    "page": 3,                          // pdf/slides only: the page number, starting at 1
    "time": { "start": 12.5, "end": 15.0 },  // video only: seconds; omit end when only a single point in time is marked
    "shapes": [                         // where this comment is marked (since sniptoss/5; an array even for one place). All coordinates are normalized to 0–1, with the origin at the top left
      { "type": "rect", "x": 0.12, "y": 0.08, "w": 0.40, "h": 0.10 },
      { "type": "rect", "x": 0.12, "y": 0.62, "w": 0.40, "h": 0.10 }
      // Other shapes:
      // { "type": "point", "x": 0.5, "y": 0.5 }
      // { "type": "arrow", "from": [0.1,0.2], "to": [0.3,0.25] }    // arrow: points from `from` to `to`
      // { "type": "path", "points": [[0.1,0.2],[0.15,0.22], …] }   // freehand circling
      // { "type": "path", "points": [ … ], "breaks": [12] }        // a stroke broken into segments: a new segment starts at points[12] and is not joined to the previous point
      // any entry may carry "color": "#ffc233": a color picked for that place alone (optional), see below
    ]
  },
  "snapshot": "snapshots/k3f9a2.png",   // relative to .sniptoss/
  "author": "user",
  "created_at": "2026-10-13T10:20:00Z",
  "updated_at": "2026-10-13T10:20:00Z",
  "handed_off_at": "2026-10-13T10:32:00Z",  // optional: the time of the most recent copy-out (Copy as Text, Copy as Images); absent if never copied
  "material_sha256": "9f2c…",           // optional: SHA-256 of the item when this note was written; differs from the item's current hash = the note is on an earlier version, see below
  "color": "#5b8cff",                   // optional: a color picked for this note's marks, #rrggbb; absent = the mark color from Settings, see below
  "replies": [                          // the agent replies when it has made the change, or asks a question
    { "author": "codex", "body": "Switched to Source Han Sans Bold", "at": "2026-10-13T11:02:00Z" }
  ]
}
```

Why coordinates are 0–1: the positions still line up after the item is scaled or exported at another resolution. When you need pixels, multiply by `width`/`height`
(`REVIEW.md` has already done this for the agent).

Points, rectangles and arrows drawn in the interface are aligned to whole pixels of the item (freehand `path` excepted) and stored with 4 decimal places
(from a side length of 10,000 pixels upward, each additional digit adds one decimal place; x follows `width`, y follows `height`);
multiplying back by `width`/`height` and rounding gives the whole-pixel number shown in the interface.

A mark can be started outside the frame, but only the part inside the frame is recorded: for a rectangle, the area that overlaps the frame; for an arrow, the stretch inside the frame;
for a freehand stroke, the parts outside the frame are cut off (a stroke that leaves and comes back is broken into several segments, see `breaks`). So coordinates always fall within 0–1.

`shapes` has as many entries as the places the note marks, and **the comment applies to every one of them** (“Make all three of these buttons rounded”: the user drew three rectangles in the interface and wrote one sentence; since sniptoss/5, before which a note could mark only one place).
The places share one number, one snapshot (every place is drawn on it), the same time (video) and the same page (PDF). The order is the order the user drew them in and means nothing else.

`shapes` omitted = a comment on the whole image / whole page / whole time range. On a video, a note with `anchor.time` and no `shapes` is called a “timestamped comment” in the app (about the whole frame at that moment or over that range); one with neither `time` nor `shapes` is an “overall comment” (about the whole video). This is only how the app groups notes; the format is the same.

`handed_off_at` (an optional field): recorded each time the interface copies something out; the notes panel uses it to show "Copied 10:32".
It does not count as a modification of the note, so `updated_at` is not touched; if both sides changed it at the same time, the later one wins. An older version that reads it preserves it as it is.

`color` (an optional field): a color the user picked for this note's marks, `#` followed by 6 hex digits.
Absent = the "Mark color" from Settings; when the user picks the Settings color again, the app removes the field. An older version that reads it preserves it (and draws with the Settings color).

`color` on each entry of `anchor.shapes` (an optional field): on a note that marks several places, the user can recolor one place,
so the comment can tell the places apart by color (“make the orange one rounded, remove the yellow one”). Each place is drawn in its own `color`, else the note's `color`, else the Settings color.
In files SnipToss writes: when the places differ in color, **every place carries a `color`** (so a program that does not know the user's settings can still name each color), and the note's `color` is the first place's color (older versions draw the whole note in it);
when the places become the same color again, the per-place colors are removed and only the note's is kept; recoloring the whole note removes the per-place colors. A note with one place never has a per-place color.

Colors only decide how marks are drawn (on the image, in snapshots, in Copy as Images) and are not part of the comment itself. But users refer to places by color in their comments,
so **when the places of a note differ in color, `REVIEW.md` and Copy as Text put the color before each place** (“2 places — (Orange) Point: …; (Yellow) Point: …”; the six presets are named, any other color is written as its value); when they are all the same, colors are not mentioned.

### Notes on an earlier version (`material_sha256`, an optional field)

An item may be overwritten in place (an AI edits it and saves to the same file). The locations of the older notes then refer to the image before the overwrite and are wrong on the new one.
So each note records the item's SHA-256 (lowercase hex) at the time it was written. **If it differs from the item's current hash, the note is on an earlier version**:
its location and time refer to the image at that time; go by its screenshot (the screenshot stores the whole frame at that time plus the mark).

- Every note SnipToss writes carries it (unless the hash could not be computed); editing the text or the status does not change it.
- Notes without it (for example, written by another program): if `created_at` is later than the item file's modification time, the item has not changed since, so the note is on the current version; otherwise use the file's `material.sha256`.
  The rule lives in core's `versions.ts` (`writtenOn`, `earlierVersions`), shared by the app and the CLI.
- SnipToss does not draw notes on an earlier version on the image and lists them in a section of their own in the notes panel; Copy as Text puts them in their own section and says to go by the screenshots; `REVIEW.md` and `sniptoss list` mark each one.
  The notes themselves are neither changed nor deleted; their status is up to the user (docs/adr/0008-earlier-versions.md).

## What `REVIEW.md` looks like

It lists only notes that are `open`, grouped by item, one section per note, so **an agent can act without parsing any JSON**. Comments on a whole folder come first (the overall picture first, then each file).
A note on an earlier version (see above) is marked at the end of its line: "(on an earlier version; go by the screenshot for the location)".
A note that marks several places (more than one entry in `shapes`) is written as “2 places — …; …”, and the introduction gains the sentence “Where a note marks several places, the comment applies to every one of them” (only when there is such a note); when the places differ in color, each place is preceded by its color (see above).
When there are notes files that cannot be read (see "Reading rules"), the files affected and the reasons are listed first, under the title, and the notes inside them are not counted.
The sample below is the output with `"language": "en"` in `project.json`; other languages produce the same structure.

```markdown
# Open notes (3)

These are notes the user added to their items with SnipToss. Go through them one by one: look at the snapshot to confirm the position (the mark is drawn on it), then change the item as the note says.
Notes marked “Whole folder” apply to every item in that folder (including subfolders; ./ means the folder that contains .sniptoss), not to one particular file.
Where a note marks several places, the comment applies to every one of them.
Categories: “Change” means modify the marked content as described; “Remove” means remove the marked content.
File and snapshot paths are relative to the project folder (the folder that contains .sniptoss). Each position starts with a rough location in the frame, followed in parentheses by percentages measured from the top-left corner; px values are pixels of the original item, with the origin at the top left; video times are minutes:seconds.milliseconds (hours:minutes:seconds.milliseconds for one hour or longer).

## ./  ·  Folder comment: applies to every item in the folder (including subfolders)

### [r0ot01] Change · Whole folder
Add the same watermark to the bottom right corner of every image

## assets/hero.png  ·  Image 1920×1080

### [k3f9a2] Change · 2 places — Region: top left of the frame (x 12%–52%, y 8%–18%), x=230 y=86 w=768 h=108 px; Region: bottom left of the frame (x 12%–52%, y 62%–72%), x=230 y=670 w=768 h=108 px
The title text is too thin; switch to a bolder sans-serif face
Snapshot: .sniptoss/snapshots/k3f9a2.png

## video/intro.mp4  ·  Video 1280×720 · 01:03.200

### [p0c7xe] Remove · 00:12.500–00:15.000 · Point: bottom right of the frame (x 90%, y 90%), x=1152 y=648 px
Remove this watermark
Snapshot: .sniptoss/snapshots/p0c7xe.png
```

## Reading rules (how the app reads; follow these when writing scripts or hand-editing JSON)

Since 2026-10-17 (docs/adr/0006-format-versioning.md). When SnipToss and the `sniptoss` command read each notes file:

- **Unrecognized fields are preserved as they are**: extra fields on the file, on `material`, on an individual note, or on `anchor` are still there when the app writes the file back after a change. Your own tools can add things to them.
- **The old form is still accepted**: `anchor.shape` (a single shape, `sniptoss/4` and earlier) is read as a `shapes` with one entry, and written back as `shapes`.
  A `sniptoss/5` file with `shape` but no `shapes` (JSON hand-edited from the old documentation) is read the same way; when both are present, `shapes` wins and `shape` is kept as an unrecognized field.
- **May be omitted and are filled in when reading**: `anchor` (treated as `{}`), an empty `anchor.shapes` array (treated as absent; removed when written back), `replies` (treated as `[]`), `author` / `created_at` / `updated_at` (treated as an empty string), `author` / `at` in a reply (treated as an empty string); a `handed_off_at` that is not a parseable time is treated as absent (removed when written back); a `material_sha256` that is not a string is treated as absent (removed when written back); a `color` (the note's or a place's) that is not `#rrggbb` (either case) is treated as absent (removed when written back).
- **Must be correct** (otherwise the whole file cannot be read, see below): `material.path` and `material.kind` are non-empty strings; `annotations` is an array;
  each note's `id` is non-empty and not repeated within the file, `status` is one of `open | resolved | wontfix`, `category` is one of `change | remove | add | question`, and `body` is a string;
  `anchor.page` is an integer ≥ 1; `anchor.time.start` (and `end`, if present) is a number; a reply's `body` is a string;
  `anchor.shapes`, if present, is an array whose entries are objects with a string `type`; the coordinates of known shapes are finite numbers (`x y w h` of `rect`; `x y` of `point`; `from` / `to` of `arrow` are `[x, y]`; `points` of `path` is `[[x, y], …]`; `breaks` is an array of integers).
  An unrecognized `type` is not an error (a shape added later); wherever shapes are drawn, it is skipped.
- **An unreadable file does not block the others**: the interface states at the top of the notes panel which file it is and why (not valid JSON / unrecognized format / which field is wrong), and the notes of that item cannot be edited for now,
  so that a blank file does not overwrite the unreadable one; once the file is fixed or deleted, this recovers automatically. The command line skips the file, says so on standard error, and carries on with the rest as usual.
  `REVIEW.md` lists the unreadable files at the top (agents read it first; without this they would assume those are all the notes there are).
- **A format newer than this version** (`sniptoss/6` onward): what can be understood is displayed as usual but is **read-only** (the interface prompts to upgrade; the command line's `resolve` / `wontfix` refuse and explain); what cannot be understood is treated as unreadable.
- Only changes that "an older app would misread", such as adding a new value to `status` or `category`, changing the unit of coordinates or time, or changing the structure of a field (`sniptoss/5` turned `shape` into `shapes`), bump the major version number; adding only optional fields does not.

Samples for each version are in `tests/golden/formats/`; the tests ensure that all of them can be read and that nothing is lost when they are written back.

## How an agent handles notes

1. Read `.sniptoss/REVIEW.md`; when you need to confirm a position, open the corresponding snapshot.
2. Change the item according to the notes.

There is no need to write back the status: the changed item is re-imported and checked by the user, the status of notes is marked by the user in SnipToss, and the existing notes are kept as a record.
The command-line `sniptoss resolve` / `wontfix` still work, for the user's own scripts; when editing the JSON directly, change `status` and append an entry to `replies`, then run `sniptoss review` to regenerate `REVIEW.md`.

## Planned extensions (not implemented yet; reserved so the structure does not have to change later)

According to "What is supported" in `docs/design.md`, these item types and positioning fields will be added. All of them are **new optional fields**; the meaning of existing fields does not change:

| `kind` | New positioning information |
|---|---|
| `capture` (screenshot) | `material.source`: `{ "from": "clipboard" \| "window" \| "adb", "title": "window title", "device": "phone serial number", "at": "time" }` |
| `web` (web page) | `material.url`; `anchor.element`: `{ "selector": "CSS selector", "text": "element text (truncated)", "rect": {x,y,w,h} (CSS pixels), "viewport": {w,h}, "scroll": {x,y} }` |
| `miniprogram` (mini program) | `anchor.route` (such as `pages/index/index`); when the element can be obtained, same as `anchor.element` |
| `text` (text/code) | `anchor.lines`: `{ "start": 12, "end": 18 }`; `anchor.quote`: the exact words being annotated |
| `audio` | same `anchor.time` as video, with no `shapes` |
| `document` (Word etc.) | same `anchor.page` as PDF |

## Migrating from pizhu (2026-10-17)

The technical name was changed from the pinyin "pizhu" to the English name SnipToss (docs/adr/0007-rename.md); the format itself did not change:

| Before | Now |
|---|---|
| Data folder `.pizhu/` | `.sniptoss/` (the structure and file names inside are the same) |
| `"schema": "pizhu/1"`–`"pizhu/3"` | `"sniptoss/4"` (same content as `pizhu/3`; older versions are still read as usual, and the app upgrades them to `sniptoss/4` when it writes them back) |
| Write-back script `.pizhu\pizhu.cmd`, command `pizhu` | Command `sniptoss` (since 2026-10-20 no write-back script is placed in projects; a `.sniptoss\sniptoss.cmd` left by an earlier version is deleted when the project is opened) |

- **When it opens a project**, SnipToss renames the whole `.pizhu/` to `.sniptoss/` (if renaming is not possible it copies it over, and deletes the old one if it can); the old `pizhu.cmd` is deleted (since 2026-10-20 no new write-back script is placed).
- When the command line meets a project that has not been opened yet and has only `.pizhu/`, it reads and writes in place in `.pizhu/` and does not create a separate `.sniptoss/`.
- If you write your own scripts to read notes: look for `.sniptoss/` first, and only then for `.pizhu/`; accept `pizhu/1`–`pizhu/3` and `sniptoss/4` as `schema`.
- Text copied for an AI before the rename and not yet acted on refers to `.pizhu\pizhu.cmd`; once the project has been migrated this path no longer exists, so just copy it again.

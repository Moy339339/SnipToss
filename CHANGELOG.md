# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Until 1.0 the app ships as `1.0.0-beta.N` (shown as "Beta N" in the app).

The annotation data format has its own version (`"schema": "sniptoss/5"`); its history is in [docs/annotation-format.md](docs/annotation-format.md).

## [Unreleased] — 1.0.0

First public release.

### Added

- Annotate images (PNG, JPEG, WebP, GIF, SVG, BMP, AVIF, TIFF, HEIC, ICO) and videos (MP4, WebM, MOV, M4V, MKV) with pins, rectangles, freehand pen and arrows; notes on videos cover a moment or a time range, with frame stepping.
- SVG is drawn at a large size so it stays sharp when zoomed, and positions are recorded in the SVG's own size. TIFF and HEIC are converted by Windows; if the HEIF Image Extension or HEVC Video Extensions is missing, the view explains which one and links to the Microsoft Store. Images with transparency are shown on a checkerboard.
- Notes saved as files in the project's `.sniptoss/` folder: `REVIEW.md` for agents, JSON per item, one snapshot per note. Documented, versioned format with a JSON Schema.
- Copy as Text (for agents that read local files) and Copy as Images (for web-based AI and chat apps); checked notes, or all open notes in the notes panel.
- Folder comments that apply to every item in a folder.
- One note can mark several places: while the note box is open, keep drawing with any tool and every mark joins the same note under the same number (`Alt+Z` removes the most recent one; right-click a mark to remove just that one). The screen-capture overlay works the same way (keep marking while its note box is open; `Alt+Z` or Undo removes the most recent mark). Copy as Text and `REVIEW.md` list the places together. The data format moves to `sniptoss/5` (`anchor.shape` becomes `anchor.shapes`); earlier files are converted when read.
- Overall notes (no location) are listed and numbered in a section of their own, so the numbered pins always match the marks on the image.
- Timestamped comments on videos (`T`, the toolbar button, Annotate → Add Timestamped Comment…): a note about the current frame (or a range) without a position, listed in its own section in time order; overall comments on a video now mean the whole video.
- A mark at a single moment of a video is drawn only on its own frame while paused (and for one second as playback passes it), so it never appears on a later frame.
- Notes panel sections (canvas marks, overall notes, notes on an earlier version) each have a header with a count and can be collapsed; a filter menu in the panel's search box shows only the chosen kinds and, optionally, resolved notes. Collapsed and filtered-out notes are left out of Select All and Copy, like search results.
- Hide the marks on the canvas to see the original (`Shift+H`, the eye on the zoom bar, or View → Show Canvas Marks), or hide a single mark from its note card or context menu; a hidden mark still shows while its note is selected. Pointing at a note highlights its mark, and the selected mark is drawn on top.
- When an item is overwritten in place, notes written on the earlier version are no longer drawn on the new one: they move to their own section, show the snapshot from that time when selected, and are marked as such in Copy as Text, `REVIEW.md` and `sniptoss list`. Each note records the item's hash (`material_sha256`).
- Library grouped by project: drag and drop, File Explorer context menu, paste from the clipboard, filtering, pinning, multi-select; reloads items and notes changed by other programs.
- Note status (open, done, won't fix) set by the user, with undo and redo for every change.
- Screen capture with notes from a global hotkey (default `Ctrl+Alt+A`): mark up any part of the screen and copy one combined image.
- In the screen-capture overlay, click a mark (its number or its outline) to select it, then pick a color or press `1`–`6` to recolor just that mark — also while its note box is open, so the places of one note can be told apart by color. When they differ, the copied text names each place's color. Undo and `Esc` restore the previous color.
- The places of one note can have their own colors in the app too: right-click a place for "Color of This Mark", or click it and press `1`–`6` (also while the note box is open). Each place's color is saved on its entry in `anchor.shapes` (an optional field; the format stays `sniptoss/5`), and Copy as Text and `REVIEW.md` name each place's color when they differ. Recoloring the whole note recolors every place.
- Menu bar with every command, keyboard shortcuts for all of them, a shortcut overview (`?`), access keys.
- 11 interface languages, following the Windows display language by default; `REVIEW.md` keeps the language recorded for each project.
- Accessibility: keyboard navigation in all dialogs and menus, screen-reader labels (including the keyboard cursor in the library), reduced motion and Windows contrast themes.
- About page with license, privacy statement and third-party notices (listed by component in the interface language; license texts in the original English).
- Help menu: getting started, report an issue (opens GitHub with diagnostic info, no upload), copy diagnostic info, export a diagnostics package (logs and settings with paths and names removed).
- Update check: once a day after startup (can be turned off) or from Help → Check for Updates; a notice in the title bar links to the download page. This is the only network access.
- Portable version: with a `data` folder next to the app, all data stays in it and the registry is never touched.
- Command-line tool `sniptoss` (list, review, resolve, wontfix); its messages follow the system display language.

### Changed

- Renamed from pizhu to SnipToss: `.pizhu/` folders, settings and registry entries are migrated automatically.

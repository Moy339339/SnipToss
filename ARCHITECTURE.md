# Architecture

SnipToss is a Windows desktop app made of a thin native shell and a web UI, plus a pure-logic core shared with a command-line tool. The data it produces — notes in a project's `.sniptoss/` folder — is the product: it is a documented, versioned file format that agents read directly ([docs/annotation-format.en.md](docs/annotation-format.en.md)).

```
SnipToss.exe  (app/, .NET 10 WPF)
├─ window, tray, global hotkey, single instance, settings, logs, crash handling
├─ screen capture overlay  (app/Capture, native WPF)
└─ WebView2
   └─ UI  (packages/web, React + Vite; note logic from packages/core)
        │  JSON messages: host.ts  ◄──►  Bridge.cs
        ▼
   Bridge.cs ── reads items through virtual hosts (read-only)
             └─ writes only <project>/.sniptoss/  (REVIEW.md, annotations/*.json, snapshots/)
                                    ▲
                                    └── packages/cli: sniptoss list / review / resolve / wontfix
                                    └── agents (Claude Code, Codex …) read REVIEW.md and the snapshots
```

## Pieces

**`app/` — the shell (C#, WPF + WebView2).** Owns everything that needs the operating system: the main window (the system title bar is removed; the UI draws its own), the tray icon, the global screen-capture hotkey, the single-instance pipe (opening a file while the app runs hands it to the open window), settings in `%APPDATA%\SnipToss\settings.json`, logs in `%LOCALAPPDATA%\SnipToss\logs`, the File Explorer context menu and start-at-sign-in (HKCU only). Each drive that holds items is mapped to a WebView2 virtual host, so the UI loads images and videos without file:// access. A portable copy (a `data` folder next to the exe) keeps all of this inside `data` and never touches the registry (`AppPaths.cs`).

**`app/Updates.cs` — the only network access.** Asks the GitHub Releases API for a newer version in the same channel (stable, or betas for a beta build) — once a day after startup unless turned off, or from Help → Check for Updates. It only reports; the user opens the download page.

**`app/Bridge.cs` — the only door to the disk.** The UI sends JSON messages; the bridge validates them and only ever writes inside a project's `.sniptoss/` folder. It also scans folders for items, computes file fingerprints, reads and writes the clipboard, and opens dialogs. The contract is documented in [docs/host-api.md](docs/host-api.md) and implemented a second time by the mock host the UI tests use (`tests/e2e/mock-host.ts`).

**`app/Capture/` — screen capture with notes.** A native WPF overlay, one per monitor, so it appears within a couple of hundred milliseconds of the hotkey. `OverlayStateMachine` holds the state and transitions (selection, tools, marks, note boxes, undo) without touching WPF controls, so it is unit-tested; `CaptureOverlay` only draws and routes input. `CaptureSession` composes the final image (screenshot, marks and the notes block underneath) and puts it on the clipboard.

**`packages/core` — the format and the text (TypeScript, no Node.js or browser APIs).** Note types, reading with the leniency rules of the format, migrations between format versions, file naming, `REVIEW.md` and the "Copy as Text" text. Every user-facing word goes through an injected `Translate` function, so the same code writes English or Chinese.

**`packages/web` — the UI (React, Vite).** Library on the left, viewer in the middle (images, videos with frame stepping), notes panel on the right, menu bar on top. The state lives in a few stores (`annotationStore.ts` for reading, writing, undo/redo and syncing external changes; `navigation.ts`; `draft.ts` …). Things that change every frame — the playhead, a box being dragged — update the DOM directly, not React state.

**`packages/cli` — `sniptoss`.** A small command-line tool on top of core for scripts and agents: list notes, regenerate `REVIEW.md`, mark notes done or won't fix with a reply.

**`i18n/locales/` — one catalog per language** in ICU MessageFormat, shared by the UI (FormatJS) and the shell (MessageFormat.NET). Simplified Chinese is the source language. Golden files (`tests/golden/messages.json`, `tests/golden/locale.json`, `tests/golden/where.zh-CN.json`) make sure TypeScript and C# format the same message and pick the same language identically.

## Invariants

- The app never modifies the user's items; it writes only to `.sniptoss/`. Writes are atomic (temp file → flush → replace, retrying while the target is locked; ADR-0005), and settings are read before every write so two processes don't overwrite each other.
- Coordinates are stored normalized to 0–1 and times in seconds. Only text for people converts them to pixels and `mm:ss.mmm`.
- The format is a contract: unknown fields survive a round trip, unreadable files are reported instead of overwritten, newer major versions open read-only (ADR-0006).
- Nothing on the UI thread may wait on a disconnected network drive: drive availability is checked in the background (`Volumes.cs`).
- External changes (an agent re-exporting an item, editing a notes file) are detected by comparing fingerprints on a timer while the window is visible (`ChangeWatch.cs`).

## Tests

- `tests/AppTests` — xUnit for the shell: settings, atomic writes, the capture state machine and geometry, path handling, localization.
- `packages/*/test` — vitest for core, the CLI and UI helpers, including the golden files shared with C#.
- `tests/e2e` — Playwright against the built UI with the mock host: each test gets its own temporary project and fake clipboard, and every notes file written is validated against the JSON Schema.
- `tests/shell` — Playwright over CDP against real `SnipToss.exe` test instances (built with test hooks into `tests/shell/.app`): virtual hosts, writing to disk, file watching, single instance, tray, crash recovery, screen capture on fake off-screen monitors.
- `tests/perf` — performance budgets: startup, hotkey to overlay, a 20,000-item library, 1,000 notes.

## Decision records

The reasoning behind the main choices is in `docs/adr/` (in Chinese): localization (0001), installer and updates (0002), a CLI that doesn't need Node.js (0003), test layers (0004), the write protocol (0005), format versioning (0006), the rename from pizhu (0007), notes on an earlier version of an item (0008), one note marking several places (0009) and supporting Windows 11 only (0010).

# ADR-0011 Mac shell: Swift + AppKit + WKWebView

- Status: accepted (2026-10-29)
- Related: ADR-0004 (test layers), ADR-0010 (Windows 11 only); the bridge contract is `docs/host-api.md`

## Context
The Windows app is a WPF window hosting the web UI in WebView2. A Mac version needs a native shell that hosts the same web UI and implements the same bridge contract (43 methods, 7 events in `docs/host-api.md`): reading and writing `.sniptoss/`, serving local media to the page, drag and drop with real paths, a global hotkey, and screenshot annotation.

Candidates considered:

| Option | Why not (or why) |
|---|---|
| .NET 10 for macOS (`net10.0-macos`) | Would reuse the pure-logic part of `app/` (about 4,300 lines) and its tests. The workload is tied to one Xcode version and builds only from the command line; few people use it, so fixes and examples are scarce. |
| **Swift + AppKit + WKWebView** | The mainstream way to build a Mac-only utility; the Apple APIs we need (ScreenCaptureKit, global hotkeys, menu bar, signing) are first-class; smallest package; no framework layer between the app and the system. |
| Electron | Same engine as the tests we already run, but a package of roughly 90 MB, and the screenshot layer still needs a native module. Kept as the fallback if WKWebView differences prove too costly. |
| Tauri 2 | Rewrites the whole shell in Rust with no reuse, and needs a Rust toolchain (see `docs/design.md`). |
| Photino.NET, Avalonia, MAUI | Custom URL schemes without Range support or still a draft, no tray icon / global hotkey / drop paths, or no way to place the window controls. |

A minimal Swift shell was built and run on a GitHub-hosted `macos-26` runner (Xcode 26.6, Swift 6.3) to check the parts the web UI depends on:

- A `WKURLSchemeHandler` serves a 256 MB file with correct `206` / `416` answers for open-ended, suffix and 64 MiB ranges; the handler hands data over in 256 KiB chunks and memory grows by tens of MB only.
- A 5 MB message round-trip between page and native code takes about 130–140 ms.
- `localStorage` survives a restart of the process.
- `currentCSSZoom`, `requestVideoFrameCallback`, CSS anchor positioning, `field-sizing` and `zoom` all exist; with `html { zoom: 1.25 }` the layout numbers match Chromium's.
- mp4 playback through the scheme handler works (12 of 12 loads, seeks and plays). A handler must clear its record of cancelled tasks when a new task starts: a task's address can be reused, and a stale record silently drops the new request.
- By default Tab moves focus between text fields only. `WKPreferences.tabFocusesLinks = true` makes buttons and links reachable, which the dialog keyboard model needs.

## Decision
1. The Mac shell is written in **Swift with AppKit and WKWebView**, Apple Silicon only, **macOS 14 or later** (the screen-capture API the screenshot feature needs, `SCScreenshotManager`, starts at 14), in its own directory (`app-mac/`). It shares the web UI, `packages/core`, the locale files, the format schema and the golden files with the Windows app, and shares no code with `app/`.
2. The bridge contract is the single source of truth for behavior. Everything the contract describes is implemented a second time in Swift (library, settings, safe file writes, hashing, the screenshot state machine); the shared golden files under `tests/golden/` are what keeps the two implementations equal, so any contract change comes with a golden or contract test that both sides run.
3. Built and tested on GitHub-hosted macOS runners.

## Consequences
- A change to the bridge contract or to shell logic is made twice (C# and Swift). Keep shell logic thin and push behavior into the web UI and `packages/core` where possible.
- ICU MessageFormat strings used by the shell (plural / select in 11 languages) are not parsed by Foundation; how they are formatted in Swift is decided when the shell gets there, and `tests/golden/messages.json` is the acceptance test.
- WKWebView has no CDP or WebDriver for an embedded view, so shell smoke tests need a JS-evaluation channel compiled into test builds only (the same idea as `TestHooks` on Windows).
- The Windows app is not touched by this decision. Signing and the update path are decided separately.

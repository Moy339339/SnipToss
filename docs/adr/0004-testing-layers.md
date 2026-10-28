# ADR-0004 Test layers

- Status: accepted (2026-10-17)
- Related: `docs/host-api.md` (the mock host implements it); `CONTRIBUTING.md` "Tests"

## Context
The goal is a test for every button and every small feature. There were only 7 vitest files (about 400 lines); C#, UI components and command-line commands had zero coverage;
self-checks were a set of CDP scripts (`scripts/cdp-*.mjs`) run by hand against a fixed port, 9333. The capture overlay is a native WPF window that CDP cannot reach.
Automated tests must not take over the mouse and keyboard the developer is using.

## Decision
Six layers from bottom to top; the lower, the more numerous and the faster:

| Layer | What it tests | Tools | Where it runs |
|---|---|---|---|
| 1 Unit | TS: core and the pure logic outside host (library, keys, the text part of annotate); C#: `<Name>.Core`, settings read/write, HomeFinder, path guards, scanning, single-instance messages, the capture overlay state machine | vitest; xUnit | locally, CI |
| 2 Golden | The complete output of REVIEW.md, text copied for AI and the screen capture caption in every language; TS and C# identical character for character; ICU messages formatted identically on both sides | vitest + xUnit reading the same `tests/golden/` | locally, CI |
| 3 UI e2e (main workhorse) | Every menu item, button, shortcut, setting, context menu, drag and drop, the full note workflow | Playwright + **mock host** (the UI build runs in plain Chromium; the shell is replaced by a fake shell that implements `docs/host-api.md` and reads and writes a temp folder) | locally, CI, can run in parallel |
| 4 Real-shell smoke | The bridge really works: startup, adding items, writing notes, file-watch sync, copying for AI, tray | Playwright `connectOverCDP` to a test instance | locally, CI (the runner needs WebView2) |
| 5 Capture overlay | Selection / hit testing / DPI conversion (state machine unit tests) → render with a fake screen bitmap and compare with golden images → inject mouse and keyboard events directly through the test pipe | xUnit + image comparison; test hooks | locally, CI |
| 6 Manual | The feel of the real mouse and keyboard, mixed-DPI multi-monitor setups, real large projects, what it actually looks like pasted into an AI agent | Features marked "manual" in the feature checklist, checked one by one before each release | by hand |

Specific conventions:
1. **The mock host is the executable specification of the shell interface**: maintained together with `docs/host-api.md`; a future Mac shell implements against it and runs the same e2e suite.
2. **Real-shell test instances**: the debugging port is set to `0` and the actual port is read from the `DevToolsActivePort` file, so it never collides with the 9333 that the self-check scripts default to;
   `<NAME>_SETTINGS` and `WEBVIEW2_USER_DATA_FOLDER` point to temp folders, items are temp copies, and the instance is ended with `Stop-Process` (closing the window only hides it to the tray).
3. **Test hooks**: native open/save dialogs, global hotkeys, the screenshot source (replaced by a fake bitmap), the clock — active only when a test environment variable is set **and** it is a development build; release builds drop them at compile time.
4. **Real SendInput runs only in Windows Sandbox or a CI virtual machine**, so it never moves the mouse the developer is using.
5. **Keyboard tests always go through the real key path** (Playwright's `keyboard` or `scripts/cdp-key.mjs`), never `window.dispatchEvent` in the page (it skips the capture order and produces false failures).
6. **Feature checklist**: every feature either points to an automated test or is on the manual checklist run before a release; a feature with no way to test it is not allowed to exist.
7. **For every bug, first write a failing test that reproduces it, then fix**; regression tests only grow.
8. **One command**: `npm run verify` = typecheck + lint + vitest + check-design + `dotnet test`; `npm run e2e` runs layer 3; `npm run e2e:shell` runs layer 4.
9. Coverage thresholds: TS core and `<Name>.Core` ≥ 90%, C# logic overall ≥ 70%.
10. **Performance budget script** (must pass before a release): warm start ≤ 1.0 s, cold start ≤ 2.0 s, hotkey to capture overlay visible ≤ 200 ms, a 20,000-item library and 1,000 notes scroll without dropping frames.
    CI machines have unstable performance, so the budget runs locally only; CI runs the functional tests.

## Implementation
- Layer 3: `tests/e2e/`. Playwright drives **the Edge that ships with the system** (`channel: "msedge"`) — WebView2 is the Edge engine, so this is closest to the real app and needs no separate browser download.
  UI files and items are served from disk by intercepting requests to `*.sniptoss.example` (same addresses as the real app, so the CSP applies as it does there); the clipboard is replaced by a fake clipboard in the page.
  `npm run e2e`: the 7 core-workflow cases took about 9 seconds.
- Lint uses oxlint, not ESLint (TS 7 has no JS API, so typescript-eslint cannot run); see `.oxlintrc.json`.
- Layer 4: `tests/shell/`. `npm run e2e:shell` first builds the UI and builds the shell to `tests/shell/.app` (it does not touch the everyday `app/bin`),
  then runs `playwright.shell.config.ts`. The fixture `harness.ts` starts a test instance per case: temporary settings (capture hotkey cleared, tray hint marked as seen),
  debugging port 0 + reading `DevToolsActivePort`, `taskkill /T` to clean up, and no `[ERROR]` allowed in the log. The earlier manual script `scripts/check-write-race.mjs` was folded in and deleted.
  9 cases, about 15 seconds: startup, writing to disk, file-watch sync, write race, video playback, single-instance hand-off, hide to tray and reopen, opening from outside after `--tray`, reload after the UI process crashes.
  Not part of `verify`: it briefly opens windows on screen and shows an icon in the tray.
- How convention 3 is realized: real-shell tests build Release (it has to match what ships), so the "development build" is a **compile switch**:
  all of `app/TestHooks.cs` is wrapped in `#if TEST_HOOKS`, defined only by `build-app.ps1 -Out tests/shell/.app -TestHooks` (`npm run e2e:shell` / `perf`)
  (the csproj property `SnipTossTestHooks`); `-TestHooks` is allowed only with that output folder, and a normal build counts as successful only if `SnipToss.dll` does not contain `TestHooks`.
  Even when compiled in, the hooks are honoured only in test instances (`SNIPTOSS_SETTINGS` set). Current entry points: `debugThrow` (throw on the UI thread / a background thread / an unobserved background task),
  `debugTray` (tray icon and menu), `debugTrayAct` (left click, click a menu item). The capture overlay's fake bitmap and injected keys follow the same pattern (see the next item).
  Text and buttons of native windows (error window, help page, system message boxes) are read with UI Automation and clicked with `Invoke` (`tests/shell/windows.ps1 -Uia / -Click`), without moving the mouse.
- How layer 5 is realized: capture overlay tests are also in `tests/shell` (`capture.spec.ts`), with hooks as above, compiled only into the shell test build (`CaptureFake / Do / State / Result` in `app/TestHooks.cs`,
  `app/Capture/CaptureOverlay.TestHooks.cs`):
  - **Fake monitors**: the screenshot source is replaced by a fake bitmap (colors computed from the physical pixel coordinates, and the test computes the expected values with the same formula), placed off-screen (starting at -20000, -20000) —
    the overlay still opens windows and runs all of its code, but nobody in front of the screen sees it and no real screen is captured;
    the number of monitors and each one's scale (1 / 1.25 / 1.5) can be set, and the window list and cursor position are fake too.
  - **Injecting mouse and keyboard**: not through SendInput (convention 4) but by calling the overlay's handlers directly — the handlers take coordinates and modifier keys as parameters, so real events and the test hooks run the same code;
    the mouse follows WPF's real routing (while captured, it goes to the capturing element; otherwise to the topmost element by `InputHitTest`, so a covered button cannot be clicked, matching the `elementFromPoint` check on the UI side).
    With fake monitors the overlay intercepts the real mouse and keyboard at the window level (tunneling events), so someone moving the mouse or typing nearby does not disturb the test.
  - **The clipboard is replaced by a recorder** (it records formats, text, PNG and bitmap size, and can be set to be busy for the first few attempts); the completion toast and error toast record their title and body; the composed image can be color-sampled by coordinates.
  - Global hotkeys: `debugHotkey` sends WM_HOTKEY to an invisible window (received even if not registered); registration itself is verified by having another process try to register the same keys (failure to register = already taken).
  - Pixel-by-pixel comparison with golden images (the second step of layer 5 in the table) was not done: sampling colors by coordinate is enough for pixel assertions, and images with rendered text differ by a pixel or two across machines; the caption area and the text for AI use string assertions.
  - Not testable, so manual: the feel of the real mouse, real multi-monitor setups with different scales, pasting into real programs, input methods, `BitBlt` failures (locked screen, disconnected remote desktop), wake from sleep.

## Rejected alternatives
- **All e2e against the real shell**: slow, cannot run in parallel, depends on WebView2 and a desktop session in CI, and one failing case takes down the ones after it.
- **FlaUI's Mouse / Keyboard classes to drive the capture overlay**: they move the real mouse pointer; using only its UI Automation patterns (Invoke) to check control state is fine.
- **Component snapshot tests (the react-test-renderer kind)**: every style or structure change turns them red, they are costly to maintain and do not catch real problems; visual regression is done with Playwright screenshot comparison instead, only for key screens.

## Consequences
- The existing `scripts/cdp-*.mjs` stay as ad-hoc self-check tools; the test suite does not depend on them.
- The shell needs test hooks; `host.ts` must be able to run under the mock host (outside the shell, `call` currently just rejects).

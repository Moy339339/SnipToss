# Contributing to SnipToss

Thanks for helping. Bug reports, translation fixes and pull requests are all welcome.

- **Bugs**: open an issue with the steps, what you expected and what happened. Attach the diagnostic info (**Help → Copy Diagnostic Info**) — it has versions and the system, but no file paths. If the app misbehaved, **Help → Export Diagnostics Package…** saves a zip with recent logs and settings (item paths and your name removed); attach it if you're comfortable sharing it.
- **Bigger changes** (new features, UI changes, changes to the data format): please open an issue first so we can agree on the approach before you spend time on code.
- **Security issues**: don't open a public issue — see [SECURITY.md](SECURITY.md).

Code comments, tests and the docs are in English: start with [ARCHITECTURE.md](ARCHITECTURE.md), then the design notes in `docs/` and the decision records in `docs/adr/`. Feel free to ask in an issue when something isn't clear.

## Setup

You need Windows 11, Node.js 24, the .NET 10 SDK and PowerShell 7 (`pwsh`).

```powershell
npm install
npm run build                                   # TypeScript packages + web UI
pwsh -File scripts/build-app.ps1 -NoBump        # desktop shell → app/bin/Release/net10.0-windows/SnipToss.exe
```

`scripts/find-dotnet.ps1` looks for a .NET 10 SDK in `SNIPTOSS_DOTNET`, then on `PATH`. (`npm run build:app` also works, but it bumps the version number in `package.json` — that's for release builds, leave it out of pull requests.)

### Run a test instance — keep your own data out of it

Set `SNIPTOSS_SETTINGS` before starting a build you're working on. The instance then keeps its settings, library, logs and WebView2 data next to that file, never touches the registry, and runs alongside your normal copy:

```powershell
$env:SNIPTOSS_SETTINGS = "$env:TEMP\sniptoss-dev\settings.json"
app/bin/Release/net10.0-windows/SnipToss.exe <folder or file>
```

For UI work, run `npm run dev:web` and start the app with `$env:SNIPTOSS_DEV_URL = 'http://localhost:5173'`; changes reload instantly.

Logs: `%LOCALAPPDATA%\SnipToss\logs` (a test instance writes to `logs\` next to its settings file). Check them first when something goes wrong — UI errors and rejected bridge calls are logged too.

## Before you send a pull request

```powershell
npm run format       # Prettier (line width 140)
npm run verify       # type check, oxlint, format check, vitest, design, i18n and English checks, C# unit tests, UI end-to-end tests
```

Everything in `verify` must pass. If you changed the desktop shell (`app/`), also run `npm run e2e:shell` — it starts real instances of the app (windows appear briefly on screen) and checks the bridge, file watching, tray, crash recovery and screen capture.

Keep a pull request to one topic, and describe what you changed and how you tested it.

## Rules of the codebase

**The app never modifies the user's files.** It only writes inside a project's `.sniptoss/` folder. JSON written there is UTF-8 without BOM, 2-space indented, with a trailing newline. Coordinates are normalized to 0–1 and times are in seconds; only text meant for people (`REVIEW.md`, the UI) converts them to pixels and `mm:ss.mmm`.

**Changing the data format** (`docs/annotation-format.md`, ADR-0006): update the format document and the JSON Schema (`docs/schema/`) first, add a sample to `tests/golden/formats/` and a migration test, then change the code. Changes that old versions would misread (removing a field, changing its meaning or unit) need a new major version and a new schema file; adding an optional field doesn't — note in the document which version introduced it.

**UI text**: never hard-code strings. Add a key to `i18n/locales/zh-CN.json` (the source language) and `en.json` in ICU MessageFormat, and use `useIntl().formatMessage` in components. `node scripts/check-i18n.mjs` counts hard-coded Chinese strings and must not go up; `node scripts/check-catalog.mjs` checks every language for missing keys, ICU syntax, placeholders and plural forms. English wording follows [i18n/glossary.md](i18n/glossary.md). Code comments, test names, log messages and docs are written in English (`node scripts/check-english.mjs` keeps Chinese from creeping back in). Text for agents, file names and logs never follows the system locale (`CultureInfo.InvariantCulture`).

**Translations**: edit `i18n/locales/<language>.json` and run `node scripts/check-catalog.mjs`. If a key you changed starts with `brand.`, `category.`, `shell.`, `capture.` or `ai.`, regenerate the cross-language golden file:

```powershell
$env:UPDATE_GOLDEN = '1'; npx vitest run packages/web/test/messages-golden.test.ts
```

**Design**: font sizes, spacing, sizes, radii and colors come only from the tokens in [docs/design-rules.md](docs/design-rules.md) (values at the top of `packages/web/src/styles.css`). Run `node scripts/check-design.mjs` after style changes. The window background in `app/MainWindow.cs` must equal `--bg`. Anything that changes every frame (playhead, a box being dragged) updates the DOM directly instead of React state.

**Shortcuts**: add them through `useKeys` in `packages/web/src/keys.ts`, and update both `docs/shortcuts.md` and `packages/web/src/ShortcutHelp.tsx`. Every command should be reachable from the menu bar and the keyboard.

**The bridge** between the UI and the shell (`packages/web/src/host.ts` ↔ `app/Bridge.cs`) is a contract: when you change how a bridge method behaves, update `docs/host-api.md` and the mock host used by the UI tests (`tests/e2e/mock-host.ts`).

**Layers**: `packages/core` is pure logic — no Node.js or browser APIs. `packages/web` talks to the disk only through `host.ts`.

## Tests

| Command | What it covers |
|---|---|
| `npm test` | vitest: core logic, CLI, UI helpers, golden files shared with C# |
| `npm run test:app` | xUnit: the desktop shell (`tests/AppTests`) |
| `npm run e2e` | Playwright against the built UI with a mock shell, in headless Edge |
| `npm run e2e:shell` | Playwright over CDP against real `SnipToss.exe` test instances |
| `npm run perf` | performance budgets (startup, capture hotkey, 20,000-item library, 1,000 notes) |

Simulate keyboard shortcuts with real key events (`scripts/cdp-key.mjs`, or Playwright's keyboard) rather than dispatching events on `window` — those skip the capture/bubble path and give false results.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

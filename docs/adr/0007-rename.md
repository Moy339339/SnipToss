# ADR-0007 Removing pinyin: the technical name becomes an English name

- Status: **completed (2026-10-17, Beta 15)**. The name is **SnipToss**; see "Implementation" at the end for what was done.
  Below, `<name>` = the lower-case English name (commands, folders, e.g. `sniptoss`), and `<Name>` = program file and namespace (e.g. `SnipToss`).
- Availability check for SnipToss: sniptoss.com / .app / .dev / .io are all unregistered; the npm and GitHub user / organization names are free; there is no winget package of that name; a web search finds no product of that name.
  **The one collision**: a closed-source memo helper for macOS and Windows that publishes only installers; it released a single alpha version in May 2026 and has not been updated since. Its program is also called `SnipToss.exe`.
  Candidates eliminated (similar "annotate for AI" products already exist): Markback, Framenote, Pinnote, Inkback, Spotnote, Markfix; others checked: Tweakmark (completely clean), Ringmark, Critmark, Tweakpin.
- Related: ADR-0006 (schema starts at `<name>/4`); `docs/annotation-format.md` "Migrating from pizhu"

## Context
The software is for users in many countries, so no pinyin (such as pizhu) should appear in the UI, files or commands, and that includes the technical name; the earlier decision to keep the technical name pizhu is withdrawn.
Current state: 358 occurrences of `pizhu` in 69 files of the repository (not counting design drafts and examples/); installed programs and users' projects also contain:

| Where | Now | Becomes |
|---|---|---|
| Each project's data folder | `.pizhu/` (containing `annotations/`, `snapshots/`, `REVIEW.md`, `pizhu.cmd`) | `.<name>/`, with the write-back script `<name>.cmd` |
| Command line | `pizhu` (Node) | `<name>` (ADR-0003's `<name>-cli.exe`) |
| Program file | `pizhu.exe` | `<Name>.exe` |
| Format | `"schema": "pizhu/3"` | `"<name>/4"` (still reads `pizhu/1–3`) |
| Settings | `%APPDATA%\pizhu\settings.json` | `%APPDATA%\<Name>\settings.json` |
| Screen capture archive | `%LOCALAPPDATA%\pizhu\captures` | `%LOCALAPPDATA%\<Name>\captures` |
| WebView2 data | `pizhu.exe.WebView2` next to the program (the sidebar width is stored in its localStorage) | `%LOCALAPPDATA%\<Name>\WebView2`; the sidebar width is stored in settings.json instead (so the portable build can take it along) |
| Registry | Context menu verb, start-with-Windows value | New verb / new value, **delete the old ones** |
| Environment variables | `PIZHU_SETTINGS`, `PIZHU_DEV_URL`, `PIZHU_PERF_LOG` | `<NAME>_*` |
| Virtual host | `vol-e.pizhu.example` | `vol-e.<name>.example` |
| Code | `Pizhu.App`, `@pizhu/*`, `Pizhu.App.csproj`, the `pizhu:` custom events, `pizhu.ico` / `pizhu.svg` | the corresponding new names |

## Decision
1. **Change everything at once**: once the name is decided, change code, scripts and docs in a single commit (historical records — old commits, old names written in logs — are not changed).
2. **Automatic migration** (done at program startup, idempotent, logged when done):
   - Settings: if the new folder has no settings.json and the old one does → **copy** it over (the old one stays as a backup, not deleted); the screen capture archive folder likewise.
   - Registry: if an old context menu / start-with-Windows entry is found → write the new one using the old on/off state, and delete the old one.
   - Project data folder: **when a project is opened**, if there is a `.pizhu/` but no `.<name>/` → rename `.pizhu` to `.<name>` (only our own data folder is touched, never the items),
     and regenerate the write-back script inside it; if the rename fails (in use, read-only) keep reading and writing the old folder and try again next time, with no error in the UI.
   - If both exist (very rare) → use the new one, leave the old one alone, and leave a note in the log.
   - The old `.pizhu/pizhu.cmd` is no longer generated; HomeFinder recognizes both names when looking upward.
3. **Compatibility period**: reading `pizhu/1–3` is kept permanently; the automatic migration code for `.pizhu/` is kept at least until 2.0.
4. **Tests**: every step of the migration has tests (both old and new present, only old present, read-only folder, in use); first run it through on a copy in `examples/demo` and in `%TEMP%`.
5. Further code changes start **after the rename commit**, and new code uses the new name directly.

## Consequences
- Text that users have already copied for AI and not yet acted on contains the path `.pizhu\pizhu.cmd`: after migration that path no longer exists. Leave a one-line notice file at the old location? — No:
  it would recreate the `.pizhu` folder. Instead, show a notice on the first launch after the rename: "The write-back command in previously copied text is no longer valid; copy again."
  (Later, the text copied for AI stopped carrying a write-back command and no longer asks the AI to write statuses back, so this line was removed; the notice now only says the technical name changed and all notes are kept intact.)
- The README, development notes and docs/* are all renamed; `docs/annotation-format.md` gets a section "Migrating from pizhu".

## Implementation
Done as decided above, with a few details differing from the original plan:
- **The command line does not move the folder**: when a project has not yet been opened by the new UI and has only `.pizhu/`, the command line reads and writes in place inside `.pizhu/` (`dataDirOf` in `cli/src/fs-store.ts`),
  and the screenshot paths in REVIEW.md also say `.pizhu/`. Reason: the command line is often invoked by the old `.pizhu\pizhu.cmd`; if the folder containing the running script is moved, cmd reports "batch file not found" when it returns.
- **If the rename is impossible, copy**: when a file in `.pizhu` is open in another program (without delete sharing), the folder cannot be renamed. In that case copy it to `.sniptoss.migrating-*`, then rename that to `.sniptoss`
  (so no half-finished folder is left), then try to delete the old one; if it cannot be deleted, leave it and use only the new one from then on (`app/DataDir.cs`). If neither renaming nor copying works (a read-only location), keep reading `.pizhu` and try again next time.
- **The old `pizhu.cmd` leaves no forwarder behind**: it is deleted when the folder is moved, and the new `sniptoss.cmd` is generated by the UI as usual; the old path in text copied for AI before the rename becomes invalid,
  and the UI shows a notice once on the first launch of the new version (`appInfo.renamedFromPizhu`, message `app.toast.renamed`).
- **WebView2 data moves to `%LOCALAPPDATA%\SnipToss\WebView2`** (test instances put it next to `SNIPTOSS_SETTINGS`), no longer `<exe>.WebView2` next to the program.
  The sidebar width is still stored in its localStorage, so **the sidebar width returns to the default once after the rename**; moving it into settings.json is left until the portable build.
- Settings are copied only once, when the new folder has no `settings.json` yet (together with `.bak` and any backups of corrupt files); the screen capture archive fills in missing entries only when settings were copied this time. Logs are not moved.
- After building, `build-app.ps1` deletes the old `pizhu.*` (including `pizhu.exe.WebView2`) from the output folder; the check for "the program is still running" recognizes both the old and new process names.
- Tests: the shell's `RenameMigrationTests` (20 cases: rename, copy fallback, both present, HomeFinder, write restrictions, settings copy, start-with-Windows detection),
  2 in the command line, 2 in core, and 3 in the UI e2e `rename.spec.ts`. The registry part happens on first launch.

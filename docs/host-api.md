# Shell interface (the bridge between the UI and the shell)

The UI (`packages/web`, running in WebView2) never touches the disk or the system directly; everything goes through this bridge to the shell (`app/`).
This is the contract between the two sides: **any other shell built later (a Mac version) implements it, and the e2e mock host (`tests/e2e/mock-host.ts`) follows it too**.

- Implementation: the shell's `app/Bridge.cs` (the method table in `HandleAsync`); the UI's `packages/web/src/host.ts` (the types `Methods` and `HostEvents` are the exact statement of the parameters and return values; the fields are not copied again here)
- Mock: `tests/e2e/mock-host.ts` implements every method following the semantics of `Bridge.cs`. **When you change the behavior of `Bridge.cs`, update the mock host and this document too**
- The real-shell tests (`tests/shell`) verify that the bridge really works; UI behavior belongs to e2e (ADR-0004)

## Messages

```
UI → shell   { id, method, params }          params is null when there are none
shell → UI   { id, result }                  success
             { id, error, code }             failure: error is the system's original text (in Windows' language), for code see below
shell → UI   { event, ...payload }           an event the shell pushes on its own, no id
```

- Only messages from the app's own UI are accepted (`MainWindow.IsOwnUi`: `app.sniptoss.example`, or `SNIPTOSS_DEV_URL` during development). Messages from other pages get no reply and are logged
- A malformed message (no id, not JSON) is logged and dropped, with no reply
- Dropped files travel as `File` objects with `postMessageWithAdditionalObjects`, and the shell takes the real path from them (`addDropped`).
  A `File` that is not on disk (an image dragged out of a web page) makes WebView2 reject the whole message on the spot: the UI submits them one at a time (`addDropped` in `host.ts`)
- If a reply cannot be sent (the page is reloading): it is dropped and logged

### The error `code`

Common disk errors are sorted into a class, and the UI explains them in its own language by that class (`Bridge.ErrorCode`):

| code | Meaning |
|---|---|
| `denied` | No write permission, or a write-protected drive |
| `notFound` | The file, folder or drive is not there |
| `tooLong` | The path is too long |
| `busy` | The file is held by another program |
| `diskFull` | The disk is full |
| `network` | The network path cannot be found or the connection dropped |
| `clipboardBusy` | The clipboard stays held by another program |
| none | Everything else; bad parameters and paths that may not be touched are here too (the reason is in `error`) |

Expected failures such as bad parameters, a file in use or no permission are logged at INFO; anything else is a defect in the program and is logged at ERROR.

### How long to wait

The UI's limit for waiting on a shell reply is `TIMEOUT` in `host.ts`: 30 seconds by default; calls that wait for the user (`pickFiles`, `pickFolder`, `captureStart`, `windowResize`) have no limit;
`scan` 5 minutes; `library`, `missing`, `readHomes`, `libraryAdd`, `addDropped`, `sha256`, `copyImages` 2 minutes. On timeout the call fails with "app not responding (method name)", and a late reply is dropped.

On the shell side: **methods that check drives never do so on the UI thread**. An unreachable network drive makes a check wait for the system timeout (10–40 seconds), so the shell first asks `Volumes` per drive
(waiting at most 0.4 seconds; a drive that has not answered counts as not connected), and other calls are answered as usual.

## Hard rules (every implementation must keep them)

1. **Write only to `.sniptoss/` in a notes home**, and never modify the item itself. Every method that writes carries `home` (the notes home, the folder that holds `.sniptoss`) + a relative path; `home` must be one of the notes homes
   that this scan handed to the UI, and the relative path, once normalized, must land inside its `.sniptoss/`, otherwise the call is refused (the `denied` class)
2. **Only let through what may be read or shown**: `sha256` and `decodeImage` accept only paths in the library; `fileUrl` accepts only paths inside a notes home's `.sniptoss/`;
   `reveal` accepts only the library, notes homes, the capture folder, the settings file, the log directory and the program directory; `openExternal` accepts only http / https
3. **Writing a notes file carries a precondition** (ADR-0005): `writeAnnotation` gives "what I think is on disk now"; if that does not match, nothing is written and the current content is returned, and the UI merges by id and then writes again
3a. **All notes content handed to the UI carries an ordering number `seq`** (ADR-0005 item 8): for each home in `readHomes` and for `annotationsChanged`, the number is taken **before the read**;
   `writeAnnotation` takes it **inside the lock**, after the write is done or after reading the current state when it was refused.
   There is one increasing counter for the whole program (`Bridge.Observe`). When the UI receives a notification whose number is smaller than the one it has seen for that file, it drops it (it may be late, stale content)
4. Every file write is an atomic replace (unique temp file → flush → replace, `AtomicFile`); JSON is always UTF-8 without BOM, 2-space indent, with a trailing newline
5. Settings are read-modified-written one at a time (`Settings.Update`: read the disk, change, write), so two processes do not overwrite each other; a failed read never overwrites

## Methods

The fields of the parameters and return values are as in `Methods` in `host.ts`.

### Library

| Method | What it does |
|---|---|
| `library` | The entries in the library (path, pinned, `folder` / `file` / `missing`, `offline` = not found and the whole drive is absent), expanded, collapsed, last selected. On the first read after the page loads it also carries the queued `focus`, `skipped` and `relocated` (things opened from outside — the command line, the context menu — before the UI was up); after that read the shell pushes `libraryChanged` instead |
| `libraryAdd` | Add to the library (as picked in a dialog). Entries already in the library (either an entry itself, or one that a folder entry's scan yields) are not added twice and are returned as `focus`; when a folder is added, the entries its scan yields are merged in; if it recognizes an entry the library could no longer find as having moved, it is swapped in place (`relocated`). When the newly added thing is on a drive that was first used after the page loaded: `reloading = true`, the shell reloads the page right away, and the UI has nothing to do |
| `addDropped` | Same as above, with the paths coming from the `File` objects sent with the message |
| `pasteClipboard` | Ctrl+V: if the clipboard holds files copied in File Explorer → same as dropping them in; if it holds an image → saved as PNG into the "Pasted Images" folder (`appInfo.pastedDir`) and added to the library, with `pasted` being that file; neither → `empty = true` |
| `pickFiles` / `pickFolder` | The system open-file / open-folder dialog; returns the chosen paths (cancel gives empty / null) |
| `libraryRemove` | Take out of the library (files are not deleted); returns how many entries were removed; if the one being viewed is among them, "last selected" is cleared |
| `libraryRelocate` | Point an entry that cannot be found at a new location: swapped in place, with pinned state, position, expanded / collapsed and last selected carried over |
| `libraryPin` | Pin to top / unpin (all the entries of one project are sent together) |
| `libraryExpanded` / `libraryCollapsed` / `librarySelect` | Record the expanded folders, the collapsed projects and the last selected |
| `scan` | Scan these entries (only those in the library are accepted): a folder lists the items inside it (relative path, kind, size, modified / created time, notes home, URL), with `truncatedAt` when a limit is exceeded; each of the following gets a note: files that are not supported yet (`others`), files left out because "More formats" is off in Settings (`moreOff`; the setting is `moreFormats`, which the shell reads itself), and skipped folders; for an entry that can no longer be found, `keptHome` is given (when its project's `.sniptoss` still exists). An item's URL is `https://vol-<drive>.sniptoss.example/<path>`; the shell maps drives to virtual hosts (which only takes effect for later navigations: when a new drive is used, the page is reloaded once); paths longer than 260 characters go through a short junction (`paths.sniptoss.example`), and `longPath = true` when it cannot be read |
| `missing` | Which of these items no longer exist (only paths in the library and inside notes homes are accepted) |
| `sha256` | The SHA-256 of an item file (used to tell which notes were written on an earlier version of the item, and to record which version a new note is written on; ADR-0008). The shell keeps the computed values locally, keyed by path + size + modified time (`cache\sha256.json`, `HashCache`), so the same file is not read twice |
| `fileUrl` | The URL of a file inside a notes home (`home` + relative path; only inside `.sniptoss/` is accepted, the same rule as for writing): when a note on an earlier version is selected, the canvas shows its snapshot |
| `decodeImage` | Images the UI cannot display (TIFF, HEIC / HEIF; only paths in the library are accepted): the shell converts them to PNG with Windows image decoding and returns `{ url, width, height }`. The URL is on `decoded.sniptoss.example` (local cache `cache\decoded`, named by path + size + modified time, so the same file is not converted twice); the width and height are those of the original after orientation correction (the PNG is shrunk when it would be too large: at most 16384 on a side and 64 million pixels in total). For multi-page files the first page is used; TIFF is rotated upright by its recorded orientation, and for HEIF the decoder applies rotation and mirroring itself. If the conversion fails it returns `{ problem }`: `heif` = the HEIF Image Extensions are not installed, `hevc` = recognized but the picture cannot be decoded (most likely the HEVC Video Extensions are missing), `unreadable` = the file is damaged |

### Notes

| Method | What it does |
|---|---|
| `readHomes` | Read all the notes files in these notes homes (only those that a scan has handed to the UI are accepted) and start watching them; on first open, an old-named `.pizhu` is moved to `.sniptoss`. Each home also carries `project`: the raw text of `.sniptoss/project.json` (null if there is none) and whether `REVIEW.md` exists, from which the UI decides which language REVIEW.md uses (`docs/annotation-format.md`, "Notes folder settings") |
| `writeAnnotation` | Write a notes file with a precondition (see hard rule 3); returns `{ written, current, seq }` (for `seq` see hard rule 3a) |
| `writeText` / `writeBase64` | Write text (REVIEW.md) / binary (snapshots) inside `.sniptoss/` |
| `deleteFile` | Delete one file inside `.sniptoss/` |
| `pruneSnapshots` | Delete old snapshots in `.sniptoss/snapshots` other than those in `keep`, that were named by this program and are more than 10 minutes old; returns how many were deleted |
| `copyImages` | Copy as Images: the shell draws one image per note (title + snapshot + notes area, `HandoffImages`); a single image goes onto the clipboard directly, and several are saved as files and put on the clipboard; returns the number of images |

### Settings, window, miscellaneous

| Method | What it does |
|---|---|
| `getPrefs` / `setPrefs` | The UI's settings (only items that differ from the defaults are stored); null if never saved. After `setPrefs` the shell switches its own text according to the `language` in it (tray, capture overlay, error window, context menu; the rule is the same as the UI's `resolveLocale`, `app/Locale.cs`); when `moreFormats` changes, the context menu (if installed) adds or removes those formats accordingly |
| `appInfo` | Version, build time, .NET / WebView2 / OS versions, where the program and the settings are, the log directory, the Pasted Images folder, the Windows display language, and whether this is the portable build (`portable`: a `data` folder next to the program, no registry writes; `setShellIntegration` and start-at-login report an error); the first load also carries the state of the settings at startup (`startupNotice`) and whether this is the first start after the rename (`renamedFromPizhu`) |
| `reveal` | Show in File Explorer; `@settings` = the settings file, `@app` = the program directory, `@logs` = the log directory, anything else is an absolute path (see hard rule 2). Checking whether it is a file or a folder happens on a background thread |
| `openExternal` | Open a URL in the default browser (only http / https are accepted) |
| `exportDiagnostics` | `{ text }`: Help → Export Diagnostics Package…. The shell shows a save dialog (default name `SnipToss-diagnostics-yyyyMMdd-HHmmss.zip`) and writes a zip: `diagnostics.txt` (the diagnostic info given here), `logs/` (the logs), `settings.json` (with the library, the expanded folders, the last selected, the capture save location, the author name and the extra instructions text removed); after writing, it selects the file in File Explorer; returns the path, or null if cancelled. No time limit |
| `checkUpdates` | Help → Check for Updates… (`app/Updates.cs`): queries GitHub Releases (a stable build looks only at stable releases, a beta build also looks at pre-releases, and drafts do not count) and returns `{ newer: { version, url, prerelease } \| null, error: string \| null }`; when the check cannot be done (offline, the repository is not public, rate limiting) `error` is an English reason, and it is logged too. This is the only place the program goes online |
| `log` | UI errors are recorded in the shell log (at most 60 per minute) |
| `window` | The three window buttons and the Window menu: `minimize`, `maximize` (pressed again it restores), `fullscreen`, `topmost` (a toggle, remembered), `close` (hides to the tray when "keep running in the tray" is on), `quit`, `resetLayout`; returns the window state afterwards |
| `windowState` | The current state of the window |
| `windowResize` | For the self-drawn title bar: pressing on the top edge, the top-left corner or the top-right corner hands resizing over to the system |
| `captureStart` | Screen Capture (hides this window first) |
| `captureSettings` / `setCaptureSettings` | Screen Capture settings (shortcut, stay in the tray, hide the window before capturing, put the notes in the image, where to save, start at login); returns the settings afterwards, including why the shortcut could not be registered, the characters the key combination would type, and the default key replaced at startup |
| `captureHotkeyPause` | Pause the old shortcut while a new one is being recorded |
| `shellIntegration` / `setShellIntegration` | Whether the File Explorer context menu item "Open with SnipToss" is installed / install or remove it (HKCU): folders, the blank area of a folder, the 12 common formats, plus 11 more when "More formats" is on in Settings |
| `openDevTools` | The developer tools (for diagnostics) |
| `ready` | The UI is usable (the shell turns off the "UI did not come up" watchdog and records the startup time) |

The `debug*` methods that exist only in the program built for the shell tests are in `app/TestHooks.cs`; they are not part of the contract.

## Events (pushed by the shell)

| Event | When | What the UI does |
|---|---|---|
| `annotationsChanged` | A notes file in a watched notes home changed from outside (an agent edited it, or another program wrote it): carries all the notes files of the whole home and the `seq` taken before the read | Dropped if older than what has been seen; otherwise merged in by id, and a "synced" notice is shown |
| `libraryChanged` | Something was opened from outside while the program was running (context menu, command line, forwarded from a second process) and has already been added to the library: `focus`, `skipped`, `relocated` | Re-read the library, scan the new entries, navigate to them, and explain what was not added / which were recognized as moved |
| `materialsChanged` | The files of these library entries changed from outside (modified, added, deleted; a drive disconnected / reconnected): `entries` | Re-read the library and rescan these entries |
| `windowHidden` | The window was hidden (to the tray, or before a capture) | A video that is playing stops |
| `systemMenu` | The system's window menu popped up (Alt+Space, right-click on the blank part of the title bar; `WM_ENTERMENULOOP`) | Close its own menu and leave menu-bar mode (the system menu takes the space of Alt+Space, so the UI sees only Alt pressed and released, which it would treat as a lone Alt) |
| `openSettings` | `{ section }`: the shell wants a page of Settings opened (the tray balloon "The capture shortcut couldn't be enabled" was clicked; if the UI has not loaded yet, it waits and sends after the load) | Open that page of Settings (a section name of `SettingsDialog`; an unknown one opens General) |
| `updateAvailable` | `{ version, url, prerelease }`: the shell's automatic check after startup found a new version ("Check for updates automatically" is on in Settings, at least 20 hours since the last check, not a test instance; the check runs 5 seconds after the UI is ready) | "Update Available" appears to the left of Capture in the title bar, and the Help menu item changes to "Download {version}…"; no notice is shown |

How often the shell checks for changes: the file being viewed and its notes home once a second, the whole library every 10 seconds (stretched to 20 times the scan duration when a scan is slow), and once immediately when the window returns to the foreground;
everything pauses while the window is hidden, and each check runs once as soon as it is shown (`app/ChangeWatch.cs`). `FileSystemWatcher` is not used: it holds on to the folder, so the user could not rename or move it.

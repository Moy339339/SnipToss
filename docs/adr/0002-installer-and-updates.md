# ADR-0002 Installer, portable build and updates

- Status: accepted (2026-10-17)
- Related: `docs/design.md` "Install options"; ADR-0010 (Windows 11 only)

## Context
The app used to run straight from the build folder `app/bin/Release/net10.0-windows/`: framework-dependent (the .NET 10 desktop runtime has to be installed), no installer, no updates.
Requirements: Windows **installer and portable build** both; in the installer, "Add to the File Explorer context menu" is **checked by default and can be unchecked** (as in VS Code); the portable build does not touch the registry.

## Decision
1. **Self-contained publish** (`dotnet publish -r win-x64 --self-contained`, ReadyToRun, no trimming — WPF does not support trimming).
   Users do not have to install .NET; the installer and the portable build ship the same files, which halves the test surface. Size is about 60 MB (smaller compressed).
   win-arm64 and others ship once CI can run an arm64 smoke test.
2. **The installer is Inno Setup 6.5+** (the official installer does not include Simplified and Traditional Chinese; those two language files come from jrsoftware/issrc and live in `installer/languages`):
   - The wizard language follows the system and can be changed; the default is a **per-user install** (`PrivilegesRequired=lowest`, no administrator), and advanced users can choose to install for all users.
   - Checkboxes: "Add to the File Explorer context menu" ☑, "Add to PATH (command line `<name>`)" ☑, "Create a desktop shortcut" ☐.
   - If the WebView2 runtime is missing it is installed silently (Microsoft's bootstrapper is bundled; Windows 11 ships it, and the vast majority of Windows 10 machines have it). **Only Windows 11 is supported now (ADR-0010)**, so no bootstrapper is bundled;
     if it is missing, the app's help page gives the download link.
   - Uninstall removes the context menu entries, the start-with-Windows entry and the PATH entry; **user data is kept by default** (settings, the library, and the notes folders inside each project are never touched).
3. **Portable build** = the same files in a zip, with a marker file `portable` in the root: if it is present, settings go to `data\` next to the program and nothing is written to the registry;
   the context menu can still be turned on manually in Settings (only then is the registry written).
   **Two things changed in the implementation** (`app/AppPaths.cs`, `scripts/publish.ps1`):
   - The marker is the `data` folder itself (as in VS Code's portable mode), not a separate `portable` file: one file fewer, and deleting `data` returns the app to the installed-style locations, which is easy to understand.
   - The context menu and start-with-Windows are **both unavailable** in the portable build (the two switches in Settings are greyed out, with the reason): a portable build often sits on a USB drive and gets moved,
     a path written to the registry breaks as soon as it moves, and deleting the folder does not remove the registry entries — which contradicts "the portable build does not touch the registry" (see Context). Use the installer if you want the context menu.
4. **A hand-written updater** (as VS Code does; no delta updates):
   - It checks GitHub Releases at most once a day after startup; channels: stable / beta (Beta is a GitHub pre-release).
   - When a new version exists: no interruption, just a small notice in the title bar or the tray; only after the user clicks does it download the **full installer** → verify the Authenticode signature and SHA256 → install silently after the app exits → relaunch.
   - On failure or when the user rolls back: the previous installer is kept, and the user can "go back to the previous version".
   - The portable build only notifies and gives a download link; it never replaces itself.
   - **For now only "check" and "notify" are implemented** (`app/Updates.cs`): at most once a day after startup (5 seconds after the UI is ready, at least 20 hours after the last successful check, never in test instances);
     when a newer version is found the title bar shows "Update Available", and clicking it opens that version's download page. The installer build does the same for now; downloading and silent installation come after signing and the sandbox tests are in place.
   - Automatic checks can be turned off in Settings; Help → Check for Updates… checks manually.
5. **Signing**: apply to SignPath Foundation (free for open-source projects; requires a public repository and release history; SmartScreen shows SignPath Foundation as the publisher).
   If rejected or too slow, fall back to an OV certificate (costs money; decided separately). Before each release, submit the installer to Microsoft for false-positive analysis — the combination of a global hotkey, screen capture and auto-update is easily flagged by antivirus software.
   **Addendum**: SignPath also expects some reputation, and small projects are often rejected; Azure Artifact Signing has strict eligibility requirements for individual developers and is not used for now;
   the cheapest paid route is Certum's open-source certificate (about €49–69 for the first year). For 1.0 the default is **not to sign yet**: the README explains how to get past the warning, and SignPath is applied for once the project has some reputation.
6. **Distribution channels**: GitHub Releases (primary), winget, Scoop. The manifests are generated with each release (`scripts/package-manifests.ps1`) and checked by hand before submission.

## Rejected alternatives
- **Velopack**: installs .NET and WebView2 automatically and has delta updates, but it is a one-click installer with **no wizard with checkboxes**, so it cannot do "context menu checked by default, can be unchecked".
- **MSIX / Microsoft Store**: the sandbox imposes many restrictions (global hotkeys, screen capture and writing to arbitrary project folders all need extra declarations), and the context menu would need separate work; possible as an additional channel later.
- **Framework-dependent + download .NET during setup**: one more online install step and one more way to fail; the portable build would also need a separate self-contained build, doubling the test surface.
- **Single-file publish (PublishSingleFile)**: WPF's native libraries have to be extracted, which slows startup and gives the installed build nothing.

## Consequences
- `scripts/build-app.ps1` is split into a "development build" and a "release build" (publish + build the installer + build the zip + generate SHA256).
- The app has to distinguish three ways of running: installed / portable / development (where settings are stored, whether it can auto-update, the context menu default).
- .NET's monthly security patches need to be followed with patch releases (cheap once the release pipeline is automated).
- The first-level Windows 11 context menu entry needs a signed sparse package plus IExplorerCommand. 1.0 only does the registry (the entry shows up under "Show more options"); a first-level entry is planned for 1.x.

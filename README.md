# SnipToss

[![Latest release](https://img.shields.io/github/v/release/Moy339339/SnipToss)](https://github.com/Moy339339/SnipToss/releases/latest) [![CI](https://github.com/Moy339339/SnipToss/actions/workflows/ci.yml/badge.svg)](https://github.com/Moy339339/SnipToss/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/github/license/Moy339339/SnipToss)](LICENSE) ![Windows 11](https://img.shields.io/badge/Windows-11-0078D4) ![macOS 14+](https://img.shields.io/badge/macOS-14%2B-000000)

Telling your AI what to fix shouldn't be a writing test. Mark it on the image or on the exact video frame, and your AI gets the spot, a snapshot and your note.

![The headline "Telling your AI what to fix shouldn't be a writing test", with "a writing test" marked the way SnipToss marks things; below it, the SnipToss window with three numbered marks on a sample coffee landing page and the matching notes next to it.](docs/images/hero.png)

**[Download for Windows](https://github.com/Moy339339/SnipToss/releases/latest)** · Windows 11 · **[Download for Mac](https://github.com/Moy339339/SnipToss/releases/latest)** · macOS 14 or later · [Install notes](#install) · [Release notes](https://github.com/Moy339339/SnipToss/releases/latest)

## You've probably been here

- You take a screenshot, write a paragraph about which part you mean, and the AI still changes the wrong thing.
- Five things are wrong, so you explain them one at a time, over five rounds.
- The markup tool inside one AI app only talks to that app. Your notes don't follow the file to another agent, and next week they are gone.
- For a video you type "around the third second" and hope.
- The AI sends a long answer with five questions in it. You select a passage, add it to the chat, type, select the next one…

In SnipToss you draw on the spot and write a short note, as many as you need. Each note is saved in the project's `.sniptoss/` folder with its position, its time and a snapshot. Paste them into Claude Code, Codex or any chat app in one go. It doesn't matter which tool made the file or which AI fixes it.

## What you can do with it

### Draw on the part you mean

![Animation: a rectangle, an arrow, a pin and a pen stroke drawn on a sample coffee landing page, each with a note in the panel on the right.](docs/images/feature-marking.webp)

Pins, rectangles, a freehand pen and arrows, in eight colors or any color you pick. One note can point at several places. A mark you leave without a note stays on the image as a plain drawing. Each note has a category (Change, Remove, Add or Question), so the AI knows what kind of answer you want.

### Comment on an exact frame of a video

![Animation: a sample video stepped frame by frame, with a note on one frame and a rectangle on another; the playback bar shows frame numbers and each note's number stands above it.](docs/images/feature-video.webp)

A note belongs to a moment or to a time range. Step through the video frame by frame, show the time as seconds, timecode or frame numbers, and click a number above the playback bar to go to its note. Press `T` to comment on the current frame without drawing anything.

### Answer a long reply point by point

![Animation: the capture overlay over an AI's long answer: a region dragged around it, a numbered box on each of its three questions with a reply written next to it, then the finished image with the replies underneath.](docs/images/feature-capture.webp)

Press `Ctrl+Alt+A` (`⌃⌥⌘A` on the Mac) and drag over anything on the screen: a running app, a web page, or the AI's own answer. Put a number on each point, write your reply next to it, and paste the result back as one image. The overlay also has an ellipse, text, and a pixelate tool for anything you'd rather not show.

### Give the notes to your AI

![A sample coffee landing page with three notes on it, the text of the notes as an agent reads it in REVIEW.md, and the page after the changes.](docs/images/feature-handoff.png)

- **Copy as Text** (`Ctrl+Shift+A`) is for agents that read local files, such as Claude Code and Codex. Paste it and the agent gets every note, with where to find the file and each snapshot.
- **Copy as Images** (`Ctrl+Shift+I`) is for web-based AI and chat apps: one image per picture or video moment, with every mark numbered on it and the notes listed underneath. One copy makes at most 10 images, about what a chat accepts in one message; you can change that in Settings.

### Also

- **Formats**: PNG, JPEG, WebP, GIF, SVG, BMP, AVIF; MP4, WebM, MOV, M4V. Settings → Advanced → More formats adds TIFF, HEIC, ICO, APNG, JFIF and MKV (on Windows, HEIC needs the HEIF Image Extension and HEVC Video Extensions from the Microsoft Store).
- **Library**: add files or folders by drag and drop, `Ctrl+O`, the File Explorer context menu or paste. Items are grouped by project, and the library shows when an agent has re-exported a file you annotated.
- **More kinds of notes**: an overall note about the whole image or video, and a folder comment that applies to every item in a folder.
- **New versions of a file**: when a file is overwritten, the notes written on the earlier version move to a section of their own and keep the snapshot from that time.
- **Status**: mark a note Done or Won't Fix (`D` / `Shift+D`). Everything can be undone. `Shift+H` hides the marks to show the original.
- **Keyboard and mouse**: every command is in the menu bar and has a shortcut; press `?` for the list.
- **11 languages**: English, 简体中文, 繁體中文, 日本語, 한국어, Français, Deutsch, Español, Italiano, Português (Brasil), Русский.
- **Private**: no telemetry and no account. The only network request is the daily update check, which you can turn off in Settings → General.
- **An open format**: `.sniptoss/REVIEW.md` lists the open notes in plain text, `.sniptoss/annotations/*.json` holds the data and `.sniptoss/snapshots/` the pictures. The folder is hidden on Windows and goes away when its last note is deleted. See [docs/annotation-format.md](docs/annotation-format.md).

Web pages, PDF and slides are planned.

## Install

Only need a quick screenshot in the browser? [SnipToss for Chrome](https://chromewebstore.google.com/detail/lbkkhgiifipdikligofiiofdccgcgdgd) captures part of a web page or your screen, lets you mark it up and copies it as one image to paste into an AI chat.

### Windows

Needs 64-bit Windows 11. Download from [Releases](https://github.com/Moy339339/SnipToss/releases):

- **Installer** (`SnipToss-<version>-win-x64-setup.exe`): installs for your account without administrator rights, or for all users if you choose so in the first step.
- **Portable** (`SnipToss-<version>-win-x64-portable.zip`): unzip anywhere and run `SnipToss.exe`.

Or with [Scoop](https://scoop.sh):

```powershell
scoop bucket add moygoldenage https://github.com/Moy339339/scoop-bucket
scoop install moygoldenage/sniptoss
```

The builds are not code-signed. If Windows SmartScreen says "Windows protected your PC", choose **More info → Run anyway**.

<details>
<summary>More about installing on Windows</summary>

- The release builds include the .NET runtime. The Microsoft Edge WebView2 Runtime comes with Windows 11; if it's missing, SnipToss shows a download link.
- The installer adds a Start menu entry and, unless you untick it, "Open with SnipToss" to the File Explorer context menu. To update, run the newer installer; it closes SnipToss if it's running. Uninstall from Settings → Apps → Installed apps.
- The portable build keeps settings, logs and captures in the `data` folder next to it and writes nothing to the registry, so the context menu and start-at-sign-in options are unavailable. To update, unzip the new version and move the `data` folder into it. Delete the folder to remove it completely.
- Scoop keeps settings and captures across `scoop update`.
- SmartScreen asks again for each new version. Each release lists the SHA256 of its files in `SHA256SUMS.txt`; check a download with `Get-FileHash <file>` in PowerShell.
- If **Smart App Control** is on (Windows Security → App & browser control → Smart App Control settings), Windows blocks unsigned apps, SnipToss included, and there is no way to allow a single app. Using SnipToss then means turning Smart App Control off. Since the April 2026 update, Windows 11 can turn it back on later without reinstalling, but SnipToss won't start while it's on.

</details>

### Mac

Needs macOS 14 or later, on Apple silicon or Intel. Download `SnipToss-<version>-mac-universal.dmg` from [Releases](https://github.com/Moy339339/SnipToss/releases), open it and drag SnipToss onto Applications. Always open it from Applications.

The app is signed with the project's own certificate but not notarized by Apple, so macOS blocks it the first time: open it, click **Done**, then in **System Settings → Privacy & Security** click **Open Anyway** and enter your login password. Each new version needs this once.

<details>
<summary>More about installing on the Mac</summary>

- Opened from the disk image or from Downloads, macOS treats SnipToss as being in a new place each time and keeps asking about screen capture (SnipToss reminds you).
- **Open Anyway** is next to "“SnipToss” was blocked to protect your Mac." If macOS asks once more after you enter your password, click **Open Anyway** again.
- Screen Capture (`⌃⌥⌘A`, or Capture in the title bar) needs permission to record the screen: the first capture leads you to **System Settings → Privacy & Security → Screen & System Audio Recording** (Screen Recording on macOS 14); turn SnipToss on (macOS asks for your login password) and choose **Quit & Reopen**. A new version keeps the permission. From macOS 15 on, macOS asks from time to time whether SnipToss may keep recording the screen; click **Allow**.
- If macOS asks whether “SnipToss” may access files in your Desktop, Documents or Downloads folder, click **Allow**. If you clicked **Don't Allow**, go to **System Settings → Privacy & Security → Files & Folders** and turn on the switch for that folder under SnipToss.
- Each release lists the SHA256 of its files in `SHA256SUMS.txt`; check a download with `shasum -a 256 <file>` in Terminal.
- To uninstall, move SnipToss from Applications to the Trash; its settings are in `~/Library/Application Support/SnipToss` and its logs in `~/Library/Logs/SnipToss`.

</details>

## Hand notes to your agent

![Animation: three notes marked on a sample landing page in SnipToss, copied as text into Claude Code, which edits the page; SnipToss then shows the new version.](docs/images/demo.webp)

1. Open the asset's folder in SnipToss and annotate. Notes are saved as you go.
2. Press **Copy as Text** (`Ctrl+Shift+A`) and paste it into Claude Code or Codex. The agent opens the snapshots and changes the files. It can also read every open note from `.sniptoss/REVIEW.md` on its own.
3. Check the result in SnipToss, which reloads files that changed, and mark the notes Done.

What gets copied: the notes you checked; if none are checked, every open note listed in the notes panel. Right-click a note, the image, or a row in the library to copy just that.

For agents and scripts the repository also has a command-line tool, `sniptoss` (`packages/cli`, needs Node.js for now): `list`, `review` (regenerate `REVIEW.md`), `resolve <id> -m "…"` and `wontfix <id> -m "…"`. Run `sniptoss --help` for options.

## How it compares

SnipToss reviews the **files** your agent produced — images and videos on disk, or anything on screen via screen capture. It doesn't inspect a running web page.

| | SnipToss | Web page annotators<br>([Agentation](https://github.com/benjitaylor/agentation), [Drawbridge](https://github.com/breschio/drawbridge), [Vibe Annotations](https://github.com/RaphaelRegnier/vibe-annotations)) | Media review for agents<br>([Rushes](https://github.com/iamredmh/rushes), [Telestrator](https://github.com/itsloukman/telestrator)) | Screenshot tools<br>(ShareX, Snagit, CleanShot X) |
|---|---|---|---|---|
| What you annotate | Images and videos on disk; any part of the screen | Elements of a running web page | Videos the agent made (Rushes also images) | Screenshots |
| Notes at a video frame or time range | Yes | No | Yes | No |
| What the agent gets | Files in the project (`.sniptoss/`), copied text, CLI | Copied Markdown, MCP or project files, depending on the tool; with DOM selectors and, in some, source locations | Project files, MCP (Rushes also a CLI) | An image |
| For web-based AI and chat apps | Copy as Images (marks numbered on the picture, notes underneath) | Copy the text | Not documented | Copy the image |
| Runs as | Desktop app for Windows and Mac, offline | Browser extension, or a package inside your app | Local server, used in the browser (Node.js) | Desktop app |
| MCP server | Not yet | Agentation, Vibe Annotations | Yes | — |
| License | MIT | PolyForm Shield (Agentation, Vibe Annotations); source-available, no redistribution (Drawbridge) | MIT | GPL-3.0 (ShareX); commercial |

- **Building a website?** The web page annotators fit better: they point at the actual element and its source code. SnipToss sees the page only as a screenshot.
- **Reviewing generated video or images?** Rushes and Telestrator also keep notes as files and talk to agents over MCP, in a browser served by a local Node.js process. SnipToss is a native app that opens any image or video on disk without a server, and adds screen capture and Copy as Images for web-based AI.
- **Cloud review** such as [Frame.io](https://frame.io/) needs an account and uploads the media (its MCP server for agents is in public beta). SnipToss keeps everything on your computer.

Compared as of October 2026; these tools change quickly — corrections are welcome.

## Why I made this

I use AI coding agents every day, and the part that kept slowing me down was the simplest one: showing them what to change. The review tools built into the apps I used always had one problem or another: sometimes they were slow, sometimes they were just awkward to use. Everywhere else I was writing paragraphs about a screenshot. I got tired of waiting for someone to fix that, so I built SnipToss.

## Build from source

The Windows app needs Windows 11, Node.js 24 and the .NET 10 SDK.

```powershell
npm install
pwsh -File scripts/build-app.ps1 -NoBump   # web UI + desktop shell → app/bin/Release/net10.0-windows/SnipToss.exe
npm run verify                             # type check, lint, unit tests (TypeScript and C#), design and i18n checks, UI end-to-end tests
```

`pwsh -File scripts/publish.ps1` makes the self-contained release build and the portable zip in `dist/release`.

The Mac app (`app-mac/`, Swift and AppKit) needs macOS 14 or later with Xcode 16 or later, and Node.js 24 for the web UI:

```sh
npm install && npm run build                   # web UI
node app-mac/scripts/build-resources.mjs       # the messages the Mac shell reads
cd app-mac && swift build && swift test        # shell and its unit tests
```

`node app-mac/scripts/package-app.mjs` and `package-dmg.mjs` make the app bundle and the disk image after `swift build -c release`; `.github/workflows/mac.yml` shows the whole build.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## Contributing

Bug reports, translations and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Questions and ideas are welcome as [issues](https://github.com/Moy339339/SnipToss/issues/new/choose); new releases are announced in [Discussions](https://github.com/Moy339339/SnipToss/discussions/categories/announcements). Translations other than English and Chinese haven't been reviewed by native speakers yet; corrections are especially welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Found a security issue? Please report it privately as described in [SECURITY.md](SECURITY.md).

## Contact

MoyGoldenAge · jujuw3939@outlook.com

## License

[MIT](LICENSE) © 2026 MoyGoldenAge

import AppKit
import WebKit

/// What other parts of the app want written into result.json of an unattended run (the hot key registration, ...)
enum SmokeNotes {
    private static let lock = NSLock()
    private static var notes: [String: Any] = [:]

    static func record(_ name: String, _ value: Any) {
        lock.lock()
        notes[name] = value
        lock.unlock()
    }

    static var all: [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return notes
    }
}

/// Unattended run for CI (SNIPTOSS_SMOKE_OUT=<folder>): wait until the UI says it has drawn, take a picture of the page, write what the
/// bridge and the page saw to result.json, and quit. Exit code 0 = the UI came up, 2 = it did not before the time ran out
final class SmokeRun {
    /// True once the UI has drawn its first screen. With an empty library that is the welcome screen, which only appears after the
    /// preferences, app info, locale and library calls all went through (the e2e first-run test waits for the same element)
    static let welcomeScript = "!!document.querySelector('.stage-empty.is-welcome')"

    /// With a project in the library and an item selected: the item is on the canvas (it has a size there: right after a switch it is 0 × 0),
    /// loaded through the media scheme and decoded
    static let imageScript = """
        (() => {
          const el = document.querySelector('.zoom-media');
          if (!el || !el.complete || el.naturalWidth === 0) return false;
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) return false;
          // Notes on an item whose fingerprint is not worked out yet count as being on an earlier version: wait until they are sorted
          const text = document.body.innerText;
          return /Canvas marks/.test(text) && !/earlier version/i.test(text);
        })()
        """

    /// The onboarding tour card is on screen (first run, an item shown)
    static let tourScript = "!!document.querySelector('.tour-card')"

    /// SNIPTOSS_SMOKE_READY picks what to wait for: `welcome` (default, an empty library), `image`, `tour`, `keys` (the welcome screen, then
    /// the key experiment of KeyExperiment.swift, whose answers go into result.json), `capture` (the welcome screen, then the capture
    /// layers over a made-up pattern, CaptureSmoke.swift), `annotate` (the same, one capture through the whole of annotating) or
    /// `hotkeyNotice` (the welcome screen with the notice that the capture shortcut couldn't be enabled: a picture of it, the note in the
    /// menu bar item's menu, then a click on it, which must open Settings at Screen Capture), `captureTiming` (the welcome screen, then
    /// five real captures opened and closed at once, CaptureSmoke.timing: for measuring on a Mac whose screen the app may record) or
    /// `moveNotice` (the welcome screen, then the prompt to move the app into Applications, made but not shown: see `moveNoticeReport`) or
    /// `settings` (the welcome screen, then every page of Settings in the smallest window: `settingsRun`)
    static let mode = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_READY"] ?? "welcome"

    static var readyScript: String {
        switch mode {
        case "image": return imageScript
        case "tour": return tourScript
        case "keys", "capture", "annotate", "hotkeyNotice", "captureTiming", "moveNotice", "settings": return welcomeScript
        default: return welcomeScript
        }
    }

    /// What the page says about itself: the title, the first words, how many library rows there are, the image on the canvas and, when
    /// the tour card is up, the text and style of each of its parts (a card that is drawn but empty is a rendering problem, not a missing string)
    static let probeScript = """
        (() => {
          const media = document.querySelector('.zoom-media');
          const card = document.querySelector('.tour-card');
          const parts = card
            ? Array.from(card.querySelectorAll('*')).slice(0, 12).map((el) => {
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return { cls: String(el.className), text: (el.textContent || '').slice(0, 40), color: s.color, opacity: s.opacity,
                  visibility: s.visibility, fontSize: s.fontSize, width: Math.round(r.width), height: Math.round(r.height) };
              })
            : null;
          return JSON.stringify({
            title: document.title,
            text: (document.body ? document.body.innerText : '').slice(0, 400),
            libraryRows: document.querySelectorAll('.lib-row').length,
            version: (document.querySelector('.app-version') || {}).textContent || '',
            versionMismatch: !!document.querySelector('.app-version.is-mismatch'),
            earlierVersion: /earlier version/i.test(document.body ? document.body.innerText : ''),
            canvasMarks: /Canvas marks/.test(document.body ? document.body.innerText : ''),
            media: media ? { width: media.naturalWidth, height: media.naturalHeight, src: media.currentSrc.slice(0, 200) } : null,
            tour: card ? { text: card.innerText, opacity: getComputedStyle(card).opacity, animation: getComputedStyle(card).animationName, parts } : null,
          });
        })()
        """

    private let outDir: URL
    private let web: WKWebView
    private let window: NSWindow
    private let bridge: BridgeHost
    private let console: ConsoleCollector
    private let began = Date()
    private var finished = false
    /// The picture taken the moment the tour card appeared (tour mode only)
    private var firstShot: String?
    /// What the key experiment found (keys mode only)
    private var keyExperiment: [String: Any]?
    private var experiment: KeyExperiment?
    private let timeoutSeconds = Double(ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_TIMEOUT"] ?? "") ?? 60

    private let captureSession: CaptureSession?
    private let hotkeyNotice: HotKeyNotice?
    private let statusMenu: (() -> NSMenu?)?

    init(
        outDir: URL, web: WKWebView, window: NSWindow, bridge: BridgeHost, console: ConsoleCollector, captureSession: CaptureSession? = nil,
        hotkeyNotice: HotKeyNotice? = nil, statusMenu: (() -> NSMenu?)? = nil
    ) {
        self.outDir = outDir
        self.web = web
        self.window = window
        self.bridge = bridge
        self.console = console
        self.captureSession = captureSession
        self.hotkeyNotice = hotkeyNotice
        self.statusMenu = statusMenu
    }

    func start() {
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) { [self] in
            if !finished { capture(ready: false) }
        }
        poll()
    }

    private func poll() {
        if finished { return }
        web.evaluateJavaScript(Self.readyScript) { [self] result, _ in
            if (result as? Bool) == true {
                // The tour card fades in over a few frames: a picture the moment it exists shows what those first frames look like
                if Self.mode == "tour" { snapshot("ui-first.png") { [self] shot in firstShot = shot } }
                // The layout fades in over 160 ms and fonts may still be settling: wait before the picture. Anything with an entrance
                // animation is photographed at least 0.6 s after it appears: `takeSnapshot` can catch the first frames half painted
                // (the first picture of the tour card has body and buttons but no title), which is the snapshot call, not the page
                if Self.mode == "capture" || Self.mode == "annotate", let session = captureSession {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in
                        let run = Self.mode == "annotate" ? CaptureSmoke.annotate : CaptureSmoke.run
                        run(session, outDir) { [self] report in
                            SmokeNotes.record(Self.mode, report)
                            capture(ready: true)
                        }
                    }
                    return
                }
                if Self.mode == "captureTiming", let session = captureSession {
                    // A moment for the start-up work to settle, as when the shortcut is pressed some time after the app started
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [self] in
                        CaptureSmoke.timing(session) { [self] report in
                            SmokeNotes.record("captureTiming", report)
                            capture(ready: true)
                        }
                    }
                    return
                }
                if Self.mode == "hotkeyNotice" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in
                        noticeRun { [self] report in
                            SmokeNotes.record("hotkeyNotice", report)
                            capture(ready: report["settingsOpened"] as? Bool == true)
                        }
                    }
                    return
                }
                if Self.mode == "settings" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in
                        settingsRun { [self] report in
                            SmokeNotes.record("settings", report)
                            capture(ready: true)
                        }
                    }
                    return
                }
                if Self.mode == "moveNotice" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in
                        moveNoticeRun { [self] report in
                            SmokeNotes.record("moveNotice", report)
                            capture(ready: true)
                        }
                    }
                    return
                }
                if Self.mode == "keys" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in
                        let run = KeyExperiment(window: window, web: web)
                        experiment = run
                        run.run { [self] found in
                            keyExperiment = found
                            capture(ready: true)
                        }
                    }
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in whenMenusSent { [self] in capture(ready: true) } }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + (Self.mode == "tour" ? 0.02 : 0.25)) { [self] in poll() }
            }
        }
    }

    /// Runs `then` once the page has sent its menus (`setMenus`), at most 5 s on. The page sends them a moment after its first screen,
    /// debounced, and on a slow machine that can be later than the picture: result.json would then have the shell's stand-in menu bar.
    /// Without the native menu bar there is nothing to wait for
    private func whenMenusSent(waited: Double = 0, _ then: @escaping () -> Void) {
        let noMenus = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_NOMENU"] == "1"
        if noMenus || bridge.calls.contains("setMenus") || waited >= 5 { return then() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [self] in whenMenusSent(waited: waited + 0.1, then) }
    }

    /// The Settings page that is open: its heading (in the fixed header above the page), the tab that is lit ("" when Settings is not
    /// open), and whether it is Screen Capture (the page with the shortcut recorder)
    static let settingsPageScript = """
        (() => {
          const tab = document.querySelector('.settings .settings-tab.is-on');
          const heading = document.querySelector('.settings .settings-head h2');
          return JSON.stringify({
            tab: tab ? tab.textContent : '', heading: heading ? heading.textContent : '',
            capture: !!document.querySelector('.settings .hotkey-input'),
          });
        })()
        """

    /// The notice that the capture shortcut couldn't be enabled (hotkeyNotice mode): it is up, at the top right of the screen with the menu
    /// bar; hotkey-notice.png is the card as drawn; the menu bar item's menu has the note under Capture Screen; a click on the card closes
    /// it, and Settings opens at Screen Capture
    private func noticeRun(_ done: @escaping ([String: Any]) -> Void) {
        var report: [String: Any] = [:]
        guard let notice = hotkeyNotice, let card = notice.card, let panel = card.window else {
            report["shown"] = false
            return done(report)
        }
        report["shown"] = true
        report["cardSize"] = [card.bounds.width, card.bounds.height]
        let area = NSScreen.screens.first?.visibleFrame ?? .zero
        report["fromTopRight"] = [area.maxX - panel.frame.maxX, area.maxY - panel.frame.maxY]
        report["level"] = panel.level.rawValue
        report["takesKeyboard"] = panel.isKeyWindow
        report["closeName"] = card.closeButton.name
        report["text"] = card.subviews.compactMap { ($0 as? OverlayText)?.text }
        if let rep = card.bitmapImageRepForCachingDisplay(in: card.bounds) {
            card.cacheDisplay(in: card.bounds, to: rep)
            if let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: outDir.appendingPathComponent("hotkey-notice.png"))
                report["picture"] = "hotkey-notice.png (\(rep.pixelsWide)x\(rep.pixelsHigh))"
            }
        }
        if let first = statusMenu?()?.items.first {
            var item: [String: Any] = ["title": first.title]
            if #available(macOS 14.4, *) { item["subtitle"] = first.subtitle ?? NSNull() }
            report["menuCapture"] = item
        }
        _ = card.accessibilityPerformPress()
        report["closedOnClick"] = notice.card == nil
        // Settings opens a moment later (the page gets the event, then draws the dialog)
        var tries = 0
        func look() {
            web.evaluateJavaScript(Self.settingsPageScript) { [self] value, _ in
                let page = (value as? String).flatMap { $0.data(using: .utf8) }.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                let heading = page?["heading"] as? String ?? ""
                tries += 1
                // The page's own settings arrive after the dialog draws its header: wait for both
                if (heading.isEmpty || page?["capture"] as? Bool != true) && tries < 40 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { look() }
                    return
                }
                report["settings"] = page ?? NSNull()
                report["settingsOpened"] = page?["capture"] as? Bool == true
                done(report)
            }
        }
        look()
    }

    /// Where the parts of the open Settings dialog are (page coordinates: [left, top, width, height]), whether a press on the middle of its
    /// close button reaches the button, and how far its page content is scrolled
    static let settingsLayoutScript = """
        (() => {
          const q = (s) => document.querySelector('.settings ' + s);
          const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
          };
          const head = q('.settings-head'), body = q('.settings-body'), close = q('.settings-close');
          let closeHit = false;
          if (close) {
            const r = close.getBoundingClientRect();
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            closeHit = !!at && close.contains(at);
          }
          return JSON.stringify({
            heading: head ? head.textContent : '', tab: (q('.settings-tab.is-on') || {}).textContent || '',
            dialog: box(document.querySelector('.settings')), head: box(head), body: box(body), close: box(close), closeHit,
            scrollTop: body ? Math.round(body.scrollTop) : -1, scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
            headLine: head ? getComputedStyle(head).borderBottomWidth : '',
          });
        })()
        """

    /// Settings in the smallest window (settings mode): every page opened from the shell (`openSettings`), each one measured and pictured
    /// (settings-<page>.png); the window's three buttons, in page coordinates, must not sit on the dialog. Then the Shortcuts page scrolled
    /// to its end (its header stays where it was) and the next page opened (it starts at its top)
    private func settingsRun(_ done: @escaping ([String: Any]) -> Void) {
        window.setContentSize(NSSize(width: 960, height: 600))
        var report: [String: Any] = [:]
        var pages: [[String: Any]] = []
        // The window's three buttons in page coordinates (from the top left of the web view, in points)
        func windowButtons() -> CGRect {
            let buttons = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { window.standardWindowButton($0) }
            let r = buttons.map { $0.convert($0.bounds, to: web) }.reduce(CGRect.null) { $0.union($1) }
            return web.isFlipped ? r : CGRect(x: r.minX, y: web.bounds.height - r.maxY, width: r.width, height: r.height)
        }
        func measure(_ then: @escaping ([String: Any]) -> Void) {
            web.evaluateJavaScript(Self.settingsLayoutScript) { value, _ in
                let text = (value as? String).flatMap { $0.data(using: .utf8) }
                then(text.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:])
            }
        }
        func onWindowButtons(_ page: [String: Any]) -> Bool {
            guard let d = page["dialog"] as? [Double], d.count == 4 else { return false }
            return windowButtons().intersects(CGRect(x: d[0], y: d[1], width: d[2], height: d[3]))
        }
        // The Shortcuts page is the longest: scrolled to its end, its header must not move; the page opened next starts at its top
        func scrolled() {
            let lights = windowButtons()
            report["windowButtons"] = [lights.minX, lights.minY, lights.width, lights.height].map { Int($0.rounded()) }
            report["windowSize"] = [Int(web.bounds.width), Int(web.bounds.height)]
            report["pages"] = pages
            bridge.emit("openSettings", ["section": "keys"])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [self] in
                web.evaluateJavaScript("document.querySelector('.settings .settings-body').scrollTop = 1e6") { [self] _, _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [self] in
                        measure { [self] page in
                            snapshot("settings-keys-scrolled.png") { [self] _ in
                                report["keysScrolled"] = page
                                bridge.emit("openSettings", ["section": "general"])
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                    measure { page in
                                        report["afterScrolled"] = page
                                        done(report)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        let sections = ["general", "annotate", "capture", "ai", "system", "keys", "advanced", "about"]
        func open(_ index: Int) {
            guard index < sections.count else { return scrolled() }
            let section = sections[index]
            bridge.emit("openSettings", ["section": section])
            // The dialog's entrance animation, then the picture (see poll)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [self] in
                measure { [self] page in
                    var page = page
                    page["section"] = section
                    page["onWindowButtons"] = onWindowButtons(page)
                    snapshot("settings-\(section).png") { shot in
                        page["shot"] = shot
                        pages.append(page)
                        open(index + 1)
                    }
                }
            }
        }
        // The window takes its new size before the first page opens
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { open(0) }
    }

    /// The prompt to move the app into Applications (moveNotice mode), not run as the modal alert, which would wait for a click: what it
    /// says, which button Return and Esc press, what the main button would show in Finder, and move-notice.png, the alert as drawn. Where
    /// the app really runs from a disk image (the CI run from the mounted volume) that is the problem it is made for; anywhere else a
    /// translocated copy is pretended
    private func moveNoticeRun(_ done: @escaping ([String: Any]) -> Void) {
        let bundlePath = Bundle.main.bundlePath
        let found = AppLocation.problem(bundlePath: bundlePath)
        let problem = found ?? .translocated
        let texts = MovePrompt.texts(for: problem)
        let alert = MovePrompt.alert(for: problem)
        let reveal = MovePrompt.reveal(for: problem, bundlePath: bundlePath)
        var report: [String: Any] = [
            "found": found.map { "\($0)" } ?? "none", "shownFor": "\(problem)", "bundlePath": bundlePath,
            "title": texts.title, "body": texts.body, "buttons": alert.buttons.map { $0.title },
            "returnKey": alert.buttons.map { $0.keyEquivalent == "\r" }, "escKey": alert.buttons.map { $0.keyEquivalent == "\u{1B}" },
            "applications": reveal.applications.path, "select": reveal.select?.path ?? NSNull(),
        ]
        // The text and the buttons draw into their layers only once the window is on screen: it is put up for a moment, not modal, and
        // its layers are rendered over the window background (the alert's own material is not part of the layers)
        let panel = alert.window
        panel.center()
        panel.orderFront(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            defer {
                panel.orderOut(nil)
                done(report)
            }
            guard let view = panel.contentView, let layer = view.layer else { return }
            let scale = panel.backingScaleFactor
            guard
                let rep = NSBitmapImageRep(
                    bitmapDataPlanes: nil, pixelsWide: Int(view.bounds.width * scale), pixelsHigh: Int(view.bounds.height * scale),
                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
                    bitsPerPixel: 0),
                let context = NSGraphicsContext(bitmapImageRep: rep)?.cgContext
            else { return }
            context.scaleBy(x: scale, y: scale)
            context.setFillColor(NSColor.windowBackgroundColor.usingColorSpace(.deviceRGB)?.cgColor ?? .white)
            context.fill(view.bounds)
            layer.render(in: context)
            if let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: outDir.appendingPathComponent("move-notice.png"))
                report["picture"] = "move-notice.png (\(rep.pixelsWide)x\(rep.pixelsHigh))"
            }
        }
    }

    /// The page's own account of itself, as a parsed object (nil when the page does not answer)
    private func probePage(_ done: @escaping (Any?) -> Void) {
        web.evaluateJavaScript(Self.probeScript) { page, _ in
            if let text = page as? String, let data = text.data(using: .utf8) {
                done(try? JSONSerialization.jsonObject(with: data))
            } else {
                done(nil)
            }
        }
    }

    /// A picture of the page written to `fileName` in the output folder; `done` gets what to say about it in result.json
    private func snapshot(_ fileName: String, _ done: @escaping (String) -> Void) {
        web.takeSnapshot(with: WKSnapshotConfiguration()) { [self] image, error in
            if let image, let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                do {
                    try png.write(to: outDir.appendingPathComponent(fileName))
                    done("\(fileName) (\(Int(image.size.width))x\(Int(image.size.height)))")
                } catch {
                    done("write failed: \(error)")
                }
            } else {
                done(error.map { "failed: \($0)" } ?? "none")
            }
        }
    }

    private func capture(ready: Bool) {
        if finished { return }
        finished = true
        let elapsed = Int(Date().timeIntervalSince(began) * 1000)
        probePage { [self] page in
            snapshot("ui.png") { [self] shot in
                if ready && Self.mode == "tour" {
                    // The card animates in: a second picture and probe a moment later show whether the first one caught it half way
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [self] in
                        probePage { [self] laterPage in
                            snapshot("ui-later.png") { [self] laterShot in
                                finish(ready: ready, elapsed: elapsed, page: page, shot: shot, laterPage: laterPage, laterShot: laterShot)
                            }
                        }
                    }
                } else {
                    finish(ready: ready, elapsed: elapsed, page: page, shot: shot, laterPage: nil, laterShot: nil)
                }
            }
        }
    }

    private func finish(ready: Bool, elapsed: Int, page: Any?, shot: String, laterPage: Any?, laterShot: String?) {
        var result: [String: Any] = [
            "ready": ready, "afterMs": elapsed, "snapshot": shot, "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
            "bridgeCalls": bridge.calls, "bridgeUnhandled": bridge.unhandled, "pageErrors": console.errors, "pageLogs": bridge.pageLogs,
        ]
        if let page { result["page"] = page }
        if let laterPage { result["pageLater"] = laterPage }
        if let laterShot { result["snapshotLater"] = laterShot }
        if let keyExperiment { result["keyExperiment"] = keyExperiment }
        result["menuBar"] = MenuReport.describe(NSApp.mainMenu)
        // Which bundle this is and whether the shell found its catalogs: a message in the language in use (the built-in text is English)
        let info = Bundle.main.infoDictionary
        result["bundle"] = [
            "id": Bundle.main.bundleIdentifier ?? "", "version": info?["CFBundleShortVersionString"] as? String ?? "",
            "build": info?["CFBundleVersion"] as? String ?? "", "fullVersion": info?["SnipTossVersion"] as? String ?? "",
            "about": ShellText.t("shell.menu.about", ["app": ShellText.t("brand.name")]),
        ]
        for (name, value) in SmokeNotes.all { result[name] = value }
        if let firstShot { result["snapshotFirst"] = firstShot }
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: outDir.appendingPathComponent("result.json"))
            print(String(data: data, encoding: .utf8) ?? "")
        }
        fflush(stdout)
        exit(ready ? 0 : 2)
    }
}

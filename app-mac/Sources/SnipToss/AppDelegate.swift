import AppKit
import WebKit

/// Where the built UI lives: SNIPTOSS_UI_DIR (development and CI), otherwise the `ui` folder inside the app bundle
func uiDirectory() -> URL? {
    if let dir = ProcessInfo.processInfo.environment["SNIPTOSS_UI_DIR"] { return URL(fileURLWithPath: dir, isDirectory: true) }
    return Bundle.main.resourceURL?.appendingPathComponent("ui", isDirectory: true)
}

/// The request-to-file rule for the UI host: files under `root` only, `/` is index.html
func uiResolver(root: URL) -> (URL) -> URL? {
    let rootPath = root.standardizedFileURL.path
    return { url in
        guard url.host == uiHost else { return nil }
        let relative = (url.path.isEmpty || url.path == "/") ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(relative).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard file.path.hasPrefix(rootPath + "/"), FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue
        else { return nil }
        return file
    }
}

/// What the page reports about itself through the `console` hook (errors only)
final class ConsoleCollector: NSObject, WKScriptMessageHandler {
    private(set) var errors: [String] = []

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        let line = "\(kind): \(body["text"] as? String ?? "")"
        errors.append(line)
        Log.error("page \(line)")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private let bridge = BridgeHost()
    private let console = ConsoleCollector()
    private var smoke: SmokeRun?
    private var changeWatch: ChangeWatch?
    private var observers: [NSObjectProtocol] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = uiDirectory(), FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            Log.error("the UI folder is missing (set SNIPTOSS_UI_DIR or put the built UI in the app bundle's ui folder)")
            exit(1)
        }
        let settings = Settings.load()
        let homes = NotesHomes()
        // Notes and items changed from outside (an agent wrote notes back, edited an item) reach the page as events
        let watch = ChangeWatch(settings: settings, emit: bridge.emit)
        changeWatch = watch
        installStubMethods(into: bridge)
        installLibraryMethods(into: bridge, settings: settings)
        installScanMethods(into: bridge, settings: settings, homes: homes)
        installNotesMethods(
            into: bridge, settings: settings, homes: homes, startWatching: watch.startWatching, didWrite: watch.wrote)
        // Ask the library's volumes now, in the background, so the first scan finds the answers ready
        Volumes.prefetch(settings.library.map { $0.path })
        // Merge entries that another folder entry's scan already reaches (duplicates from adding a subfolder before its parent). Done before
        // the page loads so the first library read sees the result; only volumes that already answered are touched, the rest wait for a later start
        let merged = Library.tidy(settings, reachable: { Volumes.known($0) == true })
        if merged > 0 { Log.info("Library: \(merged) entries inside other folder entries were merged away") }

        let config = WKWebViewConfiguration()
        let media = MediaAccess(roots: { settings.library.map { $0.path } }, homes: { homes.all })
        let scheme = FileSchemeHandler(
            resolve: hostResolver(ui: uiResolver(root: root), media: media.resolve),
            extraHeaders: { url in url.host?.lowercased() == MediaURL.host ? MediaURL.responseHeaders : [:] })
        config.setURLSchemeHandler(scheme, forURLScheme: uiScheme)
        config.userContentController.add(bridge, name: "bridge")
        config.userContentController.add(console, name: "console")
        for source in [bridgeShimScript, consoleHookScript] {
            config.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // The dialog keyboard model moves focus with Tab between buttons; by default WebKit on macOS reaches text fields only
        config.preferences.tabFocusesLinks = true
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
        if ProcessInfo.processInfo.environment["SNIPTOSS_INSPECTABLE"] == "1" { web.isInspectable = true }
        bridge.webView = web

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "SnipToss"
        window.minSize = NSSize(width: 960, height: 600)
        // Same as --bg in styles.css and Bg in MainWindow.cs, so a window that is still loading does not flash white
        window.backgroundColor = NSColor(srgbRed: 0x14 / 255, green: 0x14 / 255, blue: 0x16 / 255, alpha: 1)
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        observeWindowState()
        // The window is on screen now: work out what can be seen once, then let the notifications keep it up to date
        refreshWatching()
        watch.start()

        web.load(URLRequest(url: URL(string: "\(uiScheme)://\(uiHost)/index.html")!))
        if let out = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] {
            smoke = SmokeRun(outDir: URL(fileURLWithPath: out, isDirectory: true), web: web, bridge: bridge, console: console)
            smoke?.start()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: Window state

    /// Keeps the change watchers in step with what the user can see: they pause while the app is hidden or the window is minimized or
    /// fully covered (to save power; the Windows shell pauses only while its window is hidden) and look at once when it can be seen again,
    /// and an app that comes to the foreground has its items looked at. The page is told when the app is hidden, so a playing video stops:
    /// that is the case the Windows shell reports as the window being hidden. A minimized or covered window keeps playing
    private func observeWindowState() {
        listen(NSWindow.didChangeOcclusionStateNotification, object: window) { [weak self] in self?.refreshWatching() }
        listen(NSWindow.didMiniaturizeNotification, object: window) { [weak self] in self?.refreshWatching() }
        listen(NSWindow.didDeminiaturizeNotification, object: window) { [weak self] in self?.refreshWatching() }
        listen(NSApplication.didHideNotification, object: NSApp) { [weak self] in
            self?.bridge.emit("windowHidden")
            self?.refreshWatching()
        }
        listen(NSApplication.didUnhideNotification, object: NSApp) { [weak self] in self?.refreshWatching() }
        listen(NSApplication.didBecomeActiveNotification, object: NSApp) { [weak self] in self?.changeWatch?.windowActivated() }
    }

    private func listen(_ name: Notification.Name, object: AnyObject?, _ handler: @escaping () -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { _ in handler() })
    }

    private func refreshWatching() {
        var shown = window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible) && !NSApp.isHidden
        // A session without a display (the CI runner) reports every window as covered, which would pause the watchers the smoke runs use
        if ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] != nil { shown = true }
        changeWatch?.setVisible(shown)
    }
}

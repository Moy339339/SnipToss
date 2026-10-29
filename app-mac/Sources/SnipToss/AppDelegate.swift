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

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var web: DropWebView!
    private var settings: Settings!
    private let bridge = BridgeHost()
    private let console = ConsoleCollector()
    private let pendingOpens = PendingOpens()
    private var opens: OutsideOpens!
    private var statusItem: StatusItemController?
    private var smoke: SmokeRun?
    private var changeWatch: ChangeWatch?
    private var windowController: WindowController?
    private var nativeMenus: NativeMenus?
    private var hotkey: GlobalHotKey?
    /// The screen capture; in the capture smoke run its pictures are a made-up pattern, never the real screen
    private lazy var captureSession: CaptureSession = {
        let options: () -> CaptureOptions = { [weak self] in self?.captureOptions() ?? CaptureOptions() }
        let hintDone: () -> Void = { [weak self] in _ = self?.settings.update { $0.capture.selectHintDone = true } }
        // The smoke run records what would go on the clipboard and into a notice: the runner's clipboard is left alone
        return Self.smokeMode == "capture"
            ? CaptureSession(
                source: CaptureSmoke.source(), access: CaptureSmoke.Access(), options: options, clipboard: CaptureSmoke.clipboard,
                notices: CaptureSmoke.notices, hintDone: hintDone)
            : CaptureSession(source: ScreenCaptureKitSource(), options: options, hintDone: hintDone)
    }()
    private static let smokeMode = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] == nil ? nil : SmokeRun.mode
    private var observers: [NSObjectProtocol] = []
    /// Paths the system asked to open before the window was set up (the app was started by opening a file); added once it is
    private var earlyOpens: [String] = []
    private var launched = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = uiDirectory(), FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            Log.error("the UI folder is missing (set SNIPTOSS_UI_DIR or put the built UI in the app bundle's ui folder)")
            exit(1)
        }
        let settings = Settings.load()
        self.settings = settings
        // The shell's own words (menus, tray, messages) are in the language the UI is in, from the first one on
        ShellLocale.use(pref: settings.current.language)
        let homes = NotesHomes()
        // Notes and items changed from outside (an agent wrote notes back, edited an item) reach the page as events
        let watch = ChangeWatch(settings: settings, emit: bridge.emit)
        changeWatch = watch
        installStubMethods(into: bridge)
        // What is opened from outside before the page has read the library waits in `pendingOpens` for that first read
        installLibraryMethods(into: bridge, settings: settings, pending: pendingOpens.take)
        let dropped = DroppedPaths()
        installDropMethods(into: bridge, settings: settings, dropped: dropped)
        installClipboardMethods(into: bridge, settings: settings)
        // The global capture shortcut, registered from the settings now; why it could not be is what the page shows
        let hotkey = GlobalHotKey(backend: CarbonHotKeyBackend(), onPressed: { [weak self] in self?.captureHotKeyPressed() })
        hotkey.error = hotkey.set(settings.capture.hotkey)
        self.hotkey = hotkey
        SmokeNotes.record("hotkey", ["asked": settings.capture.hotkey, "registered": hotkey.current ?? "", "error": hotkey.error ?? "none"])
        // Capture from the page (the title bar's Capture, File → Capture Screen…): the call returns when the capture is over
        bridge.register("captureStart") { [weak self] _ in
            let over = DispatchSemaphore(value: 0)
            onMain {
                if let self { self.captureSession.start(whenClosed: { over.signal() }) } else { over.signal() }
            }
            over.wait()
            return nil
        }
        installCaptureSettingsMethods(into: bridge, settings: settings, hotkey: hotkey, access: SystemScreenAccess()) { [weak self] keepInTray in
            runOnMain { self?.statusItem?.setVisible(TrayPolicy.showsStatusItem(keepInTray: keepInTray)) }
        }
        installScanMethods(into: bridge, settings: settings, homes: homes)
        installNotesMethods(
            into: bridge, settings: settings, homes: homes, startWatching: watch.startWatching, didWrite: watch.wrote)
        opens = OutsideOpens(
            pending: pendingOpens, add: { Library.add(settings, paths: $0) }, emit: bridge.emit,
            show: { [weak self] in runOnMain { self?.showMainWindow() } })
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
        web = DropWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config, dropped: dropped)
        // Told when a page starts loading: what was opened from outside waits for the new page again
        web.navigationDelegate = self
        if ProcessInfo.processInfo.environment["SNIPTOSS_INSPECTABLE"] == "1" { web.isInspectable = true }
        bridge.webView = web

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "SnipToss"
        // Closing hides the window when the app keeps running in the menu bar; the window must stay alive to be shown again
        window.isReleasedWhenClosed = false
        // The page draws its own title strip, under the system's three window buttons (TitleBar.tsx leaves room for them at the left)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.styleMask.insert(.fullSizeContentView)
        window.minSize = NSSize(width: 960, height: 600)
        // Same as --bg in styles.css and Bg in MainWindow.cs, so a window that is still loading does not flash white
        window.backgroundColor = NSColor(srgbRed: 0x14 / 255, green: 0x14 / 255, blue: 0x16 / 255, alpha: 1)
        window.contentView = web
        window.center()
        // The main menu: without its standard Edit items the keys for copy, paste and select all do nothing in a text box. The key
        // experiment of the smoke run turns it off to see what happens without it. The page's own menus take over from the stand-ins
        // as soon as it sends them (setMenus)
        if ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_NOMENU"] != "1" {
            let bar = MainMenu.build(openSettings: #selector(openSettingsFromMenu(_:)), openAbout: #selector(openAboutFromMenu(_:)))
            NSApp.mainMenu = bar
            let menus = NativeMenus(bar: bar, emit: bridge.emit)
            menus.install(into: bridge)
            nativeMenus = menus
        } else {
            bridge.register("setMenus") { _ in nil }
        }
        let controller = WindowController(window: window, settings: settings)
        controller.install(into: bridge)
        windowController = controller
        // The menu bar item is the way back to a window that was closed while the app keeps running
        let item = StatusItemController(
            showWindow: { [weak self] in self?.showMainWindow() }, openSettings: { [weak self] in self?.openSettingsPage() },
            quit: { NSApp.terminate(nil) }, capture: { [weak self] in self?.captureSession.start() },
            shortcut: { [weak self] in self?.hotkey?.current.flatMap(HotKeySpec.parse) })
        item.setVisible(TrayPolicy.showsStatusItem(keepInTray: settings.capture.keepInTray))
        statusItem = item
        // Menus that are made once say their words again when the UI's language changes
        listen(.shellLanguageChanged, object: nil) { [weak self] in self?.languageChanged() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        observeWindowState()
        // The window is on screen now: work out what can be seen once, then let the notifications keep it up to date
        refreshWatching()
        watch.start()

        web.load(URLRequest(url: URL(string: "\(uiScheme)://\(uiHost)/index.html")!))
        if let out = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] {
            smoke = SmokeRun(
                outDir: URL(fileURLWithPath: out, isDirectory: true), web: web, window: window, bridge: bridge, console: console,
                captureSession: captureSession)
            smoke?.start()
        }

        // Opened from outside: on the command line (SnipToss <path>...), or by the system before the window existed
        launched = true
        let initial = LaunchArguments.paths(from: CommandLine.arguments) + earlyOpens
        earlyOpens = []
        if !initial.isEmpty { opens.open(initial) }
    }

    /// With "keep running in the menu bar" on, closing the last window leaves the app running (the window is hidden, see `windowWillClose`)
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        TrayPolicy.quitsWhenLastWindowCloses(keepInTray: settings?.capture.keepInTray ?? true)
    }

    /// A click on the Dock icon (or opening the app again) while the window is closed brings it back
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showMainWindow() }
        return false
    }

    /// Opened with the app from the file manager, `open -a SnipToss <path>`, or by a drop on the Dock icon. The system sends it before
    /// `applicationDidFinishLaunching` when the app was started by opening a file
    func application(_ application: NSApplication, open urls: [URL]) {
        let paths = urls.filter { $0.isFileURL }.map { $0.path }
        if paths.isEmpty { return }
        if launched {
            opens.open(paths)
        } else {
            earlyOpens.append(contentsOf: paths)
        }
    }

    /// The capture shortcut was pressed, from any app
    private func captureHotKeyPressed() {
        captureSession.start()
    }

    /// What a capture starts with: the settings as they are when it starts
    private func captureOptions() -> CaptureOptions {
        let values = settings.current
        let folder = values.capture.folder?.trimmingCharacters(in: .whitespacesAndNewlines)
        return CaptureOptions(
            markColor: MarkColor(hexText: values.markColor) ?? ToolPrefs.colors[0], defaultCategory: values.defaultCategory,
            selectHint: !values.capture.selectHintDone, notesInImage: values.capture.notesInImage, promptExtra: values.promptExtra,
            folder: folder?.isEmpty == false ? folder : nil)
    }

    private func languageChanged() {
        if let bar = NSApp.mainMenu {
            MainMenu.refreshAppMenu(in: bar, openSettings: #selector(openSettingsFromMenu(_:)), openAbout: #selector(openAboutFromMenu(_:)))
        }
        statusItem?.refreshLanguage()
    }

    /// App menu, Settings… (the page opens its own settings page)
    @objc private func openSettingsFromMenu(_ sender: Any?) {
        openSettingsPage()
    }

    /// App menu, About SnipToss
    @objc private func openAboutFromMenu(_ sender: Any?) {
        openSettingsPage(section: "about")
    }

    private func openSettingsPage(section: String = "general") {
        showMainWindow()
        bridge.emit("openSettings", ["section": section])
    }

    /// Brings the window to the front: shows it if it was closed, restores it if it was minimized, shows the app if it was hidden
    private func showMainWindow() {
        if NSApp.isHidden { NSApp.unhide(nil) }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // The watchers resume once the window can be seen; the occlusion notification does it too, this only makes it prompt
        DispatchQueue.main.async { [weak self] in self?.refreshWatching() }
    }

    // MARK: Page loading

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        pendingOpens.navigating()
        // The new page counts the versions of its menus from the start again
        nativeMenus?.pageReloading()
    }

    // MARK: Window state

    /// Keeps the change watchers in step with what the user can see: they pause while the app is hidden or the window is minimized or
    /// fully covered (to save power; the Windows shell pauses only while its window is hidden) and look at once when it can be seen again,
    /// and an app that comes to the foreground has its items looked at. The page is told when the app is hidden, so a playing video stops:
    /// that is the case the Windows shell reports as the window being hidden. A minimized or covered window keeps playing.
    /// A window closed while the app keeps running is hidden too: the page is told, and the watchers pause
    private func observeWindowState() {
        listen(NSWindow.didChangeOcclusionStateNotification, object: window) { [weak self] in self?.refreshWatching() }
        listen(NSWindow.didMiniaturizeNotification, object: window) { [weak self] in self?.refreshWatching() }
        listen(NSWindow.didDeminiaturizeNotification, object: window) { [weak self] in self?.refreshWatching() }
        listen(NSWindow.willCloseNotification, object: window) { [weak self] in self?.windowWillClose() }
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

    /// The window is closed (the red button, Cmd+W, the page's close action). It is gone a moment after this notification, so what can
    /// be seen is worked out once it has gone. When the app keeps running without it, a playing video stops, as when the Windows shell
    /// hides to the tray; otherwise the app quits next
    private func windowWillClose() {
        DispatchQueue.main.async { [weak self] in self?.refreshWatching() }
        if !TrayPolicy.quitsWhenLastWindowCloses(keepInTray: settings.capture.keepInTray) { bridge.emit("windowHidden") }
    }

    private func refreshWatching() {
        var shown = window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible) && !NSApp.isHidden
        // A session without a display (the CI runner) reports every window as covered, which would pause the watchers the smoke runs use
        if ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] != nil { shown = true }
        changeWatch?.setVisible(shown)
    }
}

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
    /// Opens pages of Settings, waiting for the page to be ready first
    private var settingsOpener: SettingsOpener!
    /// Says at startup that the capture shortcut couldn't be enabled
    private let hotkeyNotice = HotKeyNotice()
    /// The screen capture; in the capture smoke runs its pictures are a made-up pattern, never the real screen, except in the timing one,
    /// which only opens and closes the layers
    private lazy var captureSession: CaptureSession = {
        let options: () -> CaptureOptions = { [weak self] in self?.captureOptions() ?? CaptureOptions() }
        let hintDone: () -> Void = { [weak self] in _ = self?.settings.update { $0.capture.selectHintDone = true } }
        // The hint about drawings is shown once ever: recorded the moment it is taken
        let drawingHint: () -> Bool = { [weak self] in
            guard let settings = self?.settings, !settings.capture.drawingHintDone else { return false }
            _ = settings.update { $0.capture.drawingHintDone = true }
            return true
        }
        // The smoke runs record what would go on the clipboard and into a notice: the runner's clipboard is left alone
        switch Self.smokeMode {
        case "capture", "annotate":
            return CaptureSession(
                source: CaptureSmoke.source(), access: CaptureSmoke.Access(), options: options, clipboard: CaptureSmoke.clipboard,
                notices: CaptureSmoke.notices, hintDone: hintDone, drawingHint: drawingHint, colors: settings)
        case "captureTiming":
            return CaptureSession(
                source: ScreenCaptureKitSource(), options: options, clipboard: CaptureSmoke.clipboard, notices: CaptureSmoke.notices,
                colors: settings)
        default:
            return CaptureSession(source: ScreenCaptureKitSource(), options: options, hintDone: hintDone, drawingHint: drawingHint, colors: settings)
        }
    }()
    private static let smokeMode = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] == nil ? nil : SmokeRun.mode
    private var observers: [NSObjectProtocol] = []
    /// Paths the system asked to open before the window was set up (the app was started by opening a file); added once it is
    private var earlyOpens: [String] = []
    private var launched = false
    private var updates: UpdateCenter?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = uiDirectory(), FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            Log.error("the UI folder is missing (set SNIPTOSS_UI_DIR or put the built UI in the app bundle's ui folder)")
            exit(1)
        }
        let settings = Settings.load()
        self.settings = settings
        // The shell's own words (menus, tray, messages) are in the language the UI is in, from the first one on
        ShellLocale.use(pref: settings.current.language)
        // Run from where it was downloaded, or straight from the disk image: first the prompt to move it into Applications, before the
        // window, which quitting would only flash up (MovePrompt). Smoke runs never stop on it: they write down what was found, and the
        // `moveNotice` one what the prompt says
        let location = AppLocation.problem(bundlePath: Bundle.main.bundlePath)
        SmokeNotes.record("appLocation", location.map { "\($0)" } ?? "none")
        if let location, Self.smokeMode == nil, !MovePrompt.ask(location, bundlePath: Bundle.main.bundlePath) {
            NSApp.terminate(nil)
            return
        }
        let homes = NotesHomes()
        // Notes and items changed from outside (an agent wrote notes back, edited an item) reach the page as events
        let watch = ChangeWatch(settings: settings, emit: bridge.emit)
        changeWatch = watch
        let opener = SettingsOpener(emit: { [bridge] event, payload in bridge.emit(event, payload) })
        settingsOpener = opener
        // The update check (Updates.swift): the page hears of a new version again each time it is ready
        let info = Bundle.main.infoDictionary
        let version = info?["SnipTossVersion"] as? String ?? info?["CFBundleShortVersionString"] as? String
            ?? ProcessInfo.processInfo.environment["SNIPTOSS_VERSION"] ?? "0.0.0"
        let updates = UpdateCenter(settings: settings, current: version, emit: { [bridge] event, payload in bridge.emit(event, payload) })
        self.updates = updates
        bridge.register("checkUpdates") { _ in updates.checkNow() }
        installStubMethods(into: bridge, onReady: {
            opener.pageReady()
            runOnMain { updates.pageReady() }
        })
        // What is opened from outside before the page has read the library waits in `pendingOpens` for that first read
        installLibraryMethods(into: bridge, settings: settings, pending: pendingOpens.take, prefsChanged: { runOnMain { updates.prefsChanged() } })
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
                if let self { self.startCapture(fromWindow: true, whenClosed: { over.signal() }) } else { over.signal() }
            }
            over.wait()
            return nil
        }
        installCaptureSettingsMethods(
            into: bridge, settings: settings, hotkey: hotkey, access: SystemScreenAccess(),
            // A test instance never touches the login item (it belongs to the installed copy, which has the same identity)
            loginItem: AppPaths.isTestInstance ? nil : SystemLoginItem()
        ) { [weak self] keepInTray in
            runOnMain { self?.statusItem?.setVisible(TrayPolicy.showsStatusItem(keepInTray: keepInTray)) }
        }
        installRecentColorMethods(into: bridge, settings: settings)
        installScanMethods(into: bridge, settings: settings, homes: homes)
        installNotesMethods(
            into: bridge, settings: settings, homes: homes, startWatching: watch.startWatching, didWrite: watch.wrote)
        installSystemMethods(into: bridge, settings: settings, homes: homes)
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
            quit: { NSApp.terminate(nil) }, capture: { [weak self] in self?.startCapture(fromMenu: true) },
            shortcut: { [weak self] in self?.hotkey?.current.flatMap(HotKeySpec.parse) }, needsAccess: { !SystemScreenAccess().allowed },
            hotkeyFailed: { [weak self] in self?.hotkey?.error != nil }, download: { updates.openDownload() }, skip: { updates.skip() })
        updates.show = { [weak item] release in item?.showUpdate(release) }
        item.setVisible(TrayPolicy.showsStatusItem(keepInTray: settings.capture.keepInTray))
        statusItem = item
        // Menus that are made once say their words again when the UI's language changes
        listen(.shellLanguageChanged, object: nil) { [weak self] in self?.languageChanged() }
        // Started by the system at login: wait in the menu bar without a window (the event is only there while the launch is handled)
        let atLogin = Self.smokeMode == nil
            && LoginLaunch.startsHidden(event: NSAppleEventManager.shared().currentAppleEvent, keepInTray: settings.capture.keepInTray)
        if atLogin {
            Log.info("Started at login: waiting in the menu bar")
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        observeWindowState()
        if Self.smokeMode == nil { updates.startAutomaticChecks() }
        // The window is on screen now: work out what can be seen once, then let the notifications keep it up to date
        refreshWatching()
        watch.start()

        web.load(URLRequest(url: URL(string: "\(uiScheme)://\(uiHost)/index.html")!))
        if let out = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_OUT"] {
            smoke = SmokeRun(
                outDir: URL(fileURLWithPath: out, isDirectory: true), web: web, window: window, bridge: bridge, console: console,
                captureSession: captureSession, hotkeyNotice: hotkeyNotice, statusMenu: { item.makeMenu() })
            smoke?.start()
        }

        // Opened from outside: on the command line (SnipToss <path>...), or by the system before the window existed
        launched = true
        let initial = LaunchArguments.paths(from: CommandLine.arguments) + earlyOpens
        earlyOpens = []
        if !initial.isEmpty { opens.open(initial) }
        tellIfHotKeyFailed(hotkey)
    }

    /// At startup: when the capture shortcut couldn't be registered (another app holds it, or the stored one is not a shortcut), a notice
    /// says so and leads to Settings → Screen Capture, and the log says why (HotKeyNotice). Started at login with no window, pressing the
    /// shortcut would otherwise do nothing and say nothing. Smoke runs only record it, except the `hotkeyNotice` one, which shows it for a
    /// reason made up there (nothing holds the shortcut on a CI machine). The made-up reason is kept as the shortcut's error, so the rest of
    /// the app sees the failure too: the note under Capture Screen in the menu bar item's menu, and Settings → Screen Capture
    private func tellIfHotKeyFailed(_ hotkey: GlobalHotKey) {
        var reason = hotkey.error
        if Self.smokeMode == "hotkeyNotice" {
            let keys = HotKeySpec.parse(settings.capture.hotkey)?.symbols ?? settings.capture.hotkey
            reason = ShellText.t("shell.hotkey.taken", ["keys": keys])
            hotkey.error = reason
        }
        guard let reason else { return }
        Log.info("Screen Capture shortcut could not be registered: \(reason)")
        if Self.smokeMode != nil && Self.smokeMode != "hotkeyNotice" {
            SmokeNotes.record("hotkeyNotice", ["shown": false, "reason": reason])
            return
        }
        hotkeyNotice.show(title: ShellText.t("shell.tray.hotkeyFailed"), body: HotKeyNotice.body(reason: reason)) {
            [weak self] in self?.openSettingsPage(section: "capture")
        }
    }

    /// With "keep running in the menu bar" on, closing the last window leaves the app running (the window is hidden, see `windowWillClose`)
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        TrayPolicy.quitsWhenLastWindowCloses(keepInTray: settings?.capture.keepInTray ?? true)
    }

    /// A click on the Dock icon (or opening the app again) brings the window back when it was closed or minimized. Decided by the window
    /// itself, not by `flag`: the menu bar item has a window of its own that the system counts as a visible one, so `flag` is true even
    /// with the main window minimized, and returning false also keeps AppKit from restoring it
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !window.isVisible || window.isMiniaturized { showMainWindow() }
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

    /// The capture shortcut was pressed, from any app: the screen as it is now (the window too, if it is in front)
    private func captureHotKeyPressed() {
        captureSession.start()
    }

    /// From the window's own Capture: with "Hide this window while capturing" on (the default) the window goes first, so it is not in the
    /// picture, and comes back when the capture is over. From the menu bar item's menu: a moment's wait, so the menu has gone from the
    /// screen before the picture is taken. The wait (180 ms) is the Windows shell's: long enough for the window server to take a window down
    private func startCapture(fromWindow: Bool = false, fromMenu: Bool = false, whenClosed done: @escaping () -> Void = {}) {
        let hide = fromWindow && settings.capture.hideWindow && window.isVisible && !window.isMiniaturized
        if !hide && !fromMenu {
            captureSession.start(whenClosed: done)
            return
        }
        if hide {
            // As when the window is closed to the menu bar: a playing video stops rather than playing on unseen
            bridge.emit("windowHidden")
            window.orderOut(nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
            guard let self else { return done() }
            self.captureSession.start(whenClosed: { [weak self] in
                if hide { self?.showMainWindow() }
                done()
            })
        }
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
        settingsOpener.open(section)
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
        settingsOpener?.pageReloading()
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

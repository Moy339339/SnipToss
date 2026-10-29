import AppKit

/// What tells the user that the app may not record the screen, and takes them to the place where they allow it
protocol PermissionGuiding {
    func show(openSettings: @escaping () -> Void)
}

struct PermissionGuide: PermissionGuiding {
    func show(openSettings: @escaping () -> Void) {
        let app = ["app": ShellText.t("brand.name")]
        let alert = NSAlert()
        alert.messageText = ShellText.t("shell.capture.noAccessTitle", app)
        alert.informativeText = ShellText.t("shell.capture.noAccessBody", app)
        alert.addButton(withTitle: ShellText.t("shell.capture.openSettings"))
        // Esc goes to the button that is not the default one only when it says Cancel; this one says Not Now
        alert.addButton(withTitle: ShellText.t("shell.capture.notNow")).keyEquivalent = "\u{1B}"
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { openSettings() }
    }
}

/// One screen capture: the pictures of all screens are taken first, then a layer is put over each screen. Main thread only.
/// What is drawn on the layers, and what the user does with them, comes in the next steps; this one makes the layers and closes them
/// with Esc
final class CaptureSession {
    private let source: ScreenSource
    private let access: ScreenAccess
    private let guide: PermissionGuiding
    private let defaults: UserDefaults
    private var panels: [OverlayPanel] = []
    private var screenObserver: NSObjectProtocol?
    private var starting = false
    private var whenClosed: [() -> Void] = []
    private(set) var isOpen = false

    private static let requestedKey = "ScreenAccessRequested"

    init(source: ScreenSource, access: ScreenAccess = SystemScreenAccess(), guide: PermissionGuiding = PermissionGuide(), defaults: UserDefaults = .standard) {
        self.source = source
        self.access = access
        self.guide = guide
        self.defaults = defaults
    }

    /// The layers on screen now (for the tests and the smoke run)
    var overlayPanels: [OverlayPanel] { panels }

    /// Starts a capture. While one is going on this only brings its layers to the front. `whenClosed` is called once, when it is over for
    /// whatever reason (finished, cancelled, no permission, no pictures)
    func start(whenClosed done: @escaping () -> Void = {}) {
        whenClosed.append(done)
        if isOpen {
            panels.forEach { $0.orderFrontRegardless() }
            return
        }
        if starting { return }
        starting = true
        Task { [weak self] in
            guard let self else { return }
            let result: Result<[FrozenScreen], Error>
            do { result = .success(try await self.source.capture()) } catch { result = .failure(error) }
            DispatchQueue.main.async { self.pictures(result) }
        }
    }

    private func pictures(_ result: Result<[FrozenScreen], Error>) {
        starting = false
        switch result {
        case .success(let screens):
            show(screens)
        case .failure(let error):
            if error as? ScreenCaptureFailure == .noAccess {
                noAccess()
            } else {
                Log.error("The screen could not be captured: \(error)")
            }
            finish()
        }
    }

    /// The first time the system is asked to put its own question to the user; afterwards the guide says where to allow it
    private func noAccess() {
        if !defaults.bool(forKey: Self.requestedKey) {
            defaults.set(true, forKey: Self.requestedKey)
            access.request()
        } else {
            guide.show(openSettings: { [access] in access.openSettings() })
        }
    }

    private func show(_ screens: [FrozenScreen]) {
        let under = NSEvent.mouseLocation
        for screen in screens {
            let panel = OverlayPanel(frame: screen.frame)
            let view = FrozenView(frame: screen.frame, picture: screen.image)
            view.onCancel = { [weak self] in self?.close() }
            panel.contentView = view
            panel.orderFrontRegardless()
            if screen.frame.contains(under) || panels.isEmpty {
                panel.makeKey()
                panel.makeFirstResponder(view)
            }
            panels.append(panel)
        }
        isOpen = true
        // A screen that comes or goes, or changes its size, invalidates the pictures: the capture ends
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) {
            [weak self] _ in self?.close()
        }
    }

    /// Ends the capture and drops the pictures
    func close() {
        guard isOpen else { return }
        isOpen = false
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
        for panel in panels {
            panel.orderOut(nil)
            panel.contentView = nil
        }
        panels = []
        finish()
    }

    private func finish() {
        let done = whenClosed
        whenClosed = []
        done.forEach { $0() }
    }
}

/// The capture smoke run (SNIPTOSS_SMOKE_READY=capture): the layers are put over the screens with a made-up pattern as the picture, what
/// they are is written into result.json, and they are drawn to pictures. Nothing real is ever captured here
enum CaptureSmoke {
    static func source() -> PatternScreenSource {
        let screens = NSScreen.screens.map { screen in
            PatternScreenSource.Screen(displayID: ScreenID.of(screen), frame: screen.frame, scale: screen.backingScaleFactor)
        }
        // A run without a screen still makes a layer, on a screen that is made up
        return PatternScreenSource(
            screens: screens.isEmpty ? [PatternScreenSource.Screen(displayID: 0, frame: CGRect(x: 0, y: 0, width: 800, height: 600), scale: 1)] : screens)
    }

    /// Opens the layers, describes them, then presses Esc the way the keyboard would (to the key window) and checks that the capture
    /// ended; `close()` is the fallback when it did not
    static func run(session: CaptureSession, outDir: URL, done: @escaping ([String: Any]) -> Void) {
        var report: [String: Any] = ["screens": NSScreen.screens.count]
        var closedCalls = 0
        session.start(whenClosed: { closedCalls += 1 })
        wait(tries: 50, until: { session.isOpen }) { opened in
            report["opened"] = opened
            guard opened else {
                report["whenClosedCalls"] = closedCalls
                return done(report)
            }
            // Let the first frame be drawn
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                let panels = session.overlayPanels
                report["layers"] = panels.enumerated().map { Self.describe($1, index: $0, outDir: outDir) }
                report["appActive"] = NSApp.isActive
                report["keyLayer"] = panels.firstIndex { $0.isKeyWindow } ?? -1
                report["keyWindowIsLayer"] = NSApp.keyWindow is OverlayPanel
                Self.pressEscape()
                Self.wait(tries: 20, until: { !session.isOpen }) { closedByEsc in
                    report["closedByEsc"] = closedByEsc
                    if !closedByEsc { session.close() }
                    report["closed"] = !session.isOpen
                    report["layersAfter"] = session.overlayPanels.count
                    report["whenClosedCalls"] = closedCalls
                    done(report)
                }
            }
        }
    }

    /// Esc as the keyboard sends it: into the app's event queue, from where it goes to the key window
    private static func pressEscape() {
        let window = NSApp.keyWindow?.windowNumber ?? 0
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            if let event = NSEvent.keyEvent(
                with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window,
                context: nil, characters: "\u{1B}", charactersIgnoringModifiers: "\u{1B}", isARepeat: false, keyCode: 53)
            {
                NSApp.postEvent(event, atStart: false)
            }
        }
    }

    private static func wait(tries: Int, until condition: @escaping () -> Bool, _ done: @escaping (Bool) -> Void) {
        if condition() { return done(true) }
        if tries == 0 { return done(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { Self.wait(tries: tries - 1, until: condition, done) }
    }

    private static func describe(_ panel: OverlayPanel, index: Int, outDir: URL) -> [String: Any] {
        func rect(_ r: CGRect) -> [Double] { [Double(r.minX), Double(r.minY), Double(r.width), Double(r.height)] }
        var info: [String: Any] = [
            "level": panel.level.rawValue, "behavior": panel.collectionBehavior.rawValue,
            "nonactivating": panel.styleMask.contains(.nonactivatingPanel), "borderless": panel.styleMask.contains(.borderless),
            "canBecomeKey": panel.canBecomeKey, "visible": panel.isVisible, "isKey": panel.isKeyWindow, "frame": rect(panel.frame),
            "scale": Double(panel.backingScaleFactor),
            "screenFrame": panel.screen.map { rect($0.frame) } ?? [],
        ]
        if let view = panel.contentView as? FrozenView, let rep = view.render() {
            info["pixels"] = [rep.pixelsWide, rep.pixelsHigh]
            if let png = rep.representation(using: .png, properties: [:]) {
                let name = "capture-overlay-\(index).png"
                try? png.write(to: outDir.appendingPathComponent(name))
                info["picture"] = name
            }
            // Three pixels on the diagonal, a quarter, half and three quarters of the way down: the pattern's color at that place, dimmed
            // by half. The colors change along both axes, so a picture drawn upside down or at another scale does not match
            let space = rep.colorSpace
            info["colorSpace"] = space.localizedName ?? "\(space.colorSpaceModel.rawValue)"
            info["samples"] = [1, 2, 3].compactMap { quarter -> [String: Any]? in
                let x = rep.pixelsWide * quarter / 4
                let y = rep.pixelsHigh * quarter / 4
                guard let actual = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { return nil }
                return ["at": [x, y], "actual": srgb(actual), "expected": shown(PatternScreenSource.color(x: x, y: y), in: space) ?? []]
            }
        }
        return info
    }

    private static func srgb(_ color: NSColor) -> [Int] {
        [color.redComponent, color.greenComponent, color.blueComponent].map { Int(($0 * 255).rounded()) }
    }

    /// The pattern's color as the layer shows it: matched into the layer's color space (as drawing the picture is), black at half strength
    /// over it there, and read back in sRGB. The dimming happens in the screen's color space, so the result depends on the screen's
    /// profile; working it out the same way keeps the check independent of it
    private static func shown(_ c: (red: UInt8, green: UInt8, blue: UInt8), in space: NSColorSpace) -> [Int]? {
        guard
            let blank = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: 1, pixelsHigh: 1, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let rep = blank.retagging(with: space), let context = NSGraphicsContext(bitmapImageRep: rep)
        else { return nil }
        let pixel = NSRect(x: 0, y: 0, width: 1, height: 1)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor(srgbRed: CGFloat(c.red) / 255, green: CGFloat(c.green) / 255, blue: CGFloat(c.blue) / 255, alpha: 1).setFill()
        pixel.fill()
        NSColor.black.withAlphaComponent(FrozenView.dimming).setFill()
        pixel.fill(using: .sourceOver)
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()
        return rep.colorAt(x: 0, y: 0)?.usingColorSpace(.sRGB).map(srgb)
    }
}

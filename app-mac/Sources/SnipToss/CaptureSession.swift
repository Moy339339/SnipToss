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

/// What a capture starts with, from the settings at the moment the shortcut is pressed
struct CaptureOptions {
    /// The mark color in Settings → Annotations
    var markColor = ToolPrefs.colors[0]
    /// The category new notes start with
    var defaultCategory = "change"
    /// Write how to select below the magnifier: until the first capture has been finished
    var selectHint = false
    /// Settings → Screen Capture → Include notes in the image
    var notesInImage = true
    /// Settings → Copying → Extra instructions
    var promptExtra = ""
    /// The folder the user chose for saved captures; nil = the default one, which is cleaned of pictures older than 30 days
    var folder: String?
    var defaultFolder = AppPaths.capturesDir
}

/// One screen capture: the pictures of all screens are taken first, then a layer is put over each screen (CaptureOverlay). The selection can
/// be on one screen only (`owner`). Finishing collects what was drawn (`CaptureResult`). Main thread only
final class CaptureSession {
    private let source: ScreenSource
    private let access: ScreenAccess
    private let guide: PermissionGuiding
    private let defaults: UserDefaults
    private let options: () -> CaptureOptions
    private let clipboard: CaptureClipboard
    private let notices: CaptureNotifying
    /// The first capture was finished: the newcomer's instructions below the magnifier are not shown any more
    private let hintDone: () -> Void
    /// The options this capture started with
    private var chosen = CaptureOptions()
    private var panels: [OverlayPanel] = []
    private(set) var overlays: [CaptureOverlay] = []
    /// The layer the selection is on
    private(set) var owner: CaptureOverlay?
    private var screenObserver: NSObjectProtocol?
    private var starting = false
    /// When the capture now opening was asked for
    private var startedAt: Date?
    private var whenClosed: [() -> Void] = []
    private(set) var isOpen = false
    /// What the last finished capture collected, the picture made of it and where that was saved (the smoke run and the tests look)
    private(set) var lastResult: CaptureResult?
    private(set) var lastOutput: CaptureOutput.Output?
    private(set) var lastFile: String?

    init(
        source: ScreenSource, access: ScreenAccess = SystemScreenAccess(), guide: PermissionGuiding = PermissionGuide(), defaults: UserDefaults = .standard,
        options: @escaping () -> CaptureOptions = { CaptureOptions() }, clipboard: CaptureClipboard = SystemCaptureClipboard(),
        notices: CaptureNotifying = CaptureNotices(), hintDone: @escaping () -> Void = {}
    ) {
        self.source = source
        self.access = access
        self.guide = guide
        self.defaults = defaults
        self.options = options
        self.clipboard = clipboard
        self.notices = notices
        self.hintDone = hintDone
    }

    /// The layers on screen now (for the tests and the smoke run)
    var overlayPanels: [OverlayPanel] { panels }

    /// Starts a capture. While one is going on this only brings its layer to the front: the one with the selection, else the one under the
    /// pointer. `whenClosed` is called once, when it is over for whatever reason (finished, cancelled, no permission, no pictures)
    func start(whenClosed done: @escaping () -> Void = {}) {
        whenClosed.append(done)
        if isOpen {
            (owner ?? overlayUnderPointer() ?? overlays.first)?.activate()
            return
        }
        if starting { return }
        // An error left from last time is about the past once another capture starts
        notices.dismissError()
        // Asked first without asking the user: taking a picture without the permission makes the system put up its own question, which
        // would then stand next to ours
        if !access.allowed {
            noAccess()
            announceClosed()
            return
        }
        starting = true
        startedAt = Date()
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
            announceClosed()
        }
    }

    /// Either the system's question or our guide, never both at once: the first time only the system asks (it asks once only); after that
    /// it will not ask again, and the guide says where to allow it
    private func noAccess() {
        if !ScreenAccessAsk.firstTime(access, defaults: defaults) {
            guide.show(openSettings: { [access] in access.openSettings() })
        }
    }

    private func show(_ screens: [FrozenScreen]) {
        chosen = options()
        let windows = source.windows()
        // The window list counts from the top of the main screen, which in AppKit's coordinates starts at 0
        let mainHeight = NSScreen.screens.first?.frame.maxY ?? screens.first?.frame.maxY ?? 0
        let under = NSEvent.mouseLocation
        var keyPanel: OverlayPanel?
        isOpen = true
        owner = nil
        for screen in screens {
            let panel = OverlayPanel(frame: screen.frame)
            let overlay = CaptureOverlay(
                session: self, shot: screen, windows: WindowList.onLayer(windows, screen: screen.frame, mainHeight: mainHeight),
                defaultColor: chosen.markColor, defaultCategory: chosen.defaultCategory, selectHint: chosen.selectHint)
            panel.contentView = overlay
            panel.orderFrontRegardless()
            if screen.frame.contains(under) || keyPanel == nil { keyPanel = panel }
            panels.append(panel)
            overlays.append(overlay)
        }
        for overlay in overlays { overlay.appeared() }
        // The performance budget measures from the press to the layers on screen: the next turn of the loop, after they were drawn
        if let startedAt {
            DispatchQueue.main.async {
                Perf.record("Hotkey → capture overlay shown \(Int((Date().timeIntervalSince(startedAt) * 1000).rounded())) ms")
            }
        }
        keyboardRoute = nil
        if let keyPanel { takeKeyboard(keyPanel) }
        // A screen that comes or goes, or changes its size, invalidates the pictures: the capture ends
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) {
            [weak self] _ in
            Log.info("The screens changed during a capture: it ends")
            self?.close()
        }
    }

    /// The layer on the screen the pointer is on
    private func overlayUnderPointer() -> CaptureOverlay? {
        let under = NSEvent.mouseLocation
        return overlays.first { $0.window?.frame.contains(under) ?? false }
    }

    /// How the layer got the keyboard in this capture: "panel" (the panel became key by itself), "activated" (the app had to be brought to
    /// the front first), "none" (neither worked: only a right click ends the capture), nil while that is not known yet
    private(set) var keyboardRoute: String?

    /// The layer under the pointer takes the keyboard. A non-activating panel normally becomes key without the app coming to the front, so
    /// the program the user was in stays in front. Right after the app was opened, or with another program in front, that can fail; then
    /// the app is brought to the front and the layer asked again
    private func takeKeyboard(_ panel: OverlayPanel) {
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(panel.contentView)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self, self.isOpen else { return }
            var route = "panel"
            if !panel.isKeyWindow {
                route = "activated"
                NSApp.activate()
                panel.makeKeyAndOrderFront(nil)
                panel.makeFirstResponder(panel.contentView)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let self, self.isOpen else { return }
                let keyed = self.panels.contains { $0.isKeyWindow }
                self.keyboardRoute = keyed ? route : "none"
                Log.info(
                    "Capture layers on \(self.panels.count) screen(s); a layer has the keyboard: \(keyed) (\(self.keyboardRoute ?? "")); app active: \(NSApp.isActive)")
            }
        }
    }

    // MARK: Several screens

    /// Selecting has started on a screen: the other screens go back to fully dark. A selection that already has drawings cannot be taken over
    func claim(_ overlay: CaptureOverlay) -> Bool {
        if owner === overlay { return true }
        if let other = owner, other.hasSelection {
            if other.isLocked { return false }
            other.idle()
        }
        owner = overlay
        for o in overlays where o !== overlay { o.idle() }
        return true
    }

    func release(_ overlay: CaptureOverlay) {
        guard owner === overlay else { return }
        owner = nil
        for o in overlays { o.idle() }
    }

    /// Gives the keyboard back to the layer with the drawings (with several screens, clicking or right-clicking another one moves it there)
    func focusOwner() {
        guard isOpen, let owner, owner.window?.isVisible == true else { return }
        owner.activate()
    }

    // MARK: Ending

    /// Esc, ⌘W, ⌘. and the × on the toolbar: if notes have been written, warn once instead of discarding everything at once
    func requestCancel() {
        if owner?.guardCancel() == true { return }
        close()
    }

    /// ✓, Return, ⌘C or a double click in the selection: collects what was drawn, ends the capture, and hands the picture over. Nothing
    /// happens without a selection
    func finish() {
        guard let owner, owner.hasSelection else { return }
        let result = owner.result()
        close()
        lastResult = result
        // Sizes and counts only: the notes and the picture never go into the log
        let notes = result.marks.filter { $0.hasNote }.count
        let w = Int((result.selection.width * result.screen.scale).rounded())
        let h = Int((result.selection.height * result.screen.scale).rounded())
        Log.info("Capture finished: \(w) × \(h) px, \(result.marks.count) marks, \(notes) notes, overall comment: \(!result.overall.isEmpty)")
        output(result, chosen)
    }

    /// The picture is composited, saved and put on the clipboard, then a notice says so. Each step stands on its own: a picture that could
    /// not be saved (a full disk, a folder that is gone) still goes on the clipboard, so nothing drawn is lost
    func output(_ r: CaptureResult, _ o: CaptureOptions) {
        let screen = r.screen.frame
        let composed: CaptureOutput.Output
        do {
            composed = try CaptureOutput.compose(r, notesInImage: o.notesInImage, promptExtra: o.promptExtra)
        } catch {
            Log.error("Screen Capture: compositing the image failed: \(error)")
            notices.failed(
                title: ShellText.t("capture.error.compose"), detail: ShellText.t("capture.error.composeBody"), path: nil, error: "\(error)", on: screen)
            return
        }
        lastOutput = composed
        let notes = r.marks.filter { $0.hasNote }
        let folder = o.folder ?? o.defaultFolder
        var file: String?
        var saveError: String?
        do {
            file = try CaptureOutput.save(composed.png, folder: folder, cleanable: o.folder == nil)
        } catch {
            Log.error("Screen Capture: saving the file failed: \(error)")
            saveError = "\(error)"
        }
        lastFile = file
        // With the notes drawn into the picture only the picture goes on the clipboard: with a picture and words, each app picks one, and
        // some take the words and lose the picture. The words go too only when the notes are not drawn in, or they would be lost
        let hasNotes = !notes.isEmpty || !r.overall.isEmpty
        let text = hasNotes && !o.notesInImage
            ? CaptureOutput.handoffText(r, notes: notes, file: file, size: composed.size, promptExtra: o.promptExtra) : nil
        let rep = NSBitmapImageRep(cgImage: composed.image)
        rep.size = NSSize(width: CGFloat(composed.size.width) / r.screen.scale, height: CGFloat(composed.size.height) / r.screen.scale)
        do {
            try clipboard.put(png: composed.png, tiff: rep.tiffRepresentation, text: text)
        } catch {
            Log.error("Screen Capture: copying to the clipboard failed: \(error)")
            notices.failed(
                title: ShellText.t("capture.error.clipboard"),
                detail: ShellText.t(file == nil ? "capture.error.clipboardNoFile" : "capture.error.clipboardSaved"), path: file, error: "\(error)",
                on: screen)
            return
        }
        if o.selectHint { hintDone() }
        let what: [String: Any] = ["what": !notes.isEmpty ? "notes" : !r.overall.isEmpty ? "overall" : "image", "count": notes.count]
        let how = ShellText.t(!hasNotes ? "capture.how.plain" : o.notesInImage ? "capture.how.inImage" : "capture.how.notInImage")
        if let saveError {
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: folder, isDirectory: &isDirectory) && isDirectory.boolValue
            notices.failed(
                title: ShellText.t("capture.copiedNotSaved", values: what), detail: ShellText.t("capture.saveFailedHint", values: ["how": how]),
                path: exists ? folder : nil, error: saveError, on: screen)
        } else {
            // The notice only says it was copied; a second line only when the notes are not in the picture (pasting into an agent app
            // would lose them)
            notices.copied(title: ShellText.t("capture.copied", values: what), detail: hasNotes && !o.notesInImage ? how : "", on: screen)
        }
    }

    /// Ends the capture and drops the pictures
    func close() {
        guard isOpen else { return }
        isOpen = false
        owner = nil
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
        let gone = panels
        let views = overlays
        for overlay in views { overlay.teardown() }
        for panel in gone { panel.orderOut(nil) }
        panels = []
        overlays = []
        // The views are let go on the next turn: this may run inside one of their own event handlers
        DispatchQueue.main.async {
            for panel in gone { panel.contentView = nil }
            _ = views.count
        }
        announceClosed()
    }

    private func announceClosed() {
        let done = whenClosed
        whenClosed = []
        done.forEach { $0() }
    }
}

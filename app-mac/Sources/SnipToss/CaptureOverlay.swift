import AppKit

/// The layer laid over one screen while a capture is going on. It is a panel that does not activate the app: pressing the shortcut in
/// another program, or one in full screen, must not switch away from it, and it still takes the keyboard (`canBecomeKey`).
/// The properties are the ones Apple's engineers give for a window that stands above other programs' full screen spaces; the style mask is
/// set when the panel is made and never changed (the system loses track of a changed non-activating flag)
final class OverlayPanel: NSPanel {
    /// Above the menu bar and the Dock, and above other programs' full screen windows
    static let capturingLevel = NSWindow.Level.screenSaver
    /// While a note or a text is being typed: still above the menu bar and the Dock, but below the input method's candidate window, which
    /// the system puts at a lower level than the screen saver's
    static let typingLevel = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)

    init(frame: CGRect) {
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isFloatingPanel = true
        level = OverlayPanel.capturingLevel
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .canJoinAllApplications, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        acceptsMouseMovedEvents = true
        isReleasedWhenClosed = false
        setFrame(frame, display: false)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// What a finished capture hands to the session: what compositing the image needs
struct CaptureResult {
    let screen: FrozenScreen
    /// The selection, in points of the screen
    let selection: CGRect
    let marks: [Mark]
    let overall: String
    let overallCategory: String
    /// The pixelated picture of the whole screen, when something was pixelated
    let pixelated: CGImage?
    /// The whole screen, in points (the layer's bounds)
    let full: CGRect
}

/// The screen as it was when the capture started. Drawn once: the layer above it is what changes
final class FrozenPictureView: NSView {
    let picture: CGImage

    init(frame: CGRect, picture: CGImage) {
        self.picture = picture
        super.init(frame: frame)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        MarkPainter.drawPicture(picture, in: bounds, context: context)
    }
}

/// Over the picture: the marks (inside the selection only), the dimmed outside, the outline and the handles. Only the part that changed is
/// drawn again: while a mark is dragged out that is the mark's own area, not the whole screen
final class OverlayMarksView: NSView {
    weak var overlay: CaptureOverlay?

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        overlay?.drawMarks(dirtyRect)
    }
}

/// The capture overlay on one screen, the Mac counterpart of the Windows CaptureOverlay: on the frozen picture, hovering highlights a window
/// and a click selects it, or a drag selects an area; the selection can be moved and resized by eight handles; below it is a row of tools
/// (rectangle, ellipse, arrow, pen, Pixelate, text, then the Pin and the overall comment). After a rectangle, ellipse, arrow or pen stroke a
/// note box opens next to it. Finishing (✓, a double click in the selection, Return) hands over to the session.
/// What happens is decided by `OverlayStateMachine`; this view draws, takes the mouse and the keyboard, holds the two input boxes and the
/// magnifier, and shows the warning before cancelling. Coordinates are points in this view, y pointing down, snapped to the screen's pixels
final class CaptureOverlay: NSView, OverlayView {
    private weak var session: CaptureSession?
    let shot: FrozenScreen
    let full: CGRect
    let scale: CGFloat
    private(set) var state: OverlayStateMachine!
    private var link: HostLink!
    private let measure = SystemTextMeasure()
    private var pixelatedPicture: CGImage?
    /// The capture is over: late events are ignored
    private(set) var isClosed = false

    let pictureView: FrozenPictureView
    let marksView = OverlayMarksView()
    let sizeLabel = OverlaySizeLabel()
    let toolbar = OverlayRow()
    private(set) var toolButtons: [(button: OverlayButton, on: () -> Bool)] = []
    let subbar = OverlayRow()
    /// What the sub-toolbar was built for: it is built again only when that changes
    private var subbarFor = ""
    let magnifier: OverlayMagnifier
    private(set) var noteBox: OverlayNoteBox!
    let textBox = OverlayTextBox()
    let warn = OverlayBanner(size: 13, stroke: OverlayStyle.danger, radius: 8, padX: 12, padY: 6, shadow: false)
    private var warnTimer: Timer?
    /// The system's tooltips are windows below the overlay's level and would not show; the overlay draws its own
    let tooltip = OverlayBanner(size: 12, stroke: OverlayStyle.borderStrong, radius: 4, padX: 8, padY: 4, shadow: true)
    private var tooltipTimer: Timer?
    private var toolbarPlaced = false

    private var cursor = NSCursor.arrow
    /// The name of the pointer the state machine chose (for the smoke run's account of the layer)
    private(set) var cursorName = "arrow"
    /// The parts of the layer the last outline and selection covered, and the last mark being dragged out: drawn again when they change
    private var drawnChrome = CGRect.null
    private var drawnFor: (shown: CGRect?, sel: CGRect?) = (nil, nil)
    private var drawnDrawing: CGRect?
    private var tracking: NSTrackingArea?
    private var resignObserver: NSObjectProtocol?

    /// - Parameters:
    ///   - windows: the windows on this screen, topmost first, in this layer's coordinates
    ///   - defaultColor: the mark color in Settings
    ///   - defaultCategory: the category new notes start with (Settings → Annotations → Default category)
    ///   - selectHint: write how to select below the magnifier (for a newcomer who has not finished a capture yet)
    init(session: CaptureSession, shot: FrozenScreen, windows: [CGRect], defaultColor: MarkColor, defaultCategory: String, selectHint: Bool) {
        self.session = session
        self.shot = shot
        scale = shot.scale
        full = CGRect(x: 0, y: 0, width: shot.frame.width, height: shot.frame.height)
        pictureView = FrozenPictureView(frame: full, picture: shot.image)
        let hint = [ShellText.t("capture.hint.drag"), ShellText.t("capture.hint.click"), ShellText.t("capture.hint.esc")].joined(separator: "\n")
        magnifier = OverlayMagnifier(hint: selectHint ? hint : nil)
        super.init(frame: full)
        wantsLayer = true
        ToolPrefs.shared.start(defaultColor)
        let link = HostLink(session: session, overlay: self)
        self.link = link
        // The state machine first: the toolbar and the input boxes built below all act on it
        state = OverlayStateMachine(
            view: self, host: link, scale: scale, full: full, windows: windows, defaultColor: defaultColor,
            defaultCategory: Categories.valid(defaultCategory), prefs: ToolPrefs.shared, measure: measure)

        marksView.frame = full
        marksView.overlay = self
        noteBox = OverlayNoteBox(
            chooseCategory: { [weak self] key in
                guard let self, !self.isClosed else { return }
                self.state.setNoteCategory(key)
                self.window?.makeFirstResponder(self.noteBox.textView)
            },
            cancel: { [weak self] in
                guard let self, !self.isClosed else { return }
                self.state.cancelNote()
            },
            save: { [weak self] in
                guard let self, !self.isClosed else { return }
                self.state.commitNote()
            })
        noteBox.onChange = { [weak self] in
            guard let self, !self.isClosed, self.state.noteOpen else { return }
            // A line break made it taller: placed again so it does not run off the bottom of the screen
            self.placeNote()
        }
        noteBox.textView.onKey = { [weak self] event in self?.routeKey(event) ?? false }
        textBox.textView.onKey = { [weak self] event in self?.routeKey(event) ?? false }
        for b in noteBox.tipButtons { b.onHover = { [weak self] b, inside in self?.hoverTip(b, inside) } }

        // Bottom to top, as the Windows overlay stacks them
        for v in [pictureView, marksView, sizeLabel, textBox, toolbar, subbar, noteBox!, magnifier, warn, tooltip] as [NSView] { addSubview(v) }
        buildToolbar()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    /// While an input box is open a click on the picture does not take the keyboard from it (the note being written keeps its text cursor)
    override var acceptsFirstResponder: Bool { !(state?.noteOpen ?? false) && !(state?.textOpen ?? false) }

    /// The layers are on screen: the window under the pointer lights up at once, without waiting for the pointer to move
    func appeared() {
        state.hoverAtCursor()
        refresh()
    }

    /// The capture is over: timers and observers stop, late events are ignored
    func teardown() {
        isClosed = true
        warnTimer?.invalidate()
        tooltipTimer?.invalidate()
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        resignObserver = nil
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        resignObserver = nil
        guard let window else { return }
        // The layer lost the keyboard mid-drag (Cmd+Tab, a system window popped up): the release may never come, so the drag ends here.
        // Otherwise the selection or the mark would follow the pointer with no button down, and the toolbar would not come back
        resignObserver = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification, object: window, queue: .main) {
            [weak self] _ in
            guard let self, !self.isClosed, self.state.op != .noDrag else { return }
            self.state.endOp()
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(
            rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .cursorUpdate, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    // MARK: Mouse (what to do is up to the state machine; this view snaps to pixels and runs the magnifier)

    private func local(_ event: NSEvent) -> CGPoint {
        convert(event.locationInWindow, from: nil)
    }

    override func mouseDown(with event: NSEvent) {
        guard !isClosed else { return }
        hideTip()
        // AppKit keeps sending the drag and the release to this view until the button comes up, so nothing else has to hold on to the
        // mouse: a press that starts no drag (a Pin, a text) leaves nothing behind that could swallow the next click on the toolbar
        _ = state.down(OverlayGeometry.snap(local(event), scale: scale), clicks: event.clickCount)
    }

    override func mouseDragged(with event: NSEvent) {
        guard !isClosed else { return }
        moveTo(local(event), shift: event.modifierFlags.contains(.shift))
    }

    override func mouseUp(with event: NSEvent) {
        guard !isClosed else { return }
        state.endOp()
    }

    // Taken on release, as on Windows; the press is kept here so it does not ask for a context menu
    override func rightMouseDown(with event: NSEvent) {}

    override func rightMouseUp(with event: NSEvent) {
        guard !isClosed else { return }
        state.right()
    }

    override func mouseMoved(with event: NSEvent) {
        guard !isClosed else { return }
        let p = local(event)
        // Over the toolbar, a panel or an input box the picture underneath does not see the pointer
        if partAt(p) != nil {
            pointerOverPart(p)
            return
        }
        moveTo(p, shift: event.modifierFlags.contains(.shift))
        cursor.set()
    }

    override func mouseExited(with event: NSEvent) {
        guard !isClosed, state.op == .noDrag else { return }
        // The pointer went to another screen: the magnifier goes, and this screen's highlight with it (two screens would each light one)
        magnifier.isHidden = true
        state.mouseLeft()
    }

    override func cursorUpdate(with event: NSEvent) {
        guard !isClosed else { return }
        let p = local(event)
        if partAt(p) != nil { pointerOverPart(p) } else { cursor.set() }
    }

    /// The toolbar, a panel or an input box under the point (those take clicks themselves); nil = the picture
    private func partAt(_ p: CGPoint) -> NSView? {
        for v in [noteBox!, subbar, toolbar, textBox] as [NSView] where !v.isHidden && v.frame.contains(p) { return v }
        return nil
    }

    /// Over the parts the pointer is an arrow, or the text cursor over a place to type
    private func pointerOverPart(_ p: CGPoint) {
        let typing = (!textBox.isHidden && textBox.frame.contains(p)) || (!noteBox.isHidden && noteBox.field.convert(noteBox.field.bounds, to: self).contains(p))
        (typing ? NSCursor.iBeam : NSCursor.arrow).set()
    }

    private func moveTo(_ raw: CGPoint, shift: Bool) {
        let p = state.moveTo(raw, shift: shift)
        showMagnifier(p, show: state.magnifierVisible)
    }

    // MARK: Keyboard

    /// A key for the overlay: the overlay's own keys first (`press`), then the open input box's (Return saves, Esc cancels, ⌥1–4 picks the
    /// category). Returns true = taken; false = the input box types it
    @discardableResult
    func routeKey(_ event: NSEvent) -> Bool {
        guard !isClosed, let key = OverlayKey.from(keyCode: event.keyCode) else { return false }
        let mods = OverlayModifiers(event.modifierFlags)
        if state.press(key, mods) { return true }
        // An input method in the middle of composing gets Return and Esc itself (picking a candidate is not saving the note)
        if state.noteOpen { return !noteBox.textView.hasMarkedText() && state.noteKey(key, mods) }
        if state.textOpen { return !textBox.textView.hasMarkedText() && state.textKey(key) }
        return false
    }

    /// Keys pressed on the overlay itself; the ones it does not use are dropped without a beep
    override func keyDown(with event: NSEvent) {
        routeKey(event)
    }

    /// Keys with ⌘ come here first, before the main menu. All of them stay on the overlay except ⌘Q: the main menu belongs to the window
    /// behind, and would act on it (⌘W would close the main window, ⌘O open a file there). In an input box the editing keys go to the box
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard !isClosed, event.type == .keyDown else { return super.performKeyEquivalent(with: event) }
        let flags = event.modifierFlags.intersection([.command, .option, .shift, .control])
        if flags.contains(.command) {
            // Q
            if event.keyCode == 0x0C { return false }
            if let editor = openEditor() {
                // The editing keys, then the overlay's (⌘W, ⌘., ⌘Return), then the box's own (⌘← to the line start, ⌘⌫ ...)
                if !edit(event, flags, in: editor) && !routeKey(event) { editor.typeKey(event) }
                return true
            }
            routeKey(event)
            return true
        }
        // F keys mean nothing here; the main menu's would act on the window behind
        if let c = event.charactersIgnoringModifiers?.unicodeScalars.first, c.value >= 0xF704, c.value <= 0xF726 { return true }
        return false
    }

    /// The input box that is open, if any
    private func openEditor() -> OverlayTextView? {
        state.noteOpen ? noteBox.textView : state.textOpen ? textBox.textView : nil
    }

    /// Copy, paste, cut, select all, undo and redo in an input box, without the main menu
    private func edit(_ event: NSEvent, _ flags: NSEvent.ModifierFlags, in editor: OverlayTextView) -> Bool {
        let command = flags == [.command]
        switch event.keyCode {
        case 0x08 where command: editor.copy(nil)
        case 0x09 where command: editor.paste(nil)
        case 0x07 where command: editor.cut(nil)
        case 0x00 where command: editor.selectAll(nil)
        case 0x06 where command: editor.undoManager?.undo()
        case 0x06 where flags == [.command, .shift]: editor.undoManager?.redo()
        default: return false
        }
        return true
    }

    // MARK: Drawing

    /// The marks, the dimmed outside, the outline and the handles, inside `dirty`
    func drawMarks(_ dirty: CGRect) {
        guard let context = NSGraphicsContext.current?.cgContext, let state else { return }
        if let sel = state.sel {
            // Only what is inside the selection shows
            context.saveGState()
            context.clip(to: sel)
            let needsMosaic = state.marks.contains(where: { $0.kind == .mosaic }) || state.drawing?.kind == .mosaic
            let mosaic = needsMosaic ? pixelated() : nil
            for m in state.marks { MarkPainter.draw(m, in: context, pixelated: mosaic, screen: full, keepInside: state.keep) }
            if let d = state.drawing { MarkPainter.draw(d, in: context, pixelated: mosaic, screen: full, keepInside: state.keep) }
            if let picked = state.picked { MarkPainter.drawPicked(picked, keepInside: state.keep, measure: measure, in: context) }
            context.restoreGState()
        }
        // Everything outside the selection is dimmed; while still choosing, the hovered window is not (a click selects that one)
        context.setFillColor(OverlayStyle.dim.cgColor)
        context.addRect(bounds)
        if let shown = state.shown { context.addRect(shown) }
        context.fillPath(using: .evenOdd)
        if let f = state.shown {
            context.setStrokeColor(OverlayStyle.accent.cgColor)
            if state.sel == nil {
                context.setLineWidth(2)
                context.stroke(f)
            } else {
                // Just outside the selection, so it is not in the screenshot
                context.setLineWidth(1)
                context.stroke(f.insetBy(dx: -0.5, dy: -0.5))
            }
        }
        if state.handlesVisible, let s = state.sel {
            for p in OverlayGeometry.handlePoints(s) {
                let r = CGRect(x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7)
                context.setFillColor(NSColor.white.cgColor)
                context.fill(r)
                context.setStrokeColor(OverlayStyle.accent.cgColor)
                context.setLineWidth(1)
                context.stroke(r.insetBy(dx: 0.5, dy: 0.5))
            }
        }
    }

    /// The pixelated picture of the whole screen, worked out the first time something is pixelated
    private func pixelated() -> CGImage? {
        if pixelatedPicture == nil { pixelatedPicture = MarkPainter.pixelate(shot.image, scale: scale) }
        return pixelatedPicture
    }

    /// The outline, the dimmed outside and the selection's marks are drawn again where they were and where they are now
    private func invalidateChrome() {
        var now = CGRect.null
        for r in [state.shown, state.sel].compactMap({ $0 }) { now = now.union(r.insetBy(dx: -8, dy: -8)) }
        let area = drawnChrome.union(now)
        if !area.isNull { marksView.setNeedsDisplay(area) }
        drawnChrome = now
    }

    /// Where a mark being dragged out draws: its points, its line, an arrowhead, a number
    private func area(of m: Mark) -> CGRect {
        let b = m.bounds
        if b.wpfIsEmpty { return .null }
        let pad = max(2 * m.size + 12, 14)
        return CGRect(x: b.wpfX, y: b.wpfY, width: b.wpfWidth, height: b.wpfHeight).insetBy(dx: -pad, dy: -pad)
    }

    // MARK: What the state machine asks of the view

    func refresh() {
        guard !isClosed, let state else { return }
        // While still choosing, a pointer move redraws only when the highlighted window changes
        if state.sel != nil || state.shown != drawnFor.shown || state.sel != drawnFor.sel { invalidateChrome() }
        drawnFor = (state.shown, state.sel)

        if let f = state.shown {
            sizeLabel.show("\(pixels(f.width)) × \(pixels(f.height))")
            let size = sizeLabel.frame.size
            let top = f.minY - 6 - size.height
            sizeLabel.setFrameOrigin(
                CGPoint(x: clampValue(f.minX, full.minX + 4, max(full.minX + 4, full.maxX - 4 - size.width)), y: top >= full.minY + 4 ? top : f.minY + 6))
        } else {
            sizeLabel.isHidden = true
        }
        placeToolbar()
        if state.noteOpen { placeNote() }
    }

    /// Points to whole pixels of this screen, rounded the way the Windows overlay rounds them
    private func pixels(_ points: CGFloat) -> Int {
        Int((points * scale).rounded(.toNearestOrEven))
    }

    func redrawMarks() {
        guard !isClosed, let sel = state.sel else { return }
        let clip = sel.insetBy(dx: -2, dy: -2)
        if let d = state.drawing {
            let now = area(of: d)
            let dirty = (drawnDrawing ?? now).union(now).intersection(clip)
            if !dirty.isNull { marksView.setNeedsDisplay(dirty) }
            drawnDrawing = now
        } else {
            drawnDrawing = nil
            marksView.setNeedsDisplay(clip)
        }
    }

    func setCursor(_ kind: CursorKind) {
        switch kind {
        case .arrow:
            cursor = .arrow
            cursorName = "arrow"
        case .hand:
            cursor = .pointingHand
            cursorName = "hand"
        case .tool:
            // Drawing tools: the pointer becomes the tool's small icon (as in the main app); the Pin is a pin, Pixelate a circle as large as
            // the brush
            let size = state.prefs.currentSize(state.tool)
            let made = ToolCursors.forTool(state.tool, color: state.prefs.color, brush: size)
            cursor = made ?? .arrow
            cursorName = made == nil ? "arrow" : state.tool == .mosaic ? "brush-\(Int(size))" : "tool"
        case .sizeAll:
            cursor = ToolCursors.move
            cursorName = "sizeall"
        case .sizeNWSE:
            cursor = ToolCursors.resizeNWSE
            cursorName = "nwse"
        case .sizeNESW:
            cursor = ToolCursors.resizeNESW
            cursorName = "nesw"
        case .sizeNS:
            cursor = .resizeUpDown
            cursorName = "ns"
        case .sizeWE:
            cursor = .resizeLeftRight
            cursorName = "we"
        }
        if let p = cursorPosition, partAt(p) == nil { cursor.set() }
    }

    func openNoteBox(_ text: String) {
        noteBox.category = state.noteCategory
        // A note that marks a place says more places can be marked (ADR-0009); the overall comment gives an example
        let placeholder = ShellText.t(state.noteFor == nil ? "capture.note.placeholder" : "capture.note.placeholderMarks")
        noteBox.open(title: noteTitle(), placeholder: placeholder, text: text)
        placeNote()
        typingLevel()
        activate()
        window?.makeFirstResponder(noteBox.textView)
        noteBox.textView.setSelectedRange(NSRange(location: (text as NSString).length, length: 0))
    }

    /// "Note 2"; with several places "Note 2 · 3 marks"; the overall comment is "Overall comment (no position)"
    private func noteTitle() -> String {
        guard let m = state.noteFor else { return ShellText.t("capture.note.overall") }
        let n = m.hasNote ? m.number : m.pendingNumber
        let places = state.notePlaces
        return places > 1
            ? ShellText.t("capture.note.titlePlaces", values: ["n": n, "count": places]) : ShellText.t("capture.note.title", values: ["n": n])
    }

    func closeNoteBox() {
        noteBox.isHidden = true
        hideTip()
        typingLevel()
    }

    func paintNote() {
        noteBox.category = state.noteCategory
        noteBox.paint()
    }

    func showNotePlaces() {
        noteBox.title.text = noteTitle()
        noteBox.layoutBox()
        // Clicking the picture does not take the keyboard from the note box, and switching tools clicks the toolbar: either way the
        // keyboard goes back to the note box so typing can go on
        window?.makeFirstResponder(noteBox.textView)
    }

    var noteDraft: String { noteBox.textView.string }

    /// The note box goes next to the mark (grown by 12), or next to the toolbar for the overall comment
    private func placeNote() {
        noteBox.layoutBox()
        let anchor = state.noteFor.map { $0.bounds.wpfInflated(by: 12, 12) } ?? toolbar.frame
        noteBox.setFrameOrigin(OverlayGeometry.noteAt(anchor, size: noteBox.frame.size, full: full))
    }

    func openTextBox() {
        textBox.open(at: state.textAt, size: state.textSize, color: state.prefs.color.nsColor)
        typingLevel()
        activate()
        window?.makeFirstResponder(textBox.textView)
    }

    func closeTextBox() {
        textBox.isHidden = true
        typingLevel()
    }

    func restyleText() {
        textBox.restyle(size: state.textSize, color: state.prefs.color.nsColor)
    }

    var textDraft: String { textBox.textView.string }

    /// Where the typed text's first character is: the finished text is drawn there, so it lands where it was typed
    var textOrigin: CGPoint { textBox.isHidden ? state.textAt : textBox.firstCharacter(in: self) }

    /// While something is typed the layer steps down below the input method's candidate window (still above the menu bar and the Dock)
    private func typingLevel() {
        guard let panel = window as? OverlayPanel else { return }
        let typing = !noteBox.isHidden || !textBox.isHidden
        let level = typing ? OverlayPanel.typingLevel : OverlayPanel.capturingLevel
        if panel.level != level { panel.level = level }
    }

    /// The layer takes the keyboard (the box being typed in keeps it). It does not bring the app to the front
    func activate() {
        guard !isClosed, let window, window.isVisible else { return }
        window.makeKeyAndOrderFront(nil)
    }

    func focusSelf() {
        guard !isClosed else { return }
        window?.makeFirstResponder(self)
    }

    /// AppKit lets go of the mouse by itself when the button comes up
    func releaseMouse() {}

    var cursorPosition: CGPoint? {
        guard let window else { return nil }
        let m = NSEvent.mouseLocation
        let frame = window.frame
        guard m.x >= frame.minX, m.x < frame.maxX, m.y > frame.minY, m.y <= frame.maxY else { return nil }
        return CGPoint(x: m.x - frame.minX, y: frame.maxY - m.y)
    }

    // MARK: Toolbar

    private func buildToolbar() {
        var views: [NSView] = []
        var gaps: [CGFloat] = []
        func add(_ v: NSView, gap: CGFloat = 0) {
            views.append(v)
            gaps.append(gap)
        }
        func tool(_ t: Tool, _ id: String, _ message: String, _ icon: [String]) {
            add(iconButton(id, icon, ShellText.t(message), act: { $0.chooseTool(t) }, on: { $0.tool == t }))
        }
        tool(.rect, "rect", "capture.tool.rect", OverlayIcons.rect)
        tool(.ellipse, "ellipse", "capture.tool.ellipse", OverlayIcons.ellipse)
        tool(.arrow, "arrow", "capture.tool.arrow", OverlayIcons.arrow)
        tool(.pen, "pen", "capture.tool.pen", OverlayIcons.pen)
        tool(.mosaic, "mosaic", "capture.tool.mosaic", OverlayIcons.mosaic)
        tool(.text, "text", "capture.tool.text", OverlayIcons.text)
        add(OverlaySeparator())
        tool(.note, "note", "capture.tool.note", OverlayIcons.note)
        add(iconButton("overall", OverlayIcons.overall, ShellText.t("capture.tool.overall"), act: { $0.toggleOverall() }, on: { $0.noteOpen && $0.noteFor == nil }))
        add(OverlaySeparator())
        add(iconButton("undo", OverlayIcons.undo, ShellText.t("capture.tool.undo"), act: { $0.undo() }, on: { _ in false }))
        add(iconButton("cancel", OverlayIcons.close, ShellText.t("capture.tool.cancel"), act: { [weak self] _ in self?.session?.requestCancel() }, on: { _ in false }))
        add(doneButton(), gap: 4)
        toolbar.set(views, gaps: gaps)
    }

    /// A 32 × 32 tool button: the current tool has a blue background and a white icon, hover is one step lighter
    private func iconButton(_ id: String, _ icon: [String], _ tip: String, act: @escaping (OverlayStateMachine) -> Void, on: @escaping (OverlayStateMachine) -> Bool) -> OverlayButton {
        let isOn: () -> Bool = { [weak self] in self.map { on($0.state) } ?? false }
        let b = OverlayButton(id: id, name: tip, tip: tip, size: CGSize(width: 32, height: 32), action: { [weak self] in
            guard let self, !self.isClosed else { return }
            act(self.state)
        }) { b, context in
            let lit = isOn()
            OverlayButton.fillBackground(b, lit ? OverlayStyle.accentFill : b.hovered ? OverlayStyle.hover : nil)
            OverlayIcons.draw(icon, in: context, at: CGPoint(x: 8, y: 8), color: lit ? .white : b.hovered ? OverlayStyle.text : OverlayStyle.text2)
        }
        b.onHover = { [weak self] b, inside in self?.hoverTip(b, inside) }
        toolButtons.append((b, isOn))
        return b
    }

    /// Finish: a check mark and the word, on the solid blue of a primary button
    private func doneButton() -> OverlayButton {
        let label = ShellText.t("capture.done")
        let tip = ShellText.t("capture.doneTip")
        let width = 10 + 16 + 6 + ceil(OverlayText(label, size: 13, color: .white).fitting.width) + 12
        let b = OverlayButton(id: "done", name: tip, tip: tip, size: CGSize(width: width, height: 32), action: { [weak self] in
            guard let self, !self.isClosed else { return }
            self.session?.finish()
        }) { b, context in
            OverlayButton.fillBackground(b, b.hovered ? OverlayStyle.accentFillHover : OverlayStyle.accentFill)
            OverlayIcons.draw(OverlayIcons.check, in: context, at: CGPoint(x: 10, y: 8), color: .white, lineWidth: 1.6)
            OverlayButton.drawLabel(label, size: 13, color: .white, in: CGRect(x: 32, y: 0, width: b.bounds.width - 32 - 12, height: b.bounds.height))
        }
        b.onHover = { [weak self] b, inside in self?.hoverTip(b, inside) }
        toolButtons.append((b, { false }))
        return b
    }

    /// With a drawing tool chosen, the row next to the toolbar: thickness and color. With a mark picked there are only the colors, the lit one
    /// is its color, and a click changes that mark
    private func buildSubbar() {
        let tool = state.tool
        let picked = state.picked
        let current = picked?.color ?? state.prefs.color
        let sizeIndex = state.prefs.sizeIndex[tool] ?? 0
        let key = "\(tool)|\(picked != nil)|\(sizeIndex)|\(current.hexText)"
        if key == subbarFor { return }
        subbarFor = key
        var views: [NSView] = []
        if tool == .noTool && picked == nil {
            subbar.set([])
            return
        }
        if tool != .note && picked == nil {
            for (i, size) in ToolPrefs.sizes(tool).enumerated() {
                let on = sizeIndex == i
                let tip = ShellText.t(tool == .text ? "capture.size.text" : "capture.size.stroke", values: ["size": Int(size)])
                let b = OverlayButton(id: "size-\(i)", name: tip, tip: tip, size: CGSize(width: 28, height: 28), action: { [weak self] in
                    guard let self, !self.isClosed else { return }
                    self.state.setSize(i)
                }) { b, _ in
                    OverlayButton.fillBackground(b, on ? OverlayStyle.hover : nil)
                    let d = CGFloat(4 + i * 3)
                    (on ? OverlayStyle.text : OverlayStyle.muted).setFill()
                    NSBezierPath(ovalIn: CGRect(x: (28 - d) / 2, y: (28 - d) / 2, width: d, height: d)).fill()
                }
                b.onHover = { [weak self] b, inside in self?.hoverTip(b, inside) }
                views.append(b)
            }
        }
        if !(tool == .mosaic && picked == nil) {
            if !views.isEmpty { views.append(OverlaySeparator()) }
            for (i, c) in ToolPrefs.colors.enumerated() {
                let on = c == current
                let name = ToolPrefs.name(c)
                let tip = ShellText.t("capture.colorTip", values: ["name": name, "n": i + 1])
                let b = OverlayButton(id: "color-\(c.hexText.dropFirst())", name: name, tip: tip, size: CGSize(width: 28, height: 28), action: { [weak self] in
                    guard let self, !self.isClosed else { return }
                    self.state.setColor(c)
                }) { _, _ in
                    let swatch = CGRect(x: 7, y: 7, width: 14, height: 14)
                    c.nsColor.setFill()
                    NSBezierPath(ovalIn: swatch).fill()
                    if on {
                        NSColor.white.setStroke()
                        let ring = NSBezierPath(ovalIn: swatch.insetBy(dx: 1, dy: 1))
                        ring.lineWidth = 2
                        ring.stroke()
                    }
                }
                b.onHover = { [weak self] b, inside in self?.hoverTip(b, inside) }
                views.append(b)
            }
        }
        subbar.set(views)
    }

    /// Right-aligned below the selection; above it if there is no room below; inside it at the bottom if neither fits
    private func placeToolbar() {
        guard let s = state.sel, state.toolbarVisible else {
            toolbar.isHidden = true
            subbar.isHidden = true
            return
        }
        toolbar.repaint()
        buildSubbar()
        toolbar.isHidden = false
        subbar.isHidden = subbar.items.isEmpty
        if !subbar.isHidden { subbar.repaint() }
        let sub = subbar.isHidden ? CGSize.zero : subbar.frame.size
        let at = OverlayGeometry.toolbarAt(s, toolbar: toolbar.frame.size, subbar: sub, full: full)
        toolbar.setFrameOrigin(at.toolbar)
        toolbarPlaced = true
        if sub.height > 0 { subbar.setFrameOrigin(at.subbar) }
    }

    // MARK: Tooltips

    private func hoverTip(_ b: OverlayButton, _ inside: Bool) {
        tooltipTimer?.invalidate()
        tooltipTimer = nil
        tooltip.isHidden = true
        guard inside, !isClosed, let tip = b.tip, !tip.isEmpty else { return }
        let timer = Timer(timeInterval: 0.6, repeats: false) { [weak self, weak b] _ in
            guard let self, let b, b.hovered, !self.isClosed, !b.isHiddenOrHasHiddenAncestor else { return }
            self.tooltip.show(tip)
            let r = b.convert(b.bounds, to: self)
            let size = self.tooltip.frame.size
            var y = r.maxY + 6
            if y + size.height > self.full.maxY - 4 { y = r.minY - 6 - size.height }
            let x = clampValue(r.midX - size.width / 2, self.full.minX + 4, max(self.full.minX + 4, self.full.maxX - 4 - size.width))
            self.tooltip.setFrameOrigin(CGPoint(x: x, y: y))
        }
        RunLoop.main.add(timer, forMode: .common)
        tooltipTimer = timer
    }

    private func hideTip() {
        tooltipTimer?.invalidate()
        tooltipTimer = nil
        tooltip.isHidden = true
    }

    // MARK: Magnifier

    private func showMagnifier(_ p: CGPoint, show: Bool) {
        guard show else {
            magnifier.isHidden = true
            return
        }
        // 15 × 11 pixels around the pointer, 8 times as large. Next to a screen edge the cells off the screen stay empty, so the crosshair
        // always marks the pixel under the pointer
        let image = shot.image
        let px = min(max(pixels(p.x), 0), image.width - 1)
        let py = min(max(pixels(p.y), 0), image.height - 1)
        let left = px - OverlayMagnifier.cellsAcross / 2
        let top = py - OverlayMagnifier.cellsDown / 2
        let x0 = max(0, left)
        let y0 = max(0, top)
        let x1 = min(image.width, left + OverlayMagnifier.cellsAcross)
        let y1 = min(image.height, top + OverlayMagnifier.cellsDown)
        let around = x1 > x0 && y1 > y0 ? image.cropping(to: CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)) : nil
        let (color, hex) = pixelColor(px, py)
        let text: String
        if state.op == .newSel || state.op == .resize, let r = state.sel {
            text = "\(pixels(r.width)) × \(pixels(r.height))"
        } else {
            text = "x \(px)  y \(py)"
        }
        // The instructions show only before a drag starts: once dragging, what matters is the selection's size
        magnifier.show(pixels: around, offset: CGPoint(x: x0 - left, y: y0 - top), color: color, colorText: hex, position: text, showHint: state.op == .noDrag)
        let size = magnifier.frame.size
        var x = p.x + 20
        var y = p.y + 20
        if x + size.width > full.maxX - 4 { x = p.x - 20 - size.width }
        if y + size.height > full.maxY - 4 { y = p.y - 20 - size.height }
        magnifier.setFrameOrigin(CGPoint(x: x, y: y))
    }

    /// One pixel of the picture in sRGB, and as #RRGGBB
    private func pixelColor(_ px: Int, _ py: Int) -> (NSColor, String) {
        guard let one = shot.image.cropping(to: CGRect(x: px, y: py, width: 1, height: 1)) else { return (.clear, "") }
        var bytes = [UInt8](repeating: 0, count: 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(one, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            return true
        }
        guard drawn else { return (.clear, "") }
        let color = NSColor(srgbRed: CGFloat(bytes[0]) / 255, green: CGFloat(bytes[1]) / 255, blue: CGFloat(bytes[2]) / 255, alpha: 1)
        return (color, String(format: "#%02X%02X%02X", bytes[0], bytes[1], bytes[2]))
    }

    // MARK: The warning before cancelling

    /// Once notes have been written, the first Esc / × does not cancel but shows "press again to discard" above the toolbar; only a second
    /// press within 3 seconds really cancels (the state machine's `armCancel` decides). Returns true = only the warning was shown
    func guardCancel() -> Bool {
        guard !isClosed, state.armCancel(now: Date()) else { return false }
        warn.show(ShellText.t("capture.cancelWarn"))
        let size = warn.frame.size
        var x: CGFloat
        var y: CGFloat
        if toolbarPlaced {
            x = toolbar.frame.maxX - size.width
            // The thickness and color row above or below the toolbar counts too: the warning goes outside the whole group
            var top = toolbar.frame.minY
            var bottom = toolbar.frame.maxY
            if !subbar.isHidden {
                top = min(top, subbar.frame.minY)
                bottom = max(bottom, subbar.frame.maxY)
            }
            y = top - 8 - size.height >= full.minY + 4 ? top - 8 - size.height : bottom + 8
        } else {
            x = (full.width - size.width) / 2
            y = full.height / 2
        }
        x = clampValue(x, full.minX + 4, max(full.minX + 4, full.maxX - 4 - size.width))
        warn.setFrameOrigin(CGPoint(x: x, y: y))
        warnTimer?.invalidate()
        let timer = Timer(timeInterval: OverlayStateMachine.warnFor, repeats: false) { [weak self] _ in self?.warn.isHidden = true }
        RunLoop.main.add(timer, forMode: .common)
        warnTimer = timer
        return true
    }

    // MARK: For the session

    /// Another screen started selecting: this one goes back to fully dark, with no highlight
    func idle() {
        guard !isClosed else { return }
        state.idle()
    }

    /// What compositing the image needs (the open note box and text box are committed first)
    func result() -> CaptureResult {
        state.commitOpenEdits()
        let marks = state.marks
        let mosaic = marks.contains(where: { $0.kind == .mosaic }) ? pixelated() : nil
        return CaptureResult(
            screen: shot, selection: state.sel ?? full, marks: marks, overall: state.overall, overallCategory: state.overallCategory,
            pixelated: mosaic, full: full)
    }

    var hasSelection: Bool { state.sel != nil }

    /// Something has been drawn or an overall comment written: the selection is locked and another screen cannot take over
    var isLocked: Bool { state.locked }

    /// The layer as pixels (the smoke run and the tests): everything on it, tooltips included
    func render() -> NSBitmapImageRep? {
        guard let rep = bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        cacheDisplay(in: bounds, to: rep)
        return rep
    }
}

/// The overlay's side of what the state machine asks the session (with several screens the selection can be on only one of them)
private final class HostLink: OverlayHost {
    weak var session: CaptureSession?
    weak var overlay: CaptureOverlay?

    init(session: CaptureSession, overlay: CaptureOverlay) {
        self.session = session
        self.overlay = overlay
    }

    var isOwner: Bool { overlay != nil && session?.owner === overlay }
    var hasOwner: Bool { session?.owner != nil }

    func claim() -> Bool {
        guard let session, let overlay else { return false }
        return session.claim(overlay)
    }

    func release() {
        guard let overlay else { return }
        session?.release(overlay)
    }

    func focusOwner() { session?.focusOwner() }
    func requestCancel() { session?.requestCancel() }
    func finish() { session?.finish() }
}

import AppKit

/// The layer laid over one screen while a capture is going on. It is a panel that does not activate the app: pressing the shortcut in
/// another program, or one in full screen, must not switch away from it, and it still takes the keyboard (`canBecomeKey`).
/// The properties are the ones Apple's engineers give for a window that stands above other programs' full screen spaces; the style mask is
/// set when the panel is made and never changed (the system loses track of a changed non-activating flag)
final class OverlayPanel: NSPanel {
    init(frame: CGRect) {
        super.init(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isFloatingPanel = true
        // Above the menu bar and the Dock, and above other programs' full screen windows
        level = .screenSaver
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

/// A screen as it was a moment ago, dimmed. The y axis points down, as everywhere in the capture.
/// The pointer is the arrow before a region is chosen, as on Windows (the other pointers come with the selection and the tools)
final class FrozenView: NSView {
    private let picture: CGImage
    /// Called for Esc
    var onCancel: (() -> Void)?

    init(frame: CGRect, picture: CGImage) {
        self.picture = picture
        super.init(frame: NSRect(origin: .zero, size: frame.size))
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.activeAlways, .inVisibleRect, .cursorUpdate], owner: self))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    /// The part of the picture that was dimmed: black at half strength
    static let dimming: CGFloat = 0.5

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        // CGContext draws images with the y axis up; this view is flipped
        context.saveGState()
        context.translateBy(x: 0, y: bounds.height)
        context.scaleBy(x: 1, y: -1)
        context.interpolationQuality = .none
        context.draw(picture, in: bounds)
        context.restoreGState()
        context.setFillColor(NSColor.black.withAlphaComponent(Self.dimming).cgColor)
        context.fill(bounds)
    }

    // The layer does not activate the app, and the system may ignore a pointer that a program in the background sets: whether the arrow
    // shows over another program's text field is one of the checks on a real Mac
    override func cursorUpdate(with event: NSEvent) {
        NSCursor.arrow.set()
    }

    override func keyDown(with event: NSEvent) {
        // Esc
        if event.keyCode == 53 { onCancel?() } else { super.keyDown(with: event) }
    }

    /// For the tests and the smoke run: the view as pixels
    func render() -> NSBitmapImageRep? {
        guard let rep = bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        cacheDisplay(in: bounds, to: rep)
        return rep
    }
}

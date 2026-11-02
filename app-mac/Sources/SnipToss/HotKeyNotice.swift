import AppKit

/// How long a notice stays: 8 seconds of the pointer not being on it, so it never goes while it is being read. Counting stops while the
/// pointer is on the notice and goes on from where it was when it leaves
struct NoticeCountdown {
    let total: TimeInterval
    private var spent: TimeInterval = 0
    private var since: Date?

    init(total: TimeInterval) {
        self.total = total
    }

    var isCounting: Bool { since != nil }

    /// Counting from `now` on (it starts, or the pointer left the notice)
    mutating func count(from now: Date) {
        if since == nil { since = now }
    }

    /// The pointer is on the notice: the time counted so far is kept
    mutating func hold(at now: Date) {
        guard let since else { return }
        spent += now.timeIntervalSince(since)
        self.since = nil
    }

    /// The time left at `now`; it does not go down while held
    func remaining(at now: Date) -> TimeInterval {
        max(0, total - spent - (since.map { now.timeIntervalSince($0) } ?? 0))
    }
}

/// The notice at startup that the capture shortcut couldn't be registered (another app holds it, or the stored one is not a shortcut).
/// The Windows shell's tray balloon: started at login with no window, pressing the shortcut would otherwise do nothing and say nothing.
/// A card of the app's own at the top right of the screen with the menu bar, where the system's notifications appear; not a system
/// notification, which would ask the user for one more permission on the first start. It never takes the keyboard. A click on it opens
/// Settings → Screen Capture, its × closes it, and it goes by itself after `showsFor`, counted only while the pointer is not on it
final class HotKeyNotice {
    static let showsFor: TimeInterval = 8

    private var panel: NSPanel?
    private var timer: Timer?
    private var countdown = NoticeCountdown(total: HotKeyNotice.showsFor)

    /// The card that is up (the smoke run draws it into a picture); nil when there is none
    private(set) var card: Card?

    /// Shows the notice (in place of one that is up). `open` runs after a click on it, once it has closed
    func show(title: String, body: String, open: @escaping () -> Void) {
        close()
        let card = Card(
            title: title, body: body,
            open: { [weak self] in
                self?.close()
                open()
            },
            close: { [weak self] in self?.close() },
            hover: { [weak self] on in self?.hover(on) })
        let panel = NSPanel(
            contentRect: CGRect(origin: .zero, size: card.frame.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
            defer: false)
        panel.isFloatingPanel = true
        // Above the windows of all apps and below menus: the menu bar item's menu opens over it, not under it
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        // Kept out of a capture's frozen picture where the system honors it
        panel.sharingType = .none
        panel.contentView = card
        // The screen with the menu bar is the first one; the visible frame starts below the menu bar
        let area = NSScreen.screens.first?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1280, height: 800)
        panel.setFrameOrigin(Self.place(card.frame.size, in: area))
        panel.orderFrontRegardless()
        self.panel = panel
        self.card = card
        countdown = NoticeCountdown(total: Self.showsFor)
        countdown.count(from: Date())
        schedule()
    }

    /// Takes the notice away (nothing happens when there is none)
    func close() {
        timer?.invalidate()
        timer = nil
        panel?.orderOut(nil)
        panel = nil
        card = nil
    }

    /// The card's text under the title: the reason, then what a click does on a line of its own. The message is one paragraph,
    /// "{reason}. Click here to open Settings.", and wrapped as one it breaks wherever the reason happens to end, which can leave a word or
    /// two of the second sentence alone on the last line. The full stop after the reason stays with it; when a language puts the reason
    /// anywhere but first, the message is left as one paragraph
    static func body(reason: String) -> String {
        // A private-use character no message holds, to find where the reason goes
        let mark = "\u{E000}"
        let template = ShellText.t("shell.tray.hotkeyFailedBody", ["reason": mark])
        guard template.hasPrefix(mark) else { return ShellText.t("shell.tray.hotkeyFailedBody", ["reason": reason]) }
        let after = template.dropFirst(mark.count)
        let stop = after.prefix { !$0.isWhitespace && !$0.isLetter && !$0.isNumber }
        let rest = after.dropFirst(stop.count).trimmingCharacters(in: .whitespaces)
        return rest.isEmpty ? reason + stop : reason + stop + "\n" + rest
    }

    /// The bottom-left corner (AppKit's coordinates) that puts a card of `size` at the top right of `area`, 16 from its right edge and 12
    /// below its top, as the system's notifications sit; at the area's left when it is narrower than the card
    static func place(_ size: CGSize, in area: CGRect) -> CGPoint {
        CGPoint(x: max(area.minX, area.maxX - 16 - size.width), y: area.maxY - 12 - size.height)
    }

    private func hover(_ on: Bool) {
        if on {
            countdown.hold(at: Date())
            timer?.invalidate()
            timer = nil
        } else {
            countdown.count(from: Date())
            schedule()
        }
    }

    private func schedule() {
        timer?.invalidate()
        let left = countdown.remaining(at: Date())
        let next = Timer(timeInterval: left, repeats: false) { [weak self] _ in self?.close() }
        RunLoop.main.add(next, forMode: .common)
        timer = next
    }

    /// The card: 360 wide, the title with × at the right, and the reason with what a click does under it, on the overlay's panel colors
    /// (the same as the capture's error card). A click anywhere but the × opens Settings
    final class Card: NSView {
        static let width: CGFloat = 360

        private let open: () -> Void
        private let hover: (Bool) -> Void
        private var pressed = false
        private var tracking: NSTrackingArea?
        let closeButton: OverlayButton

        init(title: String, body: String, open: @escaping () -> Void, close: @escaping () -> Void, hover: @escaping (Bool) -> Void) {
            self.open = open
            self.hover = hover
            let closeName = ShellText.t("app.toast.close")
            closeButton = OverlayButton(id: "notice-close", name: closeName, size: CGSize(width: 24, height: 24), action: close) { b, context in
                OverlayButton.fillBackground(b, b.hovered ? OverlayStyle.hover : nil)
                OverlayIcons.draw(OverlayIcons.close, in: context, at: CGPoint(x: 4, y: 4), color: b.hovered ? OverlayStyle.text : OverlayStyle.text2)
            }
            super.init(frame: .zero)
            let inner = Self.width - 32
            let head = OverlayText(KeepWords.of(title), size: 13, color: OverlayStyle.text, weight: .semibold)
            head.width = inner - 32
            head.lineHeight = 20
            head.fit(at: CGPoint(x: 16, y: 14))
            addSubview(head)
            closeButton.frame.origin = CGPoint(x: Self.width - 12 - 24, y: 12)
            addSubview(closeButton)
            let what = OverlayText(KeepWords.of(body), size: 12, color: OverlayStyle.text2)
            what.width = inner
            what.lineHeight = 18
            what.fit(at: CGPoint(x: 16, y: head.frame.maxY + 4))
            addSubview(what)
            frame = CGRect(x: 0, y: 0, width: Self.width, height: what.frame.maxY + 14)
            setAccessibilityElement(true)
            setAccessibilityRole(.button)
            setAccessibilityLabel("\(title). \(body)")
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used") }

        override var isFlipped: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func updateTrackingAreas() {
            super.updateTrackingAreas()
            if let tracking { removeTrackingArea(tracking) }
            // The app is usually not active when the notice is up: the pointer is followed anyway
            let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
            addTrackingArea(area)
            tracking = area
        }

        override func mouseEntered(with event: NSEvent) { hover(true) }
        override func mouseExited(with event: NSEvent) { hover(false) }

        override func mouseDown(with event: NSEvent) { pressed = true }

        override func mouseUp(with event: NSEvent) {
            let inside = bounds.contains(convert(event.locationInWindow, from: nil))
            let wasPressed = pressed
            pressed = false
            if wasPressed && inside { open() }
        }

        override func accessibilityPerformPress() -> Bool {
            open()
            return true
        }

        override func draw(_ dirtyRect: NSRect) {
            let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
            OverlayStyle.surface2.setFill()
            shape.fill()
            OverlayStyle.borderStrong.setStroke()
            shape.lineWidth = 1
            shape.stroke()
        }
    }
}

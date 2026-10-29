import AppKit

/// Where a finished capture's picture and words go: the clipboard, or in the tests and the smoke run a recorder that never touches the
/// user's clipboard
protocol CaptureClipboard {
    /// Puts the picture (PNG first, TIFF for apps that only read that) and, when given, the words on the clipboard. Throws when the system
    /// refuses
    func put(png: Data, tiff: Data?, text: String?) throws
}

struct SystemCaptureClipboard: CaptureClipboard {
    enum Failure: Error {
        case refused
    }

    func put(png: Data, tiff: Data?, text: String?) throws {
        func once() -> Bool {
            let board = NSPasteboard.general
            board.clearContents()
            let item = NSPasteboardItem()
            item.setData(png, forType: .png)
            if let tiff { item.setData(tiff, forType: .tiff) }
            if let text { item.setString(text, forType: .string) }
            return board.writeObjects([item])
        }
        if once() { return }
        // Another program may have the clipboard for a moment: one more try
        Thread.sleep(forTimeInterval: 0.1)
        if !once() { throw Failure.refused }
    }
}

/// Records what would have gone on the clipboard
final class RecordingCaptureClipboard: CaptureClipboard {
    private(set) var png: Data?
    private(set) var tiff: Data?
    private(set) var text: String?
    private(set) var puts = 0
    var fails = false

    func put(png: Data, tiff: Data?, text: String?) throws {
        if fails { throw SystemCaptureClipboard.Failure.refused }
        puts += 1
        self.png = png
        self.tiff = tiff
        self.text = text
    }
}

/// The notices after a capture: "copied" in the middle of the screen for a moment, or an error that stays until it is closed.
/// A protocol so the tests and the smoke run can see what would have been shown
protocol CaptureNotifying {
    func copied(title: String, detail: String, on screen: CGRect)
    func failed(title: String, detail: String, path: String?, error: String?, on screen: CGRect)
    /// Another capture starts: an error left from last time is about the past
    func dismissError()
}

/// Records the notices instead of showing them
final class RecordingCaptureNotices: CaptureNotifying {
    struct Shown {
        let kind: String
        let title: String
        let detail: String
        let path: String?
        let error: String?
    }

    private(set) var shown: [Shown] = []

    func copied(title: String, detail: String, on screen: CGRect) {
        shown.append(Shown(kind: "toast", title: title, detail: detail, path: nil, error: nil))
    }

    func failed(title: String, detail: String, path: String?, error: String?, on screen: CGRect) {
        shown.append(Shown(kind: "error", title: title, detail: detail, path: path, error: error))
    }

    func dismissError() {}
}

/// The notices as windows. Both float above other programs, full screen ones included, and never take the keyboard when they appear
/// (the user is about to paste into another program)
final class CaptureNotices: CaptureNotifying {
    private var toast: NoticePanel?
    private var toastTimer: Timer?
    private var error: NoticePanel?

    /// A roughly square notice in the middle of the screen's work area, like the system's volume popup: a clipboard with a check mark and
    /// one sentence. It appears at once and goes after 1.5 seconds; the mouse passes through it
    func copied(title: String, detail: String, on screen: CGRect) {
        closeToast()
        let card = ToastCard(title: title, detail: detail)
        let panel = Self.panel(size: card.frame.size)
        panel.ignoresMouseEvents = true
        panel.contentView = card
        panel.setFrameOrigin(Self.middle(of: Self.workArea(of: screen), size: card.frame.size))
        panel.orderFrontRegardless()
        toast = panel
        let timer = Timer(timeInterval: 1.5, repeats: false) { [weak self] _ in self?.closeToast() }
        RunLoop.main.add(timer, forMode: .common)
        toastTimer = timer
    }

    /// The error stays until its × or Esc closes it: what went wrong, what to do, where the picture or folder is (a click shows it in
    /// Finder), the system's own words (selectable), and Open Log
    func failed(title: String, detail: String, path: String?, error message: String?, on screen: CGRect) {
        dismissError()
        let card = ErrorCard(title: title, detail: detail, path: path, error: message) { [weak self] in self?.dismissError() }
        let panel = Self.panel(size: card.frame.size)
        panel.onCancel = { [weak self] in self?.dismissError() }
        panel.contentView = card
        panel.setFrameOrigin(Self.middle(of: Self.workArea(of: screen), size: card.frame.size))
        panel.orderFrontRegardless()
        error = panel
    }

    func dismissError() {
        error?.orderOut(nil)
        error = nil
    }

    private func closeToast() {
        toastTimer?.invalidate()
        toastTimer = nil
        toast?.orderOut(nil)
        toast = nil
    }

    private static func panel(size: CGSize) -> NoticePanel {
        let panel = NoticePanel(contentRect: CGRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .popUpMenu
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        // Kept out of the next capture's frozen picture where the system honors it
        panel.sharingType = .none
        return panel
    }

    /// The screen's area without the menu bar and the Dock (the whole screen when the system does not know it)
    static func workArea(of screen: CGRect) -> CGRect {
        NSScreen.screens.first { $0.frame == screen }?.visibleFrame ?? screen
    }

    /// The bottom-left corner that puts `size` in the middle of `area` (AppKit's coordinates); at its top-left when it does not fit
    static func middle(of area: CGRect, size: CGSize) -> CGPoint {
        CGPoint(x: area.minX + max(0, (area.width - size.width) / 2).rounded(.down), y: area.maxY - size.height - max(0, (area.height - size.height) / 2).rounded(.down))
    }

    /// A panel that can take the keyboard when clicked (so Esc closes the error and its text can be selected)
    private final class NoticePanel: NSPanel {
        var onCancel: (() -> Void)?

        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { false }

        // Esc
        override func cancelOperation(_ sender: Any?) {
            if let onCancel { onCancel() } else { orderOut(nil) }
        }
    }

    /// "Copied": 196 wide (one Chinese sentence fits a line; longer languages wrap to two or three), an opaque mid-gray card that stands out
    /// on a dark screen, a large clipboard with a check mark, the sentence, and a second line only when the notes were not drawn in
    final class ToastCard: NSView {
        private let title: OverlayText
        private let detail: OverlayText?

        init(title text: String, detail second: String) {
            let head = OverlayText(KeepWords.of(text), size: 15, color: OverlayStyle.text, weight: .bold)
            head.width = 196 - 28
            head.lineHeight = 22
            head.alignment = .center
            title = head
            var below: OverlayText?
            if !second.isEmpty {
                let d = OverlayText(KeepWords.of(second), size: 12, color: OverlayStyle.text)
                d.width = 196 - 28
                d.lineHeight = 18
                d.alignment = .center
                below = d
            }
            detail = below
            super.init(frame: .zero)
            title.fit(at: CGPoint(x: 14, y: 18 + 36 + 12))
            addSubview(title)
            var bottom = title.frame.maxY
            if let detail {
                detail.fit(at: CGPoint(x: 14, y: bottom + 6))
                addSubview(detail)
                bottom = detail.frame.maxY
            }
            let height = max(152, bottom + 18)
            // Vertically centered in a card that is taller than its content
            let shift = (height - (bottom + 18)) / 2
            for v in subviews { v.frame.origin.y += shift }
            iconTop = 18 + shift
            frame = CGRect(x: 0, y: 0, width: 196, height: height)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used") }

        private var iconTop: CGFloat = 18

        override var isFlipped: Bool { true }

        override func draw(_ dirtyRect: NSRect) {
            let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
            NSColor(hex: 0x3a3a40).setFill()
            shape.fill()
            NSColor(hex: 0x4c4c52).setStroke()
            shape.lineWidth = 1
            shape.stroke()
            guard let context = NSGraphicsContext.current?.cgContext else { return }
            // The UI's line icons are on a 16 grid; this one is drawn at 2.25 times, the board in the text color, the check in the accent
            let at = CGPoint(x: (bounds.width - 36) / 2, y: iconTop)
            OverlayIcons.draw(
                [
                    "M5.5 3H4.5A1.5 1.5 0 0 0 3 4.5V13A1.5 1.5 0 0 0 4.5 14.5H11.5A1.5 1.5 0 0 0 13 13V4.5A1.5 1.5 0 0 0 11.5 3H10.5",
                    "M6.5 1.75H9.5A1 1 0 0 1 10.5 2.75V3.25A1 1 0 0 1 9.5 4.25H6.5A1 1 0 0 1 5.5 3.25V2.75A1 1 0 0 1 6.5 1.75Z",
                ], in: context, at: at, scale: 2.25, color: OverlayStyle.text, lineWidth: 1.05)
            OverlayIcons.draw(["M5.6 9.1L7.2 10.7L10.4 7.3"], in: context, at: at, scale: 2.25, color: OverlayStyle.accent, lineWidth: 1.05)
        }
    }

    /// The error: 480 wide, the title with × at the right, what to do, the path, the system's words in a box, Open Log
    final class ErrorCard: NSView {
        private let close: () -> Void
        private var path: String?

        init(title: String, detail: String, path: String?, error: String?, close: @escaping () -> Void) {
            self.close = close
            self.path = path
            super.init(frame: .zero)
            let inner: CGFloat = 480
            let head = OverlayText(KeepWords.of(title), size: 13, color: OverlayStyle.text, weight: .semibold)
            head.width = inner - 28
            head.lineHeight = 20
            head.fit(at: CGPoint(x: 16, y: 14))
            addSubview(head)
            let closeButton = OverlayButton(id: "error-close", name: ShellText.t("capture.tool.cancel"), size: CGSize(width: 24, height: 24), action: close) { b, context in
                OverlayButton.fillBackground(b, b.hovered ? OverlayStyle.hover : nil)
                OverlayIcons.draw(OverlayIcons.close, in: context, at: CGPoint(x: 4, y: 4), color: b.hovered ? OverlayStyle.text : OverlayStyle.text2)
            }
            closeButton.frame.origin = CGPoint(x: 16 + inner - 24 + 8, y: 12)
            addSubview(closeButton)
            var y = head.frame.maxY + 4
            let what = OverlayText(KeepWords.of(detail), size: 12, color: OverlayStyle.text2)
            what.width = inner
            what.lineHeight = 18
            what.fit(at: CGPoint(x: 16, y: y))
            addSubview(what)
            y = what.frame.maxY
            if let path {
                let link = OverlayButton(id: "error-path", name: path, tip: path, size: .zero, action: { [weak self] in self?.reveal() }) { b, _ in
                    let text = NSAttributedString(
                        string: path, attributes: [.font: OverlayStyle.font(12), .foregroundColor: OverlayStyle.accent, .underlineStyle: b.hovered ? 1 : 0])
                    text.draw(with: b.bounds, options: [.usesLineFragmentOrigin])
                }
                let size = NSAttributedString(string: path, attributes: [.font: OverlayStyle.font(12)])
                    .boundingRect(with: CGSize(width: inner, height: 1000), options: [.usesLineFragmentOrigin])
                link.frame = CGRect(x: 16, y: y + 8, width: inner, height: ceil(size.height))
                addSubview(link)
                y = link.frame.maxY
            }
            if let error {
                let box = NSTextField(wrappingLabelWithString: error)
                box.isSelectable = true
                box.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
                box.textColor = OverlayStyle.text2
                box.drawsBackground = true
                box.backgroundColor = OverlayStyle.bg
                box.isBordered = false
                box.preferredMaxLayoutWidth = inner - 16
                let fit = box.cell?.cellSize(forBounds: CGRect(x: 0, y: 0, width: inner - 16, height: 1000)) ?? CGSize(width: inner - 16, height: 40)
                let holder = NSView(frame: CGRect(x: 16, y: y + 12, width: inner, height: min(160, ceil(fit.height)) + 12))
                holder.wantsLayer = true
                holder.layer?.backgroundColor = OverlayStyle.bg.cgColor
                holder.layer?.cornerRadius = 6
                box.frame = CGRect(x: 8, y: 6, width: inner - 16, height: holder.frame.height - 12)
                holder.addSubview(box)
                addSubview(holder)
                y = holder.frame.maxY
            }
            let logLabel = ShellText.t("app.error.openLog")
            let logWidth = ceil(OverlayText(logLabel, size: 13, color: .white).fitting.width) + 24
            let log = OverlayButton(id: "error-log", name: logLabel, size: CGSize(width: logWidth, height: 28), action: {
                NSWorkspace.shared.open(URL(fileURLWithPath: AppPaths.logDir, isDirectory: true))
            }) { b, _ in
                OverlayButton.fillBackground(b, b.hovered ? OverlayStyle.hover : OverlayStyle.border)
                OverlayButton.drawLabel(logLabel, size: 13, color: OverlayStyle.text, in: b.bounds)
            }
            log.frame.origin = CGPoint(x: 16 + inner - logWidth, y: y + 12)
            addSubview(log)
            frame = CGRect(x: 0, y: 0, width: inner + 32, height: log.frame.maxY + 16)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used") }

        override var isFlipped: Bool { true }

        /// Shows the picture or folder in Finder; if it is gone already, the notice stays and its words still have the path
        private func reveal() {
            guard let path else { return }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
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

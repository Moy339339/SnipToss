import AppKit

/// The color picker of the capture overlay, opened by the hue disc at the end of the color row: a saturation / brightness field, a hue
/// strip, the color as hex digits, and OK. The Mac counterpart of CaptureOverlay.ColorPicker.cs, laid out like the main window's picker
/// (packages/web/src/ColorPicker.tsx). Return or OK hands the color to `onApply`; Esc calls `onClose` and hands nothing. Either way the
/// panel hides itself first and then calls back, so the callback is where the keyboard goes back to the note box, the text box or the
/// overlay (and where the toolbar is placed again)
///
/// How the overlay uses it:
/// - Added once, hidden, above the toolbar. `open(with:)` shows it on the color in use; the overlay places it (`frame.size` is its size)
///   and then calls `focusDigits()`, which gives the keyboard to the digits with all of them selected, so typing replaces them
/// - Presses inside it go to its own parts (the field and strip pick, the digits take the caret, OK is a button) and never reach the
///   overlay. The overlay still has to keep its pointer handling off the picker: `mouseMoved` and `cursorUpdate` need it among the parts
///   of `partAt` (and `cursor(at:)` for the pointer shape), or the picture and the magnifier underneath follow the pointer
/// - Keys: with the keyboard in the digits, Return and Esc reach `key(_:)` through `editor.onKey` (set here) before anything is typed, and
///   everything else is typed; the overlay's own keys (tools, colors, arrows) never see them. When the keyboard is elsewhere the
///   overlay's `routeKey` calls `key(_:)` itself. ⌘ keys arrive through the overlay's `performKeyEquivalent`: `editor` is the text view
///   to hand the editing keys to (⌘V pastes a color code)
final class OverlayColorPicker: OverlayPanelView, NSTextViewDelegate {
    // Sizes are the Windows overlay's (points here, DIPs there)
    static let fieldWidth: CGFloat = 208
    static let fieldHeight: CGFloat = 128
    static let stripHeight: CGFloat = 12
    static let padding: CGFloat = 12
    /// "#" and six digits; more is cut off (a pasted code often has the #)
    static let maxDigits = 7

    /// OK or Return: the color to use
    var onApply: ((MarkColor) -> Void)?
    /// Esc: closed without using the color
    var onClose: (() -> Void)?

    /// The color picked so far, kept apart from hue / saturation / value so typed digits are not rounded through HSV
    private(set) var color = MarkColor(r: 0, g: 0, b: 0)
    /// Hue 0–360 (the strip reaches 359.9), saturation and value 0–1
    private(set) var h = 0.0
    private(set) var s = 0.0
    private(set) var v = 0.0

    let field = Field()
    let strip = Strip()
    let preview = Swatch()
    let digitsBox = DigitsBox()
    private let thumbs = Thumbs()
    private(set) var applyButton: OverlayButton!
    /// The digits box is being rewritten by code (not typed): its change notification must not feed back
    private var writing = false

    init() {
        super.init()
        let pad = Self.padding
        let width = Self.fieldWidth
        field.frame = CGRect(x: pad, y: pad, width: width, height: Self.fieldHeight)
        strip.frame = CGRect(x: pad, y: field.frame.maxY + 10, width: width, height: Self.stripHeight)
        let rowTop = strip.frame.maxY + 12
        preview.frame = CGRect(x: pad, y: rowTop, width: 28, height: 28)

        let label = ShellText.t("markColor.apply")
        let applyWidth = ceil(OverlayText(label, size: 13, color: .white).fitting.width) + 24
        applyButton = OverlayButton(id: "picker-apply", name: label, size: CGSize(width: applyWidth, height: 28), action: { [weak self] in
            self?.commit()
        }) { b, _ in
            OverlayButton.fillBackground(b, b.hovered ? OverlayStyle.accentFillHover : OverlayStyle.accentFill)
            OverlayButton.drawLabel(label, size: 13, color: .white, in: b.bounds)
        }
        applyButton.frame.origin = CGPoint(x: pad + width - applyWidth, y: rowTop)
        // The digits box takes what is left of the row between the preview and OK, 8 of room on each side
        let digitsLeft = preview.frame.maxX + 8
        digitsBox.frame = CGRect(x: digitsLeft, y: rowTop, width: applyButton.frame.minX - 8 - digitsLeft, height: 28)
        digitsBox.layoutContent()

        for part in [field, strip, preview, digitsBox, applyButton!, thumbs] as [NSView] { addSubview(part) }
        setFrameSize(CGSize(width: pad * 2 + width, height: rowTop + 28 + pad))
        thumbs.frame = bounds

        field.onPick = { [weak self] p in self?.pickInField(at: p) }
        strip.onPick = { [weak self] p in self?.pickInStrip(x: p.x) }
        editor.delegate = self
        // Return and Esc first, as in the note box; the overlay's own keys (tools, colors) are not asked while the digits are typed in
        editor.onKey = { [weak self] event in
            guard let self, let key = OverlayKey.from(keyCode: event.keyCode) else { return false }
            return self.key(key)
        }

        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel(ShellText.t("markColor.custom"))
        setAccessibilityIdentifier("picker")
        let areas = [(field, "picker-field", "markColor.field"), (strip, "picker-hue", "markColor.hue")] as [(NSView, String, String)]
        for (part, id, name) in areas {
            part.setAccessibilityElement(true)
            part.setAccessibilityRole(.group)
            part.setAccessibilityLabel(ShellText.t(name))
            part.setAccessibilityIdentifier(id)
        }
        editor.setAccessibilityRole(.textField)
        editor.setAccessibilityLabel(ShellText.t("markColor.hex"))
        editor.setAccessibilityIdentifier("picker-hex")
        refresh(writeDigits: true)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: Opening and closing

    var isOpen: Bool { !isHidden }

    /// Shows the picker on this color (the one in use): the field, strip and digits follow it, and the digits are all selected
    func open(with start: MarkColor) {
        color = start
        let hsv = ColorMath.hsv(start)
        (h, s, v) = (hsv.h, hsv.s, hsv.v)
        refresh(writeDigits: true)
        isHidden = false
    }

    /// The digits get the keyboard, all selected (call it once the picker is in the overlay's window)
    func focusDigits() {
        guard let window else { return }
        window.makeFirstResponder(editor)
        // Hex digits only: a Chinese or Japanese input method would start composing on a–f. As in a password field, the box takes Roman
        // input sources only, and the system switches back when the keyboard leaves it
        editor.inputContext?.allowedInputSourceLocales = [NSAllRomanInputSourcesLocaleIdentifier]
        editor.setSelectedRange(NSRange(location: 0, length: (editor.string as NSString).length))
    }

    /// The text view of the digits: what ⌘ editing keys (copy, paste, select all, undo) go to while the picker is open
    var editor: OverlayTextView { digitsBox.textView }

    /// The digits as they are in the box now
    var digitsText: String { editor.string }

    /// A key while the picker is open: Return applies, Esc closes; true = handled. Anything else is left to the digits box
    @discardableResult
    func key(_ key: OverlayKey) -> Bool {
        guard !isHidden else { return false }
        switch key {
        case .enter: commit()
        case .escape: cancel()
        default: return false
        }
        return true
    }

    /// Uses the typed digits when they are a color, otherwise the picked color
    private func commit() {
        guard !isHidden else { return }
        let chosen = ColorMath.parse(editor.string) ?? color
        hide()
        onApply?(chosen)
    }

    private func cancel() {
        guard !isHidden else { return }
        hide()
        onClose?()
    }

    /// Hides the panel; the keyboard is not left in a hidden digits box (the callback gives it back to the overlay or an input box)
    private func hide() {
        if let window, let responder = window.firstResponder as? NSView, responder.isDescendant(of: self) {
            window.makeFirstResponder(nil)
        }
        isHidden = true
    }

    // MARK: Picking

    /// Press or drag on the field: `p` is the pointer from the field's top-left corner (outside it while dragging: it is held at the edge)
    func pickInField(at p: CGPoint) {
        s = Self.clamp01(p.x / Self.fieldWidth)
        v = 1 - Self.clamp01(p.y / Self.fieldHeight)
        color = ColorMath.fromHsv(h, s, v)
        refresh(writeDigits: true)
    }

    /// Press or drag on the hue strip: `x` is the pointer from the strip's left edge
    func pickInStrip(x: CGFloat) {
        h = Self.clamp01(x / Self.fieldWidth) * 359.9
        color = ColorMath.fromHsv(h, s, v)
        refresh(writeDigits: true)
    }

    private static func clamp01(_ x: CGFloat) -> Double { Double(min(max(x, 0), 1)) }

    /// Where the field's thumb is, from the field's top-left corner
    var fieldThumbPoint: CGPoint { CGPoint(x: s * Self.fieldWidth, y: (1 - v) * Self.fieldHeight) }

    /// Where the hue strip's thumb is, from the strip's top-left corner
    var hueThumbPoint: CGPoint { CGPoint(x: h / 360 * Self.fieldWidth, y: Self.stripHeight / 2) }

    /// Typing in the digits: when they make a color, that is the color (kept exactly) and the field and strip follow it. Gray and black
    /// have no hue of their own: the strip stays where it was instead of jumping to red. The digits themselves are left as typed
    func textDidChange(_ notification: Notification) {
        guard !writing else { return }
        tidyDigits()
        guard let typed = ColorMath.parse(editor.string) else { return }
        color = typed
        let hsv = ColorMath.hsv(typed)
        if hsv.s > 0 && hsv.v > 0 { h = hsv.h }
        (s, v) = (hsv.s, hsv.v)
        refresh(writeDigits: false)
    }

    /// What the box allows, as the Windows box does (upper case, 7 characters), and no spaces or line breaks (a pasted code often has
    /// them). Left alone while an input method is composing: rewriting the text would drop the composition
    private func tidyDigits() {
        guard !editor.hasMarkedText() else { return }
        let tidy = String(editor.string.filter { !$0.isWhitespace }.uppercased().prefix(Self.maxDigits))
        guard tidy != editor.string else { return }
        let caret = min(editor.selectedRange().location, (tidy as NSString).length)
        writing = true
        editor.string = tidy
        editor.setSelectedRange(NSRange(location: caret, length: 0))
        writing = false
    }

    /// Return and Esc as the text view turns them into commands, when `key(_:)` was not asked first
    func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            commit()
            return true
        }
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            cancel()
            return true
        }
        return false
    }

    /// The picked color changed: move the thumbs, recolor the field and the preview; `writeDigits` = also show its digits (not while they
    /// are being typed)
    private func refresh(writeDigits: Bool) {
        let pureHue = ColorMath.fromHsv(h, 1, 1)
        field.hue = pureHue
        preview.color = color
        let fieldAt = field.frame.origin
        let stripAt = strip.frame.origin
        thumbs.set(
            field: CGPoint(x: fieldAt.x + fieldThumbPoint.x, y: fieldAt.y + fieldThumbPoint.y), fieldColor: color,
            hue: CGPoint(x: stripAt.x + hueThumbPoint.x, y: stripAt.y + hueThumbPoint.y), hueColor: pureHue)
        if writeDigits { showDigits() }
    }

    /// Writes the picked color's six digits in upper case, as typed digits are shown and as the main window's picker shows them, all
    /// selected so typing replaces them
    private func showDigits() {
        writing = true
        if editor.hasMarkedText() {
            editor.inputContext?.discardMarkedText()
            editor.unmarkText()
        }
        editor.string = String(color.hexText.dropFirst()).uppercased()
        editor.undoManager?.removeAllActions()
        editor.setSelectedRange(NSRange(location: 0, length: (editor.string as NSString).length))
        writing = false
    }

    /// The pointer over a point of the panel (in the panel's own coordinates): a cross over the field, a hand over the strip, a text cursor
    /// over the digits, an arrow elsewhere
    func cursor(at point: CGPoint) -> NSCursor {
        if field.frame.contains(point) { return .crosshair }
        if strip.frame.contains(point) { return .pointingHand }
        if digitsBox.frame.contains(point) { return .iBeam }
        return .arrow
    }

    // MARK: For the tests

    /// Types into the digits as the keyboard does (replacing what is selected, then the same change notification): all the digits are
    /// replaced by `text`
    func typeDigits(_ text: String) {
        editor.setSelectedRange(NSRange(location: 0, length: (editor.string as NSString).length))
        editor.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
    }

    // MARK: Parts

    /// An area that picks by position: a press and every drag step report the pointer from its top-left corner, outside it too (AppKit
    /// keeps sending the drag to the view that took the press until the button comes up)
    class Area: NSView {
        var onPick: ((CGPoint) -> Void)?

        override var isFlipped: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func mouseDown(with event: NSEvent) {
            onPick?(convert(event.locationInWindow, from: nil))
        }

        override func mouseDragged(with event: NSEvent) {
            onPick?(convert(event.locationInWindow, from: nil))
        }

        override func mouseUp(with event: NSEvent) {}
        override func rightMouseDown(with event: NSEvent) {}
        override func rightMouseUp(with event: NSEvent) {}
    }

    /// The saturation / value field: the hue, white from the left, black from the bottom, clipped to rounded corners. The three layers are
    /// blended in a bitmap in sRGB (kept until the hue or the screen's scale changes) and that picture is what is drawn: blended straight
    /// into the window they would mix in the screen's own color space, and a spot would not show the color a press on it picks
    final class Field: Area {
        var hue = MarkColor(r: 255, g: 0, b: 0) {
            didSet { if hue != oldValue { needsDisplay = true } }
        }

        private var cached: (hue: MarkColor, scale: CGFloat, image: CGImage)?

        private static let space = CGColorSpace(name: CGColorSpace.sRGB)!

        /// A ramp from `from` to `to` (components in sRGB, alpha last)
        private static func ramp(_ from: [CGFloat], _ to: [CGFloat]) -> CGGradient {
            let colors = [CGColor(colorSpace: space, components: from)!, CGColor(colorSpace: space, components: to)!]
            return CGGradient(colorsSpace: space, colors: colors as CFArray, locations: [0, 1])!
        }

        /// White at the left edge, clear at the right
        private static let whiteRamp = ramp([1, 1, 1, 1], [1, 1, 1, 0])
        /// Clear at the top, black at the bottom
        private static let blackRamp = ramp([0, 0, 0, 0], [0, 0, 0, 1])

        /// The field as pixels (`scale` per point), top row first
        private func picture(scale: CGFloat) -> CGImage? {
            if let cached, cached.hue == hue, cached.scale == scale { return cached.image }
            let size = bounds.size
            let (width, height) = (Int((size.width * scale).rounded()), Int((size.height * scale).rounded()))
            guard
                let context = CGContext(
                    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: Self.space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return nil }
            // Points, y pointing down
            context.translateBy(x: 0, y: size.height * scale)
            context.scaleBy(x: scale, y: -scale)
            context.setFillColor(hue.nsColor.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.drawLinearGradient(Self.whiteRamp, start: .zero, end: CGPoint(x: size.width, y: 0), options: [])
            context.drawLinearGradient(Self.blackRamp, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            guard let image = context.makeImage() else { return nil }
            cached = (hue, scale, image)
            return image
        }

        override func draw(_ dirtyRect: NSRect) {
            guard let context = NSGraphicsContext.current?.cgContext else { return }
            // The context's scale is the screen's (2 on a sharp screen); the picture has one pixel per device pixel
            guard let picture = picture(scale: max(1, abs(context.ctm.a).rounded())) else { return }
            context.saveGState()
            context.addPath(CGPath(roundedRect: bounds, cornerWidth: 6, cornerHeight: 6, transform: nil))
            context.clip()
            // CoreGraphics draws pictures with the y axis up; this view's points
            context.translateBy(x: 0, y: bounds.minY + bounds.maxY)
            context.scaleBy(x: 1, y: -1)
            context.interpolationQuality = .none
            context.draw(picture, in: bounds)
            context.restoreGState()
        }
    }

    /// The hue strip: the seven hues 60 degrees apart, from red back to red, with rounded ends
    final class Strip: Area {
        private static let ramp = CGGradient(
            colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
            colors: (0...6).map { ColorMath.fromHsv(Double($0 * 60), 1, 1).nsColor.cgColor } as CFArray,
            locations: (0...6).map { CGFloat($0) / 6 })!

        override func draw(_ dirtyRect: NSRect) {
            guard let context = NSGraphicsContext.current?.cgContext else { return }
            context.saveGState()
            context.addPath(CGPath(roundedRect: bounds, cornerWidth: bounds.height / 2, cornerHeight: bounds.height / 2, transform: nil))
            context.clip()
            context.drawLinearGradient(Self.ramp, start: CGPoint(x: bounds.minX, y: 0), end: CGPoint(x: bounds.maxX, y: 0), options: [])
            context.restoreGState()
        }
    }

    /// The color as a 28 × 28 square with a thin light border
    final class Swatch: NSView {
        var color = MarkColor(r: 0, g: 0, b: 0) {
            didSet { if color != oldValue { needsDisplay = true } }
        }

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func draw(_ dirtyRect: NSRect) {
            color.nsColor.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 6, yRadius: 6).fill()
            NSColor.white.withAlphaComponent(0x26 / 255).setStroke()
            let edge = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 5.5, yRadius: 5.5)
            edge.lineWidth = 1
            edge.stroke()
        }
    }

    /// The box around the digits: a "#" in the muted color, then the text view of the six digits in a monospaced face. A press anywhere in
    /// the box (not only on the digits) gives the keyboard to them
    final class DigitsBox: NSView {
        static let font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)

        let hashSign = OverlayText("#", size: 13, color: OverlayStyle.muted)
        let textView = OverlayTextView(usingTextLayoutManager: false)

        init() {
            super.init(frame: .zero)
            textView.makePlain(font: Self.font, color: OverlayStyle.text)
            textView.insertionPointColor = OverlayStyle.text
            // One line that never wraps or scrolls: at most 7 characters fit the box in every language
            textView.textContainerInset = .zero
            textView.textContainer?.lineFragmentPadding = 0
            textView.textContainer?.widthTracksTextView = false
            textView.textContainer?.heightTracksTextView = false
            textView.textContainer?.containerSize = NSSize(width: 100_000, height: 100_000)
            textView.textContainer?.lineBreakMode = .byClipping
            textView.isHorizontallyResizable = false
            textView.isVerticallyResizable = false
            textView.focusRingType = .none
            addSubview(hashSign)
            addSubview(textView)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used") }

        override var isFlipped: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        /// Places the "#" and the digits for the box's size: 8 of room inside the 1-point border, 4 between the two
        func layoutContent() {
            hashSign.fit(at: .zero)
            hashSign.frame.origin = CGPoint(x: 1 + 8, y: ((bounds.height - hashSign.frame.height) / 2).rounded())
            let lineHeight = ceil(NSLayoutManager().defaultLineHeight(for: Self.font))
            let left = hashSign.frame.maxX + 4
            textView.frame = CGRect(
                x: left, y: ((bounds.height - lineHeight) / 2).rounded(), width: max(0, bounds.width - 1 - 8 - left), height: lineHeight)
            textView.minSize = textView.frame.size
            textView.maxSize = textView.frame.size
        }

        override func mouseDown(with event: NSEvent) {
            window?.makeFirstResponder(textView)
        }

        override func rightMouseDown(with event: NSEvent) {}
        override func rightMouseUp(with event: NSEvent) {}

        override func draw(_ dirtyRect: NSRect) {
            let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 5.5, yRadius: 5.5)
            OverlayStyle.bg.setFill()
            shape.fill()
            OverlayStyle.borderStrong.setStroke()
            shape.lineWidth = 1
            shape.stroke()
        }
    }

    /// The two thumbs, over the whole panel and above the field and strip (so the field's rounded corners do not clip them): 16-point
    /// circles with a white 2-point ring and a faint dark outer edge, filled with the color under them. Never takes a click
    final class Thumbs: NSView {
        private var fieldAt = CGPoint.zero
        private var fieldColor = MarkColor(r: 0, g: 0, b: 0)
        private var hueAt = CGPoint.zero
        private var hueColor = MarkColor(r: 255, g: 0, b: 0)

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        func set(field: CGPoint, fieldColor: MarkColor, hue: CGPoint, hueColor: MarkColor) {
            fieldAt = field
            self.fieldColor = fieldColor
            hueAt = hue
            self.hueColor = hueColor
            needsDisplay = true
        }

        override func draw(_ dirtyRect: NSRect) {
            drawThumb(at: fieldAt, color: fieldColor)
            drawThumb(at: hueAt, color: hueColor)
        }

        private func drawThumb(at c: CGPoint, color: MarkColor) {
            // The fill and the white ring on the 12-point circle (the ring covers 5 to 7 from the middle), the dark edge outside (7 to 8)
            let ring = NSBezierPath(ovalIn: CGRect(x: c.x - 6, y: c.y - 6, width: 12, height: 12))
            color.nsColor.setFill()
            ring.fill()
            NSColor.white.setStroke()
            ring.lineWidth = 2
            ring.stroke()
            let edge = NSBezierPath(ovalIn: CGRect(x: c.x - 7.5, y: c.y - 7.5, width: 15, height: 15))
            NSColor.black.withAlphaComponent(0x66 / 255).setStroke()
            edge.lineWidth = 1
            edge.stroke()
        }
    }
}

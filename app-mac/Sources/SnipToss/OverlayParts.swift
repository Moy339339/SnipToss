import AppKit

// The pieces laid over the capture overlay: the floating panels, their buttons and text, the magnifier, and the two input boxes. Sizes are
// the Windows overlay's (points here, DIPs there). Everything draws in `draw(_:)` rather than through layer properties, so a picture of the
// overlay (`cacheDisplay`) shows them as they are on screen

/// A floating panel: the overlay's surface color, a 1-point border, rounded corners and a soft shadow below. Clicks on it stay on it
/// (they never reach the canvas underneath); a panel that is only something to look at (`passThrough`) lets them through
class OverlayPanelView: NSView {
    var passThrough = false
    var radius: CGFloat
    var fill: NSColor
    var stroke: NSColor?

    init(radius: CGFloat = 10, fill: NSColor = OverlayStyle.surface2, stroke: NSColor? = OverlayStyle.borderStrong, shadow: Bool = true) {
        self.radius = radius
        self.fill = fill
        self.stroke = stroke
        super.init(frame: .zero)
        wantsLayer = true
        if shadow {
            let s = NSShadow()
            s.shadowBlurRadius = 24
            // In the unflipped base coordinates: negative is down
            s.shadowOffset = NSSize(width: 0, height: -8)
            s.shadowColor = NSColor.black.withAlphaComponent(0.45)
            self.shadow = s
        }
        isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { passThrough ? nil : super.hitTest(point) }
    override func mouseDown(with event: NSEvent) {}
    override func mouseUp(with event: NSEvent) {}
    override func mouseDragged(with event: NSEvent) {}
    override func rightMouseDown(with event: NSEvent) {}
    override func rightMouseUp(with event: NSEvent) {}

    override func draw(_ dirtyRect: NSRect) {
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: radius, yRadius: radius)
        fill.setFill()
        shape.fill()
        if let stroke {
            stroke.setStroke()
            shape.lineWidth = 1
            shape.stroke()
        }
    }
}

/// Words drawn in one style; with `width` set they wrap at it. Never takes a click
final class OverlayText: NSView {
    var text: String {
        didSet { if text != oldValue { needsDisplay = true } }
    }
    var font: NSFont
    var color: NSColor {
        didSet { needsDisplay = true }
    }
    /// A fixed line height (nil = the font's own)
    var lineHeight: CGFloat?
    /// Wrap at this width (nil = one line)
    var width: CGFloat?
    var alignment = NSTextAlignment.natural

    init(_ text: String = "", size: CGFloat, color: NSColor, weight: NSFont.Weight = .regular) {
        self.text = text
        font = OverlayStyle.font(size, weight: weight)
        self.color = color
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    private var attributed: NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = width == nil ? .byClipping : .byWordWrapping
        // Korean wraps between words, as the main app does (word-break: keep-all)
        paragraph.lineBreakStrategy = .standard
        paragraph.alignment = alignment
        if let lineHeight {
            paragraph.minimumLineHeight = lineHeight
            paragraph.maximumLineHeight = lineHeight
        }
        return NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
    }

    /// The size the text needs (at `width` when it wraps)
    var fitting: CGSize {
        let r = attributed.boundingRect(
            with: CGSize(width: width ?? 100_000, height: 100_000), options: [.usesLineFragmentOrigin, .usesFontLeading])
        return CGSize(width: ceil(width ?? r.width), height: ceil(r.height))
    }

    /// Takes the size it needs, at `origin`
    func fit(at origin: CGPoint) {
        frame = CGRect(origin: origin, size: fitting)
    }

    override func draw(_ dirtyRect: NSRect) {
        attributed.draw(with: bounds, options: [.usesLineFragmentOrigin, .usesFontLeading])
    }
}

/// A button the overlay draws itself: what it looks like comes from `paint`, which sees whether the pointer is over it. Clicked on release
/// inside it, as everywhere on the Mac; a press never reaches the canvas. Screen readers read its name, and the smoke run finds it by its id
final class OverlayButton: NSView {
    let id: String
    let name: String
    var tip: String?
    var action: () -> Void
    var paint: (OverlayButton, CGContext) -> Void
    /// A disabled button (Save with nothing written) ignores clicks
    var enabled: () -> Bool = { true }
    /// The pointer came onto it or left it (tooltips, and buttons whose neighbors change with it)
    var onHover: ((OverlayButton, Bool) -> Void)?
    private(set) var hovered = false
    private var pressed = false
    private var tracking: NSTrackingArea?

    init(id: String, name: String, tip: String? = nil, size: CGSize, action: @escaping () -> Void, paint: @escaping (OverlayButton, CGContext) -> Void) {
        self.id = id
        self.name = name
        self.tip = tip
        self.action = action
        self.paint = paint
        super.init(frame: CGRect(origin: .zero, size: size))
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel(name)
        setAccessibilityIdentifier(id)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) {
        hovered = true
        needsDisplay = true
        onHover?(self, true)
    }

    override func mouseExited(with event: NSEvent) {
        hovered = false
        needsDisplay = true
        onHover?(self, false)
    }

    override func mouseDown(with event: NSEvent) {
        pressed = true
    }

    override func mouseUp(with event: NSEvent) {
        let inside = bounds.contains(convert(event.locationInWindow, from: nil))
        let wasPressed = pressed
        pressed = false
        if wasPressed && inside { click() }
    }

    override func rightMouseDown(with event: NSEvent) {}
    override func rightMouseUp(with event: NSEvent) {}

    /// What a click does (the smoke run and screen readers press it the same way)
    func click() {
        onHover?(self, false)
        if enabled() { action() }
    }

    override func accessibilityPerformPress() -> Bool {
        click()
        return true
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        paint(self, context)
    }

    /// The rounded background of a button
    static func fillBackground(_ b: OverlayButton, _ color: NSColor?, radius: CGFloat = 6) {
        guard let color else { return }
        color.setFill()
        NSBezierPath(roundedRect: b.bounds, xRadius: radius, yRadius: radius).fill()
    }

    /// Text centered in the button
    static func drawLabel(_ text: String, size: CGFloat, color: NSColor, in rect: CGRect) {
        let label = NSAttributedString(string: text, attributes: [.font: OverlayStyle.font(size), .foregroundColor: color])
        let s = label.size()
        label.draw(at: CGPoint(x: rect.midX - s.width / 2, y: rect.midY - s.height / 2))
    }
}

/// A thin vertical line between groups of buttons (1 × 16, 4 of room each side)
final class OverlaySeparator: NSView {
    init() { super.init(frame: CGRect(x: 0, y: 0, width: 9, height: 16)) }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        OverlayStyle.borderStrong.setFill()
        CGRect(x: 4, y: 0, width: 1, height: bounds.height).fill()
    }
}

/// A row of buttons and separators in a panel, vertically centered, with `padding` all around
final class OverlayRow: OverlayPanelView {
    private(set) var items: [NSView] = []
    let padding: CGFloat

    init(padding: CGFloat = 4) {
        self.padding = padding
        super.init()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    /// Puts these in a row (left to right, `gaps[i]` of room before item i) and takes the size they need
    func set(_ views: [NSView], gaps: [CGFloat] = []) {
        items.forEach { $0.removeFromSuperview() }
        items = views
        let height = views.map { $0.frame.height }.max() ?? 0
        var x = padding
        for (i, v) in views.enumerated() {
            x += i < gaps.count ? gaps[i] : 0
            v.frame.origin = CGPoint(x: x, y: padding + (height - v.frame.height) / 2)
            addSubview(v)
            x += v.frame.width
        }
        setFrameSize(CGSize(width: x + padding, height: height + padding * 2))
        needsDisplay = true
    }

    func repaint() {
        for v in items { v.needsDisplay = true }
    }
}

/// The selection's size in pixels, above its top-left corner
final class OverlaySizeLabel: OverlayPanelView {
    let label = OverlayText(size: 12, color: OverlayStyle.text)

    init() {
        super.init(radius: 4, fill: NSColor(srgbRed: 0x18 / 255, green: 0x18 / 255, blue: 0x1b / 255, alpha: 0xe0 / 255), stroke: nil, shadow: false)
        passThrough = true
        addSubview(label)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ text: String) {
        label.text = text
        label.fit(at: CGPoint(x: 6, y: 2))
        setFrameSize(CGSize(width: label.frame.width + 12, height: label.frame.height + 4))
        isHidden = false
    }
}

/// One line of words in a bordered panel: the warning before cancelling (red border), and tooltips
final class OverlayBanner: OverlayPanelView {
    let label: OverlayText
    private let padX: CGFloat
    private let padY: CGFloat

    init(size: CGFloat, stroke: NSColor, radius: CGFloat, padX: CGFloat, padY: CGFloat, shadow: Bool) {
        label = OverlayText(size: size, color: OverlayStyle.text)
        self.padX = padX
        self.padY = padY
        super.init(radius: radius, stroke: stroke, shadow: shadow)
        passThrough = true
        addSubview(label)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ text: String) {
        label.text = text
        label.fit(at: CGPoint(x: padX, y: padY))
        setFrameSize(CGSize(width: label.frame.width + padX * 2, height: label.frame.height + padY * 2))
        isHidden = false
    }
}

/// The magnifier next to the pointer: 15 × 11 pixels around it at 8 times, a crosshair on the middle pixel, the position (or while
/// dragging, the selection's size) and the color of that pixel; for a newcomer, how to select below it
final class OverlayMagnifier: OverlayPanelView {
    /// How many pixels the magnifier shows across and down
    static let cellsAcross = 15
    static let cellsDown = 11
    static let cell: CGFloat = 8

    private let zoom = ZoomView()
    private let position = OverlayText(size: 12, color: OverlayStyle.text2)
    private let swatch = SwatchView()
    private let colorText = OverlayText(size: 12, color: OverlayStyle.text2)
    let hint: OverlayText?

    /// `hint`: the lines saying how to select, or nil when they are not shown any more
    init(hint: String?) {
        if let hint {
            let text = OverlayText(hint, size: 12, color: OverlayStyle.text2)
            // As wide as the magnified picture: long languages wrap instead of widening the magnifier
            text.width = 120
            text.lineHeight = 16
            self.hint = text
        } else {
            self.hint = nil
        }
        super.init()
        passThrough = true
        zoom.frame = CGRect(x: 6, y: 6, width: 120, height: 88)
        addSubview(zoom)
        addSubview(position)
        addSubview(swatch)
        addSubview(colorText)
        if let hint = self.hint { addSubview(hint) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    /// What it shows now. `pixels` = the picture's pixels around the pointer (nil when none is on the screen), placed `offset` cells from the
    /// top-left of the magnified area (next to a screen edge part of the area is off the screen and stays empty)
    func show(pixels: CGImage?, offset: CGPoint, color: NSColor, colorText hex: String, position text: String, showHint: Bool) {
        zoom.pixels = pixels
        zoom.offset = offset
        zoom.needsDisplay = true
        position.text = text
        position.fit(at: CGPoint(x: 6, y: zoom.frame.maxY + 6))
        swatch.color = color
        colorText.text = hex
        let rowTop = position.frame.maxY + 2
        let textSize = colorText.fitting
        swatch.frame = CGRect(x: 6, y: rowTop + (textSize.height - 10) / 2, width: 10, height: 10)
        colorText.frame = CGRect(origin: CGPoint(x: 6 + 16, y: rowTop), size: textSize)
        var bottom = colorText.frame.maxY
        if let hint {
            hint.isHidden = !showHint
            if showHint {
                hint.fit(at: CGPoint(x: 6, y: bottom + 6))
                bottom = hint.frame.maxY
            }
        }
        setFrameSize(CGSize(width: 132, height: bottom + 6))
        isHidden = false
    }

    /// The magnified pixels and the crosshair
    final class ZoomView: NSView {
        var pixels: CGImage?
        var offset = CGPoint.zero

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func draw(_ dirtyRect: NSRect) {
            guard let context = NSGraphicsContext.current?.cgContext else { return }
            context.saveGState()
            context.addPath(CGPath(roundedRect: bounds, cornerWidth: 4, cornerHeight: 4, transform: nil))
            context.clip()
            if let pixels {
                let cell = OverlayMagnifier.cell
                let rect = CGRect(x: offset.x * cell, y: offset.y * cell, width: CGFloat(pixels.width) * cell, height: CGFloat(pixels.height) * cell)
                MarkPainter.drawPicture(pixels, in: rect, context: context)
            }
            // The crosshair: a band across and a band down through the middle pixel, and a white square around it
            let band = OverlayStyle.accent.withAlphaComponent(0x40 / 255)
            context.setFillColor(band.cgColor)
            context.fill(CGRect(x: 0, y: 40, width: 120, height: 8))
            context.fill(CGRect(x: 56, y: 0, width: 8, height: 88))
            context.restoreGState()
            context.setStrokeColor(NSColor.white.cgColor)
            context.setLineWidth(1)
            context.stroke(CGRect(x: 56.5, y: 40.5, width: 7, height: 7))
        }
    }

    final class SwatchView: NSView {
        var color = NSColor.clear {
            didSet { needsDisplay = true }
        }

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func draw(_ dirtyRect: NSRect) {
            color.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2).fill()
        }
    }
}

/// The text views of the two input boxes. The overlay sees each key first (`onKey`; true = it took it) unless an input method is in the
/// middle of composing: then Return picks the candidate and Esc drops the composition, as in any text field. Tab does nothing (it would
/// type a tab character into a note)
final class OverlayTextView: NSTextView {
    var onKey: ((NSEvent) -> Bool)?

    override func keyDown(with event: NSEvent) {
        if !hasMarkedText(), let onKey, onKey(event) { return }
        super.keyDown(with: event)
    }

    /// The key as the text view itself takes it (typing, moving the caret, deleting), without asking the overlay first
    func typeKey(_ event: NSEvent) {
        super.keyDown(with: event)
    }

    override func insertTab(_ sender: Any?) {}
    override func insertBacktab(_ sender: Any?) {}

    /// Plain text only, without the substitutions a document editor makes (smart quotes, dashes, links, spelling marks)
    func makePlain(font: NSFont, color: NSColor) {
        isRichText = false
        importsGraphics = false
        allowsUndo = true
        drawsBackground = false
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticTextReplacementEnabled = false
        isAutomaticSpellingCorrectionEnabled = false
        isAutomaticLinkDetectionEnabled = false
        isContinuousSpellCheckingEnabled = false
        isGrammarCheckingEnabled = false
        smartInsertDeleteEnabled = false
        self.font = font
        textColor = color
        typingAttributes = [.font: font, .foregroundColor: color]
        selectedTextAttributes = [.backgroundColor: OverlayStyle.accent, .foregroundColor: NSColor.white]
    }
}

/// The small note box (the words for the AI), looking like the main app's composer: title, category (Change / Remove / Add / Question,
/// ⌥1–4), the input box, and Cancel and Save below. The button says Save, not Finish: the toolbar already has a Finish (the whole capture)
final class OverlayNoteBox: OverlayPanelView, NSTextViewDelegate {
    /// Inside width: the box is 360 wide, the same as the main window's composer; the four categories in Italian, German, Russian and
    /// Portuguese need a bit over 320
    static let inner: CGFloat = 336

    let title = OverlayText(size: 12, color: OverlayStyle.muted)
    private let segGroup = SegmentGroup()
    private var segs: [(button: OverlayButton, key: String)] = []
    let field = FieldView()
    let scroll = NSScrollView()
    // TextKit 1 from the start: the box is laid out with its layout manager (asking a TextKit 2 view for one switches it over midway)
    let textView = OverlayTextView(usingTextLayoutManager: false)
    let placeholder = OverlayText(size: 13, color: OverlayStyle.muted)
    private let hint = OverlayText(size: 12, color: OverlayStyle.muted)
    private(set) var cancel: OverlayButton!
    private(set) var save: OverlayButton!

    /// The category shown as chosen
    var category = "change"
    /// The text changed (the overlay places the box again: a line break makes it taller)
    var onChange: (() -> Void)?

    init(chooseCategory: @escaping (String) -> Void, cancel cancelAction: @escaping () -> Void, save saveAction: @escaping () -> Void) {
        super.init(radius: 12)
        addSubview(title)

        for (i, key) in Categories.keys.enumerated() {
            let label = Categories.label(key)
            let tip = ShellText.t("composer.categoryTitle", values: ["name": label, "n": i + 1])
            let width = 8 + 6 + 6 + OverlayText(label, size: 12, color: OverlayStyle.text2).fitting.width + 12
            let button = OverlayButton(id: "category-\(key)", name: label, tip: tip, size: CGSize(width: width, height: 28), action: {
                chooseCategory(key)
            }) { [weak self] b, context in self?.paintSegment(b, key: key, label: label, context: context) }
            segs.append((button, key))
            segGroup.addSubview(button)
        }
        addSubview(segGroup)

        field.addSubview(scroll)
        addSubview(field)
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        textView.makePlain(font: OverlayStyle.font(13), color: OverlayStyle.text)
        textView.insertionPointColor = OverlayStyle.text
        // The text starts 7 in from the field's border and 9 from its left edge, where the placeholder is
        textView.textContainerInset = NSSize(width: 6, height: 6)
        textView.textContainer?.lineFragmentPadding = 2
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.delegate = self
        scroll.documentView = textView
        placeholder.width = OverlayNoteBox.inner - 18
        field.addSubview(placeholder)

        hint.text = KeepWords.of(ShellText.t("composer.keys"))
        // Wraps to two lines when it does not fit: cut short, the second half of the sentence was lost in some languages
        hint.width = 100
        addSubview(hint)
        let cancelLabel = ShellText.t("capture.note.cancel")
        let saveLabel = ShellText.t("capture.note.save")
        cancel = OverlayButton(
            id: "note-cancel", name: cancelLabel, tip: ShellText.t("capture.note.cancelTip"), size: Self.footSize(cancelLabel), action: cancelAction
        ) { b, _ in
            OverlayButton.fillBackground(b, b.hovered ? OverlayStyle.hover : nil)
            OverlayButton.drawLabel(cancelLabel, size: 13, color: b.hovered ? OverlayStyle.text : OverlayStyle.text2, in: b.bounds)
        }
        save = OverlayButton(id: "note-save", name: saveLabel, size: Self.footSize(saveLabel), action: saveAction) { [weak self] b, context in
            let empty = self?.isEmpty ?? true
            context.saveGState()
            if empty { context.setAlpha(0.4) }
            OverlayButton.fillBackground(b, !empty && b.hovered ? OverlayStyle.accentFillHover : OverlayStyle.accentFill)
            OverlayButton.drawLabel(saveLabel, size: 13, color: .white, in: b.bounds)
            context.restoreGState()
        }
        save.enabled = { [weak self] in !(self?.isEmpty ?? true) }
        addSubview(cancel)
        addSubview(save)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    private static func footSize(_ label: String) -> CGSize {
        CGSize(width: ceil(OverlayText(label, size: 13, color: .white).fitting.width) + 24, height: 28)
    }

    /// Nothing written yet (white space does not count)
    var isEmpty: Bool { textView.string.trimmedBothEnds.isEmpty }

    /// The buttons that show a tooltip
    var tipButtons: [OverlayButton] { segs.map { $0.button } + [cancel] }

    /// Normally gray text and a dot in the category's color; the chosen one is filled and outlined in its color (as in the main app)
    private func paintSegment(_ b: OverlayButton, key: String, label: String, context: CGContext) {
        let c = Categories.color(key).nsColor
        let on = key == category
        if on {
            let shape = NSBezierPath(roundedRect: b.bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6)
            OverlayStyle.mix(c, OverlayStyle.surface2, 0.18).setFill()
            shape.fill()
            c.withAlphaComponent(0x66 / 255).setStroke()
            shape.lineWidth = 1
            shape.stroke()
        }
        c.setFill()
        NSBezierPath(ovalIn: CGRect(x: 8, y: b.bounds.midY - 3, width: 6, height: 6)).fill()
        let text = NSAttributedString(
            string: label, attributes: [.font: OverlayStyle.font(12), .foregroundColor: on ? c : b.hovered ? OverlayStyle.text : OverlayStyle.text2])
        let s = text.size()
        text.draw(at: CGPoint(x: 8 + 6 + 6, y: b.bounds.midY - s.height / 2))
    }

    /// The category's look, the hover of the buttons, and Save grayed out while nothing is written
    func paint() {
        for s in segs { s.button.needsDisplay = true }
        save.needsDisplay = true
        cancel.needsDisplay = true
        placeholder.isHidden = !textView.string.isEmpty
    }

    /// Opens with this title, placeholder and text
    func open(title heading: String, placeholder hintText: String, text: String) {
        title.text = heading
        placeholder.text = hintText
        textView.string = text
        textView.undoManager?.removeAllActions()
        isHidden = false
        layoutBox()
        paint()
    }

    /// Lays the box out for its text and takes the size it needs
    func layoutBox() {
        let inner = OverlayNoteBox.inner
        title.width = inner
        title.fit(at: CGPoint(x: 12, y: 12))
        var x: CGFloat = 2
        for (i, s) in segs.enumerated() {
            x += i == 0 ? 0 : 2
            s.button.frame.origin = CGPoint(x: x, y: 2)
            x += s.button.frame.width
        }
        segGroup.frame = CGRect(x: 12, y: title.frame.maxY + 8, width: x + 2, height: 32)

        // The field grows with the text from 64 to 180, then scrolls
        let fieldTop = segGroup.frame.maxY + 8
        textView.frame.size.width = inner - 2
        if let manager = textView.layoutManager, let container = textView.textContainer {
            manager.ensureLayout(for: container)
        }
        let used = textView.layoutManager.flatMap { m in textView.textContainer.map { m.usedRect(for: $0).height } } ?? 0
        let fieldHeight = min(max(ceil(used) + 12 + 2, 64), 180)
        field.frame = CGRect(x: 12, y: fieldTop, width: inner, height: fieldHeight)
        scroll.frame = field.bounds.insetBy(dx: 1, dy: 1)
        // At least as tall as the field, so a click below the last line still lands in the text
        textView.minSize = NSSize(width: 0, height: scroll.contentSize.height)
        textView.maxSize = NSSize(width: 100_000, height: 100_000)
        placeholder.fit(at: CGPoint(x: 9, y: 7))

        let footTop = field.frame.maxY + 12
        let saveX = 12 + inner - save.frame.width
        let cancelX = saveX - 8 - cancel.frame.width
        hint.width = max(40, cancelX - 12 - 8)
        hint.fit(at: CGPoint(x: 12, y: footTop))
        let footHeight = max(28, hint.frame.height)
        hint.frame.origin.y = footTop + (footHeight - hint.frame.height) / 2
        cancel.frame.origin = CGPoint(x: cancelX, y: footTop + (footHeight - 28) / 2)
        save.frame.origin = CGPoint(x: saveX, y: footTop + (footHeight - 28) / 2)
        setFrameSize(CGSize(width: inner + 24, height: footTop + footHeight + 12))
        needsDisplay = true
    }

    func textDidChange(_ notification: Notification) {
        paint()
        onChange?()
    }

    /// The category group: a dark rounded tray around the four
    final class SegmentGroup: NSView {
        override var isFlipped: Bool { true }

        override func draw(_ dirtyRect: NSRect) {
            let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 8, yRadius: 8)
            OverlayStyle.bg.setFill()
            shape.fill()
            OverlayStyle.border.setStroke()
            shape.lineWidth = 1
            shape.stroke()
        }
    }

    /// The input field's frame: dark inside, a 1-point border
    final class FieldView: NSView {
        override var isFlipped: Bool { true }

        override func draw(_ dirtyRect: NSRect) {
            OverlayStyle.bg.setFill()
            bounds.fill()
            OverlayStyle.borderStrong.setStroke()
            let edge = NSBezierPath(rect: bounds.insetBy(dx: 0.5, dy: 0.5))
            edge.lineWidth = 1
            edge.stroke()
        }
    }
}

/// The Text tool's box: typed straight onto the picture in the mark's color and size, with a thin light border. It grows with the text;
/// the text's first character sits 5 right and 3 down from the box's corner (a 1-point border, 4 and 2 of room)
final class OverlayTextBox: NSView, NSTextViewDelegate {
    let textView = OverlayTextView(usingTextLayoutManager: false)
    static let inset = CGSize(width: 5, height: 3)

    init() {
        super.init(frame: .zero)
        isHidden = true
        textView.makePlain(font: OverlayStyle.font(18), color: .white)
        textView.insertionPointColor = .white
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.isHorizontallyResizable = true
        textView.isVerticallyResizable = true
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.heightTracksTextView = false
        textView.textContainer?.containerSize = NSSize(width: 100_000, height: 100_000)
        textView.maxSize = NSSize(width: 100_000, height: 100_000)
        textView.delegate = self
        addSubview(textView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override var isFlipped: Bool { true }

    /// Opens empty at `at` (where the first character goes)
    func open(at: CGPoint, size: CGFloat, color: NSColor) {
        textView.string = ""
        textView.undoManager?.removeAllActions()
        restyle(size: size, color: color)
        frame.origin = CGPoint(x: at.x - OverlayTextBox.inset.width, y: at.y - OverlayTextBox.inset.height)
        isHidden = false
    }

    func restyle(size: CGFloat, color: NSColor) {
        let font = OverlayStyle.font(size)
        textView.font = font
        textView.textColor = color
        textView.typingAttributes = [.font: font, .foregroundColor: color]
        if let storage = textView.textStorage {
            storage.addAttributes([.font: font, .foregroundColor: color], range: NSRange(location: 0, length: storage.length))
        }
        fitText()
    }

    /// The box takes the size of its text (at least 40 wide and one line high)
    func fitText() {
        guard let manager = textView.layoutManager, let container = textView.textContainer else { return }
        manager.ensureLayout(for: container)
        let used = manager.usedRect(for: container)
        let font = textView.font ?? OverlayStyle.font(18)
        let lineHeight = manager.defaultLineHeight(for: font)
        // Room for the caret after the last character
        let size = CGSize(width: max(40, ceil(used.width) + 2), height: max(ceil(lineHeight), ceil(used.height)))
        textView.frame = CGRect(origin: CGPoint(x: OverlayTextBox.inset.width, y: OverlayTextBox.inset.height), size: size)
        setFrameSize(CGSize(width: size.width + OverlayTextBox.inset.width * 2, height: size.height + OverlayTextBox.inset.height * 2))
        needsDisplay = true
    }

    func textDidChange(_ notification: Notification) {
        fitText()
    }

    /// Where the first character's top-left corner is, in the coordinates of `view`
    func firstCharacter(in view: NSView) -> CGPoint {
        convert(CGPoint(x: OverlayTextBox.inset.width, y: OverlayTextBox.inset.height), to: view)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 1, alpha: 0xb0 / 255).setStroke()
        let edge = NSBezierPath(rect: bounds.insetBy(dx: 0.5, dy: 0.5))
        edge.lineWidth = 1
        edge.stroke()
    }
}

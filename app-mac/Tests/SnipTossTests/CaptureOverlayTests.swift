import AppKit
import XCTest

@testable import SnipToss

/// The capture overlay's view without a window: driven through its state machine and its keys, it must show the right parts in the right
/// places (toolbar, sub-toolbar, note box, text box, warning) and draw the marks over the picture. The windows themselves, the real
/// mouse and the keyboard's way to the layer are in the capture smoke run (mac.yml)
final class CaptureOverlayTests: SnipTestCase {
    private let screen = CGRect(x: 0, y: 0, width: 800, height: 600)
    private var session: CaptureSession!

    override func setUp() {
        super.setUp()
        // The last color and thickness are shared by all captures while the app runs: start each test from the defaults
        ToolPrefs.shared.color = ToolPrefs.colors[0]
        ToolPrefs.shared.sizeIndex = [.text: 1, .mosaic: 1]
        session = CaptureSession(source: PatternScreenSource(screens: []))
    }

    override func tearDown() {
        session = nil
        super.tearDown()
    }

    private func overlay(windows: [CGRect] = [], hint: Bool = false) -> CaptureOverlay {
        let shot = FrozenScreen(
            displayID: 0, frame: screen, scale: 1, image: PatternScreenSource.image(width: Int(screen.width), height: Int(screen.height)))
        return CaptureOverlay(
            session: session, shot: shot, windows: windows, defaultColor: ToolPrefs.colors[0], defaultCategory: "change", selectHint: hint)
    }

    private func drag(_ o: CaptureOverlay, _ a: CGPoint, _ b: CGPoint) {
        _ = o.state.down(a, clicks: 1)
        o.state.moveTo(b, shift: false)
        o.state.endOp()
    }

    /// The overlay with a selection from (100, 100) to (500, 400)
    private func selected() -> CaptureOverlay {
        let o = overlay()
        drag(o, CGPoint(x: 100, y: 100), CGPoint(x: 500, y: 400))
        return o
    }

    private func ids(_ row: OverlayRow) -> [String] {
        row.items.compactMap { ($0 as? OverlayButton)?.id }
    }

    private func key(_ code: UInt16, _ characters: String, _ flags: NSEvent.ModifierFlags = []) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil, characters: characters,
            charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
    }

    private func type(_ text: String, into view: NSTextView) {
        view.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
    }

    // MARK: Selecting

    func testASelectionGetsItsSizeTheToolbarBelowItAndItsHandles() {
        let o = selected()
        XCTAssertEqual(o.state.sel, CGRect(x: 100, y: 100, width: 400, height: 300))
        XCTAssertFalse(o.sizeLabel.isHidden)
        XCTAssertEqual(o.sizeLabel.label.text, "400 × 300")
        // Above the selection's top-left corner
        XCTAssertEqual(o.sizeLabel.frame.minX, 100)
        XCTAssertEqual(o.sizeLabel.frame.maxY, 94)
        XCTAssertTrue(o.state.handlesVisible)
        // Right-aligned below the selection
        XCTAssertFalse(o.toolbar.isHidden)
        XCTAssertEqual(o.toolbar.frame.maxX, 500)
        XCTAssertEqual(o.toolbar.frame.minY, 408)
        XCTAssertEqual(
            ids(o.toolbar), ["rect", "ellipse", "arrow", "pen", "mosaic", "text", "note", "overall", "undo", "cancel", "done"])
        // No tool yet: no sub-toolbar
        XCTAssertTrue(o.subbar.isHidden)
    }

    func testHoveringAWindowHighlightsItAndAClickSelectsIt() {
        let o = overlay(windows: [CGRect(x: 200, y: 150, width: 300, height: 200)])
        o.state.moveTo(CGPoint(x: 250, y: 200), shift: false)
        XCTAssertEqual(o.state.shown, CGRect(x: 200, y: 150, width: 300, height: 200))
        XCTAssertEqual(o.sizeLabel.label.text, "300 × 200")
        XCTAssertTrue(o.toolbar.isHidden)
        _ = o.state.down(CGPoint(x: 250, y: 200), clicks: 1)
        o.state.endOp()
        XCTAssertEqual(o.state.sel, CGRect(x: 200, y: 150, width: 300, height: 200))
        XCTAssertFalse(o.toolbar.isHidden)
    }

    // MARK: The sub-toolbar

    func testTheSubToolbarHasTheToolsSizesAndColors() {
        let o = selected()
        let colors = ToolPrefs.colors.map { "color-\($0.hexText.dropFirst())" }
        o.state.chooseTool(.rect)
        XCTAssertFalse(o.subbar.isHidden)
        XCTAssertEqual(ids(o.subbar), ["size-0", "size-1", "size-2"] + colors)
        // Next to the toolbar, on its outer side
        XCTAssertEqual(o.subbar.frame.minY, o.toolbar.frame.maxY + 6)
        // Pixelate has no color; the Pin has no thickness
        o.state.chooseTool(.mosaic)
        XCTAssertEqual(ids(o.subbar), ["size-0", "size-1", "size-2"])
        o.state.chooseTool(.note)
        XCTAssertEqual(ids(o.subbar), colors)
        // Clicking the chosen tool again puts it down
        o.toolButton("note")?.click()
        XCTAssertEqual(o.state.tool, .noTool)
        XCTAssertTrue(o.subbar.isHidden)
    }

    func testAColorOnTheSubToolbarIsForTheNextMarks() {
        let o = selected()
        o.state.chooseTool(.pen)
        o.subbarButton("color-5b8cff")?.click()
        XCTAssertEqual(o.state.prefs.color, MarkColor(hex: 0x5b8cff))
        o.subbarButton("size-2")?.click()
        XCTAssertEqual(o.state.prefs.currentSize(.pen), 6)
    }

    // MARK: The note box

    func testARectangleOpensTheNoteBoxNextToItAndSaveWritesTheNote() {
        let o = selected()
        o.toolButton("rect")?.click()
        XCTAssertEqual(o.state.tool, .rect)
        drag(o, CGPoint(x: 200, y: 200), CGPoint(x: 300, y: 260))
        XCTAssertTrue(o.state.noteOpen)
        XCTAssertFalse(o.noteBox.isHidden)
        XCTAssertEqual(o.noteBox.title.text, ShellText.t("capture.note.title", values: ["n": 1]))
        // To the right of the mark grown by 12, its top level with the grown mark's
        XCTAssertEqual(o.noteBox.frame.minX, 320)
        XCTAssertEqual(o.noteBox.frame.minY, 188)
        XCTAssertEqual(o.noteBox.frame.width, 360)
        // Nothing written: Save does nothing
        XCTAssertFalse(o.noteBox.save.enabled())
        o.noteBox.save.click()
        XCTAssertTrue(o.state.noteOpen)

        type("Make this blue", into: o.noteBox.textView)
        XCTAssertTrue(o.noteBox.save.enabled())
        XCTAssertTrue(o.noteBox.placeholder.isHidden)
        o.noteBox.save.click()
        XCTAssertFalse(o.state.noteOpen)
        XCTAssertTrue(o.noteBox.isHidden)
        XCTAssertEqual(o.state.marks.count, 1)
        XCTAssertEqual(o.state.marks[0].note, "Make this blue")
        XCTAssertEqual(o.state.marks[0].number, 1)
        // A mark locks the selection: no handles
        XCTAssertFalse(o.state.handlesVisible)
    }

    func testTheNoteBoxKeysSaveCancelAndPickTheCategory() {
        let o = selected()
        o.state.chooseTool(.rect)
        drag(o, CGPoint(x: 200, y: 200), CGPoint(x: 300, y: 260))
        type("Delete it", into: o.noteBox.textView)
        // ⌥2 is Remove (by the key's place, whatever character Option makes)
        XCTAssertTrue(o.routeKey(key(0x13, "™", .option)))
        XCTAssertEqual(o.state.noteCategory, "remove")
        // A plain letter is typed into the box
        XCTAssertFalse(o.routeKey(key(0x0F, "r")))
        XCTAssertEqual(o.state.tool, .rect)
        // Return saves
        XCTAssertTrue(o.routeKey(key(0x24, "\r")))
        XCTAssertFalse(o.state.noteOpen)
        XCTAssertEqual(o.state.marks[0].category, "remove")

        // A category button in the box does the same
        o.state.chooseTool(.ellipse)
        drag(o, CGPoint(x: 150, y: 300), CGPoint(x: 250, y: 380))
        o.noteBox.button("category-question")?.click()
        XCTAssertEqual(o.state.noteCategory, "question")
        // Esc cancels the note and keeps the ellipse as a plain drawing
        XCTAssertTrue(o.routeKey(key(0x35, "\u{1B}")))
        XCTAssertFalse(o.state.noteOpen)
        XCTAssertEqual(o.state.marks.count, 2)
        XCTAssertEqual(o.state.marks[1].number, 0)
    }

    func testTheOverallCommentOpensNextToTheToolbar() {
        let o = selected()
        o.toolButton("overall")?.click()
        XCTAssertTrue(o.state.noteOpen)
        XCTAssertNil(o.state.noteFor)
        XCTAssertEqual(o.noteBox.title.text, ShellText.t("capture.note.overall"))
        XCTAssertTrue(o.toolButtons.first { $0.button.id == "overall" }?.on() ?? false)
        type("Too dark overall", into: o.noteBox.textView)
        o.noteBox.save.click()
        XCTAssertEqual(o.state.overall, "Too dark overall")
    }

    // MARK: The text box

    func testTextIsTypedWhereTheClickWasAndEndsWithEsc() {
        let o = selected()
        o.state.chooseTool(.text)
        _ = o.state.down(CGPoint(x: 150, y: 150), clicks: 1)
        o.state.endOp()
        XCTAssertTrue(o.state.textOpen)
        XCTAssertFalse(o.textBox.isHidden)
        // The first character goes where the click was: the box starts 5 left and 3 up of it
        XCTAssertEqual(o.textBox.frame.origin, CGPoint(x: 145, y: 147))
        XCTAssertEqual(o.textOrigin, CGPoint(x: 150, y: 150))
        type("Hi", into: o.textBox.textView)
        XCTAssertGreaterThanOrEqual(o.textBox.frame.width, 40 + 10)
        XCTAssertTrue(o.routeKey(key(0x35, "\u{1B}")))
        XCTAssertFalse(o.state.textOpen)
        XCTAssertTrue(o.textBox.isHidden)
        XCTAssertEqual(o.state.marks.last?.kind, .text)
        XCTAssertEqual(o.state.marks.last?.text, "Hi")
        XCTAssertEqual(o.state.marks.last?.points, [CGPoint(x: 150, y: 150)])
    }

    // MARK: Keys

    func testTheOverlaysKeysPickToolsAndCommandKeysStayOnIt() {
        let o = selected()
        XCTAssertTrue(o.routeKey(key(0x0F, "r")))
        XCTAssertEqual(o.state.tool, .rect)
        XCTAssertTrue(o.routeKey(key(0x13, "2")))
        XCTAssertEqual(o.state.prefs.color, ToolPrefs.colors[1])
        // Keys the overlay does not use are dropped, not passed on
        XCTAssertFalse(o.routeKey(key(0x07, "x")))
        // ⌘Z undoes on the overlay itself (the main menu would undo in the window behind)
        o.state.chooseTool(.pen)
        drag(o, CGPoint(x: 200, y: 200), CGPoint(x: 260, y: 240))
        o.state.cancelNote()
        XCTAssertEqual(o.state.marks.count, 1)
        XCTAssertTrue(o.performKeyEquivalent(with: key(0x06, "z", .command)))
        XCTAssertEqual(o.state.marks.count, 0)
        // Every other ⌘ key stays here too, except ⌘Q
        XCTAssertTrue(o.performKeyEquivalent(with: key(0x1F, "o", .command)))
        XCTAssertFalse(o.performKeyEquivalent(with: key(0x0C, "q", .command)))
        // F keys mean nothing here and do not reach the main menu
        XCTAssertTrue(o.performKeyEquivalent(with: key(0x60, String(Character(UnicodeScalar(UInt32(NSF5FunctionKey))!)))))
    }

    // MARK: Cancelling

    func testAfterANoteTheFirstEscOnlyWarnsAboveTheToolbar() {
        let o = selected()
        XCTAssertFalse(o.guardCancel(), "nothing written: cancel at once")
        o.state.chooseTool(.rect)
        drag(o, CGPoint(x: 200, y: 200), CGPoint(x: 300, y: 260))
        type("Keep me", into: o.noteBox.textView)
        o.noteBox.save.click()
        XCTAssertTrue(o.guardCancel())
        XCTAssertFalse(o.warn.isHidden)
        XCTAssertEqual(o.warn.label.text, KeepWords.of(ShellText.t("capture.cancelWarn")))
        // Above the toolbar, right-aligned with it, unless that is off the screen
        XCTAssertLessThanOrEqual(o.warn.frame.maxY, min(o.toolbar.frame.minY, o.subbar.isHidden ? .infinity : o.subbar.frame.minY) - 8 + 0.5)
        // A second press soon after really cancels
        XCTAssertFalse(o.guardCancel())
    }

    // MARK: Pixels

    func testTheLayerShowsTheMarksOverThePictureAndDimsTheOutside() throws {
        let o = selected()
        o.state.chooseTool(.rect)
        drag(o, CGPoint(x: 200, y: 200), CGPoint(x: 300, y: 260))
        o.state.cancelNote()
        let rep = try XCTUnwrap(o.render())
        let s = CGFloat(rep.pixelsWide) / screen.width
        func at(_ x: CGFloat, _ y: CGFloat) -> [Int] {
            let c = rep.colorAt(x: Int(x * s), y: Int(y * s))?.usingColorSpace(.sRGB)
            return [c?.redComponent ?? -1, c?.greenComponent ?? -1, c?.blueComponent ?? -1].map { Int(($0 * 255).rounded()) }
        }
        func close(_ a: [Int], _ b: [Int], _ what: String) {
            XCTAssertEqual(a.count, b.count, what)
            for (x, y) in zip(a, b) { XCTAssertEqual(x, y, accuracy: 3, "\(what): \(a) vs \(b)") }
        }
        // The picture as the layer shows it, in the layer's color space (dimming there is not exactly half in sRGB)
        func pattern(_ x: Int, _ y: Int, dimmed: Bool) -> [Int] {
            CaptureSmoke.expectedColor(PatternScreenSource.color(x: x, y: y), in: rep.colorSpace, dimmed: dimmed) ?? []
        }
        let orange = ToolPrefs.colors[0]
        // The rectangle's top edge, in its color
        close(at(250, 200), [Int(orange.r), Int(orange.g), Int(orange.b)], "the rectangle's edge")
        // Inside the rectangle and the selection: the picture as it is
        close(at(250, 230), pattern(250, 230, dimmed: false), "inside the selection")
        // Outside the selection: the picture at half
        close(at(50, 50), pattern(50, 50, dimmed: true), "outside the selection")
    }
}

extension CaptureOverlay {
    /// A toolbar button by its id (the tests click it the way a click does)
    func toolButton(_ id: String) -> OverlayButton? {
        toolbar.items.compactMap { $0 as? OverlayButton }.first { $0.id == id }
    }

    func subbarButton(_ id: String) -> OverlayButton? {
        subbar.items.compactMap { $0 as? OverlayButton }.first { $0.id == id }
    }
}

extension OverlayNoteBox {
    func button(_ id: String) -> OverlayButton? {
        func find(_ view: NSView) -> OverlayButton? {
            for sub in view.subviews {
                if let b = sub as? OverlayButton, b.id == id { return b }
                if let b = find(sub) { return b }
            }
            return nil
        }
        return find(self)
    }
}

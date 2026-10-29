import XCTest

@testable import SnipToss

/// A text measure with fixed numbers, so hit testing does not depend on a font: a character is 0.6 of the font size wide, a line 1.3 high
struct FixedTextMeasure: TextMeasuring {
    func size(of text: String, fontSize: CGFloat) -> CGSize {
        CGSize(width: fontSize * 0.6 * CGFloat(text.utf16.count), height: fontSize * 1.3)
    }
}

/// Whether the shell's message catalogs and formatter are built (node app-mac/scripts/build-resources.mjs, SNIPTOSS_RESOURCES_DIR)
func shellResourcesAvailable() -> Bool {
    guard let dir = AppResources.directory() else { return false }
    return FileManager.default.fileExists(atPath: dir.appendingPathComponent("shell-messages.js").path)
}

/// The marks: their geometry, hit testing and the position wording given to the AI
final class MarksTests: XCTestCase {
    override func setUp() {
        super.setUp()
        ShellLocale.reset()
    }

    override func tearDown() {
        ShellLocale.reset()
        super.tearDown()
    }

    private let measure = FixedTextMeasure()

    private func useChinese() throws {
        try XCTSkipUnless(shellResourcesAvailable(), "the shell's resources are not built")
        ShellLocale.use(pref: "zh-CN", system: "en-US")
    }

    // MARK: Position wording

    func testPositionWordingFormatsNumbersIndependentlyOfTheSystemLocale() throws {
        try useChinese()
        // The numbers are written as plain text with an ASCII minus; no system number format gets a say. They are never negative today,
        // but the rule has to hold
        let m = Mark(kind: .rect, points: [CGPoint(x: -5, y: 10), CGPoint(x: 1200, y: 30)])
        let text = m.whereText(sel: CGRect(x: 0, y: 0, width: 1200, height: 1000), size: (width: 1200, height: 1000))
        XCTAssertEqual(text, "区域 横贯画面上部（横 0%–100%、纵 1%–3%），x=-5 y=10 宽=1205 高=20 px")
        XCTAssertTrue(text.contains("x=-5 "))
    }

    func testWordingForANoteWithSeveralMarksIsNPlacesWithSemicolonsAndOnePlaceIsUnchanged() throws {
        try useChinese()
        // ADR-0009: the first place plus those marked after it, in drawing order; the message is the main app's (ai.where.many),
        // golden files in tests/golden/handoff
        let sel = CGRect(x: 0, y: 0, width: 1000, height: 500)
        let size: PixelSize = (width: 1000, height: 500)
        let rect = Mark(kind: .rect, points: [CGPoint(x: 100, y: 400), CGPoint(x: 300, y: 440)])
        let pin = Mark(kind: .note, points: [CGPoint(x: 850, y: 425)], lead: rect)
        let other = Mark(kind: .note, points: [CGPoint(x: 500, y: 250)])
        let all = [rect, other, pin]
        XCTAssertEqual(
            rect.whereAll(all, sel: sel, size: size),
            "2 处：区域 画面左下（横 10%–30%、纵 80%–88%），x=100 y=400 宽=200 高=40 px；位置 画面右下（横 85%、纵 85%），x=850 y=425 px")
        XCTAssertEqual(other.whereAll(all, sel: sel, size: size), other.whereText(sel: sel, size: size))
        XCTAssertIdentical(pin.head, rect)
        XCTAssertIdentical(other.head, other)
    }

    func testWhenThePlacesHaveDifferentColorsEachIsPrefixedWithItsColor() throws {
        try useChinese()
        // A place gets its own color so the note can say "the yellow one…"; preset colors are written by name, custom color values as they
        // are
        let sel = CGRect(x: 0, y: 0, width: 1000, height: 500)
        let size: PixelSize = (width: 1000, height: 500)
        let first = Mark(kind: .note, color: ToolPrefs.colors[0], points: [CGPoint(x: 100, y: 100)])
        let second = Mark(kind: .note, color: ToolPrefs.colors[2], points: [CGPoint(x: 900, y: 400)], lead: first)
        XCTAssertEqual(
            first.whereAll([first, second], sel: sel, size: size),
            "2 处：（橙色）位置 画面左上（横 10%、纵 20%），x=100 y=100 px；（黄色）位置 画面右下（横 90%、纵 80%），x=900 y=400 px")
        second.color = MarkColor(r: 0x12, g: 0x34, b: 0x56)
        let custom = first.whereAll([first, second], sel: sel, size: size)
        XCTAssertTrue(custom.hasPrefix("2 处：（橙色）位置 "), custom)
        XCTAssertTrue(custom.contains("；（#123456）位置 "), custom)
        XCTAssertEqual(ShellLocale.text("markColor.name", in: "en", ["color": "yellow"]), "Yellow")
    }

    func testCategoriesAreNamedInTheLanguageInUseAndAnUnknownOneIsChange() throws {
        try useChinese()
        XCTAssertEqual(Categories.label("remove"), "删除")
        XCTAssertEqual(Categories.label("no-such-category"), Categories.label("change"))
        XCTAssertEqual(Categories.valid(nil), "change")
        XCTAssertEqual(Categories.valid("question"), "question")
        XCTAssertEqual(Categories.color("remove"), MarkColor(r: 0xff, g: 0x90, b: 0x90))
        XCTAssertEqual(Categories.color("anything else"), MarkColor(r: 0xb3, g: 0x9d, b: 0xff))
    }

    // MARK: Hit testing

    func testMarkHitTestingWidensLinesByThicknessIgnoresTheInsideOfBoxesAndUsesTheTextExtentForText() {
        let rect = Mark(kind: .rect, size: 2, points: [CGPoint(x: 100, y: 100), CGPoint(x: 200, y: 200)])
        XCTAssertTrue(rect.hits(CGPoint(x: 100, y: 150), measure: measure))
        XCTAssertTrue(rect.hits(CGPoint(x: 95, y: 150), measure: measure))  // within half the line width + 4
        XCTAssertFalse(rect.hits(CGPoint(x: 94, y: 150), measure: measure))
        XCTAssertFalse(rect.hits(CGPoint(x: 150, y: 150), measure: measure))  // inside the box: a new mark is drawn as usual
        let small = Mark(kind: .rect, size: 2, points: [CGPoint(x: 100, y: 100), CGPoint(x: 106, y: 106)])
        XCTAssertTrue(small.hits(CGPoint(x: 103, y: 103), measure: measure))  // a small box counts as hit all over
        let ellipse = Mark(kind: .ellipse, size: 2, points: [CGPoint(x: 100, y: 100), CGPoint(x: 300, y: 200)])
        XCTAssertTrue(ellipse.hits(CGPoint(x: 300, y: 150), measure: measure))
        XCTAssertTrue(ellipse.hits(CGPoint(x: 200, y: 98), measure: measure))
        XCTAssertFalse(ellipse.hits(CGPoint(x: 200, y: 150), measure: measure))
        let arrow = Mark(kind: .arrow, size: 4, points: [CGPoint(x: 100, y: 100), CGPoint(x: 300, y: 100)])
        XCTAssertTrue(arrow.hits(CGPoint(x: 200, y: 105), measure: measure))
        XCTAssertFalse(arrow.hits(CGPoint(x: 200, y: 108), measure: measure))
        XCTAssertTrue(arrow.hits(CGPoint(x: 295, y: 112), measure: measure))  // the arrow head
        let pen = Mark(kind: .pen, size: 2, points: [CGPoint(x: 100, y: 100), CGPoint(x: 150, y: 100), CGPoint(x: 150, y: 150)])
        XCTAssertTrue(pen.hits(CGPoint(x: 153, y: 125), measure: measure))
        XCTAssertFalse(pen.hits(CGPoint(x: 125, y: 125), measure: measure))
        let mosaic = Mark(kind: .mosaic, size: 20, points: [CGPoint(x: 100, y: 100), CGPoint(x: 200, y: 100)])
        XCTAssertFalse(mosaic.hits(CGPoint(x: 150, y: 100), measure: measure))
        // "Hello" at 18 is 54 wide and 23.4 high with the fixed measure (a real font gives about the same), drawn from (100, 100)
        let text = Mark(kind: .text, size: 18, points: [CGPoint(x: 100, y: 100)], text: "Hello")
        XCTAssertTrue(text.hits(CGPoint(x: 110, y: 110), measure: measure))
        XCTAssertFalse(text.hits(CGPoint(x: 100, y: 140), measure: measure))
    }

    func testAPenStrokeWithOnePointAndAnArrowWithNoLengthStillBehave() {
        let dot = Mark(kind: .pen, size: 2, points: [CGPoint(x: 100, y: 100)])
        XCTAssertTrue(dot.hits(CGPoint(x: 104, y: 100), measure: measure))
        XCTAssertFalse(dot.hits(CGPoint(x: 106, y: 100), measure: measure))
        XCTAssertTrue(dot.isTiny)
        // Both ends at the same point: the line is a point, and only the head's reach counts
        let flat = Mark(kind: .arrow, size: 2, points: [CGPoint(x: 100, y: 100), CGPoint(x: 100, y: 100)])
        XCTAssertTrue(flat.hits(CGPoint(x: 103, y: 100), measure: measure))
        XCTAssertFalse(flat.hits(CGPoint(x: 140, y: 100), measure: measure))
    }

    func testHitTestingANumberBadgeUsesThePositionItIsDrawnAt() {
        // A box right at the selection's top-left corner: the badge is clamped 10 into the selection, and both drawing and hit-testing
        // use the clamped position
        let sel = CGRect(x: 100, y: 100, width: 400, height: 300)
        let m = Mark(kind: .rect, points: [CGPoint(x: 100, y: 100), CGPoint(x: 200, y: 180)])
        XCTAssertEqual(MarkPainter.badgeCenter(m, keepInside: sel), CGPoint(x: 110, y: 110))
        let inside = Mark(kind: .rect, points: [CGPoint(x: 150, y: 150), CGPoint(x: 200, y: 180)])
        XCTAssertEqual(MarkPainter.badgeCenter(inside, keepInside: sel), CGPoint(x: 150, y: 150))
        // Without a selection (the empty rectangle) the position is left as it is
        XCTAssertEqual(MarkPainter.badgeCenter(m, keepInside: WPFRect.empty), CGPoint(x: 100, y: 100))
    }

    func testATextMarkCoversTheMeasuredSizeFromItsTopLeftCorner() {
        let m = Mark(kind: .text, size: 20, points: [CGPoint(x: 30, y: 40)], text: "ab")
        let box = MarkPainter.textBounds(m, measure: measure)
        XCTAssertEqual(box.origin, CGPoint(x: 30, y: 40))
        XCTAssertEqual(box.size.width, 24, accuracy: 1e-9)
        XCTAssertEqual(box.size.height, 26, accuracy: 1e-9)
    }

    // MARK: Shape of a mark

    func testBoundsAndWhatCountsAsTiny() {
        XCTAssertTrue(Mark(kind: .rect).bounds.wpfIsEmpty)
        let rect = Mark(kind: .rect, points: [CGPoint(x: 50, y: 60), CGPoint(x: 10, y: 20)])
        XCTAssertEqual(rect.bounds, CGRect(x: 10, y: 20, width: 40, height: 40))
        XCTAssertEqual(rect.badgeAt, CGPoint(x: 10, y: 20))
        XCTAssertFalse(rect.isTiny)
        XCTAssertTrue(Mark(kind: .rect, points: [CGPoint(x: 0, y: 0), CGPoint(x: 3.9, y: 50)]).isTiny)
        XCTAssertTrue(Mark(kind: .ellipse, points: [CGPoint(x: 0, y: 0), CGPoint(x: 50, y: 3.9)]).isTiny)
        XCTAssertTrue(Mark(kind: .arrow, points: [CGPoint(x: 0, y: 0), CGPoint(x: 5, y: 5)]).isTiny)  // 7.07 long
        XCTAssertFalse(Mark(kind: .arrow, points: [CGPoint(x: 0, y: 0), CGPoint(x: 6, y: 6)]).isTiny)
        XCTAssertTrue(Mark(kind: .mosaic, points: [CGPoint(x: 0, y: 0)]).isTiny)
        XCTAssertFalse(Mark(kind: .pen, points: [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 1)]).isTiny)
        XCTAssertTrue(Mark(kind: .text, points: [CGPoint(x: 0, y: 0)], text: " \n ").isTiny)
        XCTAssertFalse(Mark(kind: .note, points: [CGPoint(x: 0, y: 0)]).isTiny)
        XCTAssertEqual(Mark(kind: .note, points: [CGPoint(x: 7, y: 8)]).badgeAt, CGPoint(x: 7, y: 8))
    }

    func testTheNameOfAColorIsItsHexValueWhenItIsNotAPreset() {
        XCTAssertEqual(MarkColor(r: 0x12, g: 0x34, b: 0x56).hexText, "#123456")
        XCTAssertEqual(MarkColor(r: 0x00, g: 0x0a, b: 0xff).hexText, "#000aff")
        XCTAssertEqual(MarkColor(hex: 0x5b8cff), MarkColor(r: 0x5b, g: 0x8c, b: 0xff))
        XCTAssertEqual(ToolPrefs.name(MarkColor(r: 1, g: 2, b: 3)), "#010203")
    }

    func testTextIsTrimmedTheWayTheNoteBoxesNeedIt() {
        XCTAssertEqual("  a b \n".trimmedBothEnds, "a b")
        XCTAssertEqual("  a b \n\t ".trimmedEnd, "  a b")
        XCTAssertEqual("".trimmedEnd, "")
        XCTAssertEqual(" \r\n ".trimmedEnd, "")
        XCTAssertEqual("a\r\n".trimmedEnd, "a")
    }

    // MARK: The measure the app uses

    func testTheSystemMeasureGivesAPlausibleSize() {
        let system = SystemTextMeasure()
        let one = system.size(of: "Hello", fontSize: 18)
        XCTAssertGreaterThan(one.width, 18)
        XCTAssertLessThan(one.width, 120)
        XCTAssertGreaterThan(one.height, 18)
        XCTAssertLessThan(one.height, 30)
        // A second line adds a line's height, and the width is the widest line's
        let two = system.size(of: "Hello\nHi", fontSize: 18)
        XCTAssertEqual(two.height, one.height * 2, accuracy: 0.001)
        XCTAssertEqual(two.width, one.width, accuracy: 0.001)
        // Trailing white space counts
        XCTAssertGreaterThan(system.size(of: "Hello  ", fontSize: 18).width, one.width)
    }
}

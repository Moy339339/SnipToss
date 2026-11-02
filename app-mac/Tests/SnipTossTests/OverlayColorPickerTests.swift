import AppKit
import XCTest

@testable import SnipToss

/// The capture overlay's color picker without a window: its size and parts, picking on the field and the strip, typing the digits, Return
/// and Esc, and how it draws. Where it goes in the overlay, and the real mouse and keyboard reaching it, are in the capture smoke run
/// (mac.yml)
final class OverlayColorPickerTests: SnipTestCase {
    private let teal = MarkColor(hex: 0x17a998)

    private func opened(_ color: MarkColor? = nil) -> OverlayColorPicker {
        let picker = OverlayColorPicker()
        picker.open(with: color ?? teal)
        return picker
    }

    private func key(_ code: UInt16, _ characters: String) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, characters: characters,
            charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
    }

    /// A mouse event at a point of `view` (the view maps the event's window position back to the same point)
    private func mouse(_ type: NSEvent.EventType, _ point: CGPoint, in view: NSView) -> NSEvent {
        NSEvent.mouseEvent(
            with: type, location: view.convert(point, to: nil), modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
            eventNumber: 0, clickCount: 1, pressure: 1)!
    }

    // MARK: Opening

    func testOpeningShowsTheDigitsInUpperCaseAndTheHsvOfTheColor() {
        let picker = OverlayColorPicker()
        XCTAssertTrue(picker.isHidden)
        picker.open(with: teal)
        XCTAssertFalse(picker.isHidden)
        XCTAssertEqual(picker.color, teal)
        XCTAssertEqual(picker.digitsText, "17A998")
        let hsv = ColorMath.hsv(teal)
        XCTAssertEqual(picker.h, hsv.h)
        XCTAssertEqual(picker.s, hsv.s)
        XCTAssertEqual(picker.v, hsv.v)
        // All the digits are selected, so typing replaces them
        XCTAssertEqual(picker.editor.selectedRange(), NSRange(location: 0, length: 6))
        // Opening again starts from the new color
        picker.open(with: MarkColor(hex: 0xff0000))
        XCTAssertEqual(picker.digitsText, "FF0000")
        XCTAssertEqual(picker.h, 0)
        XCTAssertEqual(picker.s, 1)
    }

    func testTheThumbsSitOnTheColor() {
        let picker = opened()
        let hsv = ColorMath.hsv(teal)
        XCTAssertEqual(picker.fieldThumbPoint.x, hsv.s * 208, accuracy: 0.001)
        XCTAssertEqual(picker.fieldThumbPoint.y, (1 - hsv.v) * 128, accuracy: 0.001)
        XCTAssertEqual(picker.hueThumbPoint.x, hsv.h / 360 * 208, accuracy: 0.001)
        // The middle of the 12-point strip
        XCTAssertEqual(picker.hueThumbPoint.y, 6)
    }

    // MARK: Size and parts

    func testThePanelIsAsBigAsItsContentWithTwelveAllAround() {
        let picker = OverlayColorPicker()
        XCTAssertEqual(picker.frame.size, CGSize(width: 12 + 208 + 12, height: 12 + 128 + 10 + 12 + 12 + 28 + 12))
        XCTAssertEqual(picker.field.frame, CGRect(x: 12, y: 12, width: 208, height: 128))
        XCTAssertEqual(picker.strip.frame, CGRect(x: 12, y: 150, width: 208, height: 12))
        // The row: the preview, the digits between 8 of room, and OK at the right edge of the content
        XCTAssertEqual(picker.preview.frame, CGRect(x: 12, y: 174, width: 28, height: 28))
        XCTAssertEqual(picker.digitsBox.frame.minX, 40 + 8)
        XCTAssertEqual(picker.digitsBox.frame.minY, 174)
        XCTAssertEqual(picker.digitsBox.frame.height, 28)
        XCTAssertEqual(picker.applyButton.frame.maxX, 12 + 208)
        XCTAssertEqual(picker.applyButton.frame.minY, 174)
        XCTAssertEqual(picker.applyButton.frame.height, 28)
        XCTAssertEqual(picker.digitsBox.frame.maxX + 8, picker.applyButton.frame.minX)
        XCTAssertEqual(picker.applyButton.frame.maxY + 12, picker.frame.height)
        // The "#" and the digits fit the box
        let box = picker.digitsBox
        XCTAssertGreaterThan(box.textView.frame.width, 40)
        XCTAssertLessThanOrEqual(box.textView.frame.maxX, box.bounds.width - 1 - 8 + 0.001)
    }

    func testThePartsAreNamedForScreenReadersAndTheSmokeRun() {
        let picker = OverlayColorPicker()
        XCTAssertEqual(picker.accessibilityIdentifier(), "picker")
        XCTAssertEqual(picker.accessibilityLabel(), ShellText.t("markColor.custom"))
        XCTAssertEqual(picker.field.accessibilityIdentifier(), "picker-field")
        XCTAssertEqual(picker.field.accessibilityLabel(), ShellText.t("markColor.field"))
        XCTAssertEqual(picker.strip.accessibilityIdentifier(), "picker-hue")
        XCTAssertEqual(picker.strip.accessibilityLabel(), ShellText.t("markColor.hue"))
        XCTAssertEqual(picker.editor.accessibilityIdentifier(), "picker-hex")
        XCTAssertEqual(picker.editor.accessibilityLabel(), ShellText.t("markColor.hex"))
        XCTAssertEqual(picker.applyButton.id, "picker-apply")
        XCTAssertEqual(picker.applyButton.accessibilityIdentifier(), "picker-apply")
        XCTAssertEqual(picker.applyButton.accessibilityLabel(), ShellText.t("markColor.apply"))
    }

    // MARK: Picking

    func testTheFieldsCornersAreWhiteBlackAndThePureHue() {
        let picker = opened(MarkColor(hex: 0x00ff00))
        XCTAssertEqual(picker.h, 120)
        picker.pickInField(at: CGPoint(x: 0, y: 0))
        XCTAssertEqual(picker.color, MarkColor(hex: 0xffffff))
        XCTAssertEqual(picker.digitsText, "FFFFFF")
        picker.pickInField(at: CGPoint(x: 208, y: 0))
        XCTAssertEqual(picker.color, MarkColor(hex: 0x00ff00))
        XCTAssertEqual(picker.digitsText, "00FF00")
        for corner in [CGPoint(x: 0, y: 128), CGPoint(x: 208, y: 128)] {
            picker.pickInField(at: corner)
            XCTAssertEqual(picker.color, MarkColor(hex: 0x000000))
            XCTAssertEqual(picker.digitsText, "000000")
        }
        // Picking on the field never moves the hue
        XCTAssertEqual(picker.h, 120)
        // The middle: half saturated, half bright
        picker.pickInField(at: CGPoint(x: 104, y: 64))
        XCTAssertEqual(picker.s, 0.5)
        XCTAssertEqual(picker.v, 0.5)
        XCTAssertEqual(picker.color, ColorMath.fromHsv(120, 0.5, 0.5))
        XCTAssertEqual(picker.digitsText, String(picker.color.hexText.dropFirst()).uppercased())
        XCTAssertEqual(picker.fieldThumbPoint, CGPoint(x: 104, y: 64))
    }

    func testThePointerOutsideTheFieldIsHeldAtItsEdge() {
        let picker = opened(MarkColor(hex: 0x00ff00))
        picker.pickInField(at: CGPoint(x: -40, y: -9))
        XCTAssertEqual(picker.color, MarkColor(hex: 0xffffff))
        picker.pickInField(at: CGPoint(x: 900, y: 0))
        XCTAssertEqual(picker.color, MarkColor(hex: 0x00ff00))
        picker.pickInField(at: CGPoint(x: 100, y: 5000))
        XCTAssertEqual(picker.color, MarkColor(hex: 0x000000))
    }

    func testPickingOnTheStripChangesTheHueAndTheColorButNotSaturationOrValue() {
        let picker = opened()
        let (s, v) = (picker.s, picker.v)
        picker.pickInStrip(x: 0)
        XCTAssertEqual(picker.h, 0)
        XCTAssertEqual(picker.color, ColorMath.fromHsv(0, s, v))
        picker.pickInStrip(x: 104)
        XCTAssertEqual(picker.h, 179.95, accuracy: 0.0001)
        XCTAssertEqual(picker.color, ColorMath.fromHsv(179.95, s, v))
        XCTAssertEqual(picker.digitsText, String(picker.color.hexText.dropFirst()).uppercased())
        XCTAssertEqual(picker.hueThumbPoint.x, 179.95 / 360 * 208, accuracy: 0.0001)
        // The right end is just short of red again; beyond it is held there
        picker.pickInStrip(x: 208)
        XCTAssertEqual(picker.h, 359.9, accuracy: 0.0001)
        picker.pickInStrip(x: 5000)
        XCTAssertEqual(picker.h, 359.9, accuracy: 0.0001)
        picker.pickInStrip(x: -5)
        XCTAssertEqual(picker.h, 0)
        XCTAssertEqual(picker.s, s)
        XCTAssertEqual(picker.v, v)
    }

    func testAPressAndADragOnTheFieldPickAndTheDragKeepsGoingOutsideIt() {
        let picker = opened(MarkColor(hex: 0x00ff00))
        let field = picker.field
        field.mouseDown(with: mouse(.leftMouseDown, CGPoint(x: 104, y: 64), in: field))
        XCTAssertEqual(picker.color, ColorMath.fromHsv(120, 0.5, 0.5))
        field.mouseDragged(with: mouse(.leftMouseDragged, CGPoint(x: 52, y: 32), in: field))
        XCTAssertEqual(picker.s, 0.25)
        XCTAssertEqual(picker.v, 0.75)
        // The pointer leaves the area with the button held: the drag goes on at the nearest edge
        field.mouseDragged(with: mouse(.leftMouseDragged, CGPoint(x: 400, y: -50), in: field))
        XCTAssertEqual(picker.color, MarkColor(hex: 0x00ff00))
        field.mouseUp(with: mouse(.leftMouseUp, CGPoint(x: 400, y: -50), in: field))
        XCTAssertEqual(picker.color, MarkColor(hex: 0x00ff00))
    }

    func testAPressAndADragOnTheStripPickTheHue() {
        let picker = opened()
        let strip = picker.strip
        strip.mouseDown(with: mouse(.leftMouseDown, CGPoint(x: 52, y: 6), in: strip))
        XCTAssertEqual(picker.h, 0.25 * 359.9, accuracy: 0.0001)
        strip.mouseDragged(with: mouse(.leftMouseDragged, CGPoint(x: 156, y: 80), in: strip))
        XCTAssertEqual(picker.h, 0.75 * 359.9, accuracy: 0.0001)
        strip.mouseUp(with: mouse(.leftMouseUp, CGPoint(x: 156, y: 80), in: strip))
        XCTAssertEqual(picker.h, 0.75 * 359.9, accuracy: 0.0001)
    }

    func testEveryPointOfThePanelIsTakenByThePanelItselfNotThePictureBelow() {
        // In a flipped host like the overlay, shifted so the panel's own coordinates are not the host's
        let host = FlippedHost(frame: CGRect(x: 0, y: 0, width: 600, height: 500))
        let picker = opened()
        picker.setFrameOrigin(CGPoint(x: 100, y: 50))
        host.addSubview(picker)
        func hit(_ x: CGFloat, _ y: CGFloat) -> NSView? { picker.hitTest(CGPoint(x: 100 + x, y: 50 + y)) }
        func inside(_ view: NSView?) -> Bool { view.map { $0 === picker || $0.isDescendant(of: picker) } ?? false }
        for x in stride(from: 1.0, to: 231.0, by: 17.0) {
            for y in stride(from: 1.0, to: 213.0, by: 13.0) {
                XCTAssertTrue(inside(hit(x, y)), "(\(x), \(y))")
            }
        }
        XCTAssertTrue(hit(12 + 100, 12 + 60) === picker.field)
        XCTAssertTrue(hit(12 + 100, 150 + 6) === picker.strip)
        XCTAssertTrue(hit(3, 3) === picker)
        XCTAssertTrue(hit(12 + 14, 174 + 14) === picker, "the preview takes no clicks, the panel does")
        XCTAssertTrue(hit(picker.applyButton.frame.midX, picker.applyButton.frame.midY) === picker.applyButton)
        // The thumbs are drawn over the field and never take a press away from it
        picker.pickInField(at: CGPoint(x: 100, y: 60))
        XCTAssertTrue(hit(12 + 100, 12 + 60) === picker.field)
        // Outside the panel nothing is hit
        XCTAssertNil(hit(-5, 20))
    }

    // MARK: Typing

    func testTypedDigitsSetTheColorExactlyWithOrWithoutTheHashAndInEitherCase() {
        let picker = opened()
        for (typed, hex) in [("ff6a3d", 0xff6a3d), ("#2E8B57", 0x2e8b57), ("#a1b2c3", 0xa1b2c3), ("A1B2C4", 0xa1b2c4)] {
            picker.typeDigits(typed)
            let expected = MarkColor(hex: hex)
            XCTAssertEqual(picker.color, expected, typed)
            let hsv = ColorMath.hsv(expected)
            XCTAssertEqual(picker.h, hsv.h, typed)
            XCTAssertEqual(picker.s, hsv.s, typed)
            XCTAssertEqual(picker.v, hsv.v, typed)
        }
    }

    func testTypedDigitsAreNotRewrittenFromTheColorButAreShownInUpperCase() {
        let picker = opened()
        picker.typeDigits("ff6a3d")
        XCTAssertEqual(picker.digitsText, "FF6A3D")
        picker.typeDigits("#2e8b57")
        // The # that was typed stays: the box is not redone from the color
        XCTAssertEqual(picker.digitsText, "#2E8B57")
        // Half-typed digits stay as they are and the color waits
        picker.typeDigits("ff6")
        XCTAssertEqual(picker.digitsText, "FF6")
        XCTAssertEqual(picker.color, MarkColor(hex: 0x2e8b57))
    }

    func testTheDigitsBoxTakesSevenCharactersAndNoSpaces() {
        let picker = opened()
        picker.typeDigits("#ff00cc00")
        XCTAssertEqual(picker.digitsText, "#FF00CC")
        XCTAssertEqual(picker.color, MarkColor(hex: 0xff00cc))
        // A pasted code often has spaces or a line break around it
        picker.typeDigits("  #00aa11 \n")
        XCTAssertEqual(picker.digitsText, "#00AA11")
        XCTAssertEqual(picker.color, MarkColor(hex: 0x00aa11))
        // Six digits and one more (no #): too many to be a color
        picker.typeDigits("123456a")
        XCTAssertEqual(picker.digitsText, "123456A")
        XCTAssertEqual(picker.color, MarkColor(hex: 0x00aa11))
    }

    func testATypedGrayOrBlackKeepsTheHueOnTheStrip() {
        let picker = opened(MarkColor(hex: 0xff6a3d))
        picker.pickInStrip(x: 150)
        let hue = picker.h
        XCTAssertGreaterThan(hue, 0)
        for (typed, expectedV) in [("808080", 128.0 / 255), ("000000", 0), ("ffffff", 1), ("#EEEEEE", 238.0 / 255)] {
            picker.typeDigits(typed)
            XCTAssertEqual(picker.h, hue, typed)
            XCTAssertEqual(picker.s, 0, typed)
            XCTAssertEqual(picker.v, expectedV, accuracy: 0.0001, typed)
            XCTAssertEqual(picker.color, ColorMath.parse(typed), typed)
            XCTAssertEqual(picker.hueThumbPoint.x, hue / 360 * 208, accuracy: 0.0001, typed)
        }
        // A color with a hue of its own moves the strip
        picker.typeDigits("00ff00")
        XCTAssertEqual(picker.h, 120)
    }

    func testDigitsThatAreNotAColorLeaveTheColorAlone() {
        let picker = opened()
        let before = (picker.color, picker.h, picker.s, picker.v)
        for typed in ["12345", "GGGGGG", "", "#", "12 3", "red", "#12345g", "1234567"] {
            picker.typeDigits(typed)
            XCTAssertEqual(picker.color, before.0, typed)
            XCTAssertEqual(picker.h, before.1, typed)
            XCTAssertEqual(picker.s, before.2, typed)
            XCTAssertEqual(picker.v, before.3, typed)
        }
    }

    func testPickingAfterTypingWritesTheDigitsAgain() {
        let picker = opened()
        picker.typeDigits("ff6")
        picker.pickInField(at: CGPoint(x: 0, y: 0))
        XCTAssertEqual(picker.digitsText, "FFFFFF")
        XCTAssertEqual(picker.editor.selectedRange(), NSRange(location: 0, length: 6))
    }

    // MARK: Return and Esc

    func testReturnAppliesTheTypedColorAndHidesThePanelFirst() {
        let picker = opened()
        var applied: [MarkColor] = []
        var closed = 0
        var hiddenInCallback = false
        picker.onApply = {
            applied.append($0)
            hiddenInCallback = picker.isHidden
        }
        picker.onClose = { closed += 1 }
        picker.typeDigits("#ff6a3d")
        XCTAssertTrue(picker.key(.enter))
        XCTAssertEqual(applied, [MarkColor(hex: 0xff6a3d)])
        XCTAssertEqual(closed, 0)
        XCTAssertTrue(hiddenInCallback)
        XCTAssertTrue(picker.isHidden)
    }

    func testReturnWithDigitsThatAreNotAColorAppliesThePickedColor() {
        let picker = opened()
        var applied: [MarkColor] = []
        picker.onApply = { applied.append($0) }
        picker.typeDigits("ff6")
        picker.key(.enter)
        XCTAssertEqual(applied, [teal])
        // A pick after typing wins over the typed digits
        picker.open(with: teal)
        picker.typeDigits("ff6a3d")
        picker.pickInField(at: CGPoint(x: 0, y: 0))
        picker.key(.enter)
        XCTAssertEqual(applied, [teal, MarkColor(hex: 0xffffff)])
    }

    func testTheOKButtonAppliesLikeReturn() {
        let picker = opened()
        var applied: [MarkColor] = []
        picker.onApply = { applied.append($0) }
        picker.typeDigits("2e8b57")
        picker.applyButton.click()
        XCTAssertEqual(applied, [MarkColor(hex: 0x2e8b57)])
        XCTAssertTrue(picker.isHidden)
        // Closed: a second click on the hidden panel's button, or Return, does nothing more
        picker.applyButton.click()
        XCTAssertFalse(picker.key(.enter))
        XCTAssertEqual(applied.count, 1)
    }

    func testEscClosesWithoutUsingTheColor() {
        let picker = opened()
        var applied = 0
        var closed = 0
        var hiddenInCallback = false
        picker.onApply = { _ in applied += 1 }
        picker.onClose = {
            closed += 1
            hiddenInCallback = picker.isHidden
        }
        picker.typeDigits("ff6a3d")
        XCTAssertTrue(picker.key(.escape))
        XCTAssertEqual(closed, 1)
        XCTAssertEqual(applied, 0)
        XCTAssertTrue(hiddenInCallback)
        XCTAssertTrue(picker.isHidden)
        // Not open any more: Esc is not the picker's
        XCTAssertFalse(picker.key(.escape))
        XCTAssertEqual(closed, 1)
    }

    func testOtherKeysAreLeftToTheDigitsBox() {
        let picker = opened()
        var calls = 0
        picker.onApply = { _ in calls += 1 }
        picker.onClose = { calls += 1 }
        for other in [OverlayKey.a, .c, .digit(1), .keypad(2), .left, .right, .up, .down, .period, .z] {
            XCTAssertFalse(picker.key(other), "\(other)")
        }
        XCTAssertEqual(calls, 0)
        XCTAssertFalse(picker.isHidden)
        XCTAssertEqual(picker.digitsText, "17A998")
    }

    func testReturnAndEscTypedInTheDigitsBoxReachThePickerBeforeAnythingIsTyped() {
        let picker = opened()
        var applied: [MarkColor] = []
        var closed = 0
        picker.onApply = { applied.append($0) }
        picker.onClose = { closed += 1 }
        picker.typeDigits("ff6a3d")
        // Return (and the keypad's Enter) are taken by the picker: no line break is typed
        picker.editor.keyDown(with: key(0x24, "\r"))
        XCTAssertEqual(applied, [MarkColor(hex: 0xff6a3d)])
        XCTAssertEqual(picker.digitsText, "FF6A3D")
        picker.open(with: teal)
        picker.editor.keyDown(with: key(0x4C, "\u{3}"))
        XCTAssertEqual(applied.count, 2)
        picker.open(with: teal)
        picker.editor.keyDown(with: key(0x35, "\u{1b}"))
        XCTAssertEqual(closed, 1)
        XCTAssertEqual(applied.count, 2)
    }

    func testTheTextViewsOwnReturnAndEscCommandsDoTheSame() {
        let picker = opened()
        var applied: [MarkColor] = []
        var closed = 0
        picker.onApply = { applied.append($0) }
        picker.onClose = { closed += 1 }
        picker.editor.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        XCTAssertEqual(applied, [teal])
        picker.open(with: teal)
        picker.editor.doCommand(by: #selector(NSResponder.cancelOperation(_:)))
        XCTAssertEqual(closed, 1)
        XCTAssertEqual(applied.count, 1)
    }

    func testFocusingTheDigitsWithoutAWindowDoesNothing() {
        let picker = opened()
        picker.focusDigits()
        XCTAssertEqual(picker.editor.selectedRange(), NSRange(location: 0, length: 6))
    }

    // MARK: Pointer

    func testThePointerShapeFollowsThePartUnderIt() {
        let picker = opened()
        XCTAssertEqual(picker.cursor(at: CGPoint(x: 100, y: 60)), .crosshair)
        XCTAssertEqual(picker.cursor(at: CGPoint(x: 100, y: 156)), .pointingHand)
        XCTAssertEqual(picker.cursor(at: CGPoint(x: picker.digitsBox.frame.midX, y: picker.digitsBox.frame.midY)), .iBeam)
        XCTAssertEqual(picker.cursor(at: CGPoint(x: 5, y: 5)), .arrow)
        XCTAssertEqual(picker.cursor(at: CGPoint(x: picker.applyButton.frame.midX, y: picker.applyButton.frame.midY)), .arrow)
    }

    // MARK: Pixels

    private func render(_ picker: OverlayColorPicker) throws -> NSBitmapImageRep {
        let rep = try XCTUnwrap(picker.bitmapImageRepForCachingDisplay(in: picker.bounds))
        picker.cacheDisplay(in: picker.bounds, to: rep)
        return rep
    }

    /// The pixel at a point of the panel is this color (sRGB). Compared in the bitmap's own color space, which on a Mac with no screen
    /// attached is narrower than sRGB. A saturated color that space cannot hold is mapped one way when drawn and another when converted,
    /// a few levels apart: such a color is compared more loosely (a hue strip drawn the wrong way round is still a hundred levels off)
    private func assertPixel(
        _ rep: NSBitmapImageRep, _ x: CGFloat, _ y: CGFloat, is color: MarkColor, _ what: String, accuracy: Int = 5,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let scale = CGFloat(rep.pixelsWide) / rep.size.width
        guard let got = rep.colorAt(x: Int(x * scale), y: Int(y * scale))?.usingColorSpace(rep.colorSpace),
            let want = color.nsColor.usingColorSpace(rep.colorSpace), let back = want.usingColorSpace(.sRGB)
        else { return XCTFail("\(what): no pixel", file: file, line: line) }
        func bytes(_ c: NSColor) -> [Int] { [c.redComponent, c.greenComponent, c.blueComponent].map { Int(($0 * 255).rounded()) } }
        // Held: inside the space, and back in sRGB it is the same color again
        let inside = bytes(want).allSatisfy { (0...255).contains($0) }
        let same = zip(bytes(back), [color.r, color.g, color.b]).allSatisfy { abs($0 - Int($1)) <= 1 }
        let within = inside && same ? accuracy : max(accuracy, 12)
        for (a, b) in zip(bytes(got), bytes(want)) {
            XCTAssertEqual(a, b, accuracy: within, "\(what): \(bytes(got)) vs \(bytes(want)) (\(color.hexText))", file: file, line: line)
        }
    }

    func testTheFieldAndTheStripAreDrawnAsTheyPick() throws {
        let picker = opened(MarkColor(hex: 0x00ff00))
        let rep = try render(picker)
        // Every spot of the field is the color a press there picks
        for (x, y) in [(6.0, 6.0), (100.0, 64.0), (200.0, 100.0), (50.0, 120.0), (150.0, 30.0)] {
            assertPixel(rep, 12 + x, 12 + y, is: ColorMath.fromHsv(120, x / 208, 1 - y / 128), "field (\(x), \(y))")
        }
        // The strip: the hue of the spot
        for x in [6.0, 52.0, 104.0, 156.0, 202.0] {
            assertPixel(rep, 12 + x, 156, is: ColorMath.fromHsv(x / 208 * 360, 1, 1), "strip \(x)")
        }
        // Another hue recolors the field
        picker.pickInStrip(x: 0)
        let red = try render(picker)
        assertPixel(red, 12 + 100, 12 + 64, is: ColorMath.fromHsv(0, 100.0 / 208, 1 - 64.0 / 128), "field at hue 0")
    }

    func testThePreviewShowsTheColorAndTheThumbsAreFilledWithTheColorUnderThem() throws {
        let picker = opened()
        let rep = try render(picker)
        let white = MarkColor(hex: 0xffffff)
        assertPixel(rep, 12 + 14, 174 + 14, is: teal, "preview")
        let field = CGPoint(x: 12 + picker.fieldThumbPoint.x, y: 12 + picker.fieldThumbPoint.y)
        assertPixel(rep, field.x, field.y, is: teal, "field thumb")
        assertPixel(rep, field.x + 6, field.y, is: white, "field thumb ring", accuracy: 8)
        let hue = CGPoint(x: 12 + picker.hueThumbPoint.x, y: 150 + picker.hueThumbPoint.y)
        assertPixel(rep, hue.x, hue.y, is: ColorMath.fromHsv(picker.h, 1, 1), "hue thumb")
        assertPixel(rep, hue.x + 6, hue.y, is: white, "hue thumb ring", accuracy: 8)
    }

    func testAThumbAtTheFieldsCornerIsNotClippedByTheFieldsRoundedCorner() throws {
        let picker = opened(MarkColor(hex: 0x00ff00))
        picker.pickInField(at: CGPoint(x: 0, y: 0))
        let rep = try render(picker)
        // The thumb is centered on the field's corner (12, 12): its ring left of the field, in the panel's padding, is still drawn
        assertPixel(rep, 12 - 6, 12, is: MarkColor(hex: 0xffffff), "ring outside the field", accuracy: 8)
        assertPixel(rep, 12, 12 - 6, is: MarkColor(hex: 0xffffff), "ring above the field", accuracy: 8)
    }
}

/// A host that is flipped, like the overlay (y down)
private final class FlippedHost: NSView {
    override var isFlipped: Bool { true }
}

import XCTest

@testable import SnipToss

/// Colors: #rrggbb text, the picker's HSV, and which colors get dark numbers (the same cases as ColorMathTests in the Windows shell)
final class ColorMathTests: SnipTestCase {
    func testParseAcceptsSixHexDigitsWithOrWithoutHash() {
        XCTAssertEqual(ColorMath.parse("#17a998"), MarkColor(hex: 0x17a998))
        XCTAssertEqual(ColorMath.parse("17A998"), MarkColor(hex: 0x17a998))
        XCTAssertEqual(ColorMath.parse("  #FFFFFF "), MarkColor(hex: 0xffffff))
        XCTAssertEqual(MarkColor(hex: 0x17a998).hexText, "#17a998")
    }

    func testParseRejectsAnythingElse() {
        for text in [nil, "", "#fff", "#12345g", "#1234567", "red", "＃１２３４５６"] {
            XCTAssertNil(ColorMath.parse(text), text ?? "nil")
        }
    }

    /// The picker shows a color as hue / saturation / value and hands back RGB: a color must come back exactly as it went in
    func testEveryColorSurvivesTheTripThroughHSV() {
        var seed: UInt64 = 7
        func next() -> UInt8 {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return UInt8(truncatingIfNeeded: seed >> 33)
        }
        for _ in 0..<2000 {
            let c = MarkColor(r: next(), g: next(), b: next())
            let (h, s, v) = ColorMath.hsv(c)
            XCTAssertEqual(ColorMath.fromHsv(h, s, v), c, c.hexText)
        }
        // The end of the hue strip is red again
        XCTAssertEqual(ColorMath.fromHsv(360, 1, 1), MarkColor(hex: 0xff0000))
        XCTAssertEqual(ColorMath.fromHsv(120, 1, 1), MarkColor(hex: 0x00ff00))
    }

    func testWhichColorsGetDarkNumbersIsTheSameAsInTheMainApp() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("tests/golden/light-colors.json"))
        let colors = try XCTUnwrap((try JSONSerialization.jsonObject(with: data) as? [String: Any])?["colors"] as? [String: Bool])
        XCTAssertFalse(colors.isEmpty)
        for (hex, light) in colors {
            XCTAssertEqual(ColorMath.isLight(try XCTUnwrap(ColorMath.parse(hex))), light, hex)
        }
    }
}

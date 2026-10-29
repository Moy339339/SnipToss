import XCTest

@testable import SnipToss

/// The position wording given to the AI: runs the same golden file as describeShape in the main app's core (tests/golden/where.zh-CN.json)
final class ShapeTextTests: XCTestCase {
    override func setUp() {
        super.setUp()
        ShellLocale.reset()
    }

    override func tearDown() {
        ShellLocale.reset()
        super.tearDown()
    }

    private func goldenURL() -> URL {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        return root.appendingPathComponent("tests/golden/where.zh-CN.json")
    }

    private struct UnknownShape: Error {
        let type: String
    }

    private func number(_ value: Any?) -> Double {
        (value as? NSNumber)?.doubleValue ?? 0
    }

    private func shapeOf(_ s: [String: Any]) throws -> ShapeText.Shape {
        switch s["type"] as? String {
        case "rect":
            return .region(x: number(s["x"]), y: number(s["y"]), w: number(s["w"]), h: number(s["h"]))
        case "point":
            return .spot(x: number(s["x"]), y: number(s["y"]))
        case "arrow":
            let from = s["from"] as? [Any] ?? []
            let to = s["to"] as? [Any] ?? []
            guard from.count == 2, to.count == 2 else { throw UnknownShape(type: "arrow without two ends") }
            return .arrow(fromX: number(from[0]), fromY: number(from[1]), toX: number(to[0]), toY: number(to[1]))
        case "path":
            let raw = s["points"] as? [[Any]] ?? []
            var points: [(x: Double, y: Double)] = []
            for p in raw where p.count == 2 { points.append((x: number(p[0]), y: number(p[1]))) }
            return .path(points)
        default:
            throw UnknownShape(type: String(describing: s["type"]))
        }
    }

    func testEveryGoldenCaseMatchesTheMainAppCharacterForCharacter() throws {
        try XCTSkipUnless(shellResourcesAvailable(), "the shell's resources are not built")
        ShellLocale.use(pref: "zh-CN", system: "en-US")
        let data = try Data(contentsOf: goldenURL())
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let name = c["name"] as? String ?? "?"
            let shape = try shapeOf(try XCTUnwrap(c["shape"] as? [String: Any], name))
            var size: PixelSize?
            if let z = c["size"] as? [String: Any] {
                size = (width: Int(number(z["width"])), height: Int(number(z["height"])))
            }
            let want = try XCTUnwrap(c["text"] as? String, name)
            XCTAssertEqual(ShapeText.describe(shape, size: size), want, name)
        }
    }

    func testCaptureOverlayMarksDescribeTheirPositionRelativeToTheSelectionWithPixelsInScreenshotSize() throws {
        try XCTSkipUnless(shellResourcesAvailable(), "the shell's resources are not built")
        ShellLocale.use(pref: "zh-CN", system: "en-US")
        // The selection starts at (100, 50) on the screen and is 400 × 200 points; on a 150% screen the screenshot is 600 × 300 pixels
        let sel = CGRect(x: 100, y: 50, width: 400, height: 200)
        let size: PixelSize = (width: 600, height: 300)
        let rect = Mark(kind: .rect, points: [CGPoint(x: 140, y: 70), CGPoint(x: 300, y: 90)])
        XCTAssertEqual(rect.whereText(sel: sel, size: size), "区域 画面左上（横 10%–50%、纵 10%–20%），x=60 y=30 宽=240 高=30 px")
        let pin = Mark(kind: .note, points: [CGPoint(x: 300, y: 150)])
        XCTAssertEqual(pin.whereText(sel: sel, size: size), "位置 画面中央（横 50%、纵 50%），x=300 y=150 px")
        let arrow = Mark(kind: .arrow, points: [CGPoint(x: 100, y: 250), CGPoint(x: 300, y: 150)])
        XCTAssertEqual(arrow.whereText(sel: sel, size: size), "箭头 从画面左下（横 0%、纵 100%）指向画面中央（横 50%、纵 50%），从 (0, 300) 到 (300, 150) px")
    }

    func testAPenStrokeAndPixelateAreDescribedByTheirBoundingBox() throws {
        try XCTSkipUnless(shellResourcesAvailable(), "the shell's resources are not built")
        ShellLocale.use(pref: "zh-CN", system: "en-US")
        let sel = CGRect(x: 0, y: 0, width: 1000, height: 500)
        let stroke = Mark(kind: .pen, points: [CGPoint(x: 100, y: 100), CGPoint(x: 300, y: 150), CGPoint(x: 200, y: 200)])
        let box = Mark(kind: .mosaic, points: [CGPoint(x: 100, y: 100), CGPoint(x: 300, y: 200)])
        XCTAssertEqual(stroke.whereText(sel: sel, size: (width: 1000, height: 500)), box.whereText(sel: sel, size: (width: 1000, height: 500)))
        XCTAssertTrue(
            stroke.whereText(sel: sel, size: (width: 1000, height: 500)).hasPrefix("画笔标记 画面左上（横 10%–30%、纵 20%–40%）"),
            stroke.whereText(sel: sel, size: (width: 1000, height: 500)))
    }

    func testWithoutTheResourcesTheWordingIsTheKeysSoNothingIsLostSilently() {
        let saved = getenv("SNIPTOSS_RESOURCES_DIR").map { String(cString: $0) }
        setenv("SNIPTOSS_RESOURCES_DIR", "/nonexistent-folder-for-test", 1)
        ShellLocale.reset()
        defer {
            if let saved { setenv("SNIPTOSS_RESOURCES_DIR", saved, 1) } else { unsetenv("SNIPTOSS_RESOURCES_DIR") }
            ShellLocale.reset()
        }
        XCTAssertEqual(ShapeText.describe(.spot(x: 0.5, y: 0.5), size: nil), "ai.where.point")
    }
}

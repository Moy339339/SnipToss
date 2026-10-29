import XCTest

@testable import SnipToss

final class ScrubTests: XCTestCase {
    private struct Golden: Decodable {
        struct Token: Decodable {
            let windows: String
            let mac: String
        }
        struct Case: Decodable {
            let name: String
            let home: String
            let user: String
            let text: String
            let expected: String
        }
        let homeToken: Token
        let cases: [Case]
    }

    /// The same cases the Windows shell runs (tests/golden/scrub.json), whatever path style each one uses
    func testGoldenCases() throws {
        // .../app-mac/Tests/SnipTossTests/ScrubTests.swift -> the repository root is four levels up
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("tests/golden/scrub.json"))
        let golden = try JSONDecoder().decode(Golden.self, from: data)
        XCTAssertFalse(golden.cases.isEmpty)
        for c in golden.cases {
            let expected = c.expected.replacingOccurrences(of: "{home}", with: golden.homeToken.mac)
            let actual = Scrub.text(c.text, home: c.home, user: c.user, homeToken: golden.homeToken.mac)
            XCTAssertEqual(actual, expected, c.name)
        }
    }

    func testDefaultsUseTheRealHomeFolder() {
        let home = NSHomeDirectory()
        XCTAssertEqual(Scrub.text("opened \(home)/Pictures/a.png"), "opened ~/Pictures/a.png")
    }
}

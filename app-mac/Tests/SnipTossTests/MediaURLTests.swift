import XCTest

@testable import SnipToss

/// The address the page uses for an item on disk: sniptoss://media/<absolute path>, with the path percent-encoded
final class MediaURLTests: XCTestCase {
    /// Names that are easy to mistake for URL syntax, or that are not ASCII
    private let samples = [
        "/Users/me/photo.png",
        "/Users/me/图 片/截图 1-2.png",
        "/a/what?.png",
        "/a/#1 best.png",
        "/a/100%.png",
        "/a/%41.png",
        "/a/c++/x+y.png",
        "/a/&=;,:@!$'()*[].png",
        "/a/emoji 😀.png",
        "/a/caf\u{E9}.png",
        "/a/cafe\u{301}.png",
        "/a/ spaced /x.png",
        "/a/quote\"s.png",
        "/a/back\\slash.png",
        "/a/tab\t.png",
        "/a/日本語/한국어/عربى.png",
    ]

    func testEveryPathComesBackExactlyAsItWentIn() throws {
        for path in samples {
            let text = MediaURL.string(for: path)
            let url = try XCTUnwrap(URL(string: text), path)
            let back = try XCTUnwrap(MediaURL.path(from: url), path)
            XCTAssertEqual(Array(back.unicodeScalars), Array(path.unicodeScalars), path)
        }
    }

    func testThePagesVersionSuffixIsNotPartOfThePath() throws {
        for path in samples {
            let url = try XCTUnwrap(URL(string: MediaURL.string(for: path) + "?v=1790843415500-3"), path)
            XCTAssertEqual(MediaURL.path(from: url).map { Array($0.unicodeScalars) }, Array(path.unicodeScalars), path)
        }
    }

    func testNothingInANameCanBeTakenForUrlSyntax() {
        for path in samples {
            let text = MediaURL.string(for: path)
            let rest = String(text.dropFirst("sniptoss://media".count))
            XCTAssertTrue(text.hasPrefix("sniptoss://media/"), path)
            XCTAssertTrue(rest.unicodeScalars.allSatisfy { $0.isASCII }, path)
            for mark in ["?", "#", " ", "\"", "\\", "+", "&", "'", "(", ")", "*", ",", ";", "=", ":", "@", "[", "]", "!", "$"] {
                XCTAssertFalse(rest.contains(mark), "\(mark) in \(text)")
            }
        }
    }

    func testExamples() {
        XCTAssertEqual(MediaURL.string(for: "/Users/me/a b.png"), "sniptoss://media/Users/me/a%20b.png")
        XCTAssertEqual(MediaURL.string(for: "/图.png"), "sniptoss://media/%E5%9B%BE.png")
        XCTAssertEqual(MediaURL.string(for: "/a?b#c%d+e.png"), "sniptoss://media/a%3Fb%23c%25d%2Be.png")
        XCTAssertEqual(MediaURL.string(for: "/a/b-c_d.e~f"), "sniptoss://media/a/b-c_d.e~f")
    }

    func testAPathWithoutALeadingSlashIsMadeAbsolute() {
        XCTAssertEqual(MediaURL.string(for: "a/b.png"), "sniptoss://media/a/b.png")
    }

    func testOnlyAddressesOnTheMediaHostAreMediaAddresses() throws {
        XCTAssertNil(MediaURL.path(from: try XCTUnwrap(URL(string: "sniptoss://app/index.html"))))
        XCTAssertNil(MediaURL.path(from: try XCTUnwrap(URL(string: "https://media/a.png"))))
        XCTAssertNil(MediaURL.path(from: try XCTUnwrap(URL(string: "sniptoss://media"))))
        XCTAssertEqual(MediaURL.path(from: try XCTUnwrap(URL(string: "sniptoss://MEDIA/a.png"))), "/a.png")
    }

    func testAnEncodedSlashIsDecodedLikeAnyOtherCharacterAndJudgedAfterwardsByTheAccessCheck() throws {
        let url = try XCTUnwrap(URL(string: "sniptoss://media/a/b%2Fc.png"))
        XCTAssertEqual(MediaURL.path(from: url), "/a/b/c.png")
    }

    func testTheHeadersAllowTheUIHostToReadItemsWithARangeRequest() {
        XCTAssertEqual(MediaURL.responseHeaders["Access-Control-Allow-Origin"], "*")
        XCTAssertEqual(MediaURL.responseHeaders["Access-Control-Allow-Headers"], "Range")
    }
}

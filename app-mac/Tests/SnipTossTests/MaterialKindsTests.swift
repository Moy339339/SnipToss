import XCTest

@testable import SnipToss

/// Which files are items, and which kind
final class MaterialKindsTests: XCTestCase {
    func testKindComesFromTheExtensionWithoutRegardToCase() {
        XCTAssertEqual(MaterialKinds.kindOf("/a/b.PNG"), "image")
        XCTAssertEqual(MaterialKinds.kindOf("/a/b.mkv"), "video")
        XCTAssertEqual(MaterialKinds.kindOf("c.Mov"), "video")
        XCTAssertNil(MaterialKinds.kindOf("/a/b.pdf"))
        XCTAssertNil(MaterialKinds.kindOf("/a/b.txt"))
        XCTAssertNil(MaterialKinds.kindOf("/a/png"))
        XCTAssertNil(MaterialKinds.kindOf("/a/b."))
    }

    func testEveryExtensionIsListedOnce() {
        XCTAssertEqual(Set(MaterialKinds.extensions).count, MaterialKinds.extensions.count)
        XCTAssertTrue(MaterialKinds.extensions.allSatisfy { $0.hasPrefix(".") && $0 == $0.lowercased() })
        XCTAssertFalse(MaterialKinds.extensions.contains(".pdf"))
        XCTAssertFalse(MaterialKinds.extensions.contains(".pptx"))
    }

    func testAFolderScanListsOnlyEnabledKindsAndTheLessCommonFormatsOnlyWithMoreFormats() {
        let defaults: Set<String> = ["image", "video"]
        XCTAssertEqual(MaterialKinds.listed("a.png", enabledKinds: defaults), "image")
        XCTAssertEqual(MaterialKinds.listed("a.mp4", enabledKinds: defaults), "video")
        XCTAssertNil(MaterialKinds.listed("a.heic", enabledKinds: defaults))
        XCTAssertNil(MaterialKinds.listed("a.mkv", enabledKinds: defaults))
        XCTAssertEqual(MaterialKinds.listed("a.heic", enabledKinds: defaults.union(["more"])), "image")
        XCTAssertEqual(MaterialKinds.listed("a.mkv", enabledKinds: defaults.union(["more"])), "video")
        // With videos turned off an MKV is no more listed than an MP4
        XCTAssertNil(MaterialKinds.listed("a.mp4", enabledKinds: ["image"]))
        XCTAssertNil(MaterialKinds.listed("a.mkv", enabledKinds: ["image", "more"]))
        XCTAssertNil(MaterialKinds.listed("a.txt", enabledKinds: defaults))
    }

    func testTheLessCommonFormatsAreAllKnownKinds() {
        for ext in MaterialKinds.more { XCTAssertTrue(MaterialKinds.extensions.contains(ext), ext) }
    }
}

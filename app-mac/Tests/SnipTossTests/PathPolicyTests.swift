import XCTest

@testable import SnipToss

/// The bridge only lets through the paths it should (docs/host-api.md, hard rules 1 and 2): sha256 and missing take library paths, notes
/// are reached only inside `.sniptoss/` of a notes folder. None of them may accept an arbitrary absolute path
final class PathPolicyTests: SnipTestCase {
    private let roots = ["/项目/素材", "/单个.png"]

    private func code(of error: Error) -> String? {
        (error as? BridgeError)?.code
    }

    // MARK: Library paths

    func testPathsInTheLibraryAndBelowThemAreAllowed() {
        for path in ["/项目/素材", "/项目/素材/", "/项目/素材/子/a.png", "/项目/素材/A.PNG", "/单个.png", "/项目/素材/../素材/a.png"] {
            XCTAssertTrue(PathPolicy.isUnder(path, roots: roots), path)
        }
    }

    func testPathsOutsideTheLibraryAreBlocked() {
        let blocked = [
            "/项目", "/项目/素材2/a.png", "/项目/素材/../别处/a.exe", "/etc/passwd", "/单个.png.exe", "", "/a\0b", "项目/素材/a.png", "素材/a.png",
        ]
        for path in blocked { XCTAssertFalse(PathPolicy.isUnder(path, roots: roots), path) }
    }

    func testRootsThatCannotBeNormalizedDoNotMakeAnythingPass() {
        XCTAssertFalse(PathPolicy.isUnder("/a/b.png", roots: ["", "/a\0b", "relative"]))
        XCTAssertTrue(PathPolicy.isUnder("/a/b.png", roots: ["", "/a"]))
    }

    func testTheNearestMatchingFolderKeyIsReported() {
        let keys: Set<String> = [Library.key("/a"), Library.key("/a/b")]
        XCTAssertEqual(PathPolicy.matchingKey(of: "/a/b/c.png", in: keys), Library.key("/a/b"))
        XCTAssertEqual(PathPolicy.matchingKey(of: "/a/x.png", in: keys), Library.key("/a"))
        XCTAssertNil(PathPolicy.matchingKey(of: "/c/x.png", in: keys))
    }

    // MARK: Inside .sniptoss/

    func testNotesInAFolderThatIsGoneAreRefusedAndTheFolderIsNotRecreated() {
        let gone = makeTempDir() + "/被移走的项目"
        XCTAssertThrowsError(try PathPolicy.inDataDir(home: gone, rel: ".sniptoss/annotations/a.json")) { error in
            XCTAssertEqual(code(of: error), "notFound")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: gone))
    }

    func testAFileInSniptossOfAnExistingNotesFolderIsAllowedWhetherOrNotItExists() throws {
        let home = makeTempDir()
        XCTAssertEqual(try PathPolicy.inDataDir(home: home, rel: ".sniptoss/annotations/a.json"), home + "/.sniptoss/annotations/a.json")
        XCTAssertEqual(try PathPolicy.inDataDir(home: home, rel: ".SNIPTOSS/./snapshots/x.png"), home + "/.SNIPTOSS/snapshots/x.png")
    }

    func testAnythingOutsideSniptossIsAlwaysRefused() {
        // A relative path from the page that climbs out, or points at the item itself, is refused
        let home = makeTempDir()
        for rel in ["annotations/../../别处.json", ".sniptoss/../素材.png", ".sniptoss2/a.json", "hero.png", ".sniptoss", ""] {
            XCTAssertThrowsError(try PathPolicy.inDataDir(home: home, rel: rel), rel) { error in
                XCTAssertEqual(code(of: error), "denied", rel)
            }
        }
    }

    func testAnAbsolutePathIsNotARelativePath() {
        let home = makeTempDir()
        XCTAssertThrowsError(try PathPolicy.inDataDir(home: home, rel: home + "/.sniptoss/a.json")) { error in
            XCTAssertNotNil(error as? BridgeError)
            XCTAssertNil(code(of: error))
        }
    }

    func testAPathWithANulCharacterIsInvalid() {
        let home = makeTempDir()
        XCTAssertThrowsError(try PathPolicy.inDataDir(home: home, rel: ".sniptoss/a\0b.json")) { error in
            XCTAssertNotNil(error as? BridgeError)
        }
    }

    func testAFolderUnderSniptossThatIsALinkIsRefusedAndNothingIsFollowedElsewhere() throws {
        let dir = makeTempDir()
        let elsewhere = dir + "/别处"
        let home = dir + "/项目"
        try FileManager.default.createDirectory(atPath: elsewhere, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: home + "/.sniptoss", withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: home + "/.sniptoss/annotations", withDestinationPath: elsewhere)
        XCTAssertThrowsError(try PathPolicy.inDataDir(home: home, rel: ".sniptoss/annotations/a.json")) { error in
            XCTAssertEqual(code(of: error), "denied")
        }
        XCTAssertEqual(names(in: elsewhere), [])
    }

    func testSniptossItselfBeingALinkIsRefused() throws {
        let dir = makeTempDir()
        let elsewhere = dir + "/别处"
        let home = dir + "/项目"
        try FileManager.default.createDirectory(atPath: elsewhere, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: home + "/.sniptoss", withDestinationPath: elsewhere)
        XCTAssertThrowsError(try PathPolicy.inDataDir(home: home, rel: ".sniptoss/a.json")) { error in
            XCTAssertEqual(code(of: error), "denied")
        }
    }

    func testAHomeThatIsItselfBehindALinkIsFine() throws {
        // Only links inside .sniptoss/ matter: the project folder may well be reached through one
        let dir = makeTempDir()
        try FileManager.default.createDirectory(atPath: dir + "/真", withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: dir + "/链", withDestinationPath: dir + "/真")
        XCTAssertEqual(try PathPolicy.inDataDir(home: dir + "/链", rel: ".sniptoss/a.json"), dir + "/链/.sniptoss/a.json")
    }

    // MARK: Notes folders handed out by scans

    func testOnlyNotesFoldersAScanHandedOutAreAccepted() throws {
        let homes = NotesHomes()
        XCTAssertThrowsError(try homes.require("/项目/甲")) { error in
            XCTAssertEqual(code(of: error), "denied")
        }
        homes.insert("/项目/甲")
        homes.insert("/项目//甲/")  // the same folder, spelled differently
        homes.insert("/项目/乙")
        XCTAssertEqual(homes.all, ["/项目/甲", "/项目/乙"])
        XCTAssertEqual(try homes.require("/项目/甲/./"), "/项目/甲")
        XCTAssertEqual(try homes.require("/项目/乙/子/.."), "/项目/乙")
        XCTAssertTrue(homes.contains("/项目/甲"))
        XCTAssertFalse(homes.contains("/项目"))
        XCTAssertFalse(homes.contains("/项目/甲/子"))
    }

    func testAMalformedHomeIsInvalidNotUnknown() {
        XCTAssertThrowsError(try NotesHomes().require("")) { error in
            XCTAssertNotNil(error as? BridgeError)
            XCTAssertNil(code(of: error))
        }
    }

    // MARK: Disk helpers

    func testLinksAreToldFromTheirTargets() throws {
        let dir = makeTempDir()
        writeText("x", to: dir + "/file.txt")
        try FileManager.default.createSymbolicLink(atPath: dir + "/link", withDestinationPath: dir + "/file.txt")
        XCTAssertTrue(PathPolicy.isSymbolicLink(dir + "/link"))
        XCTAssertFalse(PathPolicy.isSymbolicLink(dir + "/file.txt"))
        XCTAssertFalse(PathPolicy.isSymbolicLink(dir + "/none"))
        XCTAssertTrue(PathPolicy.isRegularFile(dir + "/link"), "followed")
        XCTAssertFalse(PathPolicy.isRegularFile(dir))
        XCTAssertEqual(PathPolicy.realPath(dir + "/link"), PathPolicy.realPath(dir + "/file.txt"))
        XCTAssertNil(PathPolicy.realPath(dir + "/none"))
    }
}

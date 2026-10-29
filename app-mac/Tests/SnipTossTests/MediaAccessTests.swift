import XCTest

@testable import SnipToss

/// What the page may read through sniptoss://media: the library's items and `.sniptoss/` of the notes folders a scan handed out, and
/// nothing else, even when it sits right next to an item
final class MediaAccessTests: SnipTestCase {
    /// The lists the resolver asks for, changeable during a test
    private final class Lists {
        var roots: [String]
        var homes: [String]

        init(roots: [String] = [], homes: [String] = []) {
            self.roots = roots
            self.homes = homes
        }

        func access() -> MediaAccess {
            MediaAccess(roots: { self.roots }, homes: { self.homes })
        }
    }

    private func request(_ path: String, suffix: String = "") -> URL {
        URL(string: MediaURL.string(for: path) + suffix)!
    }

    @discardableResult
    private func touch(_ path: String, _ text: String = "x") -> String {
        writeText(text, to: path)
        return path
    }

    private func link(_ path: String, to target: String) throws {
        try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: path, withDestinationPath: target)
    }

    // MARK: Library entries

    func testAFileEntryIsServedAndItsNeighbourIsNot() {
        let dir = makeTempDir()
        let entry = touch(dir + "/a.png")
        touch(dir + "/b.png")
        let access = Lists(roots: [entry]).access()
        XCTAssertEqual(access.resolve(request(entry))?.path, entry)
        XCTAssertNil(access.resolve(request(dir + "/b.png")))
    }

    func testFilesAtAnyDepthInAFolderEntryAreServedAlsoWithTheVersionSuffixThePageAdds() {
        let dir = makeTempDir()
        let file = touch(dir + "/项目/图/子/a.png")
        let access = Lists(roots: [dir + "/项目"]).access()
        XCTAssertEqual(access.resolve(request(file))?.path, file)
        XCTAssertEqual(access.resolve(request(file, suffix: "?v=1790843415500-1"))?.path, file)
    }

    func testNamesWithSpacesMarksAndNonAsciiCharactersAreServed() {
        let dir = makeTempDir()
        let names = ["图 片 #1?.png", "100%.png", "%41.png", "a+b.png", "e\u{301}.png", "日本語.png"]
        let files = names.map { touch(dir + "/项目/" + $0) }
        let access = Lists(roots: [dir + "/项目"]).access()
        for file in files { XCTAssertEqual(access.resolve(request(file))?.path, file, file) }
    }

    func testAFileOutsideTheLibraryIsRefusedEvenNextToAnItem() {
        let dir = makeTempDir()
        touch(dir + "/库/a.png")
        touch(dir + "/别处/x.png")
        touch(dir + "/库2/x.png")  // shares the name's prefix, not the folder
        let access = Lists(roots: [dir + "/库"]).access()
        XCTAssertNotNil(access.resolve(request(dir + "/库/a.png")))
        XCTAssertNil(access.resolve(request(dir + "/别处/x.png")))
        XCTAssertNil(access.resolve(request(dir + "/库2/x.png")))
        XCTAssertNil(access.resolve(request("/etc/hosts")))
    }

    func testAFolderAndAFileThatDoesNotExistAreNotServed() {
        let dir = makeTempDir()
        touch(dir + "/库/a.png")
        let access = Lists(roots: [dir + "/库"]).access()
        XCTAssertNil(access.resolve(request(dir + "/库")))
        XCTAssertNil(access.resolve(request(dir + "/库/none.png")))
    }

    func testClimbingOutWithDotDotIsRefused() {
        let dir = makeTempDir()
        touch(dir + "/库/a.png")
        touch(dir + "/别处/x.png")
        let access = Lists(roots: [dir + "/库"]).access()
        XCTAssertNil(access.resolve(request(dir + "/库/../别处/x.png")))
        XCTAssertNil(access.resolve(request(dir + "/库/../../../../../../etc/hosts")))
        XCTAssertNil(access.resolve(request("/..")))
    }

    func testANulCharacterInTheAddressIsRefused() {
        let dir = makeTempDir()
        touch(dir + "/库/a.png")
        let access = Lists(roots: [dir + "/库"]).access()
        if let url = URL(string: MediaURL.string(for: dir + "/库/a") + "%00.png") {
            XCTAssertNil(access.resolve(url))
        }
    }

    func testAnAddressOnAnotherHostIsNotAMediaRequest() throws {
        let dir = makeTempDir()
        let file = touch(dir + "/库/a.png")
        let access = Lists(roots: [dir + "/库"]).access()
        let onUI = try XCTUnwrap(URL(string: MediaURL.string(for: file).replacingOccurrences(of: "://media/", with: "://app/")))
        XCTAssertNil(access.resolve(onUI))
        XCTAssertNil(access.resolve(URL(fileURLWithPath: file)))
    }

    // MARK: Links

    func testALinkInsideAFolderEntryThatPointsOutsideIsRefused() throws {
        let dir = makeTempDir()
        touch(dir + "/别处/secret.png")
        try link(dir + "/库/link.png", to: dir + "/别处/secret.png")
        try link(dir + "/库/folder", to: dir + "/别处")
        let access = Lists(roots: [dir + "/库"]).access()
        XCTAssertNil(access.resolve(request(dir + "/库/link.png")))
        XCTAssertNil(access.resolve(request(dir + "/库/folder/secret.png")))
    }

    func testALinkThatPointsAtAnotherFileInsideTheEntryIsServedUnderTheNameItWasAskedFor() throws {
        let dir = makeTempDir()
        touch(dir + "/库/real.mp4")
        try link(dir + "/库/alias.mp4", to: dir + "/库/real.mp4")
        let access = Lists(roots: [dir + "/库"]).access()
        XCTAssertEqual(access.resolve(request(dir + "/库/alias.mp4"))?.path, dir + "/库/alias.mp4")
    }

    func testALibraryEntryThatIsItselfALinkIsServed() throws {
        let dir = makeTempDir()
        touch(dir + "/真/a.png")
        try link(dir + "/入口", to: dir + "/真")
        let access = Lists(roots: [dir + "/入口"]).access()
        XCTAssertNotNil(access.resolve(request(dir + "/入口/a.png")))
        // The entry is the link: the real folder's other names are not part of the library
        XCTAssertNil(access.resolve(request(dir + "/真/a.png")))
    }

    func testAFileEntryThatIsALinkIsServedButNotItsTarget() throws {
        let dir = makeTempDir()
        touch(dir + "/真.png")
        try link(dir + "/入口.png", to: dir + "/真.png")
        let access = Lists(roots: [dir + "/入口.png"]).access()
        XCTAssertNotNil(access.resolve(request(dir + "/入口.png")))
        XCTAssertNil(access.resolve(request(dir + "/真.png")))
    }

    // MARK: Notes folders

    func testSniptossOfAHandedOutNotesFolderIsServedAndNothingElseInIt() {
        let dir = makeTempDir()
        let home = dir + "/项目"
        let snapshot = touch(home + "/.sniptoss/snapshots/a.png")
        touch(home + "/hero.png")
        touch(home + "/.sniptoss2/x.png")
        let access = Lists(homes: [home]).access()
        XCTAssertEqual(access.resolve(request(snapshot))?.path, snapshot)
        XCTAssertNil(access.resolve(request(home + "/hero.png")), "the item is served only when it is in the library")
        XCTAssertNil(access.resolve(request(home + "/.sniptoss2/x.png")))
    }

    func testSniptossOfAFolderNoScanHandedOutIsNotServed() {
        let dir = makeTempDir()
        let snapshot = touch(dir + "/别人的项目/.sniptoss/snapshots/a.png")
        let access = Lists(homes: [dir + "/项目"]).access()
        XCTAssertNil(access.resolve(request(snapshot)))
    }

    func testSniptossBeingALinkLeadsNowhere() throws {
        let dir = makeTempDir()
        let home = dir + "/项目"
        touch(dir + "/别处/x.png")
        try link(home + "/.sniptoss", to: dir + "/别处")
        let access = Lists(homes: [home]).access()
        XCTAssertNil(access.resolve(request(home + "/.sniptoss/x.png")))
    }

    func testAFolderInTheLibraryAndItsSniptossAreBothReachable() {
        let dir = makeTempDir()
        let item = touch(dir + "/项目/a.png")
        let snapshot = touch(dir + "/项目/.sniptoss/snapshots/a.png")
        let access = Lists(roots: [dir + "/项目"], homes: [dir + "/项目"]).access()
        XCTAssertNotNil(access.resolve(request(item)))
        XCTAssertNotNil(access.resolve(request(snapshot)))
    }

    // MARK: Changes while running, volumes

    func testEntriesAndNotesFoldersAddedLaterAreSeenWithoutBuildingANewResolver() {
        let dir = makeTempDir()
        let lists = Lists()
        let access = lists.access()
        let file = touch(dir + "/库/a.png")
        XCTAssertNil(access.resolve(request(file)))
        lists.roots = [dir + "/库"]
        XCTAssertNotNil(access.resolve(request(file)))
        lists.roots = []
        XCTAssertNil(access.resolve(request(file)), "removed from the library")
        let snapshot = touch(dir + "/库/.sniptoss/s.png")
        XCTAssertNil(access.resolve(request(snapshot)))
        lists.homes = [dir + "/库"]
        XCTAssertNotNil(access.resolve(request(snapshot)))
    }

    func testAnItemOnAVolumeThatIsNotThereIsRefusedWithoutWaiting() {
        let absent = "/Volumes/SnipTossAbsent-" + UUID().uuidString
        let access = Lists(roots: [absent]).access()
        let started = Date()
        XCTAssertNil(access.resolve(request(absent + "/a.png")))
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    // MARK: One scheme, two hosts

    func testTheSchemeServesTheUIOnTheAppHostAndItemsOnTheMediaHostAndNothingElse() throws {
        let ui = URL(fileURLWithPath: "/ui/index.html")
        let item = URL(fileURLWithPath: "/items/a.png")
        let resolver = hostResolver(ui: { _ in ui }, media: { _ in item })
        let onApp = try XCTUnwrap(URL(string: "sniptoss://app/index.html"))
        let onMedia = try XCTUnwrap(URL(string: "sniptoss://media/items/a.png"))
        let onMediaUpper = try XCTUnwrap(URL(string: "sniptoss://MEDIA/items/a.png"))
        let onOther = try XCTUnwrap(URL(string: "sniptoss://other/x"))
        let withoutHost = try XCTUnwrap(URL(string: "sniptoss:///x"))
        XCTAssertEqual(resolver(onApp), ui)
        XCTAssertEqual(resolver(onMedia), item)
        XCTAssertEqual(resolver(onMediaUpper), item)
        XCTAssertNil(resolver(onOther))
        XCTAssertNil(resolver(withoutHost))
        XCTAssertNil(resolver(URL(fileURLWithPath: "/x")))
    }
}

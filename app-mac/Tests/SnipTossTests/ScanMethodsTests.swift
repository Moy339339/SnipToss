import CryptoKit
import XCTest

@testable import SnipToss

/// The replies of `scan`, `missing`, `sha256` and `fileUrl` (the bridge methods themselves only unpack their parameters)
final class ScanMethodsTests: SnipTestCase {
    private let kinds: Set<String> = ["image", "video"]
    private let skipDirs = Set(MaterialKinds.defaultSkipDirs)

    @discardableResult
    private func touch(_ path: String, _ text: String = "abc") -> String {
        writeText(text, to: path)
        return path
    }

    private func scan(
        _ library: [String], _ raw: [String]? = nil, homes: NotesHomes = NotesHomes(), kinds: Set<String>? = nil,
        limit: Int = MaterialScanner.limit
    ) -> [[String: Any]] {
        scanEntries(raw ?? library, library: library, kinds: kinds ?? self.kinds, skipDirs: skipDirs, homes: homes, limit: limit)
    }

    private func materials(of result: [String: Any]) -> [[String: Any]] {
        (result["materials"] as? [[String: Any]]) ?? []
    }

    private func material(_ result: [String: Any], rel: String) -> [String: Any]? {
        materials(of: result).first { ($0["rel"] as? String) == rel }
    }

    // MARK: scan

    func testAFolderEntryListsItsItemsWithRelativePathsNotesFoldersAndMediaAddresses() throws {
        let dir = makeTempDir()
        let root = dir + "/项目"
        let image = touch(root + "/图/a.png")
        touch(root + "/片子/b.mp4")
        touch(root + "/根.png")
        let homes = NotesHomes()

        let results = scan([root], homes: homes)

        XCTAssertTrue(JSONSerialization.isValidJSONObject(results), "the reply can be sent to the page")
        let result = try XCTUnwrap(results.first)
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(result["entry"] as? String, root)
        XCTAssertEqual(result["kind"] as? String, "folder")
        XCTAssertEqual(result["project"] as? String, root, "with no .sniptoss yet the folder entry keeps the notes")
        XCTAssertEqual(materials(of: result).count, 3)
        let item = try XCTUnwrap(material(result, rel: "图/a.png"))
        XCTAssertEqual(item["path"] as? String, image)
        XCTAssertEqual(item["kind"] as? String, "image")
        XCTAssertEqual(item["size"] as? Int64, 3)
        XCTAssertEqual(item["home"] as? String, root)
        XCTAssertEqual(item["homeRel"] as? String, "图/a.png")
        XCTAssertEqual(item["url"] as? String, MediaURL.string(for: image))
        XCTAssertGreaterThan(try XCTUnwrap(item["mtime"] as? Int64), 0)
        XCTAssertNotNil(item["ctime"] as? Int64)
        XCTAssertEqual(material(result, rel: "根.png")?["homeRel"] as? String, "根.png")
        XCTAssertTrue(result["truncatedAt"] is NSNull)
        XCTAssertTrue(result["others"] is NSNull)
        XCTAssertTrue(result["moreOff"] is NSNull)
        XCTAssertTrue(result["skippedDirs"] is NSNull)
        XCTAssertTrue(result["keptHome"] is NSNull)
        XCTAssertEqual(homes.all, [root], "the notes folder was handed out")
    }

    func testANotesFolderAboveTheEntryIsTheNotesFolderOfItsItems() throws {
        let dir = makeTempDir()
        try FileManager.default.createDirectory(atPath: dir + "/.sniptoss", withIntermediateDirectories: true)
        touch(dir + "/项目/子/x.png")
        let results = scan([dir + "/项目/子"])
        let result = try XCTUnwrap(results.first)
        XCTAssertEqual(result["project"] as? String, dir)
        let item = try XCTUnwrap(material(result, rel: "x.png"))
        XCTAssertEqual(item["home"] as? String, dir)
        XCTAssertEqual(item["homeRel"] as? String, "项目/子/x.png")
    }

    func testASingleFileEntryIsItselfAndItsOwnFolderHoldsTheNotes() throws {
        let dir = makeTempDir()
        let file = touch(dir + "/封面.png")
        let result = try XCTUnwrap(scan([file]).first)
        XCTAssertEqual(result["kind"] as? String, "file")
        XCTAssertEqual(result["project"] as? String, dir)
        let item = try XCTUnwrap(material(result, rel: "封面.png"))
        XCTAssertEqual(item["path"] as? String, file)
        XCTAssertEqual(item["home"] as? String, dir)
        XCTAssertEqual(item["homeRel"] as? String, "封面.png")
    }

    func testEntriesNotInTheLibraryAreIgnored() {
        let dir = makeTempDir()
        let listed = touch(dir + "/库/a.png")
        let stranger = touch(dir + "/别处/b.png")
        XCTAssertTrue(scan([listed], [stranger]).isEmpty)
        XCTAssertEqual(scan([listed], [stranger, listed + "/"]).count, 1, "an entry is found by its normalized path")
    }

    func testAMissingEntryKeepsTheNotesFolderOfItsProjectWhenThereIsOne() throws {
        let dir = makeTempDir()
        let gone = dir + "/项目/没了.png"
        try FileManager.default.createDirectory(atPath: dir + "/项目/.sniptoss", withIntermediateDirectories: true)
        let homes = NotesHomes()
        let result = try XCTUnwrap(scan([gone], homes: homes).first)
        XCTAssertEqual(result["kind"] as? String, "missing")
        XCTAssertEqual(result["keptHome"] as? String, dir + "/项目")
        XCTAssertEqual(result["project"] as? String, dir + "/项目")
        XCTAssertTrue(materials(of: result).isEmpty)
        XCTAssertEqual(homes.all, [dir + "/项目"])
    }

    func testAMissingEntryWithoutNotesIsGroupedUnderTheFolderItWasIn() throws {
        let dir = makeTempDir()
        let result = try XCTUnwrap(scan([dir + "/项目/没了.png"]).first)
        XCTAssertEqual(result["kind"] as? String, "missing")
        XCTAssertTrue(result["keptHome"] is NSNull)
        XCTAssertEqual(result["project"] as? String, dir + "/项目")
    }

    func testAnEntryOnAVolumeThatIsNotThereIsMissingAndIsNotLookedAt() throws {
        let volume = "/Volumes/SnipTossAbsent-" + UUID().uuidString
        let result = try XCTUnwrap(scan([volume + "/项目"]).first)
        XCTAssertEqual(result["kind"] as? String, "missing")
        XCTAssertEqual(result["project"] as? String, volume)
        XCTAssertTrue(result["keptHome"] is NSNull)
    }

    func testTheReplyNotesWhatTheScanLeftOut() throws {
        let dir = makeTempDir()
        let root = dir + "/项目"
        touch(root + "/a.png")
        touch(root + "/设计/封面.psd")
        touch(root + "/d.heic")
        touch(root + "/dist/x.png")
        touch(root + "/node_modules/y.png")
        let result = try XCTUnwrap(scan([root]).first)
        XCTAssertEqual(materials(of: result).count, 1)
        let others = try XCTUnwrap(result["others"] as? [String: Any])
        XCTAssertEqual(others["count"] as? Int, 1)
        XCTAssertEqual(others["exts"] as? [String], ["psd"])
        let moreOff = try XCTUnwrap(result["moreOff"] as? [String: Any])
        XCTAssertEqual(moreOff["count"] as? Int, 1)
        XCTAssertEqual(moreOff["exts"] as? [String], ["heic"])
        XCTAssertEqual(result["skippedDirs"] as? [String], ["dist", "node_modules"])
        // With More formats on, the HEIC is listed instead
        let more = try XCTUnwrap(scan([root], kinds: kinds.union([MaterialKinds.moreKind])).first)
        XCTAssertEqual(materials(of: more).count, 2)
        XCTAssertTrue(more["moreOff"] is NSNull)
    }

    func testTruncatedAtIsGivenOnlyWhenItemsWereLeftOut() throws {
        let dir = makeTempDir()
        for i in 0..<3 { touch(dir + "/库/\(i).png") }
        let cut = try XCTUnwrap(scan([dir + "/库"], limit: 2).first)
        XCTAssertEqual(cut["truncatedAt"] as? Int, 2)
        XCTAssertEqual(materials(of: cut).count, 2)
        let exact = try XCTUnwrap(scan([dir + "/库"], limit: 3).first)
        XCTAssertTrue(exact["truncatedAt"] is NSNull)
    }

    func testAnEntryAddedOnItsOwnInsideAFolderEntryKeepsItsNotesWithTheOuterFolder() throws {
        // dist is skipped by the folder's scan, so the file was added on its own; its notes still go with the folder
        let dir = makeTempDir()
        let root = dir + "/项目"
        let built = touch(root + "/dist/out.png")
        let result = try XCTUnwrap(scan([root, built], [built]).first)
        XCTAssertEqual(result["kind"] as? String, "file")
        XCTAssertEqual(result["project"] as? String, root)
        XCTAssertEqual(material(result, rel: "out.png")?["home"] as? String, root)
    }

    func testSeveralEntriesAreAnsweredInTheOrderAsked() {
        let dir = makeTempDir()
        let first = touch(dir + "/甲/a.png")
        let second = touch(dir + "/乙/b.png")
        let results = scan([first, second], [second, first])
        XCTAssertEqual(results.map { $0["entry"] as? String }, [second, first])
    }

    // MARK: missing

    func testMissingNamesTheLibraryAndNotesFolderPathsThatNoLongerExist() {
        let dir = makeTempDir()
        let here = touch(dir + "/项目/a.png")
        let gone = dir + "/项目/b.png"
        let home = dir + "/项目"
        let note = home + "/.sniptoss/annotations/x.json"
        let volume = "/Volumes/SnipTossAbsent-" + UUID().uuidString + "/c.png"
        let stranger = dir + "/别处/d.png"
        let library = [dir + "/项目", volume]

        let asked = [here, gone, note, volume, stranger, "/etc/hosts-not-here", "relative.png"]
        XCTAssertEqual(missingPaths(asked, library: library, homes: [home]), [gone, note, volume])
        XCTAssertEqual(missingPaths([here], library: library, homes: []), [])
        XCTAssertEqual(missingPaths([], library: library, homes: [home]), [])
    }

    // MARK: sha256

    func testTheHashOfALibraryItemIsReturnedAndOthersAreRefused() throws {
        let dir = makeTempDir()
        let item = touch(dir + "/库/a.png", "hello")
        let outside = touch(dir + "/别处/b.png", "secret")
        let cache = HashCache(location: dir + "/cache/sha256.json")
        let hello = SHA256.hash(data: Data("hello".utf8)).map { String(format: "%02x", $0) }.joined()

        XCTAssertEqual(try hashOfLibraryItem(item, library: [dir + "/库"], cache: cache), hello)
        XCTAssertEqual(try hashOfLibraryItem(dir + "/库/./a.png", library: [dir + "/库"], cache: cache), hello)
        for path in [outside, dir + "/库/../别处/b.png", "a.png", ""] {
            XCTAssertThrowsError(try hashOfLibraryItem(path, library: [dir + "/库"], cache: cache), path) { error in
                XCTAssertEqual((error as? BridgeError)?.code, "denied", path)
            }
        }
    }

    func testTheHashOfAnItemThatIsGoneOrOnAVolumeThatIsNotThereIsNotFound() {
        let dir = makeTempDir()
        let cache = HashCache(location: dir + "/cache/sha256.json")
        let volume = "/Volumes/SnipTossAbsent-" + UUID().uuidString
        for path in [dir + "/库/none.png", volume + "/a.png"] {
            XCTAssertThrowsError(try hashOfLibraryItem(path, library: [dir + "/库", volume], cache: cache), path) { error in
                XCTAssertEqual((error as? BridgeError)?.code, "notFound", path)
            }
        }
    }

    // MARK: fileUrl

    func testTheAddressOfANotesFileIsGivenOnlyInsideSniptossOfAHandedOutFolder() throws {
        let dir = makeTempDir()
        let home = dir + "/项目"
        try FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true)
        let homes = NotesHomes()
        homes.insert(home)

        let url = try notesFileUrl(home: home + "/./", rel: ".sniptoss/snapshots/a b.png", homes: homes)
        XCTAssertEqual(url, MediaURL.string(for: home + "/.sniptoss/snapshots/a b.png"))
        XCTAssertTrue(url.hasSuffix("/.sniptoss/snapshots/a%20b.png"))

        XCTAssertThrowsError(try notesFileUrl(home: dir + "/别人", rel: ".sniptoss/a.png", homes: homes)) { error in
            XCTAssertEqual((error as? BridgeError)?.code, "denied")
        }
        XCTAssertThrowsError(try notesFileUrl(home: home, rel: "a.png", homes: homes)) { error in
            XCTAssertEqual((error as? BridgeError)?.code, "denied")
        }
        XCTAssertThrowsError(try notesFileUrl(home: home, rel: ".sniptoss/../a.png", homes: homes))
    }

    func testWhatFileUrlHandsOutIsWhatTheMediaHostServes() throws {
        let dir = makeTempDir()
        let home = dir + "/项目"
        let snapshot = touch(home + "/.sniptoss/snapshots/a.png")
        let homes = NotesHomes()
        homes.insert(home)
        let access = MediaAccess(roots: { [] }, homes: { homes.all })
        let address = try notesFileUrl(home: home, rel: ".sniptoss/snapshots/a.png", homes: homes)
        let url = try XCTUnwrap(URL(string: address))
        XCTAssertEqual(access.resolve(url)?.path, snapshot)
    }

    func testWhatScanHandsOutIsWhatTheMediaHostServes() throws {
        let dir = makeTempDir()
        let library = [dir + "/项目"]
        touch(library[0] + "/图 片/a.png")
        let access = MediaAccess(roots: { library }, homes: { [] })
        let result = try XCTUnwrap(scan(library).first)
        let item = try XCTUnwrap(materials(of: result).first)
        let address = try XCTUnwrap(item["url"] as? String)
        let url = try XCTUnwrap(URL(string: address + "?v=1-3"))
        XCTAssertEqual(access.resolve(url)?.path, item["path"] as? String)
    }
}

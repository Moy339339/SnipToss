import XCTest

@testable import SnipToss

/// Where one item's notes are stored (HomeFinder): look upward for an existing .sniptoss, otherwise work it out from the entry;
/// compute only, never create
final class HomeFinderTests: SnipTestCase {
    private func make(_ root: String, _ rel: String) -> String {
        let full = root + "/" + rel
        try! FileManager.default.createDirectory(atPath: (full as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: full, contents: Data([1]))
        return full
    }

    private func makeDir(_ path: String) {
        try! FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
    }

    func testSearchingUpwardTheNearestNotesFolderWinsAndBothCurrentAndLegacyNamesAreRecognised() {
        let root = makeTempDir()
        makeDir(root + "/" + DataDir.name)
        makeDir(root + "/a/" + DataDir.legacyName)
        let deep = make(root, "a/b/x.png")
        let shallow = make(root, "c/y.png")
        let finder = HomeFinder()
        XCTAssertEqual(finder.find(file: deep, folderEntry: root), root + "/a")
        XCTAssertEqual(finder.find(file: shallow, folderEntry: nil), root)
    }

    func testWithNoNotesFolderYetItemsInAFolderEntryUseTheEntryAndSingleFilesUseTheirFolderComputingOnly() {
        let root = makeTempDir()
        let file = make(root, "项目/图/x.png")
        let entry = root + "/项目"
        let finder = HomeFinder()
        XCTAssertEqual(finder.find(file: file, folderEntry: entry), entry)
        XCTAssertEqual(finder.find(file: file, folderEntry: nil), (file as NSString).deletingLastPathComponent)
        XCTAssertEqual(finder.folderHome(of: entry + "/图", outer: entry), entry)
        let created = FileManager.default.enumerator(atPath: root)?.allObjects.compactMap { $0 as? String }.filter { $0.hasSuffix(DataDir.name) }
        XCTAssertEqual(created ?? [], [], "nothing is created")
    }

    func testAFolderEntryItselfUsesANotesFolderInsideOrAboveIt() {
        let root = makeTempDir()
        let sub = root + "/项目/子"
        makeDir(sub + "/" + DataDir.name)
        XCTAssertEqual(HomeFinder().folderHome(of: sub, outer: root + "/项目"), sub)
        // Above: the folder entry is inside a project that has notes
        let inner = root + "/项目/子/更深"
        makeDir(inner)
        XCTAssertEqual(HomeFinder().folderHome(of: inner, outer: root + "/项目"), sub)
    }

    func testAnEntryThatCanNoLongerBeFoundStillResolvesToItsNotesFolderIfTheProjectsNotesFolderExists() {
        let root = makeTempDir()
        makeDir(root + "/" + DataDir.name)
        let finder = HomeFinder()
        XCTAssertEqual(finder.existingHome(of: root + "/挪走了/01.png"), root)
        let nowhere = "/snip-tests-no-such-place-" + UUID().uuidString + "/x.png"
        XCTAssertNil(HomeFinder().existingHome(of: nowhere))
    }

    func testNotesFolderOfADifferentSpellingOfTheSameFolderIsFoundOnce() {
        let root = makeTempDir()
        makeDir(root + "/" + DataDir.name)
        let finder = HomeFinder()
        XCTAssertEqual(finder.find(file: root + "/a.png", folderEntry: nil), root)
        // The answer for a folder is remembered: asking again, in any spelling of its name that compares equal, gives the same one
        XCTAssertEqual(finder.find(file: root.uppercased() + "/b.png", folderEntry: nil), root)
    }
}

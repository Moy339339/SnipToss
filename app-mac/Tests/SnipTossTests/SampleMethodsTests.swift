import XCTest

@testable import SnipToss

/// `addSample`: the tutorial's picture copied into the app's Sample folder, added to the library and located, on a clean picture each time
final class SampleMethodsTests: SnipTestCase {
    /// A UI folder with the picture in `sample/`, and an empty app folder
    private func makeSample(picture: String = "jpeg bytes") -> (settings: Settings, ui: URL, source: String, dir: String) {
        let root = makeTempDir()
        let ui = root + "/ui"
        try? FileManager.default.createDirectory(atPath: ui + "/sample", withIntermediateDirectories: true)
        writeText(picture, to: ui + "/sample/" + Sample.fileName)
        let settings = Settings.load(from: root + "/settings.json")
        let url = URL(fileURLWithPath: ui, isDirectory: true)
        return (settings, url, Sample.source(ui: url) ?? "", root + "/data/sample")
    }

    func testThePictureIsCopiedAddedAndLocated() throws {
        let s = makeSample()
        XCTAssertEqual(s.source, s.ui.path + "/sample/landing-page.jpg")
        let reply = try Sample.add(settings: s.settings, dir: s.dir, source: s.source)
        let file = s.dir + "/landing-page.jpg"
        XCTAssertEqual(try String(contentsOfFile: file, encoding: .utf8), "jpeg bytes")
        XCTAssertEqual(reply["focus"] as? String, file)
        let listed = s.settings.library.map { $0.path }
        XCTAssertEqual(listed.count, 1, "the folder is one project in the library")
        XCTAssertTrue(listed[0].hasSuffix("/data/sample"), listed[0])
        XCTAssertEqual(reply["added"] as? [String], listed)
    }

    /// The tutorial starts on a clean picture: last time's notes go, the picture already there is not copied again, and the folder already
    /// in the library still lands on the picture
    func testAgainTheNotesFromLastTimeAreClearedAndThePictureIsKept() throws {
        let s = makeSample()
        _ = try Sample.add(settings: s.settings, dir: s.dir, source: s.source)
        let notes = s.dir + "/" + DataDir.name
        try FileManager.default.createDirectory(atPath: notes + "/snapshots", withIntermediateDirectories: true)
        writeText("{}", to: notes + "/annotations.json")
        writeText("kept", to: s.dir + "/landing-page.jpg")

        let reply = try Sample.add(settings: s.settings, dir: s.dir, source: s.source)
        XCTAssertFalse(FileManager.default.fileExists(atPath: notes))
        XCTAssertEqual(try String(contentsOfFile: s.dir + "/landing-page.jpg", encoding: .utf8), "kept")
        XCTAssertEqual(reply["focus"] as? String, s.dir + "/landing-page.jpg")
        XCTAssertEqual(reply["added"] as? [String], [])
        XCTAssertEqual(s.settings.library.count, 1)
    }

    /// Without the picture in the UI folder there is no source: `appInfo` gives no `sampleDir`, and the UI offers no tutorial on a sample
    func testWithoutThePictureInTheUIThereIsNoSample() {
        let ui = URL(fileURLWithPath: makeTempDir(), isDirectory: true)
        XCTAssertNil(Sample.source(ui: ui))
        XCTAssertNil(Sample.source(ui: nil))
    }

    func testTheSampleFolderIsTheAppsOwn() {
        XCTAssertEqual(AppPaths.sampleDir, AppPaths.localDir + "/sample")
    }
}

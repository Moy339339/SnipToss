import AppKit
import XCTest

@testable import SnipToss

/// `pasteClipboard`: files copied in the file manager, an image, or neither. The clipboard is a stand-in; the system's is never touched
final class ClipboardMethodsTests: SnipTestCase {
    private struct FakeClipboard: ClipboardReading {
        var files: [String] = []
        var png: Data?

        func filePaths() -> [String] { files }
        func pngData() -> Data? { png }
    }

    private let utc = TimeZone(identifier: "UTC")!
    /// 1971-01-01 13:05:09 UTC
    private let moment = Date(timeIntervalSince1970: 31_583_109)
    private let pngBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])

    private struct Project {
        let settings: Settings
        let dir: String
        let pastedDir: String
    }

    private func makeProject() -> Project {
        let dir = makeTempDir()
        return Project(settings: Settings.load(from: dir + "/settings.json"), dir: dir, pastedDir: dir + "/Pasted Images")
    }

    private func paste(_ p: Project, _ clipboard: FakeClipboard, at date: Date? = nil) throws -> [String: Any] {
        try pasteReply(settings: p.settings, clipboard: clipboard, pastedDir: p.pastedDir, now: date ?? moment, timeZone: utc)
    }

    // MARK: Files

    func testFilesCopiedInTheFileManagerAreAddedLikeADrop() throws {
        let p = makeProject()
        let image = p.dir + "/work/a.png"
        let notes = p.dir + "/work/notes.txt"
        writeText("x", to: image)
        writeText("x", to: notes)

        let reply = try paste(p, FakeClipboard(files: [image, notes], png: pngBytes))

        XCTAssertEqual(reply["added"] as? [String], [image])
        XCTAssertEqual(reply["focus"] as? String, image)
        XCTAssertEqual((reply["skipped"] as? [String])?.count, 1)
        XCTAssertTrue(reply["pasted"] is NSNull, "files are not a pasted image")
        XCTAssertNil(reply["empty"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: p.pastedDir), "an image on the clipboard as well is ignored")
        XCTAssertEqual(p.settings.library.map { $0.path }, [image])
    }

    func testACopiedFolderIsAdded() throws {
        let p = makeProject()
        let folder = p.dir + "/project"
        writeText("x", to: folder + "/a.png")
        let reply = try paste(p, FakeClipboard(files: [folder]))
        XCTAssertEqual(reply["added"] as? [String], [folder])
        XCTAssertEqual(reply["focus"] as? String, folder)
    }

    // MARK: Images

    func testAnImageIsSavedAsPNGInThePastedFolderAddedAndLocated() throws {
        let p = makeProject()

        let reply = try paste(p, FakeClipboard(png: pngBytes))

        let file = p.pastedDir + "/paste-19710101-130509.png"
        XCTAssertEqual(reply["pasted"] as? String, file)
        XCTAssertEqual(reply["focus"] as? String, file, "the page lands on the image, not on the folder")
        XCTAssertEqual(reply["added"] as? [String], [p.pastedDir])
        XCTAssertEqual(reply["skipped"] as? [String], [])
        XCTAssertEqual(reply["reloading"] as? Bool, false)
        XCTAssertNil(reply["empty"])
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: file)), pngBytes)
        XCTAssertEqual(p.settings.library.map { $0.path }, [p.pastedDir], "the whole folder is one project")
        XCTAssertEqual(tempFiles(in: p.pastedDir), [], "no temporary file is left")
        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
    }

    func testASecondImageInTheSameSecondGetsANumberAndTheFolderIsNotAddedTwice() throws {
        let p = makeProject()
        _ = try paste(p, FakeClipboard(png: pngBytes))
        let second = Data([0x89, 0x50, 0x4E, 0x47, 9, 9])

        let reply = try paste(p, FakeClipboard(png: second))

        let file = p.pastedDir + "/paste-19710101-130509-2.png"
        XCTAssertEqual(reply["pasted"] as? String, file)
        XCTAssertEqual(reply["focus"] as? String, file)
        XCTAssertEqual(reply["added"] as? [String], [], "the folder was in the library already")
        XCTAssertEqual(names(in: p.pastedDir), ["paste-19710101-130509-2.png", "paste-19710101-130509.png"])
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: file)), second)
        XCTAssertEqual(p.settings.library.count, 1)
    }

    func testAnImageAtALaterTimeGetsItsOwnName() throws {
        let p = makeProject()
        _ = try paste(p, FakeClipboard(png: pngBytes))
        let reply = try paste(p, FakeClipboard(png: pngBytes), at: moment.addingTimeInterval(61))
        XCTAssertEqual(reply["pasted"] as? String, p.pastedDir + "/paste-19710101-130610.png")
    }

    func testAnImageThatCannotBeSavedIsAnErrorTheUserCanRead() throws {
        let p = makeProject()
        // A file where the folder should be
        writeText("x", to: p.pastedDir)
        XCTAssertThrowsError(try paste(p, FakeClipboard(png: pngBytes))) { error in
            XCTAssertTrue(error is BridgeError, "\(error)")
        }
        XCTAssertTrue(p.settings.library.isEmpty)
    }

    // MARK: Nothing

    func testNeitherFilesNorAnImageIsEmpty() throws {
        let p = makeProject()
        let reply = try paste(p, FakeClipboard())
        XCTAssertEqual(reply["empty"] as? Bool, true)
        XCTAssertEqual(reply["added"] as? [String], [])
        XCTAssertTrue(reply["pasted"] is NSNull)
        XCTAssertFalse(FileManager.default.fileExists(atPath: p.pastedDir))
        XCTAssertTrue(p.settings.library.isEmpty)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
    }

    // MARK: File names and image data

    func testTheNameCarriesTheDateAndTimeInTheGivenZone() {
        XCTAssertEqual(PastedImages.stem(for: moment, timeZone: utc), "paste-19710101-130509")
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        XCTAssertEqual(PastedImages.stem(for: moment, timeZone: tokyo), "paste-19710101-220509")
    }

    func testTheNameDoesNotFollowTheSystemCalendar() {
        // The Buddhist calendar would write 2514 for 1971
        let year = PastedImages.stem(for: moment, timeZone: utc).dropFirst("paste-".count).prefix(4)
        XCTAssertEqual(String(year), "1971")
    }

    func testImageDataInAnotherFormatBecomesPNG() throws {
        let rep = try XCTUnwrap(
            NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: 4, pixelsHigh: 3, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let tiff = try XCTUnwrap(rep.representation(using: .tiff, properties: [:]))

        let png = try XCTUnwrap(PastedImages.png(fromImageData: tiff))

        XCTAssertEqual(Array(png.prefix(4)), [0x89, 0x50, 0x4E, 0x47], "a PNG signature")
        let back = try XCTUnwrap(NSBitmapImageRep(data: png))
        XCTAssertEqual(back.pixelsWide, 4)
        XCTAssertEqual(back.pixelsHigh, 3)
    }

    func testDataThatIsNoImageIsNotConverted() {
        XCTAssertNil(PastedImages.png(fromImageData: Data("not an image".utf8)))
        XCTAssertNil(PastedImages.png(fromImageData: Data()))
    }
}

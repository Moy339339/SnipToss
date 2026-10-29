import XCTest

@testable import SnipToss

/// Dropping files onto the window: the paths of the native drop are kept for the page's `addDropped` call
final class DropTests: SnipTestCase {
    /// A clock the test moves by hand
    private final class ManualClock {
        var now: TimeInterval = 1000
        func read() -> TimeInterval { now }
    }

    private func makeDropped(_ clock: ManualClock) -> DroppedPaths {
        DroppedPaths(clock: { clock.read() })
    }

    // MARK: DroppedPaths

    func testThePathsOfADropAreHandedOutOnceAndForgotten() {
        let clock = ManualClock()
        let dropped = makeDropped(clock)
        dropped.store(["/p/a.png", "/p/b.png"])
        clock.now += 1
        XCTAssertEqual(dropped.take(), ["/p/a.png", "/p/b.png"])
        XCTAssertEqual(dropped.take(), [], "used up")
    }

    func testPathsStayValidForTenSecondsAndNotLonger() {
        let clock = ManualClock()
        let dropped = makeDropped(clock)
        dropped.store(["/p/a.png"])
        clock.now += 9.9
        XCTAssertEqual(dropped.take(), ["/p/a.png"])

        dropped.store(["/p/b.png"])
        clock.now += 10.1
        XCTAssertEqual(dropped.take(), [], "too old to belong to the call that is asking")
        XCTAssertEqual(dropped.take(), [], "and forgotten")
    }

    func testTheLifetimeIsTenSeconds() {
        XCTAssertEqual(DroppedPaths.lifetime, 10)
    }

    func testNothingStoredGivesNothing() {
        XCTAssertEqual(makeDropped(ManualClock()).take(), [])
    }

    func testANewDropReplacesTheOldOne() {
        let clock = ManualClock()
        let dropped = makeDropped(clock)
        dropped.store(["/p/old.png"])
        clock.now += 5
        dropped.store(["/p/new.png"])
        clock.now += 8
        XCTAssertEqual(dropped.take(), ["/p/new.png"], "the clock runs from the newer drop")
    }

    func testADropWithoutFilesClearsWhatAnEarlierDropLeft() {
        // An image dragged out of a web page has no file; it must not be taken for the files of the drop before it
        let dropped = makeDropped(ManualClock())
        dropped.store(["/p/a.png"])
        dropped.store([])
        XCTAssertEqual(dropped.take(), [])
    }

    func testTheSystemClockIsUsedByDefault() {
        let dropped = DroppedPaths()
        dropped.store(["/p/a.png"])
        XCTAssertEqual(dropped.take(), ["/p/a.png"])
    }

    // MARK: addDropped

    func testWithNoStoredPathsTheReplyIsEmptyAndNothingIsAdded() {
        let asked = Counter()
        let reply = addDroppedReply(
            paths: [],
            add: { _ in
                asked.increment()
                return Library.AddResult(added: ["/x"], focus: "/x", skipped: [], relocated: [])
            })
        XCTAssertEqual(asked.value, 0, "the library was not touched")
        XCTAssertEqual(reply["added"] as? [String], [])
        XCTAssertTrue(reply["focus"] is NSNull)
        XCTAssertEqual(reply["skipped"] as? [String], [], "the page explains a drop with no file in its own words")
        XCTAssertEqual(reply["reloading"] as? Bool, false)
        XCTAssertTrue(reply["pasted"] is NSNull)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
    }

    func testDroppedFilesAreAddedLikeAnyOtherAdd() {
        let dir = makeTempDir()
        let settings = Settings.load(from: dir + "/settings.json")
        let image = dir + "/p/a.png"
        let notes = dir + "/p/notes.txt"
        writeText("x", to: image)
        writeText("x", to: notes)

        let reply = addDroppedReply(paths: [image, notes], add: { Library.add(settings, paths: $0) })

        XCTAssertEqual(reply["added"] as? [String], [image])
        XCTAssertEqual(reply["focus"] as? String, image)
        let skipped = reply["skipped"] as? [String] ?? []
        XCTAssertEqual(skipped.count, 1)
        XCTAssertTrue(skipped.first?.contains("notes.txt") == true, skipped.joined())
        XCTAssertEqual(settings.library.map { $0.path }, [image])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
    }

    func testAFileAlreadyInTheLibraryIsLocatedNotAddedAgain() {
        let dir = makeTempDir()
        let settings = Settings.load(from: dir + "/settings.json")
        let image = dir + "/p/a.png"
        writeText("x", to: image)
        Library.add(settings, paths: [image])

        let reply = addDroppedReply(paths: [image], add: { Library.add(settings, paths: $0) })

        XCTAssertEqual(reply["added"] as? [String], [])
        XCTAssertEqual(reply["focus"] as? String, image)
        XCTAssertEqual(settings.library.count, 1)
    }

    func testTheReplyOfAFolderDropNamesTheFolder() {
        let dir = makeTempDir()
        let settings = Settings.load(from: dir + "/settings.json")
        let folder = dir + "/project"
        writeText("x", to: folder + "/a.png")

        let reply = addDroppedReply(paths: [folder], add: { Library.add(settings, paths: $0) })

        XCTAssertEqual(reply["added"] as? [String], [folder])
        XCTAssertEqual(reply["focus"] as? String, folder)
    }

    // MARK: Reading the paths from a pasteboard

    func testOnlyFileURLsBecomePaths() {
        let urls = [
            URL(fileURLWithPath: "/Users/u/Pictures/a b.png"), URL(string: "https://example.com/a.png")!,
            URL(fileURLWithPath: "/Users/u/项目", isDirectory: true),
        ]
        XCTAssertEqual(ClipboardPaths.of(urls), ["/Users/u/Pictures/a b.png", "/Users/u/项目"])
    }

    func testNoURLsGiveNoPaths() {
        XCTAssertEqual(ClipboardPaths.of([]), [])
    }
}

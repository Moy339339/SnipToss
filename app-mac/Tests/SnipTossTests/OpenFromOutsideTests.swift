import XCTest

@testable import SnipToss

/// Things opened from outside: queued until the page reads the library for the first time, pushed as `libraryChanged` afterwards
final class OpenFromOutsideTests: SnipTestCase {
    /// A list several threads can add to
    private final class Recorder<T> {
        private let lock = NSLock()
        private var items: [T] = []

        func add(_ item: T) {
            lock.lock()
            items.append(item)
            lock.unlock()
        }

        var all: [T] {
            lock.lock()
            defer { lock.unlock() }
            return items
        }
    }

    private struct Event {
        let name: String
        let payload: [String: Any]
    }

    private func result(
        added: [String] = [], focus: String? = nil, skipped: [String] = [], relocated: [Library.Relocation] = []
    ) -> Library.AddResult {
        Library.AddResult(added: added, focus: focus, skipped: skipped, relocated: relocated)
    }

    private struct Setup {
        let opens: OutsideOpens
        let pending: PendingOpens
        let events: Recorder<Event>
        let shown: Counter
        let asked: Recorder<[String]>
    }

    /// An `emit` that records the events
    private func recording(_ events: Recorder<Event>) -> OutsideOpens.Emit {
        { name, payload in events.add(Event(name: name, payload: payload)) }
    }

    /// Opens whose `add` answers with `answer` for every call
    private func makeOpens(pending: PendingOpens = PendingOpens(), answer: @escaping () -> Library.AddResult) -> Setup {
        let events = Recorder<Event>()
        let shown = Counter()
        let asked = Recorder<[String]>()
        let add: ([String]) -> Library.AddResult = { paths in
            asked.add(paths)
            return answer()
        }
        let opens = OutsideOpens(pending: pending, add: add, emit: recording(events), show: { shown.increment() })
        return Setup(opens: opens, pending: pending, events: events, shown: shown, asked: asked)
    }

    // MARK: Before the page listens

    func testAResultBeforeThePageHasReadTheLibraryIsQueuedNotPushed() {
        let moved = Library.Relocation(from: "/old/a.png", to: "/new/a.png")
        let s = makeOpens { self.result(added: ["/p/a.png"], focus: "/p/a.png", skipped: ["Unsupported"], relocated: [moved]) }
        s.opens.handle(["/p/a.png"])

        XCTAssertTrue(s.events.all.isEmpty, "the page would not hear it yet")
        XCTAssertFalse(s.pending.isListening)
        let taken = s.pending.take()
        XCTAssertEqual(taken.focus, "/p/a.png")
        XCTAssertEqual(taken.skipped, ["Unsupported"])
        XCTAssertEqual(taken.relocated, [moved])
    }

    func testTheFirstReadTakesTheQueueAndLaterReadsGetNothing() {
        let s = makeOpens { self.result(focus: "/p/a.png", skipped: ["x"]) }
        s.opens.handle(["/p/a.png"])
        XCTAssertEqual(s.pending.take().focus, "/p/a.png")
        XCTAssertTrue(s.pending.isListening)

        let again = s.pending.take()
        XCTAssertNil(again.focus)
        XCTAssertEqual(again.skipped, [])
        XCTAssertEqual(again.relocated, [])
    }

    func testSeveralQueuedResultsAreMergedInOrderAndALaterFocusWins() {
        let pending = PendingOpens()
        let a = Library.Relocation(from: "/o/a", to: "/n/a")
        let b = Library.Relocation(from: "/o/b", to: "/n/b")
        XCTAssertTrue(pending.stashUnlessListening(result(focus: "/p/1.png", skipped: ["one"], relocated: [a])))
        XCTAssertTrue(pending.stashUnlessListening(result(focus: nil, skipped: ["two"])))
        XCTAssertTrue(pending.stashUnlessListening(result(focus: "/p/3.png", skipped: ["three"], relocated: [b])))

        let taken = pending.take()
        XCTAssertEqual(taken.focus, "/p/3.png")
        XCTAssertEqual(taken.skipped, ["one", "two", "three"])
        XCTAssertEqual(taken.relocated, [a, b])
    }

    func testAResultWithoutAFocusKeepsTheEarlierFocus() {
        let pending = PendingOpens()
        _ = pending.stashUnlessListening(result(focus: "/p/1.png"))
        _ = pending.stashUnlessListening(result(skipped: ["nothing could be opened"]))
        XCTAssertEqual(pending.take().focus, "/p/1.png")
    }

    // MARK: After the page listens

    func testAResultAfterTheFirstReadIsPushedAsLibraryChanged() throws {
        let moved = Library.Relocation(from: "/old/a.png", to: "/new/a.png")
        let s = makeOpens { self.result(added: ["/p/a.png"], focus: "/p/a.png", skipped: ["Unsupported"], relocated: [moved]) }
        _ = s.pending.take()

        s.opens.handle(["/p/a.png"])

        XCTAssertEqual(s.events.all.count, 1)
        let event = try XCTUnwrap(s.events.all.first)
        XCTAssertEqual(event.name, "libraryChanged")
        XCTAssertEqual(event.payload["focus"] as? String, "/p/a.png")
        XCTAssertEqual(event.payload["skipped"] as? [String], ["Unsupported"])
        let relocated = try XCTUnwrap(event.payload["relocated"] as? [[String: String]])
        XCTAssertEqual(relocated, [["from": "/old/a.png", "to": "/new/a.png"]])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(event.payload), "the event can be sent to the page")
        XCTAssertNil(s.pending.take().focus, "nothing was queued")
    }

    func testNothingToLocateIsPushedAsNull() throws {
        let s = makeOpens { self.result(skipped: ["Unsupported"]) }
        _ = s.pending.take()
        s.opens.handle(["/p/a.txt"])
        let event = try XCTUnwrap(s.events.all.first)
        XCTAssertTrue(event.payload["focus"] is NSNull)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(event.payload))
    }

    func testAPageThatStartsLoadingAgainGetsTheNextOpenQueued() {
        let s = makeOpens { self.result(focus: "/p/a.png") }
        _ = s.pending.take()
        s.pending.navigating()
        XCTAssertFalse(s.pending.isListening)

        s.opens.handle(["/p/a.png"])

        XCTAssertTrue(s.events.all.isEmpty)
        XCTAssertEqual(s.pending.take().focus, "/p/a.png")
    }

    // MARK: open

    func testOpeningBringsTheWindowForwardAndAddsInTheBackgroundInOrder() {
        let s = makeOpens { self.result() }
        s.opens.open(["/p/a.png"])
        s.opens.open(["/p/b.png", "/p/c.png"])
        XCTAssertEqual(s.shown.value, 2, "the window comes forward at once, before the paths are checked")
        s.opens.flush()
        XCTAssertEqual(s.asked.all, [["/p/a.png"], ["/p/b.png", "/p/c.png"]])
    }

    func testOpeningNothingOnlyBringsTheWindowForward() {
        let s = makeOpens { self.result() }
        _ = s.pending.take()
        s.opens.open([])
        s.opens.flush()
        XCTAssertEqual(s.shown.value, 1)
        XCTAssertTrue(s.asked.all.isEmpty)
        XCTAssertTrue(s.events.all.isEmpty)
    }

    // MARK: With the real library

    func testAnUnsupportedFileIsReportedAndAnImageIsAddedAndLocated() throws {
        let dir = makeTempDir()
        let settings = Settings.load(from: dir + "/settings.json")
        let image = dir + "/project/a.png"
        let notes = dir + "/project/notes.txt"
        writeText("x", to: image)
        writeText("x", to: notes)
        let events = Recorder<Event>()
        let pending = PendingOpens()
        _ = pending.take()
        let opens = OutsideOpens(pending: pending, add: { Library.add(settings, paths: $0) }, emit: recording(events), show: {})

        opens.open([notes, image])
        opens.flush()

        let event = try XCTUnwrap(events.all.first)
        XCTAssertEqual(event.name, "libraryChanged")
        XCTAssertEqual(event.payload["focus"] as? String, image)
        let skipped = try XCTUnwrap(event.payload["skipped"] as? [String])
        XCTAssertEqual(skipped.count, 1)
        XCTAssertTrue(skipped[0].contains("notes.txt"), skipped[0])
        XCTAssertEqual(settings.library.map { $0.path }, [image])
    }

    func testAPathThatDoesNotExistIsReportedAsNotFound() throws {
        let dir = makeTempDir()
        let settings = Settings.load(from: dir + "/settings.json")
        let pending = PendingOpens()
        let opens = OutsideOpens(pending: pending, add: { Library.add(settings, paths: $0) }, emit: { _, _ in }, show: {})

        opens.handle([dir + "/gone.png"])

        let taken = pending.take()
        XCTAssertNil(taken.focus)
        XCTAssertEqual(taken.skipped.count, 1)
        XCTAssertTrue(taken.skipped[0].contains("gone.png"), taken.skipped[0])
        XCTAssertTrue(settings.library.isEmpty)
    }

    // MARK: The command line

    func testTheCommandLineGivesItsPathsWithoutTheProgramName() {
        let program = "/Applications/SnipToss.app/Contents/MacOS/SnipToss"
        XCTAssertEqual(LaunchArguments.paths(from: [program, "/a/b.png", "c d"]), ["/a/b.png", "c d"])
        XCTAssertEqual(LaunchArguments.paths(from: [program]), [])
        XCTAssertEqual(LaunchArguments.paths(from: []), [])
    }

    func testOptionsTheSystemAddsAreNotPaths() {
        let arguments = [
            "SnipToss", "-psn_0_12345", "/a.png", "-NSDocumentRevisionsDebugMode", "YES", "-AppleLanguages", "(de)", "/b.png",
            "-NSQuitAlwaysKeepsWindows",
        ]
        XCTAssertEqual(LaunchArguments.paths(from: arguments), ["/a.png", "/b.png"])
    }

    func testAnEmptyArgumentIsNotAPath() {
        XCTAssertEqual(LaunchArguments.paths(from: ["SnipToss", "", "/a.png"]), ["/a.png"])
    }
}

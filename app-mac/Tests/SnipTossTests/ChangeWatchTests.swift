import XCTest

@testable import SnipToss

/// Detecting notes and items that changed on disk (ChangeWatch.swift): the notes folders (an agent or another program edited notes) and the
/// items (an agent edited an image according to the notes). The watchers are driven by hand: `tick()` is one beat of the timer, `flush()`
/// waits for the check it started, and the clock and the volume answers are stand-ins, so nothing here waits for real time
final class ChangeWatchTests: SnipTestCase {
    // MARK: Stand-ins

    /// A clock the test moves by hand
    private final class FakeClock {
        private let lock = NSLock()
        private var time: TimeInterval = 1000

        func now() -> TimeInterval {
            lock.lock()
            defer { lock.unlock() }
            return time
        }

        func advance(_ seconds: TimeInterval) {
            lock.lock()
            time += seconds
            lock.unlock()
        }
    }

    /// A value several threads can read and set
    private final class Flag {
        private let lock = NSLock()
        private var stored: Bool

        init(_ initial: Bool) {
            stored = initial
        }

        var isOn: Bool {
            get {
                lock.lock()
                defer { lock.unlock() }
                return stored
            }
            set {
                lock.lock()
                stored = newValue
                lock.unlock()
            }
        }
    }

    private final class Number {
        private let lock = NSLock()
        private var stored = 0

        var value: Int {
            get {
                lock.lock()
                defer { lock.unlock() }
                return stored
            }
            set {
                lock.lock()
                stored = newValue
                lock.unlock()
            }
        }
    }

    /// What a notes watcher announced, in order
    private final class Announced {
        struct Call {
            let home: String
            let files: [[String: Any]]
            let seq: Int
        }

        private let lock = NSLock()
        private var calls: [Call] = []

        func record(_ home: String, _ files: [[String: Any]], _ seq: Int) {
            lock.lock()
            calls.append(Call(home: home, files: files, seq: seq))
            lock.unlock()
        }

        var all: [Call] {
            lock.lock()
            defer { lock.unlock() }
            return calls
        }
    }

    /// The library entries an item watcher announced, one list per announcement
    private final class Entries {
        private let lock = NSLock()
        private var lists: [[String]] = []

        func record(_ entries: [String]) {
            lock.lock()
            lists.append(entries)
            lock.unlock()
        }

        var all: [[String]] {
            lock.lock()
            defer { lock.unlock() }
            return lists
        }
    }

    /// The events a `ChangeWatch` sent to the page
    private final class Events {
        private let lock = NSLock()
        private var sent: [(event: String, payload: [String: Any])] = []

        func add(_ event: String, _ payload: [String: Any]) {
            lock.lock()
            sent.append((event: event, payload: payload))
            lock.unlock()
        }

        func named(_ event: String) -> [[String: Any]] {
            lock.lock()
            defer { lock.unlock() }
            return sent.filter { $0.event == event }.map { $0.payload }
        }
    }

    /// A timer that beats only when told to
    private final class ManualTicker: Ticker {
        private var fire: (() -> Void)?
        private(set) var running = false

        func start(_ fire: @escaping () -> Void) {
            self.fire = fire
            running = true
        }

        func stop() {
            running = false
        }

        /// A beat, if the timer is running
        func beat() {
            if running { fire?() }
        }
    }

    // MARK: Helpers

    private func notes(_ home: String) -> String {
        home + "/.sniptoss/annotations"
    }

    private func makeSettings(library: [String] = [], selected: String? = nil) -> Settings {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        settings.update { values in
            values.library = library.map { LibraryEntry(path: $0) }
            values.selected = selected
        }
        return settings
    }

    private func bytes(_ count: Int, _ letter: String = "a") -> String {
        String(repeating: letter, count: count)
    }

    private func fileNames(_ call: Announced.Call) -> [String] {
        call.files.compactMap { $0["name"] as? String }
    }

    /// A notes folder a scan has handed out
    private func newHome() -> (home: String, homes: NotesHomes) {
        let home = makeTempDir()
        let homes = NotesHomes()
        homes.insert(home)
        return (home, homes)
    }

    // MARK: Notes: what the Windows shell's tests also cover

    func testANotesFileChangedOnDiskIsAnnouncedOnceWithTheFilesRead() {
        let dir = makeTempDir()
        let file = notes(dir) + "/hero.png.json"
        writeText("{}", to: file)
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        watcher.tick()
        watcher.flush()
        XCTAssertTrue(seen.all.isEmpty, "no change, no announcement")

        writeText("{ \"changed\": true }", to: file)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(seen.all.count, 1)
        XCTAssertEqual(seen.all.first?.home, dir)
        XCTAssertEqual(seen.all.first?.files.count, 1)
        XCTAssertEqual(seen.all.first?.files.first?["name"] as? String, "hero.png.json")
        XCTAssertEqual(seen.all.first?.files.first?["text"] as? String, "{ \"changed\": true }")

        watcher.tick()
        watcher.flush()
        XCTAssertEqual(seen.all.count, 1, "one change is announced only once")
    }

    func testANotesFolderThatDidNotExistWhenWatchingStartedIsAnnouncedOnceItIsCreatedElsewhere() {
        let dir = makeTempDir()
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        writeText("{}", to: notes(dir) + "/a.json")
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(seen.all.count, 1)
        XCTAssertEqual(seen.all.first.map { fileNames($0) }, ["a.json"])
    }

    func testAProjectFolderVanishingEntirelyIsNotTreatedAsAllNotesDeleted() throws {
        let dir = makeTempDir()
        let home = dir + "/project"
        writeText("{}", to: notes(home) + "/a.json")
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(home)

        try FileManager.default.removeItem(atPath: home)
        watcher.tick()
        watcher.flush()
        XCTAssertTrue(seen.all.isEmpty, "the project folder itself is gone: not an empty list of notes")

        // It comes back with different notes in it: that is a change
        writeText("{ \"v\": 2 }", to: notes(home) + "/a.json")
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(seen.all.count, 1)
        XCTAssertEqual(seen.all.first?.files.first?["text"] as? String, "{ \"v\": 2 }")
    }

    func testNothingIsCheckedWhileTheWindowIsHiddenAndEverythingAtOnceWhenItIsShown() {
        let dir = makeTempDir()
        let file = notes(dir) + "/a.json"
        writeText("{}", to: file)
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)
        watcher.pause(true)

        writeText("{ \"changed\": true }", to: file)
        watcher.tick()
        watcher.flush()
        XCTAssertTrue(seen.all.isEmpty, "paused: the timer's beats do nothing")

        watcher.pause(false)
        watcher.flush()
        XCTAssertEqual(seen.all.count, 1, "shown again: looked at once, without waiting for a beat")
    }

    func testWatchingAFolderTwiceKeepsTheStateRecordedAtTheFirstCall() {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        writeText("{}", to: notes(dir) + "/b.json")
        watcher.watch(dir)
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(seen.all.count, 1, "the second call did not take the new file as the starting point")
    }

    func testANotesFileThatCannotBeReadIsTriedAgainAtTheNextBeat() {
        let dir = makeTempDir()
        let file = notes(dir) + "/a.json"
        writeText("{}", to: file)
        let busy = Flag(true)
        let seen = Announced()
        let watcher = AnnotationWatcher(
            read: { home in
                if busy.isOn { throw FileOperationError(operation: "open", path: home, code: EBUSY) }
                return try NotesStore.readAnnotations(home: home)
            },
            changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)
        writeText("{ \"changed\": true }", to: file)

        watcher.tick()
        watcher.flush()
        XCTAssertTrue(seen.all.isEmpty, "it was being written: nothing announced")

        busy.isOn = false
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(seen.all.count, 1, "the difference was not recorded, so it was looked at again")
    }

    func testOnlyJsonFilesAreNotesAndTemporaryAndLockFilesAreIgnored() {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        writeText("{", to: notes(dir) + "/.a.json.4242-abcdef.tmp")
        writeText("4242 1 abcd", to: notes(dir) + "/.a.json.lock")
        watcher.tick()
        watcher.flush()
        XCTAssertTrue(seen.all.isEmpty)

        writeText("{}", to: notes(dir) + "/b.json")
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(seen.all.first.map { fileNames($0) }, ["a.json", "b.json"])
    }

    // MARK: Notes: the ordering number, volumes

    func testTheOrderingNumberIsTakenBeforeTheFilesAreRead() {
        let dir = makeTempDir()
        let file = notes(dir) + "/a.json"
        writeText("{}", to: file)
        let takenDuringRead = Number()
        let seen = Announced()
        let watcher = AnnotationWatcher(
            read: { home in
                takenDuringRead.value = NotesStore.observe()
                return try NotesStore.readAnnotations(home: home)
            },
            changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        writeText("{ \"changed\": true }", to: file)
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(seen.all.count, 1)
        XCTAssertGreaterThan(takenDuringRead.value, 0)
        let announcedSeq = seen.all.first?.seq ?? Int.max
        XCTAssertLessThan(announcedSeq, takenDuringRead.value, "a number taken after the read could not tell a late notification")
    }

    func testANotesFolderOnAVolumeThatIsNotThereIsNeverLookedAtAndIsSyncedOnceItIsBack() {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let connected = Flag(false)
        let looks = Counter()
        let seen = Announced()
        let watcher = AnnotationWatcher(
            volumes: WatchVolumes(wait: { _ in }, known: { _ in connected.isOn }),
            sign: { home in
                looks.increment()
                return AnnotationWatcher.signature(of: home)
            },
            changed: { seen.record($0, $1, $2) })

        watcher.watch(dir)
        writeText("{ \"changed\": true }", to: notes(dir) + "/a.json")
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(looks.value, 0, "the disk is not touched while the volume is not connected")
        XCTAssertTrue(seen.all.isEmpty)

        connected.isOn = true
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(looks.value, 1)
        XCTAssertEqual(seen.all.count, 1, "back again: the notes are synced")
    }

    func testAVolumeThatNeverAnsweredCountsAsNotConnected() {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let looks = Counter()
        let watcher = AnnotationWatcher(
            volumes: WatchVolumes(wait: { _ in }, known: { _ in nil }),
            sign: { home in
                looks.increment()
                return AnnotationWatcher.signature(of: home)
            },
            changed: { _, _, _ in })
        watcher.watch(dir)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(looks.value, 0)
    }

    // MARK: Notes: the app's own writes

    func testANoteTheAppWroteItselfIsAnnouncedLikeAnyOtherChange() {
        // As on Windows: the page gets its own write back and takes content it already knows for no change
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        writeText("{ \"mine\": true }", to: notes(dir) + "/b.json")
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(seen.all.count, 1)
        XCTAssertEqual(seen.all.first.map { fileNames($0) }, ["a.json", "b.json"])
    }

    func testAfterAWriteTheNotesFolderIsWatched() {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let events = Events()
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(), emit: events.add, ticker: ticker)
        watch.start()

        // Nothing watched this folder before: the write starts it, from how the folder looks then
        watch.wrote(home: dir, file: notes(dir) + "/a.json")
        ticker.beat()
        watch.flush()
        XCTAssertTrue(events.named("annotationsChanged").isEmpty)

        writeText("{ \"agent\": \"resolved\" }", to: notes(dir) + "/b.json")
        ticker.beat()
        watch.flush()
        XCTAssertEqual(events.named("annotationsChanged").count, 1)
    }
    func testAFileRemovedFromTheNotesFolderIsAnnounced() throws {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        writeText("{}", to: notes(dir) + "/b.json")
        let seen = Announced()
        let watcher = AnnotationWatcher(changed: { seen.record($0, $1, $2) })
        watcher.watch(dir)

        try FileManager.default.removeItem(atPath: notes(dir) + "/b.json")
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(seen.all.count, 1)
        XCTAssertEqual(seen.all.first.map { fileNames($0) }, ["a.json"])
    }

    // MARK: Notes: through the bridge methods

    func testANoteWrittenThroughTheBridgeIsPushedBackLikeAnyChangeAndAnExternalOneAgainWithALargerNumber() throws {
        let (home, homes) = newHome()
        writeText("{}", to: notes(home) + "/a.json")
        let events = Events()
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(), emit: events.add, ticker: ticker)
        watch.start()

        let read = try readHomesReply([home], homes: homes, startWatching: { watch.startWatching($0) })
        let readSeq = try XCTUnwrap(read.first?["seq"] as? Int)
        let params: [String: Any] = [
            "home": home, "path": ".sniptoss/annotations/b.json", "text": "{ \"b\": 1 }\n", "expectSha256": NSNull(),
        ]
        let written = try writeAnnotationReply(
            params, homes: homes, startWatching: { watch.startWatching($0) }, didWrite: { watch.wrote(home: $0, file: $1) })
        XCTAssertEqual(written["written"] as? Bool, true)

        // Its own write comes back once, with a number taken after the write (as on Windows; the page takes it for no change)
        ticker.beat()
        watch.flush()
        XCTAssertEqual(events.named("annotationsChanged").count, 1)
        let echoSeq = try XCTUnwrap(events.named("annotationsChanged")[0]["seq"] as? Int)
        XCTAssertGreaterThan(echoSeq, try XCTUnwrap(written["seq"] as? Int), "taken after the page's own write: it is not older than it")

        writeText("{ \"agent\": \"resolved\" }", to: notes(home) + "/a.json")
        ticker.beat()
        watch.flush()
        let pushed = events.named("annotationsChanged")
        XCTAssertEqual(pushed.count, 2)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(pushed[1]), "the event can be sent to the page")
        XCTAssertEqual(pushed[1]["home"] as? String, home)
        let seq = try XCTUnwrap(pushed[1]["seq"] as? Int)
        XCTAssertGreaterThan(seq, readSeq)
        XCTAssertGreaterThan(seq, echoSeq)
        let files = try XCTUnwrap(pushed[1]["annotations"] as? [[String: Any]])
        XCTAssertEqual(files.compactMap { $0["name"] as? String }, ["a.json", "b.json"])
        XCTAssertEqual(files.first?["text"] as? String, "{ \"agent\": \"resolved\" }")
    }

    func testADifferenceTheAgentMakesWhileTheNotesAreBeingReadIsAnnounced() throws {
        let (home, homes) = newHome()
        writeText("{}", to: notes(home) + "/a.json")
        let events = Events()
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(), emit: events.add, ticker: ticker)
        watch.start()

        // The agent writes right after watching started, before the read is done: watching had recorded the state before it
        _ = try readHomesReply(
            [home], homes: homes,
            startWatching: { watched in
                watch.startWatching(watched)
                self.writeText("{ \"late\": true }", to: self.notes(watched) + "/late.json")
            })
        ticker.beat()
        watch.flush()

        let pushed = events.named("annotationsChanged")
        XCTAssertEqual(pushed.count, 1)
        let files = pushed.first?["annotations"] as? [[String: Any]]
        XCTAssertEqual(files?.compactMap { $0["name"] as? String }, ["a.json", "late.json"])
    }

    func testTheWriteHookIsCalledOnlyForAWriteThatHappened() throws {
        let (home, homes) = newHome()
        let rel = ".sniptoss/annotations/a.png.json"
        writeText("别人改的", to: home + "/" + rel)
        var reported: [String] = []

        let refused = try writeAnnotationReply(
            ["home": home, "path": rel, "text": "我的", "expectSha256": NotesStore.textSha256("旧") ?? ""] as [String: Any],
            homes: homes, startWatching: { _ in }, didWrite: { reported.append($0 + "|" + $1) })
        XCTAssertEqual(refused["written"] as? Bool, false)
        XCTAssertEqual(reported, [], "nothing was written, so nothing is reported")

        let accepted = try writeAnnotationReply(
            ["home": home, "path": rel, "text": "合并后", "expectSha256": NotesStore.textSha256("别人改的") ?? ""] as [String: Any],
            homes: homes, startWatching: { _ in }, didWrite: { reported.append($0 + "|" + $1) })
        XCTAssertEqual(accepted["written"] as? Bool, true)
        XCTAssertEqual(reported, [home + "|" + home + "/" + rel])
    }

    // MARK: Items: what the Windows shell's tests also cover

    func testTheItemBeingViewedChangedAnnouncesTheLibraryEntryContainingIt() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        let hero = folder + "/hero.png"
        writeText(bytes(100), to: hero)
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [folder], selected: hero), changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        watcher.tick()
        watcher.flush()
        XCTAssertTrue(entries.all.isEmpty, "the first pass only records the starting point")

        writeText(bytes(200), to: hero)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all, [[folder]])
    }

    func testAnEntryThatIsASingleFileIsAnnouncedAsItself() {
        let dir = makeTempDir()
        let hero = dir + "/hero.png"
        writeText(bytes(100), to: hero)
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [hero], selected: hero), changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        writeText(bytes(200), to: hero)
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(entries.all, [[hero]])
    }

    func testTheItemBeingViewedDeletedIsAnnounced() throws {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        let hero = folder + "/hero.png"
        writeText(bytes(100), to: hero)
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [folder], selected: hero), changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        try FileManager.default.removeItem(atPath: hero)
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(entries.all, [[folder]])
    }

    func testPathsCorruptedByHandEditingTheSettingsFileCountAsMissingAndDoNotCrash() {
        for path in ["", "/tmp/a\0b.png", "relative.png", "\0"] {
            XCTAssertEqual(MaterialWatcher.fileSignature(path), "missing", path)
        }
    }

    func testItemSignatureChangesWithSizeOrModifiedTimeAndANonItemFileIsCalledOther() throws {
        let dir = makeTempDir()
        let png = dir + "/a.png"
        writeText(bytes(10), to: png)
        let first = MaterialWatcher.fileSignature(png)
        writeText(bytes(20), to: png)
        XCTAssertNotEqual(first, MaterialWatcher.fileSignature(png))

        let second = MaterialWatcher.fileSignature(png)
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -3600)], ofItemAtPath: png)
        XCTAssertNotEqual(second, MaterialWatcher.fileSignature(png), "the same size with another modification time")

        writeText("x", to: dir + "/notes.txt")
        XCTAssertEqual(MaterialWatcher.fileSignature(dir + "/notes.txt"), "other")
        XCTAssertEqual(MaterialWatcher.fileSignature(dir + "/没有.png"), "missing")
        XCTAssertEqual(MaterialWatcher.fileSignature(dir), "missing", "a folder is not a file")
    }

    // MARK: Items: when the scans run

    func testAFullScanAnnouncesAnEntryWhoseFilesChangedOnlyWhenItIsDueAndOnlyOnce() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        writeText(bytes(10), to: folder + "/a.png")
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [folder]), clock: { clock.now() }, changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        writeText(bytes(10), to: folder + "/b.png")
        clock.advance(5)
        watcher.tick()
        watcher.flush()
        XCTAssertTrue(entries.all.isEmpty, "not due yet")

        clock.advance(5)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all, [[folder]])

        clock.advance(10)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all.count, 1, "announced once")
    }

    func testAFileDeletedFromAFolderEntryIsFoundByTheFullScan() throws {
        let dir = makeTempDir()
        let first = dir + "/one"
        let second = dir + "/two"
        writeText(bytes(10), to: first + "/a.png")
        writeText(bytes(10), to: second + "/b.png")
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(
            settings: makeSettings(library: [first, second]), clock: { clock.now() }, changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        try FileManager.default.removeItem(atPath: second + "/b.png")
        clock.advance(10)
        watcher.tick()
        watcher.flush()

        XCTAssertEqual(entries.all, [[second]])
    }

    func testComingBackToTheForegroundScansAtOnceUnlessItWasDoneAMomentAgo() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        writeText(bytes(10), to: folder + "/a.png")
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [folder]), clock: { clock.now() }, changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        writeText(bytes(10), to: folder + "/b.png")
        watcher.windowActivated()
        watcher.flush()
        XCTAssertTrue(entries.all.isEmpty, "scanned a moment ago")

        clock.advance(3)
        watcher.windowActivated()
        watcher.flush()
        XCTAssertEqual(entries.all, [[folder]], "nothing waits for the next full scan")
    }

    func testASlowScanStretchesTheIntervalToTwentyTimesItsDuration() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        writeText(bytes(10), to: folder + "/a.png")
        let clock = FakeClock()
        let scans = Counter()
        // Asking about the volumes happens once per scan and here takes three seconds
        let volumes = WatchVolumes(
            wait: { _ in
                scans.increment()
                clock.advance(3)
            },
            known: { _ in true })
        let watcher = MaterialWatcher(
            settings: makeSettings(library: [folder]), clock: { clock.now() }, volumes: volumes, changed: { _ in })
        watcher.start()
        watcher.flush()
        XCTAssertEqual(scans.value, 1)

        clock.advance(10)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(scans.value, 1, "too early: after a three-second scan the next one is sixty seconds after it ended")

        clock.advance(49)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(scans.value, 1)

        clock.advance(1)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(scans.value, 2)
    }

    func testTheOpenFileAndTheFullScanDoNotAnnounceTheSameChangeTwice() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        let hero = folder + "/hero.png"
        writeText(bytes(100), to: hero)
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(
            settings: makeSettings(library: [folder], selected: hero), clock: { clock.now() }, changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        writeText(bytes(200), to: hero)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all, [[folder]])

        clock.advance(10)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all.count, 1, "the full scan only recorded what the open-file check had already announced")
    }

    func testAnEntryTakenOutOfTheLibraryIsForgottenSoItsReturnIsOnlyRecorded() {
        let dir = makeTempDir()
        let kept = dir + "/kept"
        let other = dir + "/other"
        writeText(bytes(10), to: kept + "/a.png")
        writeText(bytes(10), to: other + "/b.png")
        let settings = makeSettings(library: [kept, other])
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(settings: settings, clock: { clock.now() }, changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        settings.update { $0.library = [LibraryEntry(path: kept)] }
        clock.advance(10)
        watcher.tick()
        watcher.flush()
        writeText(bytes(20), to: other + "/b.png")
        settings.update { $0.library = [LibraryEntry(path: kept), LibraryEntry(path: other)] }
        clock.advance(10)
        watcher.tick()
        watcher.flush()

        XCTAssertTrue(entries.all.isEmpty, "a first sighting is recorded, not announced")
    }

    func testNothingIsCheckedWhilePausedAndTheOpenFileIsCheckedAtOnceWhenShown() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        let hero = folder + "/hero.png"
        writeText(bytes(100), to: hero)
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [folder], selected: hero), changed: { entries.record($0) })
        watcher.start()
        watcher.flush()
        watcher.pause(true)

        writeText(bytes(200), to: hero)
        watcher.tick()
        watcher.windowActivated()
        watcher.flush()
        XCTAssertTrue(entries.all.isEmpty, "paused: neither the beats nor coming to the foreground check anything")

        watcher.pause(false)
        watcher.flush()
        XCTAssertEqual(entries.all, [[folder]], "shown again: the open file is checked without waiting for a beat")
    }

    func testShownAgainScansTheWholeLibraryAtOnceToo() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        writeText(bytes(10), to: folder + "/a.png")
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(settings: makeSettings(library: [folder]), clock: { clock.now() }, changed: { entries.record($0) })
        watcher.start()
        watcher.flush()
        watcher.pause(true)
        writeText(bytes(10), to: folder + "/b.png")
        clock.advance(60)

        watcher.pause(false)
        watcher.flush()

        XCTAssertEqual(entries.all, [[folder]])
    }

    // MARK: Items: volumes

    func testAnEntryOnAVolumeThatIsNotThereIsNotScannedAndIsRescannedWhenItComesBack() {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        let hero = folder + "/hero.png"
        writeText(bytes(100), to: hero)
        let connected = Flag(false)
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(
            settings: makeSettings(library: [folder], selected: hero), clock: { clock.now() },
            volumes: WatchVolumes(wait: { _ in }, known: { _ in connected.isOn }), changed: { entries.record($0) })
        watcher.start()
        watcher.flush()

        // The clock stays where it is, so no full scan is due and only the open file is looked at: a full scan on its own queue could
        // otherwise replace what the open file's check has just recorded, and which of the two finishes last is not fixed
        writeText(bytes(200), to: hero)
        watcher.tick()
        watcher.flush()
        XCTAssertTrue(entries.all.isEmpty, "offline before and offline now: nothing to announce, and the disk was not looked at")

        connected.isOn = true
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all, [[folder]], "the volume is back: the page rescans the entry")

        clock.advance(10)
        watcher.tick()
        watcher.flush()
        XCTAssertEqual(entries.all.count, 1)
    }

    func testAnEntryOnAMountPointThatDoesNotExistIsOfflineWithTheRealVolumeChecker() {
        let volume = "/Volumes/SnipTossAbsent-" + UUID().uuidString
        let clock = FakeClock()
        let entries = Entries()
        let watcher = MaterialWatcher(
            settings: makeSettings(library: [volume + "/assets"], selected: volume + "/assets/a.png"), clock: { clock.now() },
            changed: { entries.record($0) })
        watcher.start()
        watcher.flush()
        clock.advance(10)
        watcher.tick()
        watcher.flush()
        XCTAssertTrue(entries.all.isEmpty)
        XCTAssertEqual(Volumes.known(volume + "/assets"), false, "the shared checker was asked and answered: not mounted")
    }

    // MARK: Both together

    func testHidingTheWindowStopsTheTimerAndShowingItLooksAtOnce() {
        let dir = makeTempDir()
        writeText("{}", to: notes(dir) + "/a.json")
        let events = Events()
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(), emit: events.add, ticker: ticker)
        watch.start()
        watch.startWatching(dir)
        XCTAssertTrue(ticker.running)

        watch.setVisible(false)
        XCTAssertFalse(ticker.running)
        writeText("{ \"changed\": true }", to: notes(dir) + "/a.json")
        ticker.beat()
        watch.flush()
        XCTAssertTrue(events.named("annotationsChanged").isEmpty, "hidden: nothing is looked at")

        watch.setVisible(true)
        watch.flush()
        XCTAssertTrue(ticker.running)
        XCTAssertEqual(events.named("annotationsChanged").count, 1, "shown: looked at once, without waiting for a beat")
    }

    func testTellingTheSameVisibilityAgainChangesNothing() {
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(), emit: { _, _ in }, ticker: ticker)
        watch.start()
        watch.setVisible(true)
        XCTAssertTrue(ticker.running)
        watch.setVisible(false)
        watch.setVisible(false)
        XCTAssertFalse(ticker.running)
    }

    func testAWindowThatIsHiddenWhenTheWatchStartsGetsItsTimerWhenItIsShown() {
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(), emit: { _, _ in }, ticker: ticker)
        watch.setVisible(false)
        watch.start()
        XCTAssertFalse(ticker.running)
        watch.setVisible(true)
        XCTAssertTrue(ticker.running)
    }

    func testTheItemEventCarriesTheEntriesAndCanBeSentToThePage() throws {
        let dir = makeTempDir()
        let folder = dir + "/assets"
        let hero = folder + "/hero.png"
        writeText(bytes(100), to: hero)
        let events = Events()
        let ticker = ManualTicker()
        let watch = ChangeWatch(settings: makeSettings(library: [folder], selected: hero), emit: events.add, ticker: ticker)
        watch.start()
        watch.flush()

        writeText(bytes(200), to: hero)
        ticker.beat()
        watch.flush()

        let pushed = events.named("materialsChanged")
        XCTAssertEqual(pushed.count, 1)
        XCTAssertEqual(pushed.first?["entries"] as? [String], [folder])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(try XCTUnwrap(pushed.first)))
    }

    /// The one test of the real timer; it runs on a 20 millisecond interval
    func testTheDispatchTickerBeatsUntilStopped() {
        let ticker = DispatchTicker(interval: 0.02)
        let beats = Counter()
        ticker.start { beats.increment() }
        let deadline = Date().addingTimeInterval(5)
        while beats.value < 3 && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
        ticker.stop()
        XCTAssertGreaterThanOrEqual(beats.value, 3)

        // A beat already under way when it stopped may still land; after that there are none
        Thread.sleep(forTimeInterval: 0.1)
        let settled = beats.value
        Thread.sleep(forTimeInterval: 0.1)
        XCTAssertEqual(beats.value, settled, "stopped")
    }
}

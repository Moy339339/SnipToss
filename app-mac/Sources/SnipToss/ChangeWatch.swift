import Foundation

// Detecting notes and items that changed outside the app: an agent wrote notes back, or edited an item according to the notes.
// Both watchers poll and compare fingerprints (docs/host-api.md, "How often the shell checks for changes"); neither uses file system
// events, the same design as the Windows shell: a network volume does not report changes made from another computer, and one rule
// then works on every volume.

/// How the watchers ask about the volumes their paths are on: the shared checker in the app, a stand-in in tests.
/// Nothing on a volume that is not connected is looked at (a network volume that stopped answering holds a `stat` for 10 to 40 seconds)
struct WatchVolumes {
    /// Asks about the volumes of these paths together, waiting at most a moment (`Volumes.wait`)
    var wait: ([String]) -> Void = { Volumes.wait($0) }
    /// The answer after `wait` (`Volumes.known`); nil, a volume that has not answered, counts as not connected
    var known: (String) -> Bool? = { Volumes.known($0) }
}

// MARK: - Notes

/// How the notes of one notes folder looked at one look
enum NotesSignature: Equatable {
    /// Every `*.json` file in `.sniptoss/annotations` by name, with its size and modification time; empty when the folder is absent
    case files([String: String])
    /// The folder could not be listed (a network volume that dropped): differs from every earlier look, so the folder is read once
    case unreadable

    var byName: [String: String]? {
        if case .files(let map) = self { return map }
        return nil
    }
}

/// The `.sniptoss/annotations` of each notes folder: once a second, look at file names, sizes and modification times; on a change, read the
/// whole folder and hand it to the page (`annotationsChanged`).
/// A folder that does not exist yet is watched too: one created elsewhere (an agent, a manual copy) is synced when it appears.
/// A missing project folder itself (its volume disconnected, or moved away) is not a change: counting it as "all notes deleted" would clear
/// the notes panel, and report again when the volume came back.
/// A notes file this app wrote itself (`noteWritten`) is recognized by its own size and modification time and is not announced; a change
/// to any other file, or a later change to that file, still is. Everything is checked on one serial queue, so a slow volume holds up
/// only this watcher
final class AnnotationWatcher {
    /// The notes folder, every notes file in it (`name`, `text`) and the ordering number taken before they were read
    typealias Changed = (String, [[String: Any]], Int) -> Void

    private struct Watched {
        let home: String
        /// The last look that was announced or recorded; nil if there was none yet, or the project folder itself was missing
        var seen: NotesSignature?
    }

    private let volumes: WatchVolumes
    private let sign: (String) -> NotesSignature?
    private let read: (String) throws -> [[String: Any]]
    private let changed: Changed
    private let queue = DispatchQueue(label: "snip.watch.notes", qos: .utility)
    /// Guards everything below. Never held while the disk is touched or `changed` is called
    private let lock = NSLock()
    /// By `Library.key` of the notes folder
    private var watched: [String: Watched] = [:]
    private var order: [String] = []
    /// What the app's own writes left behind: the notes folder key, then the file name (`nameKey`), then the stamp of the file right after
    /// the write
    private var ownWrites: [String: [String: String]] = [:]
    private var paused = false
    private var checking = false

    /// - Parameter sign: how a folder is looked at; tests count the looks
    /// - Parameter read: how the notes files are read once a change was seen
    init(
        volumes: WatchVolumes = WatchVolumes(),
        sign: @escaping (String) -> NotesSignature? = { AnnotationWatcher.signature(of: $0) },
        read: @escaping (String) throws -> [[String: Any]] = { try NotesStore.readAnnotations(home: $0) },
        changed: @escaping Changed
    ) {
        self.volumes = volumes
        self.sign = sign
        self.read = read
        self.changed = changed
    }

    /// Starts watching this notes folder (call it before reading its notes and after writing to it; repeated calls are harmless).
    /// What is recorded is how it looks at the first call: every later change is announced
    func watch(_ home: String) {
        let key = Library.key(home)
        lock.lock()
        let known = watched[key] != nil
        lock.unlock()
        if known { return }
        // Looked at outside the lock. A volume that is not connected is not asked about; it is looked at once it is
        let seen: NotesSignature? = volumes.known(home) == true ? sign(home) : nil
        lock.lock()
        if watched[key] == nil {
            watched[key] = Watched(home: home, seen: seen)
            order.append(key)
        }
        lock.unlock()
    }

    /// A notes file this app has just written (called inside the write lock, so nobody else's version can be taken for its own).
    /// Its size and modification time are remembered; the next look does not announce a difference that is only that file as written
    func noteWritten(home: String, file: String) {
        let dir = Library.join(Library.join(home, DataDir.name), "annotations")
        guard let parent = Library.parentDirectory(of: file), Library.key(parent) == Library.key(dir) else { return }
        let name = Library.nameOf(file)
        guard name.hasSuffix(".json"), let stamp = AnnotationWatcher.fileStamp(file) else { return }
        lock.lock()
        ownWrites[Library.key(home), default: [:]][AnnotationWatcher.nameKey(name)] = stamp
        lock.unlock()
    }

    /// Stops while the window is hidden (the app stays open for weeks) so network volumes are not woken constantly; looks once at once
    /// when shown again
    func pause(_ pause: Bool) {
        lock.lock()
        paused = pause
        lock.unlock()
        if !pause { checkSoon() }
    }

    /// One beat of the timer
    func tick() {
        lock.lock()
        let off = paused
        lock.unlock()
        if !off { checkSoon() }
    }

    /// Waits until the looks already under way are done. For tests
    func flush() {
        queue.sync {}
    }

    private func checkSoon() {
        lock.lock()
        // The previous look has not finished (a slow volume): that one is enough
        if checking || paused || watched.isEmpty {
            lock.unlock()
            return
        }
        checking = true
        lock.unlock()
        queue.async { [self] in
            check()
            lock.lock()
            checking = false
            lock.unlock()
        }
    }

    private func check() {
        var targets: [(key: String, home: String, seen: NotesSignature?)] = []
        lock.lock()
        for key in order {
            if let entry = watched[key] { targets.append((key: key, home: entry.home, seen: entry.seen)) }
        }
        lock.unlock()
        // Volumes that are not connected are not looked at: one project on such a volume would otherwise delay the changes of the others
        // by the system timeout
        volumes.wait(targets.map { $0.home })
        for target in targets {
            guard volumes.known(target.home) == true, let now = sign(target.home) else { continue }
            if target.seen == now { continue }
            if isOwnWrite(key: target.key, before: target.seen, after: now) {
                remember(target.key, now)
                continue
            }
            // The number is taken before reading (ADR-0005 item 8, hard rule 3a): the page uses it to recognize a late, old notification
            let seq = NotesStore.observe()
            let files: [[String: Any]]
            do {
                files = try read(target.home)
            } catch {
                // Being written, or unreadable: not recorded, so the next look tries again
                continue
            }
            // The project folder vanished during the read (its volume just disconnected): an empty list read then does not count
            if !Library.isDirectory(target.home) { continue }
            remember(target.key, now)
            changed(target.home, files, seq)
        }
    }

    private func remember(_ key: String, _ signature: NotesSignature) {
        lock.lock()
        watched[key]?.seen = signature
        lock.unlock()
    }

    /// Whether every file that differs between the two looks is exactly as this app wrote it
    private func isOwnWrite(key: String, before: NotesSignature?, after: NotesSignature) -> Bool {
        guard let was = before?.byName, let now = after.byName else { return false }
        lock.lock()
        let own = ownWrites[key] ?? [:]
        lock.unlock()
        if own.isEmpty { return false }
        var different = 0
        for name in Set(was.keys).union(now.keys) where was[name] != now[name] {
            guard let stamp = now[name], own[AnnotationWatcher.nameKey(name)] == stamp else { return false }
            different += 1
        }
        return different > 0
    }

    // MARK: Looking at the disk

    /// The `*.json` files in `.sniptoss/annotations` by name with their size and modification time; empty if that folder is absent; nil if
    /// the project folder itself is missing (not a change; wait for it to return)
    static func signature(of home: String) -> NotesSignature? {
        if !Library.isDirectory(home) { return nil }
        let dir = Library.join(Library.join(home, DataDir.name), "annotations")
        if !Library.isDirectory(dir) { return .files([:]) }
        let names: [String]
        do {
            names = try FileManager.default.contentsOfDirectory(atPath: dir)
        } catch {
            return .unreadable
        }
        var files: [String: String] = [:]
        for name in names where name.hasSuffix(".json") {
            if let stamp = fileStamp(Library.join(dir, name)) { files[name] = stamp }
        }
        return .files(files)
    }

    /// Size and modification time (to the nanosecond) of a regular file, following links like the read does; nil for anything else
    static func fileStamp(_ path: String) -> String? {
        var st = stat()
        guard stat(path, &st) == 0, (Int(st.st_mode) & 0o170000) == 0o100000 else { return nil }
        return "\(st.st_size):\(st.st_mtimespec.tv_sec).\(st.st_mtimespec.tv_nsec)"
    }

    /// A file name as it is compared: the same name composed or decomposed is one file
    private static func nameKey(_ name: String) -> String {
        name.precomposedStringWithCanonicalMapping
    }
}

// MARK: - Items

/// Items changed externally (an agent edited an image according to the notes, generated new files, deleted old ones): makes the page rescan
/// that entry (`materialsChanged`).
/// The open file is checked every second (that is mostly what an agent edits); when the window returns to the foreground, and now and then
/// in the background, every library entry is scanned and fingerprints compared. The item address the page holds carries the modification
/// time from the scan, so without a rescan the address would stay the same and the page would keep showing the stale cached image.
/// The two checks run on two queues: a slow scan of a large folder does not hold up the check of the open file
final class MaterialWatcher {
    /// Interval of the background full scan: at least 10 seconds; if a scan is slow (large folders, network volumes) it is stretched to
    /// 20 times its duration
    static let fullEvery: TimeInterval = 10

    /// Fingerprint for when the volume is not connected (a stick unplugged, a share disconnected)
    static let offline = "offline"

    private let settings: Settings
    private let clock: () -> TimeInterval
    private let volumes: WatchVolumes
    private let changed: ([String]) -> Void
    private let currentQueue = DispatchQueue(label: "snip.watch.current", qos: .utility)
    private let fullQueue = DispatchQueue(label: "snip.watch.full", qos: .utility)
    /// Guards everything below. Never held while the disk is touched or `changed` is called
    private let lock = NSLock()
    /// Library entry (`Library.key`) to its fingerprint at the last full scan. The first sighting is only recorded, not announced
    private var signatures: [String: String] = [:]
    /// Every item file seen in the last full scan (`Library.key` of the path) to its size and modification time. The open file is compared
    /// against this; comparing it with its state at its first check instead would take a change made just before that check for the
    /// starting point, and never announce it
    private var files: [String: String] = [:]
    private var nextFull = -TimeInterval.infinity
    private var lastFull = -TimeInterval.infinity
    private var scanning = false
    private var checkingCurrent = false
    private var paused = false

    /// - Parameter clock: seconds on a monotonic clock; tests move it by hand
    /// - Parameter changed: the library entries whose files changed
    init(
        settings: Settings, clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        volumes: WatchVolumes = WatchVolumes(), changed: @escaping ([String]) -> Void
    ) {
        self.settings = settings
        self.clock = clock
        self.volumes = volumes
        self.changed = changed
    }

    /// Records the starting point: the first full scan announces nothing
    func start() {
        scheduleFull()
    }

    /// One beat of the timer: the open file now, everything when the full scan is due
    func tick() {
        lock.lock()
        let off = paused
        let due = clock() >= nextFull
        lock.unlock()
        if off { return }
        scheduleCurrent()
        if due { scheduleFull() }
    }

    /// Window back in the foreground: scan everything right away (the user has probably just come back from having an agent edit things
    /// elsewhere), unless that was done a moment ago
    func windowActivated() {
        lock.lock()
        let off = paused
        let recent = clock() - lastFull <= 2
        lock.unlock()
        if !off && !recent { scheduleFull() }
    }

    /// Stops while the window is hidden (the app stays open for weeks): scanning the whole library every 10 seconds and the open file
    /// every second would constantly wake network volumes and sleeping NAS units. Checks immediately when shown again
    func pause(_ pause: Bool) {
        lock.lock()
        paused = pause
        lock.unlock()
        if pause { return }
        scheduleCurrent()
        windowActivated()
    }

    /// Waits until the checks already under way are done. For tests
    func flush() {
        currentQueue.sync {}
        fullQueue.sync {}
    }

    private func scheduleCurrent() {
        lock.lock()
        // The previous check has not finished (a slow volume): that one is enough
        if checkingCurrent {
            lock.unlock()
            return
        }
        checkingCurrent = true
        lock.unlock()
        currentQueue.async { [self] in
            checkCurrent()
            lock.lock()
            checkingCurrent = false
            lock.unlock()
        }
    }

    private func scheduleFull() {
        lock.lock()
        if scanning {
            lock.unlock()
            return
        }
        scanning = true
        lock.unlock()
        fullQueue.async { [self] in
            fullCheck()
            lock.lock()
            scanning = false
            lock.unlock()
        }
    }

    private func checkCurrent() {
        guard let path = settings.selected else { return }
        volumes.wait([path])
        let signature = volumes.known(path) == true ? MaterialWatcher.fileSignature(path) : MaterialWatcher.offline
        let key = Library.key(path)
        lock.lock()
        let before = files[key]
        files[key] = signature
        lock.unlock()
        guard let known = before, known != signature, let entry = entryOf(path) else { return }
        // The next full scan only records it again, so the same change is not announced twice
        lock.lock()
        signatures[Library.key(entry)] = nil
        lock.unlock()
        changed([entry])
    }

    private func fullCheck() {
        let started = clock()
        lock.lock()
        lastFull = started
        nextFull = started + MaterialWatcher.fullEvery
        lock.unlock()
        defer {
            let took = clock() - started
            lock.lock()
            nextFull = clock() + (took * 20 > MaterialWatcher.fullEvery ? took * 20 : MaterialWatcher.fullEvery)
            lock.unlock()
        }

        let values = settings.current
        let entries = values.library.map { $0.path }
        let kinds = values.enabledKinds
        let skip = values.skipDirs
        var seen: [String: String] = [:]
        var results: [(entry: String, signature: String)] = []
        // Volumes that are not connected are recorded as offline and not scanned (a disconnected network volume takes ten-odd seconds per
        // query): one entry on such a volume would otherwise make a round take tens of seconds, the interval stretch to ten-odd minutes,
        // and changes to other items go unseen. When the volume comes back its fingerprint changes from offline and the page rescans it
        volumes.wait(entries)
        for entry in entries {
            if volumes.known(entry) == true {
                results.append((entry: entry, signature: MaterialWatcher.entrySignature(entry, kinds: kinds, skipDirs: skip, seen: &seen)))
            } else {
                results.append((entry: entry, signature: MaterialWatcher.offline))
            }
        }

        var dirty: [String] = []
        lock.lock()
        for result in results {
            let key = Library.key(result.entry)
            if let old = signatures[key], old != result.signature { dirty.append(result.entry) }
            signatures[key] = result.signature
        }
        files = seen
        let listed = Set(entries.map { Library.key($0) })
        signatures = signatures.filter { listed.contains($0.key) }
        lock.unlock()
        if !dirty.isEmpty { changed(dirty) }
    }

    /// The library entry that is this path or a folder above it
    private func entryOf(_ path: String) -> String? {
        settings.library.map { $0.path }.first { Library.same($0, path) || Library.inside(path, $0) }
    }

    // MARK: Looking at the disk

    /// Size and modification time (milliseconds, the same as what the scan gives the page) of an item; `other` for a file that is not an
    /// item, `missing` if it is gone
    static func fileSignature(_ path: String) -> String {
        // A settings file damaged by hand edits (an empty path, a NUL, a relative path) names no file
        if path.unicodeScalars.first != "/" || path.unicodeScalars.contains("\0") { return "missing" }
        if let found = MaterialScanner.describe(path) { return itemSignature(found) }
        return Library.isFile(path) ? "other" : "missing"
    }

    private static func itemSignature(_ found: MaterialScanner.Found) -> String {
        "\(found.size):\(found.mtime)"
    }

    /// A folder: the items found by the scan rules (path, size, modification time) and the counts at its end; a single file: its size and
    /// modification time. Every file seen is recorded in `seen`
    private static func entrySignature(
        _ entry: String, kinds: Set<String>, skipDirs: Set<String>, seen: inout [String: String]
    ) -> String {
        let root = (try? Library.norm(entry)) ?? entry
        if !Library.isDirectory(root) {
            let signature = fileSignature(root)
            seen[Library.keyOf(root)] = signature
            return signature
        }
        var hasher = Hasher()
        let stats = MaterialScanner.Stats()
        for found in MaterialScanner.scan(root, enabledKinds: kinds, skipDirs: skipDirs, stats: stats) {
            hasher.combine(found.fullPath)
            hasher.combine(found.size)
            hasher.combine(found.mtime)
            seen[Library.keyOf(found.fullPath)] = itemSignature(found)
        }
        // The line at the end of the folder, "N more files aren't supported yet", must follow too: one more psd also counts as a change
        hasher.combine(stats.others)
        hasher.combine(stats.moreOff)
        return "d" + String(hasher.finalize())
    }
}

// MARK: - Both together

/// Calls its handler once a second while running. The app uses a dispatch timer; tests use one they fire by hand
protocol Ticker: AnyObject {
    func start(_ fire: @escaping () -> Void)
    func stop()
}

final class DispatchTicker: Ticker {
    private let interval: TimeInterval
    private let queue = DispatchQueue(label: "snip.watch.ticker", qos: .utility)
    private let lock = NSLock()
    private var source: DispatchSourceTimer?

    init(interval: TimeInterval = 1) {
        self.interval = interval
    }

    func start(_ fire: @escaping () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        source?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(100))
        timer.setEventHandler { fire() }
        timer.resume()
        source = timer
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        source?.cancel()
        source = nil
    }
}

/// The two watchers, one timer, and the events they send (`annotationsChanged`, `materialsChanged`). The window tells it when it is shown
/// or hidden: while hidden nothing is checked and the timer stops, and when it is shown again everything is checked once at once
final class ChangeWatch {
    let annotations: AnnotationWatcher
    let materials: MaterialWatcher
    private let ticker: Ticker
    private let lock = NSLock()
    private var started = false
    private var visible = true

    /// - Parameter emit: sends an event to the page (`BridgeHost.emit`); called from background queues
    init(
        settings: Settings, emit: @escaping (String, [String: Any]) -> Void, ticker: Ticker = DispatchTicker(),
        clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }, volumes: WatchVolumes = WatchVolumes()
    ) {
        self.ticker = ticker
        annotations = AnnotationWatcher(
            volumes: volumes,
            changed: { home, files, seq in
                emit("annotationsChanged", ["home": home, "seq": seq, "annotations": files])
            })
        materials = MaterialWatcher(
            settings: settings, clock: clock, volumes: volumes,
            changed: { entries in
                emit("materialsChanged", ["entries": entries])
            })
    }

    /// Records the starting point of the items and starts the timer (if the window is shown)
    func start() {
        lock.lock()
        let first = !started
        started = true
        let shown = visible
        lock.unlock()
        if !first { return }
        materials.start()
        if shown { startTicker() }
    }

    /// The window can be seen / cannot be seen
    func setVisible(_ shown: Bool) {
        lock.lock()
        let was = visible
        visible = shown
        let live = started
        lock.unlock()
        if was == shown { return }
        annotations.pause(!shown)
        materials.pause(!shown)
        if !live { return }
        if shown { startTicker() } else { ticker.stop() }
    }

    /// The app came to the foreground
    func windowActivated() {
        materials.windowActivated()
    }

    /// For `readHomes` and the writing methods: starts watching a notes folder
    func startWatching(_ home: String) {
        annotations.watch(home)
    }

    /// For `writeAnnotation`: this file was written by the app itself
    func noteWritten(home: String, file: String) {
        annotations.noteWritten(home: home, file: file)
    }

    /// Waits until the checks already under way are done. For tests
    func flush() {
        annotations.flush()
        materials.flush()
    }

    private func startTicker() {
        ticker.start { [weak self] in self?.tick() }
    }

    private func tick() {
        annotations.tick()
        materials.tick()
    }
}

import Foundation

/// Whether the volume an item is on is mounted. An item under /Volumes/<name> lives on that mounted volume (a USB drive, a network
/// share, a disk image); when the folder /Volumes/<name> is gone, the volume is not connected, and the item was not deleted: it is
/// back once the volume is. Everything outside /Volumes is on the boot volume, which is always there.
///
/// A network volume that stopped answering makes one `stat` wait for the system timeout, 10 to 40 seconds. So nothing that serves the
/// page asks the disk about such a path directly: the volume is checked in the background, once per volume, the answer is remembered for
/// a moment, and a caller waits only a short while for it. A volume that has not answered counts as not connected for now.
/// No event is sent when a volume comes back; the periodic check for changed items sees the entry change and the page rescans it
enum Volumes {
    static let shared = VolumeChecker()

    /// The mount point an absolute path is on: /Volumes/<name>; nil when the path is not under /Volumes (or is /Volumes itself)
    static func rootOf(_ path: String) -> String? {
        guard let full = try? Library.norm(path) else { return nil }
        let parts = Library.components(full)
        guard parts.count >= 2, parts[0].lowercased() == "volumes" else { return nil }
        return "/Volumes/" + parts[1]
    }

    /// Whether the volume of this path was there at the last check; true for paths outside /Volumes, nil when the volume was never checked
    /// or the first check has not finished. Does not touch the disk. Call `wait` first and use this afterwards: it reflects that moment
    static func known(_ path: String) -> Bool? {
        shared.known(path)
    }

    /// Checks the volumes of these paths together (different volumes in parallel), waiting at most 0.4 seconds in all. After it returns,
    /// `known` is the answer; a volume that has not answered yet is nil there, which callers treat as not connected
    static func wait(_ paths: [String]) {
        shared.wait(for: paths)
    }

    /// Whether the volume of this path is mounted, waiting until the answer is certain (a path the user explicitly added on a sleeping
    /// NAS must not be called missing after a short wait). May take as long as the system timeout; background threads only
    static func isThere(_ path: String) -> Bool {
        shared.thereWait(path)
    }

    /// Starts checking the volumes of these paths without waiting, so the first real question finds the answers ready
    static func prefetch(_ paths: [String]) {
        shared.prefetch(paths)
    }
}

/// The checking behind `Volumes`. The probe and the clock can be replaced so a test can stand in a volume that never answers
final class VolumeChecker {
    /// Asks the system whether a mount point exists (the argument is /Volumes/<name>). May take very long on a share that stopped answering
    typealias Probe = (String) -> Bool

    /// The longest a caller waits: a local volume answers in under a millisecond, a connected network volume in tens of milliseconds
    let patience: TimeInterval
    /// How long to wait for a volume that was absent at the last check: a stick plugged back in answers at once, and one that is still
    /// gone need not be waited on for the full patience every time
    let quick: TimeInterval
    /// How long an answer is remembered: volumes come and go, and remembering too long would miss one plugged back in
    let freshFor: TimeInterval

    private let probe: Probe
    private let clock: () -> TimeInterval
    private let queue = DispatchQueue(label: "snip.volumes", qos: .utility, attributes: .concurrent)
    private let lock = NSLock()
    /// By `Library.keyOf` of the mount point
    private var checks: [String: Check] = [:]

    init(
        patience: TimeInterval = 0.4, quick: TimeInterval = 0.05, freshFor: TimeInterval = 2,
        probe: @escaping Probe = { FileManager.default.fileExists(atPath: $0) },
        clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.patience = patience
        self.quick = quick
        self.freshFor = freshFor
        self.probe = probe
        self.clock = clock
    }

    /// One question to the system: in flight until `finish`, then an answer with the time it came
    private final class Check {
        /// Entered when the check is created and left when it finishes, so any number of callers can wait for it
        let finished = DispatchGroup()
        private let lock = NSLock()
        private var result: Bool?
        private var answeredAt: TimeInterval = 0

        init() {
            finished.enter()
        }

        /// nil while the question is still being asked
        var answer: Bool? {
            lock.lock()
            defer { lock.unlock() }
            return result
        }

        func isFresh(now: TimeInterval, within seconds: TimeInterval) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            return result != nil && now - answeredAt < seconds
        }

        func finish(_ there: Bool, at time: TimeInterval) {
            lock.lock()
            result = there
            answeredAt = time
            lock.unlock()
            finished.leave()
        }
    }

    /// The check in flight or just finished for this mount point, or a new one started on a background thread
    private func lookup(_ root: String) -> Check {
        let key = Library.keyOf(root)
        lock.lock()
        defer { lock.unlock() }
        if let existing = checks[key], existing.answer == nil || existing.isFresh(now: clock(), within: freshFor) {
            return existing
        }
        let check = Check()
        checks[key] = check
        let ask = probe
        let now = clock
        queue.async {
            let there = ask(root)
            check.finish(there, at: now())
        }
        return check
    }

    /// The finished answer for a mount point, whatever its age
    private func finishedAnswer(_ root: String) -> Bool? {
        lock.lock()
        defer { lock.unlock() }
        return checks[Library.keyOf(root)]?.answer
    }

    func known(_ path: String) -> Bool? {
        guard let root = Volumes.rootOf(path) else { return true }
        return finishedAnswer(root)
    }

    func wait(for paths: [String]) {
        var waiting: [Check] = []
        var seen = Set<String>()
        var anyNotKnownAbsent = false
        for path in paths {
            guard let root = Volumes.rootOf(path), seen.insert(Library.keyOf(root)).inserted else { continue }
            let before = finishedAnswer(root)
            let check = lookup(root)
            if check.answer != nil { continue }
            waiting.append(check)
            if before != false { anyNotKnownAbsent = true }
        }
        if waiting.isEmpty { return }
        let deadline = DispatchTime.now() + (anyNotKnownAbsent ? patience : min(quick, patience))
        for check in waiting {
            if check.finished.wait(timeout: deadline) == .timedOut { return }
        }
    }

    func thereWait(_ path: String) -> Bool {
        guard let root = Volumes.rootOf(path) else { return true }
        let check = lookup(root)
        check.finished.wait()
        return check.answer ?? false
    }

    func prefetch(_ paths: [String]) {
        var seen = Set<String>()
        for path in paths {
            guard let root = Volumes.rootOf(path), seen.insert(Library.keyOf(root)).inserted else { continue }
            _ = lookup(root)
        }
    }
}

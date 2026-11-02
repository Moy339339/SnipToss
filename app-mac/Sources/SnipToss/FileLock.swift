import CryptoKit
import Foundation

/// A lock that could not be taken
enum FileLockError: Error, CustomStringConvertible {
    /// Another writer held the lock for the whole wait
    case stayedLocked(String)

    var description: String {
        switch self {
        case .stayedLocked(let path): return "Annotation file stayed locked by another writer: \(path)"
        }
    }
}

/// Cross-process write lock (docs/adr/0005-write-protocol.md, "Lock"): a `.<file name>.lock` next to the notes file, taken by creating it
/// exclusively (`O_EXCL`), holding "process id, time in milliseconds, computer id" (see `machineId`) and deleted when the write is done.
/// The command line (`withFileLock` in packages/cli/src/fs-store.ts) and the Windows shell (app/FileLock.cs) use the same name and the same
/// rules, so the UI, the command line and several agents writing the same notes file take turns, and nobody can slip in between the
/// comparison before a write and the write itself. It must stay the same protocol: a lock the other side does not recognize is no lock.
/// `flock(2)` is not used for that reason: the command line does not look at it.
/// A lock left behind by a crashed process is reclaimed: its writer is gone (checked only for locks written on this computer: the process
/// id of a lock written over a network volume belongs to another computer), or the lock file has not been touched for `staleAfter`
enum FileLock {
    /// How long to wait for the lock: other writers need a few milliseconds per write, so a much longer wait means it is stuck
    static let defaultWait: TimeInterval = 10
    /// A lock file untouched for this long is left over, whatever its writer's process id says (the id may have been reused)
    static let staleAfter: TimeInterval = 10
    /// Creating the lock keeps being refused (no permission) for this long: the folder is not writable, so stop waiting
    static let deniedLimit: TimeInterval = 1

    /// The name of this computer. The command line takes `COMPUTERNAME` if set, otherwise `os.hostname()`, which is what `gethostname` returns
    static let machineName: String = {
        if let name = ProcessInfo.processInfo.environment["COMPUTERNAME"] { return name }
        let size = 256
        var buffer = [CChar](repeating: 0, count: size)
        if gethostname(&buffer, size) == 0 {
            return buffer.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
        }
        return ProcessInfo.processInfo.hostName
    }()

    /// What the lock says about the computer: the first 16 hex digits of the SHA-256 of the lowercased name (UTF-8), never the name itself.
    /// A Mac's name is often the owner's name ("Ann's MacBook Pro"), and a lock left behind by a crash can travel with the project
    /// (a synced folder, an archive). The same function as `machineId` in packages/cli/src/fs-store.ts;
    /// `tests/golden/lock-machine.json` holds the cases both must agree on
    static func machineId(of name: String) -> String {
        let digest = SHA256.hash(data: Data(name.lowercased().utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    static let machine: String = machineId(of: machineName)

    /// The lock file of a notes file: `.<file name>.lock` in the same folder
    static func pathFor(_ file: String) -> String {
        let full = (try? Library.norm(file)) ?? file
        let dir = (full as NSString).deletingLastPathComponent
        let name = (full as NSString).lastPathComponent
        return Library.join(dir.isEmpty ? "." : dir, "." + name + ".lock")
    }

    /// A lock that is held. Releasing deletes the lock file, unless someone else has replaced it meanwhile
    final class Held {
        private let path: String
        private let content: String
        private let guardLock = NSLock()
        private var done = false

        fileprivate init(path: String, content: String) {
            self.path = path
            self.content = content
        }

        /// A holder that is dropped without being released still gives the lock up
        deinit {
            release()
        }

        /// Safe to call more than once
        func release() {
            guardLock.lock()
            let alreadyDone = done
            done = true
            guardLock.unlock()
            if alreadyDone { return }
            FileLock.remove(path, ownedContent: content)
        }
    }

    /// Takes the lock for a notes file, waiting up to `wait` seconds. Throws `FileLockError.stayedLocked` when another writer kept it, and
    /// a `FileOperationError` when the lock file cannot be created (no permission for a full second, a read-only volume, ...)
    static func acquire(_ file: String, wait: TimeInterval = FileLock.defaultWait) throws -> Held {
        let path = pathFor(file)
        try AtomicFile.ensureDirectory((path as NSString).deletingLastPathComponent)
        let started = uptime()
        var deniedSince: TimeInterval?
        while true {
            let content = "\(ProcessInfo.processInfo.processIdentifier) \(Int64(Date().timeIntervalSince1970 * 1000)) \(machine)"
            let fd = Darwin.open(path, O_WRONLY | O_CREAT | O_EXCL, 0o644)
            if fd >= 0 {
                try fill(fd, with: content, path: path)
                return Held(path: path, content: content)
            }
            let code = errno
            if code == EEXIST {
                // Someone holds it. If they are gone, take their place at once instead of waiting
                deniedSince = nil
                if reclaimIfStale(path) { continue }
            } else if code == EACCES || code == EPERM || code == EBUSY {
                // Refused continuously for a second means the folder is not writable, so do not wait the full time
                let since = deniedSince ?? uptime()
                deniedSince = since
                if uptime() - since > deniedLimit { throw FileOperationError(operation: "create lock", path: path, code: code) }
            } else {
                throw FileOperationError(operation: "create lock", path: path, code: code)
            }
            if uptime() - started > wait { throw FileLockError.stayedLocked(path) }
            Thread.sleep(forTimeInterval: Double.random(in: 0.002...0.012))
        }
    }

    /// Runs `body` while holding the lock
    static func withLock<T>(_ file: String, wait: TimeInterval = FileLock.defaultWait, _ body: () throws -> T) throws -> T {
        let held = try acquire(file, wait: wait)
        defer { held.release() }
        return try body()
    }

    // MARK: Taking and judging a lock file

    private static func uptime() -> TimeInterval {
        ProcessInfo.processInfo.systemUptime
    }

    /// Writes what the lock says about its holder. A lock that could not be filled in is removed again: an empty lock would look valid
    /// for `staleAfter` seconds
    private static func fill(_ fd: Int32, with content: String, path: String) throws {
        let bytes = Array(content.utf8)
        var failure: Int32 = 0
        var offset = 0
        while offset < bytes.count {
            let written = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress! + offset, bytes.count - offset) }
            if written < 0 {
                if errno == EINTR { continue }
                failure = errno
                break
            }
            offset += written
        }
        Darwin.close(fd)
        if failure != 0 {
            _ = Darwin.unlink(path)
            throw FileOperationError(operation: "write lock", path: path, code: failure)
        }
    }

    /// Reads the lock without holding it shut: a reader never keeps anyone from deleting it. nil when it is gone or cannot be read
    private static func readLock(_ path: String) -> String? {
        guard let data = try? AtomicFile.readAllBytes(path) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }

    /// Deletes the lock if a crashed process left it, and tells whether it did. Reads it again before deleting and deletes only if it is
    /// still the same lock: someone may have just released it and put a new one there, which must not be deleted
    private static func reclaimIfStale(_ path: String) -> Bool {
        guard let stale = staleContent(path), let again = readLock(path), again == stale else { return false }
        return Darwin.unlink(path) == 0
    }

    /// The content of the lock if it was left behind (to check again before deleting), nil if it is still valid. A lock that cannot be read
    /// (just deleted) or has no readable holder yet (just created, not filled in) counts as valid unless it is old
    static func staleContent(_ path: String) -> String? {
        guard let text = readLock(path) else { return nil }
        let parts = text.components(separatedBy: " ")
        let pid = Int32(parts[0]) ?? 0
        // Written by another computer (the item is on a network volume): the process id belongs to that computer and cannot be checked
        // here, so only look at how long the lock has been untouched. A lock from before the computer was written as an id names it
        // outright; that still counts as this computer's
        let here = parts.count < 3 || parts[2] == machine || parts[2].lowercased() == machineName.lowercased()
        if here && pid > 0 && !isAlive(pid) { return text }
        guard let modified = modifiedAt(path) else { return nil }
        return Date().timeIntervalSince1970 - modified > staleAfter ? text : nil
    }

    private static func isAlive(_ pid: pid_t) -> Bool {
        if Darwin.kill(pid, 0) == 0 { return true }
        // Another user's process: it exists, we just may not signal it
        return errno == EPERM
    }

    private static func modifiedAt(_ path: String) -> TimeInterval? {
        var st = stat()
        guard stat(path, &st) == 0 else { return nil }
        return TimeInterval(st.st_mtimespec.tv_sec) + TimeInterval(st.st_mtimespec.tv_nsec) / 1_000_000_000
    }

    /// Deletes our own lock. Not deleted when it has been replaced: this lock was judged left over (the writer was slower than
    /// `staleAfter`) and another writer holds the file now. A refusal to delete is retried a while, like the command line does:
    /// giving up on the first one would leave the lock in place for every other writer to wait out
    fileprivate static func remove(_ path: String, ownedContent: String) {
        if let current = readLock(path), current != ownedContent { return }
        var attempt = 1
        while true {
            if Darwin.unlink(path) == 0 { return }
            let code = errno
            if code == ENOENT { return }
            if (code == EPERM || code == EBUSY || code == EACCES) && attempt < 200 {
                Thread.sleep(forTimeInterval: 0.005)
                attempt += 1
                continue
            }
            return
        }
    }
}

import CryptoKit
import Foundation

/// Reading and writing the notes data of a notes folder ("home"): the notes files in `.sniptoss/annotations/`, `project.json`, the
/// snapshots. Every function here takes a path or a home that the caller has already checked (`NotesHomes`, `PathPolicy.inDataDir`).
/// The write protocol is docs/adr/0005-write-protocol.md; the command line follows the same one (packages/cli/src/fs-store.ts)
enum NotesStore {
    // MARK: Ordering numbers

    private static let sequenceLock = NSLock()
    private static var observed = 0

    /// The next ordering number of the notes content that is read or written (ADR-0005 item 8, hard rule 3a). Reads of a notes folder
    /// and change notifications take theirs **before** reading; a write takes its number **inside the lock**, once its content is
    /// fixed. A number taken before a read that is larger than one taken inside some lock means the file was opened after that write,
    /// so what was read is not older. One counter for the whole program, so numbers from different files compare too
    static func observe() -> Int {
        sequenceLock.lock()
        defer { sequenceLock.unlock() }
        observed += 1
        return observed
    }

    // MARK: Fingerprint

    /// SHA-256 of a text, over its UTF-8 bytes, as lower-case hex: the same as `textSha256` in packages/web/src/host.ts. nil for nil
    static func textSha256(_ text: String?) -> String? {
        guard let text = text else { return nil }
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Reading

    /// The notes files of a home, as they are on disk (the shell does not parse them): `name` is the file name, `text` the content without
    /// a byte order mark. Sorted by name. Does not hold anything shut, so an agent replacing a file meanwhile is not held up. A file
    /// deleted between listing and reading is left out
    static func readAnnotations(home: String) throws -> [[String: Any]] {
        let dir = Library.join(Library.join(home, DataDir.name), "annotations")
        guard Library.isDirectory(dir) else { return [] }
        var result: [[String: Any]] = []
        for name in try listNames(dir).filter({ $0.hasSuffix(".json") }).sorted() {
            let path = Library.join(dir, name)
            if Library.isDirectory(path) { continue }
            if let text = try readIfExists(path) { result.append(["name": name, "text": text]) }
        }
        return result
    }

    /// The home's own settings: the raw text of `.sniptoss/project.json` (null if absent) and whether `REVIEW.md` exists. The page decides
    /// from them which language REVIEW.md is written in
    static func readProject(home: String) throws -> [String: Any] {
        let dir = Library.join(home, DataDir.name)
        let text = try readIfExists(Library.join(dir, "project.json"))
        return ["text": jsonOrNull(text), "review": Library.isFile(Library.join(dir, "REVIEW.md"))]
    }

    /// The text of a file, nil when it does not exist
    static func readIfExists(_ path: String) throws -> String? {
        do {
            return try AtomicFile.readAllText(path)
        } catch let error as FileOperationError where error.isMissing {
            return nil
        }
    }

    /// The names in a folder, without the full path
    private static func listNames(_ dir: String) throws -> [String] {
        do {
            return try FileManager.default.contentsOfDirectory(atPath: dir)
        } catch {
            throw FileOperationError(operation: "list", path: dir, code: posixCode(of: error))
        }
    }

    private static func posixCode(of error: Error) -> Int32 {
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain { return Int32(ns.code) }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSPOSIXErrorDomain {
            return Int32(underlying.code)
        }
        return EIO
    }

    // MARK: Writing

    /// What a conditional write did
    struct WriteOutcome {
        let written: Bool
        /// The content on disk when the write was refused (nil: the file does not exist); nil when written
        let current: String?
        /// The ordering number taken under the lock
        let seq: Int
    }

    /// Writes only if the disk still holds the version the caller read (`check` false skips the comparison): `expectSha256` is the
    /// SHA-256 of that version, nil when the caller believes the file does not exist yet. Otherwise nothing is written and the current
    /// content is handed back, and the caller merges and writes again (ADR-0005 item 2).
    /// The comparison and the write happen under the same lock the command line takes (`FileLock`): nobody can slip in between them.
    /// The ordering number is taken inside the lock, when the content is fixed
    static func writeIfUnchanged(
        _ full: String, text: String, check: Bool, expectSha256: String?, lockWait: TimeInterval = FileLock.defaultWait
    ) throws -> WriteOutcome {
        try FileLock.withLock(full, wait: lockWait) { () throws -> WriteOutcome in
            if check {
                let current = try readIfExists(full)
                if textSha256(current) != expectSha256 { return WriteOutcome(written: false, current: current, seq: observe()) }
            }
            try AtomicFile.write(full, Data(text.utf8))
            return WriteOutcome(written: true, current: nil, seq: observe())
        }
    }

    /// Deletes one file; nothing happens if it is not there (or is a folder)
    static func deleteFile(_ full: String) throws {
        guard Library.isFile(full) else { return }
        if Darwin.unlink(full) != 0 {
            let code = errno
            if code != ENOENT { throw FileOperationError(operation: "delete", path: full, code: code) }
        }
    }

    // MARK: Snapshots

    /// Names the app gives snapshots: the note's id (6 lower-case letters or digits) and `.png` or `.jpg`
    static func isSnapshotName(_ name: String) -> Bool {
        let ext = Library.extensionOf(name)
        guard ext == ".png" || ext == ".jpg" else { return false }
        let stem = name.unicodeScalars.dropLast(ext.unicodeScalars.count)
        return stem.count == 6 && stem.allSatisfy { ($0.value >= 97 && $0.value <= 122) || ($0.value >= 48 && $0.value <= 57) }
    }

    /// Deletes the snapshots in `.sniptoss/snapshots` that no note uses any more (leftovers of deleted notes, or of an older snapshot
    /// format; the folder would only grow). `keep` is what the page's notes record, relative to `.sniptoss/`
    /// (`snapshots/xxxxxx.png`; either kind of slash, any case). Only names the app generates are deleted, and nothing modified less
    /// than `minAge` seconds ago: another window may just have taken a snapshot whose note is not written yet. A file that cannot be
    /// deleted is left for next time. Returns how many were deleted
    static func pruneSnapshots(home: String, keep: [String], minAge: TimeInterval, now: Date = Date()) throws -> Int {
        let marker = try PathPolicy.inDataDir(home: home, rel: DataDir.name + "/snapshots/_")
        guard let dir = Library.parentDirectory(of: marker), Library.isDirectory(dir) else { return 0 }
        var kept = Set<String>()
        let prefix = "snapshots/"
        for entry in keep {
            let lower = entry.replacingOccurrences(of: "\\", with: "/").lowercased()
            if lower.hasPrefix(prefix) { kept.insert(String(lower.dropFirst(prefix.count))) }
        }
        var deleted = 0
        for name in try listNames(dir).sorted() {
            if !isSnapshotName(name) || kept.contains(name.lowercased()) { continue }
            let path = Library.join(dir, name)
            guard let modified = regularFileModified(path), now.timeIntervalSince1970 - modified >= minAge else { continue }
            if Darwin.unlink(path) == 0 { deleted += 1 }
        }
        if deleted > 0 { Log.info("Removed \(deleted) snapshots no longer used by any note: \(dir)") }
        return deleted
    }

    /// The modification time of a regular file (a link is not followed); nil for anything else
    private static func regularFileModified(_ path: String) -> TimeInterval? {
        var st = stat()
        guard Darwin.lstat(path, &st) == 0, (Int(st.st_mode) & 0o170000) == 0o100000 else { return nil }
        return TimeInterval(st.st_mtimespec.tv_sec) + TimeInterval(st.st_mtimespec.tv_nsec) / 1_000_000_000
    }
}

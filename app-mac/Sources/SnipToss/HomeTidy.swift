import Foundation

/// Keeps .sniptoss out of the user's way: removed once it holds no notes (the last note was deleted, or it is found empty when read).
/// Removing deletes only what this app wrote: notes files with no notes and no drawings, REVIEW.md, project.json, the .gitignore it
/// placed, snapshots it named, and Finder's own .DS_Store. Anything else stays, and then so does the folder. On the Mac the folder needs no
/// hiding: Finder does not show names that start with a dot.
///
/// Deleting a note keeps its snapshot because undo needs it. The snapshots of a removed folder are therefore set aside in the app's own
/// cache for as long as the app runs and put back before the next write into that folder (undo writes the notes back first), so undo
/// works as before. The same rules as the Windows shell's (app/HomeTidy.cs). Safe from any thread: bridge methods run concurrently
final class HomeTidy {
    enum Result: String {
        /// There is no .sniptoss here
        case nothing
        /// It holds notes, or something that can't be judged (an unreadable notes file, a file being written, a link): left untouched
        case kept
        /// This app's files are gone but the folder holds other files, so it stays
        case left
        /// The folder is gone
        case removed
    }

    /// Where snapshots are set aside
    let stashRoot: String
    private let lock = NSLock()
    /// Notes folder (by `key`) → where its snapshots were set aside
    private var stashes: [String: String] = [:]
    /// Notes folder (by `key`) → its turn (see `withHome`)
    private var gates: [String: NSLock] = [:]

    init(stashRoot: String = AppPaths.cacheDir + "/removed-snapshots") {
        self.stashRoot = stashRoot
    }

    /// Finder writes this into folders it has shown (with hidden files shown): it is not the user's, and it would keep an emptied folder
    private static let finderFile = ".DS_Store"

    /// Which notes folder `home` is: the folder itself on its volume (device and inode), so two spellings of one folder on a volume that
    /// ignores case are one, and two folders that differ only in case on a volume that does not are two. The path when it cannot be looked at
    static func key(_ home: String) -> String {
        var st = stat()
        // fstatat follows a link, as stat does (whose name Swift reads as the type here)
        guard fstatat(AT_FDCWD, home, &st, 0) == 0 else { return "path:" + home }
        return "\(st.st_dev):\(st.st_ino)"
    }

    /// One at a time per notes folder: removing it, and every write into it (which first puts the snapshots back, `restore`). Without
    /// this a note saved while the folder is being removed could have its snapshot set aside after the note was written, and lose it
    /// when the app quits. Not reentrant: `body` must not call `tidy` or `withHome` for the same folder. `body` gets the folder's key,
    /// worked out once here and before the table lock (on a disconnected network volume looking at the folder takes the system's
    /// timeout, and other folders must not wait for that); everything in this turn uses that one key
    func withHome<T>(_ home: String, _ body: (_ key: String) throws -> T) rethrows -> T {
        let key = Self.key(home)
        let gate: NSLock = lock.withLock {
            if let known = gates[key] { return known }
            let made = NSLock()
            gates[key] = made
            return made
        }
        gate.lock()
        defer { gate.unlock() }
        return try body(key)
    }

    /// Removes the .sniptoss of `home` if it holds no notes (see the type's summary), in this folder's turn (`withHome`). Never throws.
    /// - Parameter lockWait: the longest it waits for the write lock of a notes file (tests pass a short one)
    func tidy(home: String, lockWait: TimeInterval = FileLock.defaultWait) -> Result {
        withHome(home) { key in tidyInTurn(home: home, key: key, lockWait: lockWait) }
    }

    private func tidyInTurn(home: String, key: String, lockWait: TimeInterval) -> Result {
        let dir = Library.join(home, DataDir.name)
        let notes = Library.join(dir, "annotations")
        let shots = Library.join(dir, "snapshots")
        var started = false
        do {
            switch Self.kind(dir) {
            case nil, .file?, .other?: return .nothing
            case .link?: return .kept
            case .directory?: break
            }
            if Self.kind(notes) == .link || Self.kind(shots) == .link { return .kept }
            var files: [String] = []
            if Self.kind(notes) == .directory {
                for name in try Self.list(notes) {
                    let path = Library.join(notes, name)
                    switch Self.kind(path) {
                    // Not a file: left alone, and then the folder stays
                    case .directory?, nil: continue
                    case .file? where name == Self.finderFile: continue
                    case .file? where name.lowercased().hasSuffix(".json") && Self.isEmptyNotes(path): files.append(path)
                    // A lock or temp file here means someone is writing right now; a link or any other stranger is not ours to judge
                    default: return .kept
                    }
                }
            }

            for file in files {
                // Under the write lock, and looked at again: an agent or another write may have got in since the first look
                let deleted = try FileLock.withLock(file, wait: lockWait) { () throws -> Bool? in
                    guard Library.isFile(file) else { return false }
                    guard Self.isEmptyNotes(file) else { return nil }
                    try NotesStore.deleteFile(file)
                    return true
                }
                if deleted == nil { return started ? .left : .kept }
                if deleted == true { started = true }
            }
            started = true
            try NotesStore.deleteFile(Library.join(dir, "REVIEW.md"))
            try NotesStore.deleteFile(Library.join(dir, "project.json"))
            // One the user edited is theirs
            let ignore = Library.join(dir, ".gitignore")
            if Self.kind(ignore) == .file, (try? AtomicFile.readAllBytes(ignore)) == Data(DataDir.gitIgnore.utf8) {
                try NotesStore.deleteFile(ignore)
            }
            for folder in [dir, notes, shots] where Self.kind(Library.join(folder, Self.finderFile)) == .file {
                try NotesStore.deleteFile(Library.join(folder, Self.finderFile))
            }
            try stash(key: key, shots: shots)
            // Both inner folders are tried, whatever the first one did
            let notesGone = Self.removeIfEmpty(notes)
            let shotsGone = Self.removeIfEmpty(shots)
            let gone = notesGone && shotsGone && Self.removeIfEmpty(dir)
            Log.info(gone ? "Removed the empty notes folder: \(dir)" : "Cleared the empty notes folder, other files remain: \(dir)")
            return gone ? .removed : .left
        } catch {
            Log.info("Could not remove the empty notes folder: \(dir) (\(error))")
            return started ? .left : .kept
        }
    }

    /// Before writing into a notes folder (in its turn, `withHome`): puts back the snapshots set aside when it was removed (the write is
    /// undo bringing notes back, and they refer to these). One already there by that name is left as it is. Forgotten only once all are
    /// back: if this fails (the volume is away for a moment, no permission), the next write tries again.
    /// - Parameter key: the folder's key from `withHome`; worked out here when not given (outside the table lock either way)
    func restore(home: String, key given: String? = nil) {
        let key = given ?? Self.key(home)
        let from: String? = lock.withLock { stashes[key] }
        guard let from else { return }
        do {
            let shots = Library.join(Library.join(home, DataDir.name), "snapshots")
            try AtomicFile.ensureDirectory(shots)
            for name in try Self.list(from) {
                let to = Library.join(shots, name)
                if Self.kind(to) != nil { continue }
                try FileManager.default.moveItem(atPath: Library.join(from, name), toPath: to)
            }
            try FileManager.default.removeItem(atPath: from)
            lock.withLock { if stashes[key] == from { stashes[key] = nil } }
        } catch {
            Log.info("Could not put the snapshots back into \(home), will try again on the next write (\(error))")
        }
    }

    /// On quit the undo history ends with the app, so nothing needs the set-aside snapshots any more; on start, the same goes for what a
    /// run that did not close normally left behind
    func dropStashes() {
        lock.withLock { stashes.removeAll() }
        // Left for the next start if it cannot be removed now
        if Self.kind(stashRoot) != nil { try? FileManager.default.removeItem(atPath: stashRoot) }
    }

    /// Moves the snapshots this app named out of `shots` into the folder under `stashRoot` kept for the notes folder `key` (replacing one
    /// by the same name)
    private func stash(key: String, shots: String) throws {
        guard Self.kind(shots) == .directory else { return }
        for name in try Self.list(shots) where NotesStore.isSnapshotName(name) {
            let from = Library.join(shots, name)
            guard Self.kind(from) == .file else { continue }
            let folder: String = lock.withLock {
                if let known = stashes[key] { return known }
                let made = Library.join(stashRoot, UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())
                stashes[key] = made
                return made
            }
            try AtomicFile.ensureDirectory(folder)
            let to = Library.join(folder, name)
            if Self.kind(to) != nil { try FileManager.default.removeItem(atPath: to) }
            // Across volumes (an item on an external drive) this copies and then deletes
            try FileManager.default.moveItem(atPath: from, toPath: to)
        }
    }

    /// The fields a notes file has at its top
    private static let knownFields: Set<String> = ["schema", "material", "annotations", "drawings"]

    /// A notes file of this app (it names its schema) with no notes and no drawings. Unreadable or unrecognized content counts as not
    /// empty: some other JSON that happens to have an empty "annotations" is not ours to delete
    static func isEmptyNotes(_ path: String) -> Bool {
        guard let text = try? AtomicFile.readAllText(path),
            let root = (try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])) as? [String: Any],
            let schema = root["schema"] as? String, schema.hasPrefix("sniptoss/") || schema.hasPrefix("pizhu/"),
            // A field this version does not know (a later version may keep something else in the file): not known to be empty
            root.keys.allSatisfy(knownFields.contains),
            let notes = root["annotations"] as? [Any], notes.isEmpty
        else { return false }
        guard let drawings = root["drawings"] else { return true }
        return (drawings as? [Any])?.isEmpty == true
    }

    private enum Kind { case directory, file, link, other }

    /// What is at `path`, without following a link; nil when nothing is there
    private static func kind(_ path: String) -> Kind? {
        var st = stat()
        guard Darwin.lstat(path, &st) == 0 else { return nil }
        switch Int(st.st_mode) & 0o170000 {
        case 0o040000: return .directory
        case 0o100000: return .file
        case 0o120000: return .link
        default: return .other
        }
    }

    private static func list(_ dir: String) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: dir).sorted()
    }

    /// Not recursive on purpose: a folder that still holds something stays
    private static func removeIfEmpty(_ dir: String) -> Bool {
        guard let found = kind(dir) else { return true }
        guard found == .directory, (try? FileManager.default.contentsOfDirectory(atPath: dir))?.isEmpty == true else { return false }
        return Darwin.rmdir(dir) == 0
    }
}

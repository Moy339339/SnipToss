import Foundation

/// The bridge methods that read and write notes (docs/host-api.md, "Notes"): `readHomes`, `writeAnnotation`, `writeText`, `writeBase64`,
/// `deleteFile`, `pruneSnapshots`. Writing is only allowed inside `.sniptoss/` of a notes folder a scan handed out (hard rule 1); a notes
/// file is written with a precondition (hard rule 3) and every reply of notes content carries an ordering number (hard rule 3a).
/// Not here yet: `copyImages`.
///
/// - Parameter startWatching: called with a notes folder when the shell should watch it for changes from outside: before it is read, and
///   after something was written in it (the folder `.sniptoss/annotations` only appears with the first note). Does nothing by default
/// - Parameter lockWait: the longest a write waits for the lock of a notes file (tests pass a short one)
/// - Parameter didWrite: called with the notes folder and the notes file when `writeAnnotation` has written it (inside the lock, so the
///   watcher can tell the file as written from a later change); not called when the write was refused. Does nothing by default
/// - Parameter settings: not read by these methods; accepted so the call looks like the one of `installScanMethods`
func installNotesMethods(
    into bridge: BridgeHost, settings: Settings, homes: NotesHomes, lockWait: TimeInterval = FileLock.defaultWait,
    startWatching: @escaping (String) -> Void = { _ in }, didWrite: @escaping (String, String) -> Void = { _, _ in }
) {
    bridge.register("readHomes") { params in
        try readHomesReply(stringList(params, "homes"), homes: homes, startWatching: startWatching)
    }

    bridge.register("writeAnnotation") { params in
        try writeAnnotationReply(params, homes: homes, lockWait: lockWait, startWatching: startWatching, didWrite: didWrite)
    }

    bridge.register("writeText") { params in
        try writeTextReply(params, homes: homes, startWatching: startWatching)
        return nil
    }

    bridge.register("writeBase64") { params in
        try writeBase64Reply(params, homes: homes, startWatching: startWatching)
        return nil
    }

    bridge.register("deleteFile") { params in
        try deleteFileReply(params, homes: homes)
        return nil
    }

    bridge.register("pruneSnapshots") { params in
        try pruneSnapshotsReply(params, homes: homes)
    }
}

// MARK: - readHomes

/// All the notes files in these notes folders, including those of items that are not in the library (REVIEW.md needs all of them). A
/// folder that no scan handed out is left out of the reply. Each reply carries the ordering number taken before the read (hard rule 3a),
/// so a notification that arrives later with an older number can be told from news. A folder whose volume is not connected is answered
/// as having no notes, without touching the disk
func readHomesReply(_ raw: [String], homes: NotesHomes, startWatching: (String) -> Void) throws -> [[String: Any]] {
    var wanted: [String] = []
    for item in raw {
        guard let home = try? Library.norm(item) else { throw BridgeError("Invalid path: \(item)") }
        if homes.contains(home) { wanted.append(home) }
    }
    Volumes.wait(wanted)
    var reply: [[String: Any]] = []
    for home in wanted {
        let there = Volumes.known(home) == true
        // Watching starts before the read: if an agent writes during the read, the difference shows up at the next check and is announced.
        // Starting after it would record a state that already includes that write, and nobody would hear about it
        if there { startWatching(home) }
        let seq = NotesStore.observe()
        var annotations: [[String: Any]] = []
        var project: [String: Any] = ["text": NSNull(), "review": false]
        if there {
            annotations = try mapped { try NotesStore.readAnnotations(home: home) }
            project = try mapped { try NotesStore.readProject(home: home) }
        }
        reply.append(["home": home, "seq": seq, "annotations": annotations, "project": project])
    }
    return reply
}

// MARK: - Writing

/// `writeAnnotation`: writes a notes file only if the disk still holds the content the caller read. `expectSha256` in the
/// parameters: absent means no comparison; null means the caller believes the file does not exist yet; a string is the SHA-256 of the
/// content it read. When the comparison fails nothing is written and the current content comes back, for the page to merge by note id
/// and write again. `didWrite(home, file)` is called only for a write that happened
func writeAnnotationReply(
    _ params: Any?, homes: NotesHomes, lockWait: TimeInterval = FileLock.defaultWait, startWatching: (String) -> Void,
    didWrite: (String, String) -> Void = { _, _ in }
) throws -> [String: Any] {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let text = try requiredString(params, "text")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    let fields = params as? [String: Any]
    let check = fields?.keys.contains("expectSha256") ?? false
    let expect = fields?["expectSha256"] as? String
    let outcome = try mapped {
        try NotesStore.writeIfUnchanged(
            full, text: text, check: check, expectSha256: expect, lockWait: lockWait, afterWrite: { didWrite(home, full) })
    }
    if !outcome.written {
        return ["written": false, "current": jsonOrNull(outcome.current), "seq": outcome.seq]
    }
    startWatching(home)
    DataDir.ensureGitIgnore(home: home)
    return ["written": true, "current": NSNull(), "seq": outcome.seq]
}

/// `writeText`: text (REVIEW.md, project.json) inside `.sniptoss/`, as UTF-8 without a byte order mark
func writeTextReply(_ params: Any?, homes: NotesHomes, startWatching: (String) -> Void) throws {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let text = try requiredString(params, "text")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    try store(Data(text.utf8), at: full, home: home, startWatching: startWatching)
}

/// `writeBase64`: a binary file (a snapshot) inside `.sniptoss/`
func writeBase64Reply(_ params: Any?, homes: NotesHomes, startWatching: (String) -> Void) throws {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let encoded = try requiredString(params, "data")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    guard let bytes = Data(base64Encoded: encoded) else { throw BridgeError("Invalid base64 data") }
    try store(bytes, at: full, home: home, startWatching: startWatching)
}

/// Unique temp file, flush, replace (hard rule 4). No lock: nothing else reads these files and then writes them back
private func store(_ bytes: Data, at full: String, home: String, startWatching: (String) -> Void) throws {
    try mapped { try AtomicFile.write(full, bytes) }
    startWatching(home)
    DataDir.ensureGitIgnore(home: home)
}

/// `deleteFile`: one file inside `.sniptoss/`; a file that is not there is not an error
func deleteFileReply(_ params: Any?, homes: NotesHomes) throws {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    try mapped { try NotesStore.deleteFile(full) }
}

/// `pruneSnapshots`: how many old snapshots nobody uses were deleted. Anything modified within `minAge` seconds is kept
func pruneSnapshotsReply(_ params: Any?, homes: NotesHomes, minAge: TimeInterval = 10 * 60) throws -> Int {
    let home = try homes.require(requiredString(params, "home"))
    let keep = stringList(params, "keep")
    return try mapped { try NotesStore.pruneSnapshots(home: home, keep: keep, minAge: minAge) }
}

// MARK: - Helpers

/// Runs a disk operation and turns what it throws into the reply the page explains (`code`, docs/host-api.md)
private func mapped<T>(_ body: () throws -> T) throws -> T {
    do {
        return try body()
    } catch {
        throw notesBridgeError(error)
    }
}

private func notesBridgeError(_ error: Error) -> BridgeError {
    if let refused = error as? BridgeError { return refused }
    // The lock stayed taken: the page says the file is in use by another program and to try again shortly
    if let locked = error as? FileLockError { return BridgeError(locked.description, code: "busy") }
    if let failed = error as? FileOperationError { return bridgeError(failed) }
    return BridgeError("\(error)")
}

private func requiredString(_ params: Any?, _ name: String) throws -> String {
    guard let p = params as? [String: Any], let value = p[name] as? String else { throw BridgeError("Missing argument: \(name)") }
    return value
}

/// A list of non-empty strings; a missing key or anything that is not a list gives an empty list
private func stringList(_ params: Any?, _ name: String) -> [String] {
    guard let p = params as? [String: Any], let items = p[name] as? [Any] else { return [] }
    return items.compactMap { $0 as? String }.filter { !$0.isEmpty }
}

import Foundation

/// The bridge methods that read and write notes (docs/host-api.md, "Notes"): `readHomes`, `writeAnnotation`, `writeText`, `writeBase64`,
/// `deleteFile`, `pruneSnapshots`, `tidyHome` (removes a .sniptoss that holds no notes, `HomeTidy`), and `stashImage` / `copyImages` (Copy
/// as Images, which takes the pictures the page drew and reads the snapshots of notes, and writes no notes). Writing is only
/// allowed inside `.sniptoss/` of a notes folder a scan handed out (hard rule 1); a notes file is written with a precondition (hard rule 3)
/// and every reply of notes content carries an ordering number (hard rule 3a).
///
/// - Parameter startWatching: called with a notes folder when the shell should watch it for changes from outside: before it is read, and
///   after something was written in it (the folder `.sniptoss/annotations` only appears with the first note). Does nothing by default
/// - Parameter lockWait: the longest a write waits for the lock of a notes file (tests pass a short one)
/// - Parameter didWrite: called with the notes folder and the notes file when `writeAnnotation` has written it (inside the lock, so the
///   watcher can tell the file as written from a later change); not called when the write was refused. Does nothing by default
/// - Parameter settings: not read by these methods; accepted so the call looks like the one of `installScanMethods`
/// - Parameter handoffClipboard: where `copyImages` puts its images; the system's unless a test says otherwise
/// - Parameter handoffFolder: where `copyImages` saves the files when it copies several images (`AppPaths.handoffDir`)
/// - Parameter tidy: removes empty notes folders and keeps their snapshots for undo; the writes put those back first. One for the whole app
///   (`libraryRemove` tidies with the same one)
func installNotesMethods(
    into bridge: BridgeHost, settings: Settings, homes: NotesHomes, lockWait: TimeInterval = FileLock.defaultWait,
    startWatching: @escaping (String) -> Void = { _ in }, didWrite: @escaping (String, String) -> Void = { _, _ in },
    handoffClipboard: HandoffClipboard = SystemHandoffClipboard(), handoffFolder: String = AppPaths.handoffDir, tidy: HomeTidy = HomeTidy()
) {
    bridge.register("readHomes") { params in
        try readHomesReply(stringList(params, "homes"), homes: homes, startWatching: startWatching)
    }

    bridge.register("writeAnnotation") { params in
        try writeAnnotationReply(params, homes: homes, lockWait: lockWait, startWatching: startWatching, didWrite: didWrite, tidy: tidy)
    }

    bridge.register("writeText") { params in
        try writeTextReply(params, homes: homes, startWatching: startWatching, tidy: tidy)
        return nil
    }

    bridge.register("writeBase64") { params in
        try writeBase64Reply(params, homes: homes, startWatching: startWatching, tidy: tidy)
        return nil
    }

    bridge.register("deleteFile") { params in
        try deleteFileReply(params, homes: homes)
        return nil
    }

    bridge.register("pruneSnapshots") { params in
        try pruneSnapshotsReply(params, homes: homes)
    }

    bridge.register("tidyHome") { params in
        try tidyHomeReply(params, homes: homes, tidy: tidy)
    }

    let stash = HandoffStash()
    bridge.register("stashImage") { params in
        try stashImageReply(params, stash: stash)
    }

    bridge.register("copyImages") { params in
        try copyImagesReply(params, homes: homes, stash: stash, clipboard: handoffClipboard, folder: handoffFolder)
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
        var project: [String: Any] = ["text": NSNull(), "review": false, "exists": false]
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
    didWrite: (String, String) -> Void = { _, _ in }, tidy: HomeTidy? = nil
) throws -> [String: Any] {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let text = try requiredString(params, "text")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    let fields = params as? [String: Any]
    let check = fields?.keys.contains("expectSha256") ?? false
    let expect = fields?["expectSha256"] as? String
    return try inTurn(tidy, home) { () throws -> [String: Any] in
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
}

/// `writeText`: text (REVIEW.md, project.json) inside `.sniptoss/`, as UTF-8 without a byte order mark
func writeTextReply(_ params: Any?, homes: NotesHomes, startWatching: (String) -> Void, tidy: HomeTidy? = nil) throws {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let text = try requiredString(params, "text")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    try inTurn(tidy, home) { try store(Data(text.utf8), at: full, home: home, startWatching: startWatching) }
}

/// `writeBase64`: a binary file (a snapshot) inside `.sniptoss/`
func writeBase64Reply(_ params: Any?, homes: NotesHomes, startWatching: (String) -> Void, tidy: HomeTidy? = nil) throws {
    let home = try homes.require(requiredString(params, "home"))
    let rel = try requiredString(params, "path")
    let encoded = try requiredString(params, "data")
    let full = try PathPolicy.inDataDir(home: home, rel: rel)
    guard let bytes = Data(base64Encoded: encoded) else { throw BridgeError("Invalid base64 data") }
    try inTurn(tidy, home) { try store(bytes, at: full, home: home, startWatching: startWatching) }
}

/// A write into a notes folder, in that folder's turn (`HomeTidy.withHome`: never while the folder is being removed), once the snapshots
/// set aside when the folder was emptied are back (this write may be undo bringing their notes back)
private func inTurn<T>(_ tidy: HomeTidy?, _ home: String, _ write: () throws -> T) rethrows -> T {
    guard let tidy else { return try write() }
    return try tidy.withHome(home) { key in
        tidy.restore(home: home, key: key)
        return try write()
    }
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

/// `tidyHome`: removes the .sniptoss of a notes folder a scan handed out if it holds no notes and no drawings (`HomeTidy`). The page asks
/// once the last note is gone, and for a folder it read in and found empty; the shell checks the disk itself, so a folder that does hold
/// notes is never touched whatever the page believes. Answers `removed`, `left`, `kept` or `nothing`
func tidyHomeReply(_ params: Any?, homes: NotesHomes, tidy: HomeTidy) throws -> String {
    let home = try homes.require(requiredString(params, "home"))
    return tidy.tidy(home: home).rawValue
}

// MARK: - copyImages

/// `stashImage`: keeps a picture the page drew (`data`, base64 PNG) for the copy of `batch`; returns `{id}`, which a page of `copyImages`
/// names as its `image`
func stashImageReply(_ params: Any?, stash: HandoffStash) throws -> [String: Any] {
    let batch = try requiredString(params, "batch")
    guard let png = Data(base64Encoded: try requiredString(params, "data")) else { throw BridgeError("Invalid base64 data") }
    return ["id": stash.stash(batch: batch, png: png)]
}

/// `copyImages`: one image per page (title, picture, notes area) on the clipboard; returns how many. A page's picture is the one stashed
/// under its `image` id; without one, the stored snapshot it names, taken only from `.sniptoss/` of a notes folder a scan handed out (the
/// same rule as for `fileUrl`); a snapshot whose folder is not known, is gone, or that names a path outside `.sniptoss/` is left out (the
/// page is text only). `extra` is the closing paragraph, at the end of the last image. The stashed pictures of the batch its pages name are
/// let go afterwards, whether the copy worked or not (a later copy that has already stashed its own keeps them).
/// Errors: nothing to copy, a folder that cannot be written (the usual disk classes), the clipboard held by another program (`clipboardBusy`)
func copyImagesReply(
    _ params: Any?, homes: NotesHomes, stash: HandoffStash, clipboard: HandoffClipboard, folder: String, now: Date = Date()
) throws -> [String: Any] {
    guard let fields = params as? [String: Any], let list = fields["pages"] as? [Any] else { throw BridgeError("Missing argument: pages") }
    defer { stash.drop(batches: Set(list.compactMap { (($0 as? [String: Any])?["image"] as? String).map(HandoffStash.batch(of:)) })) }
    let pages = try list.map { try handoffPage($0, homes: homes, stash: stash) }
    let extra = fields["extra"] as? String
    let count = try mapped { try HandoffImages.copy(pages, extra: extra, clipboard: clipboard, folder: folder, now: now) }
    return ["count": count]
}

/// One entry of `pages`: `title`, `name` and `notes` are required; `image` (a stashed picture's id) and `snapshot` (a path relative to the
/// notes folder `home`) are not
private func handoffPage(_ raw: Any, homes: NotesHomes, stash: HandoffStash) throws -> HandoffImages.Page {
    guard let fields = raw as? [String: Any] else { throw BridgeError("Invalid argument: pages") }
    let picture = (fields["image"] as? String).flatMap { stash.picture($0) }
    var snapshot: String?
    if picture == nil, let rel = fields["snapshot"] as? String {
        do {
            snapshot = try PathPolicy.inDataDir(home: homes.require(requiredString(fields, "home")), rel: rel)
        } catch let refused as BridgeError {
            Log.info("Copy as images: snapshot skipped (\(refused.message))")
        }
    }
    guard let list = fields["notes"] as? [Any] else { throw BridgeError("Missing argument: notes") }
    let notes = try list.map(handoffNote)
    return HandoffImages.Page(
        picture: picture, snapshot: snapshot, title: try requiredString(fields, "title"), notes: notes, name: try requiredString(fields, "name"))
}

/// One note of a page: `number`, `category`, `where`, `body` and `color` (`#rrggbb`; the default orange when it is not) are required,
/// `group` (the item's name, on a page that mixes items) is not
private func handoffNote(_ raw: Any) throws -> NoteEntry {
    guard let fields = raw as? [String: Any] else { throw BridgeError("Invalid argument: notes") }
    guard let number = fields["number"] as? Int else { throw BridgeError("Missing argument: number") }
    let category = try requiredString(fields, "category")
    let whereText = try requiredString(fields, "where")
    let body = try requiredString(fields, "body")
    let color = MarkColor(hexText: try requiredString(fields, "color")) ?? MarkColor(hex: 0xff6a3d)
    return NoteEntry(number: number, color: color, category: category, whereText: whereText, body: body, group: fields["group"] as? String)
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
    if let failed = error as? HandoffImages.Failure { return failed.asBridgeError }
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

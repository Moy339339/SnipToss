import Foundation

/// The bridge methods that look at items on disk: `scan`, `missing`, `sha256`, `fileUrl` (docs/host-api.md, "Library").
/// Every question about a path on a volume goes through `Volumes` first: an unreachable network volume would otherwise hold a bridge
/// thread for the system timeout.
/// Not here yet: `decodeImage`, `addDropped`, `pasteClipboard`. The notes methods are in NotesMethods.swift, the checks for changes from
/// outside in ChangeWatch.swift
func installScanMethods(into bridge: BridgeHost, settings: Settings, homes: NotesHomes, hashes: HashCache = HashCache.shared) {
    bridge.register("scan") { params in
        let values = settings.current
        return scanEntries(
            stringList(params, "paths"), library: values.library.map { $0.path }, kinds: values.enabledKinds, skipDirs: values.skipDirs,
            homes: homes)
    }

    bridge.register("missing") { params in
        missingPaths(stringList(params, "paths"), library: settings.library.map { $0.path }, homes: homes.all)
    }

    bridge.register("sha256") { params in
        try hashOfLibraryItem(requiredString(params, "path"), library: settings.library.map { $0.path }, cache: hashes)
    }

    bridge.register("fileUrl") { params in
        try notesFileUrl(home: requiredString(params, "home"), rel: requiredString(params, "path"), homes: homes)
    }
}

// MARK: - scan

/// Scans the library entries named in `raw` (anything not in `library` is ignored). A folder lists every item in it, with paths relative
/// to the folder, from which the page builds its tree; a file is just itself. Each item carries its notes folder and its URL, and the
/// entry carries its notes folder as `project` (the page groups entries into projects by it). When an entry sits inside another folder
/// entry (skipped by that scan, added on its own), its notes are kept with the outer one. The notes folders found are recorded in `homes`.
/// Entries on a volume that is not connected are not scanned: one such entry must not make the others wait
func scanEntries(
    _ raw: [String], library: [String], kinds: Set<String>, skipDirs: Set<String>, homes: NotesHomes, limit: Int = MaterialScanner.limit
) -> [[String: Any]] {
    let inLibrary = Library.contains(library)
    let paths = raw.filter(inLibrary)
    if paths.isEmpty { return [] }
    let finder = HomeFinder()
    Volumes.wait(library)
    let folders = library.filter { Volumes.known($0) == true && Library.isDirectory($0) }
    var reply: [[String: Any]] = []
    for path in paths {
        let scanned = scanOne(
            path, outer: Library.outerFolder(folders: folders, path: path), finder: finder, kinds: kinds, skipDirs: skipDirs, limit: limit)
        for home in scanned.homes { homes.insert(home) }
        reply.append(scanReply(scanned, limit: limit))
    }
    return reply
}

private struct ScannedEntry {
    let entry: String
    /// `file`, `folder` or `missing`
    let kind: String
    let project: String
    var found: [MaterialScanner.Found] = []
    /// The notes folder of each item in `found`; for a missing entry, the notes folder that still exists for it (at most one)
    var homes: [String] = []
    var stats: MaterialScanner.Stats?
}

private func scanOne(
    _ raw: String, outer: String?, finder: HomeFinder, kinds: Set<String>, skipDirs: Set<String>, limit: Int
) -> ScannedEntry {
    guard let entry = try? Library.norm(raw) else { return ScannedEntry(entry: raw, kind: "missing", project: raw) }
    let parent = Library.parentDirectory(of: entry) ?? entry
    if Volumes.known(entry) != true { return ScannedEntry(entry: entry, kind: "missing", project: parent) }
    if Library.isFile(entry) {
        let one = MaterialScanner.describe(entry)
        let home = finder.find(file: entry, folderEntry: outer)
        return ScannedEntry(entry: entry, kind: "file", project: home, found: one.map { [$0] } ?? [], homes: one == nil ? [] : [home])
    }
    if Library.isDirectory(entry) {
        let stats = MaterialScanner.Stats()
        let found = MaterialScanner.scan(entry, enabledKinds: kinds, skipDirs: skipDirs, limit: limit, stats: stats)
        let folderEntry = outer ?? entry
        return ScannedEntry(
            entry: entry, kind: "folder", project: finder.folderHome(of: entry, outer: folderEntry), found: found,
            homes: found.map { finder.find(file: $0.fullPath, folderEntry: folderEntry) }, stats: stats)
    }
    // Not found: group it under the folder it used to be in. If that project's .sniptoss still exists (only this one file was moved away),
    // its notes are still read, so the "item missing" group in the notes panel can list them
    let kept = finder.existingHome(of: entry)
    return ScannedEntry(entry: entry, kind: "missing", project: kept ?? parent, homes: kept.map { [$0] } ?? [])
}

private func scanReply(_ scanned: ScannedEntry, limit: Int) -> [String: Any] {
    let isFolder = scanned.kind == "folder"
    var materials: [[String: Any]] = []
    for (i, item) in scanned.found.enumerated() {
        let home = scanned.homes[i]
        materials.append([
            "path": item.fullPath,
            "rel": isFolder ? relativePath(item.fullPath, below: scanned.entry) : Library.nameOf(item.fullPath),
            "kind": item.kind,
            "size": item.size,
            "mtime": item.mtime,
            "ctime": item.ctime,
            "home": home,
            "homeRel": relativePath(item.fullPath, below: home),
            "url": MediaURL.string(for: item.fullPath),
        ])
    }
    let stats = scanned.stats
    return [
        "entry": scanned.entry,
        "kind": scanned.kind,
        "project": scanned.project,
        "keptHome": jsonOrNull(scanned.kind == "missing" ? scanned.homes.first : nil),
        // Hit the limit with items left unscanned: the page says so on the project row
        "truncatedAt": jsonOrNull(isFolder && stats?.truncated == true ? limit : nil),
        // Unsupported files and skipped folders in a folder: the page explains them at the end of the folder
        "others": countsReply(stats?.others ?? 0, stats?.sortedOtherExts ?? []),
        "moreOff": countsReply(stats?.moreOff ?? 0, stats?.sortedMoreOffExts ?? []),
        "skippedDirs": jsonOrNull(stats.flatMap { $0.skippedDirs.isEmpty ? nil : $0.skippedDirs }),
        "materials": materials,
    ]
}

private func countsReply(_ count: Int, _ exts: [String]) -> Any {
    if count == 0 { return NSNull() }
    return ["count": count, "exts": exts] as [String: Any]
}

/// The part of `path` below `folder`, joined with slashes. The scan builds every path by appending names to its entry, and every notes
/// folder is a parent of such a path, so the leading parts are always the folder's own
private func relativePath(_ path: String, below folder: String) -> String {
    let base = Library.components(folder).count
    return Library.components(path).dropFirst(base).joined(separator: "/")
}

// MARK: - missing, sha256, fileUrl

/// Which of these paths no longer exist. Only paths in the library or inside a notes folder are asked about; the rest are ignored. A path
/// on a volume that is not connected counts as missing without being looked at
func missingPaths(_ paths: [String], library: [String], homes: [String]) -> [String] {
    let rootKeys = Set((library + homes).map { Library.key($0) })
    let asked = paths.filter { PathPolicy.isUnder($0, rootKeys: rootKeys) }
    Volumes.wait(asked)
    return asked.filter { Volumes.known($0) != true || !FileManager.default.fileExists(atPath: $0) }
}

/// The SHA-256 of an item. Only paths in the library are accepted (hard rule 2)
func hashOfLibraryItem(_ path: String, library: [String], cache: HashCache) throws -> String {
    guard PathPolicy.isUnder(path, roots: library), let full = try? Library.norm(path) else {
        throw BridgeError("Path is not in the material list or a notes folder: \(path)", code: "denied")
    }
    Volumes.wait([full])
    guard Volumes.known(full) == true else { throw BridgeError("Not found: \(full)", code: "notFound") }
    do {
        return try cache.sha256(of: full)
    } catch let error as FileOperationError {
        throw bridgeError(error)
    }
}

/// The address of a file inside `.sniptoss/` of a notes folder a scan handed out: the same rule as for writing there
func notesFileUrl(home: String, rel: String, homes: NotesHomes) throws -> String {
    let full = try PathPolicy.inDataDir(home: homes.require(home), rel: rel)
    return MediaURL.string(for: full)
}

/// The reply for a failed disk operation: the class of the POSIX error is what the page explains in its own language. Shared with the
/// notes methods
func bridgeError(_ error: FileOperationError) -> BridgeError {
    let code: String?
    switch error.code {
    case ENOENT, ENOTDIR: code = "notFound"
    case EACCES, EPERM, EROFS: code = "denied"
    case EBUSY: code = "busy"
    case ENOSPC: code = "diskFull"
    case ENAMETOOLONG: code = "tooLong"
    case ESTALE, ENETDOWN, ENETUNREACH, EHOSTDOWN, EHOSTUNREACH, ETIMEDOUT: code = "network"
    default: code = nil
    }
    return BridgeError(error.description, code: code)
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

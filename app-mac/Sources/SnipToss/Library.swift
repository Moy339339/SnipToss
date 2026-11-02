import Foundation

/// Why a library edit was refused. The bridge methods turn these into replies the UI explains
enum LibraryError: Error {
    case invalidPath(String)
    /// The place to point an entry at does not exist
    case notFound(String)
    case insideDataDir(String)
    /// Nothing named in the call is in the library. The associated value is the entry that was asked for, when there is one
    case notInLibrary(String?)
}

/// The library on the left: files and folders the user added. Add, remove and change all go through `Settings.update` (read the disk first,
/// then modify); the list is only a "handy place", and neither removing nor clearing touches the files themselves.
///
/// Paths are POSIX paths. Two paths are the same item when their `keyOf` is equal (see there); that is also how the UI compares them
enum Library {
    // MARK: Paths

    /// An absolute path with `.` / `..` / repeated and trailing slashes resolved (links are not followed; the root keeps its slash).
    /// A relative path is taken from the current folder. Throws for an empty path or one with a NUL character
    static func norm(_ path: String) throws -> String {
        if path.isEmpty || path.unicodeScalars.contains("\0") { throw LibraryError.invalidPath(path) }
        let absolute = path.unicodeScalars.first == "/" ? path : FileManager.default.currentDirectoryPath + "/" + path
        var parts: [String] = []
        for part in components(absolute) {
            if part == "." { continue }
            if part == ".." {
                if !parts.isEmpty { parts.removeLast() }
                continue
            }
            parts.append(part)
        }
        return "/" + parts.joined(separator: "/")
    }

    /// The parts of a path between slashes. Splits on the slash character itself, not on a grapheme that merely starts with one
    static func components(_ path: String) -> [String] {
        path.unicodeScalars.split(separator: "/").map { string($0) }
    }

    private static func string(_ scalars: Substring.UnicodeScalarView) -> String {
        var text = String()
        text.unicodeScalars.append(contentsOf: scalars)
        return text
    }

    /// The key for comparing paths. **The same function as `keyOf` in packages/web/src/host.ts**, character for character:
    /// every slash becomes a backslash, then composed Unicode (NFC), then lower case. Windows and POSIX paths compare the same way: a Mac
    /// volume is case-insensitive by default, and macOS can hand over the same file name composed or decomposed (é as one character or as
    /// e plus an accent). Differences from JavaScript's toLowerCase: none known except that a capital sigma at the end of a word becomes
    /// σ here and ς there
    static func keyOf(_ path: String) -> String {
        path.replacingOccurrences(of: "/", with: "\\", options: .literal).precomposedStringWithCanonicalMapping.lowercased()
    }

    /// The comparison key of a path: `keyOf` of its normalized form (of the path as it is if it can't be normalized)
    static func key(_ path: String) -> String {
        keyOf((try? norm(path)) ?? path)
    }

    static func same(_ a: String, _ b: String) -> Bool {
        key(a) == key(b)
    }

    /// `path` is inside `folder` (not `folder` itself)
    static func inside(_ path: String, _ folder: String) -> Bool {
        keyInside(key(path), key(folder))
    }

    /// Same, with both sides already keys. The root is `\` as a key, and it is not inside itself
    static func keyInside(_ pathKey: String, _ folderKey: String) -> Bool {
        let prefix = folderKey.unicodeScalars.last == "\\" ? folderKey : folderKey + "\\"
        return pathKey.utf8.count > prefix.utf8.count && pathKey.utf8.starts(with: prefix.utf8)
    }

    /// The key of the folder above, nil at the root
    static func parentKey(_ key: String) -> String? {
        let scalars = key.unicodeScalars
        guard let slash = scalars.lastIndex(of: "\\") else { return nil }
        if slash == scalars.startIndex { return scalars.count > 1 ? "\\" : nil }
        return string(scalars[..<slash])
    }

    /// The keys of the folders above a key, nearest first, ending with the root
    static func ancestorKeys(of key: String) -> [String] {
        var result: [String] = []
        var current = key
        while let parent = parentKey(current) {
            result.append(parent)
            current = parent
        }
        return result
    }

    /// The folder a path is in; nil for the root and for a path that is not absolute
    static func parentDirectory(of path: String) -> String? {
        let parts = components(path)
        guard path.unicodeScalars.first == "/", !parts.isEmpty else { return nil }
        return parts.count == 1 ? "/" : "/" + parts.dropLast().joined(separator: "/")
    }

    /// The last part of a path
    static func nameOf(_ path: String) -> String {
        components(path).last ?? ""
    }

    /// The extension with its dot, as it is written ("" if none). A name that is only an extension (".png") is an extension
    static func extensionOf(_ path: String) -> String {
        let scalars = nameOf(path).unicodeScalars
        guard let dot = scalars.lastIndex(of: "."), scalars.index(after: dot) != scalars.endIndex else { return "" }
        return string(scalars[dot...])
    }

    static func join(_ base: String, _ name: String) -> String {
        base.unicodeScalars.last == "/" ? base + name : base + "/" + name
    }

    static func isDirectory(_ path: String) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && isDir.boolValue
    }

    /// Exists and is not a folder
    static func isFile(_ path: String) -> Bool {
        var isDir: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && !isDir.boolValue
    }

    /// Which of a batch of paths are in the list (equal to one of its entries). The list is turned into keys once instead of comparing pairs
    static func contains(_ listed: [String]) -> (String) -> Bool {
        let keys = Set(listed.map { Library.key($0) })
        return { path in keys.contains(Library.key(path)) }
    }

    /// Whether the volume of the path is mounted: when it isn't, a drive is not plugged in or a share is not connected; the file wasn't
    /// deleted or moved. Background threads only (see Volumes)
    static func driveThere(_ path: String) -> Bool {
        Volumes.isThere(path)
    }

    /// The path is in (or is) a notes data folder (.sniptoss, or the older .pizhu): those are notes and snapshots, not items
    static func inDataDir(_ full: String) -> Bool {
        components(full).contains { DataDir.isName($0) }
    }

    // MARK: What a folder scan would list

    private struct DiskInfo {
        let isDirectory: Bool
        let isLink: Bool
        let hidden: Bool
    }

    /// What is on disk at a path, without following a link for `isLink`; nil if there is nothing there
    private static func describe(_ path: String) -> DiskInfo? {
        var st = stat()
        guard Darwin.lstat(path, &st) == 0 else { return nil }
        let isLink = (Int(st.st_mode) & 0o170000) == 0o120000
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDir) else { return nil }
        let hidden = ((try? URL(fileURLWithPath: path).resourceValues(forKeys: [.isHiddenKey]))?.isHidden) ?? false
        return DiskInfo(isDirectory: isDir.boolValue, isLink: isLink, hidden: hidden)
    }

    /// Whether the scan of `folder` would list `path`: path is inside folder, none of the levels between is hidden, starts with a dot, is a
    /// skipped folder or a link to a folder, and for a file its kind is turned on. Only then does "inside the folder" count as already in
    /// the list. `skipDirs` is lower case (`SettingsValues.skipDirs`)
    static func covers(folder: String, path: String, kinds: Set<String>, skipDirs: Set<String>) -> Bool {
        guard inside(path, folder), let base = try? norm(folder), let full = try? norm(path) else { return false }
        let parts = Array(components(full).dropFirst(components(base).count))
        var current = base
        for (i, name) in parts.enumerated() {
            current = join(current, name)
            if name.unicodeScalars.first == "." { return false }
            guard let info = describe(current) else { return false }
            if info.hidden { return false }
            if info.isDirectory {
                // When the last level is the folder itself, it isn't listed if it is skipped or a link either (the scan doesn't enter it)
                if skipDirs.contains(name.lowercased()) || info.isLink { return false }
            } else if i < parts.count - 1 || MaterialKinds.listed(name, enabledKinds: kinds) == nil || name.hasPrefix("~$") {
                return false
            }
        }
        return true
    }

    /// The outermost folder entry in the list that contains path (or is path): for things added on their own that the scan skips,
    /// notes are stored with it
    static func outerFolder(_ settings: Settings, path: String) -> String? {
        outerFolder(folders: settings.library.map { $0.path }.filter { isDirectory($0) }, path: path)
    }

    /// Same, but folders are the folder entries in the list (already checked to be folders, so the disk is queried only once during a scan)
    static func outerFolder(folders: [String], path: String) -> String? {
        folders
            .filter { same($0, path) || inside(path, $0) }
            .compactMap { try? norm($0) }
            .min { $0.count < $1.count }
    }

    // MARK: Moved entries

    /// A list entry went from `from` to `to` (the project folder was moved or renamed)
    struct Relocation: Equatable {
        let from: String
        let to: String
    }

    /// Replaces an entry that was moved or renamed with its new location: the path is replaced in place, position and pin are kept; old paths
    /// recorded in expanded, collapsed and last selected follow. If the new location is already in the list on its own (added again), that
    /// entry is merged away. The notes are in the project's own .sniptoss and move with it
    @discardableResult
    static func relocate(_ settings: Settings, from: String, to: String) throws -> Relocation {
        let target = try norm(to)
        if !isDirectory(target) && !isFile(target) { throw LibraryError.notFound(target) }
        if inDataDir(target) { throw LibraryError.insideDataDir(target) }
        try settings.update { s in
            guard let entry = s.library.first(where: { same($0.path, from) }) else { throw LibraryError.notInLibrary(from) }
            s.library.removeAll { $0 !== entry && same($0.path, target) }
            retarget(&s, entry, target)
        }
        return Relocation(from: from, to: target)
    }

    /// Switches this entry to target: its path, and those under it in expanded / collapsed / last selected, are all replaced
    private static func retarget(_ s: inout SettingsValues, _ entry: LibraryEntry, _ target: String) {
        let old = entry.path
        entry.path = target
        func move(_ path: String) -> String {
            if same(path, old) { return target }
            if inside(path, old) { return join(target, relativeComponents(of: path, below: old).joined(separator: "/")) }
            return path
        }
        s.expanded = s.expanded.map(move)
        s.collapsed = s.collapsed.map(move)
        if let selected = s.selected { s.selected = move(selected) }
    }

    private static func relativeComponents(of path: String, below folder: String) -> [String] {
        let base = components((try? norm(folder)) ?? folder).count
        return Array(components((try? norm(path)) ?? path).dropFirst(base))
    }

    /// Whether the newly added item is the list entry that could no longer be found (added again after being moved): same name, both folders
    /// or same extension, and the original is really gone (`probe.gone`). If recognized, it is replaced in place; otherwise the list would
    /// show one grayed and one normal entry, and the pin and position would have to be redone
    private static func movedFrom(_ library: [LibraryEntry], full: String, isDirectory isDir: Bool, probe: Probed) -> LibraryEntry? {
        let name = keyOf(nameOf(full))
        let ext = extensionOf(full).lowercased()
        return library.first { entry in
            keyOf(nameOf(entry.path)) == name
                && (isDir ? MaterialKinds.kindOf(entry.path) == nil : extensionOf(entry.path).lowercased() == ext)
                && !same(entry.path, full)
                && probe.gone.contains(key(entry.path))
        }
    }

    // MARK: Adding

    struct ProbedPath {
        let raw: String
        /// nil: a malformed path
        let full: String?
        let isDirectory: Bool
        let exists: Bool
    }

    /// Checked before adding to the list. `items` has one entry per path; `gone` holds the keys of the list entries with the same name as
    /// something being added that are really gone (their volume is still there)
    struct Probed {
        let items: [ProbedPath]
        let gone: Set<String>
    }

    struct AddResult {
        let added: [String]
        let focus: String?
        let skipped: [String]
        /// Added items recognized as the list entry that could no longer be found, replaced in place with their new location
        let relocated: [Relocation]
    }

    private struct AddOutcome {
        var added: [String] = []
        var skipped: [String] = []
        var relocated: [Relocation] = []
        var focus: String?
    }

    /// The part of adding that queries the disk: whether each path exists and is a folder, and whether the same-named list entries that may
    /// have been moved still exist. Background threads only: a path or a list entry on a volume that stopped answering can take long to query.
    /// `listed` is the paths of the list entries
    static func probe(listed: [String], paths: [String]) -> Probed {
        var items: [ProbedPath] = []
        for raw in paths {
            guard let full = try? norm(raw) else {
                items.append(ProbedPath(raw: raw, full: nil, isDirectory: false, exists: false))
                continue
            }
            // If the volume isn't there, don't ask the disk about the path
            let there = Volumes.isThere(full)
            let isDir = there && isDirectory(full)
            items.append(ProbedPath(raw: raw, full: full, isDirectory: isDir, exists: isDir || (there && isFile(full))))
        }
        let names = Set(items.filter { $0.exists }.compactMap { $0.full }.map { keyOf(nameOf($0)) })
        // Entries whose whole volume is absent (drive unplugged, share not connected) don't count as moved: they are there once the volume
        // is back. Otherwise casually adding something with the same name (items, assets) would replace them
        var gone = Set<String>()
        for path in listed where names.contains(keyOf(nameOf(path))) && Volumes.isThere(path) && !isDirectory(path) && !isFile(path) {
            gone.insert(key(path))
        }
        return Probed(items: items, gone: gone)
    }

    /// Adds to the list (dialog, drop, paste, open from outside), querying the disk on this thread
    @discardableResult
    static func add(_ settings: Settings, paths: [String]) -> AddResult {
        add(settings, probe: probe(listed: settings.library.map { $0.path }, paths: paths))
    }

    /// Adds to the list: new entries go below the pinned area and above the other entries. Ones already in the list (an entry itself, or
    /// reachable by a folder entry's scan) aren't added twice but are returned as `focus`, and the UI locates it directly. `focus` is the
    /// first path that can be opened this time.
    /// When a folder is added, the entries in the list that its scan reaches (subfolders and single files added earlier) are merged in:
    /// otherwise the same item would be listed in two places, and where its notes go would depend on which row is clicked;
    /// if a merged one was pinned, the new one is pinned too
    @discardableResult
    static func add(_ settings: Settings, probe: Probed) -> AddResult {
        var outcome = AddOutcome()
        settings.update { s in
            addItems(&s, probe: probe, outcome: &outcome)
        }
        return AddResult(added: outcome.added, focus: outcome.focus, skipped: outcome.skipped, relocated: outcome.relocated)
    }

    private static func addItems(_ s: inout SettingsValues, probe: Probed, outcome: inout AddOutcome) {
        let kinds = s.enabledKinds
        let skip = s.skipDirs
        var at = s.library.filter { $0.pinned }.count
        // Each entry's key is worked out once, and entries are found by key: every added path is checked against the whole list, and
        // comparing pairs would normalize N times N paths when thousands of separate files are dropped in
        var index = EntryIndex(s.library)
        for item in probe.items {
            guard let full = item.full else {
                outcome.skipped.append(ShellText.t("shell.add.invalid", ["path": item.raw]))
                continue
            }
            if !item.exists {
                outcome.skipped.append(ShellText.t("shell.notFound", ["path": full]))
                continue
            }
            if inDataDir(full) {
                outcome.skipped.append(ShellText.t("shell.add.dataDir", ["dir": DataDir.name, "path": full]))
                continue
            }
            if !item.isDirectory && MaterialKinds.kindOf(full) == nil {
                outcome.skipped.append(ShellText.t("shell.add.type", ["ext": extensionOf(full), "name": nameOf(full)]))
                continue
            }
            if outcome.focus == nil { outcome.focus = full }
            let fullKey = key(full)
            if index.isListed(fullKey: fullKey, full: full, kinds: kinds, skipDirs: skip) { continue }
            // The list entry that could no longer be found has moved: replace the path in place (position and pin kept)
            // instead of adding another entry
            if !probe.gone.isEmpty, let moved = movedFrom(s.library, full: full, isDirectory: item.isDirectory, probe: probe) {
                outcome.relocated.append(Relocation(from: moved.path, to: full))
                index.remove(moved)
                retarget(&s, moved, full)
                index.insert(moved)
                outcome.added.append(full)
                continue
            }
            let entry = LibraryEntry(path: full)
            if item.isDirectory {
                let absorbed = s.library.filter { other in
                    keyInside(index.key(of: other), fullKey) && covers(folder: full, path: other.path, kinds: kinds, skipDirs: skip)
                }
                if !absorbed.isEmpty {
                    let ids = Set(absorbed.map { ObjectIdentifier($0) })
                    at -= s.library.prefix(at).filter { ids.contains(ObjectIdentifier($0)) }.count
                    s.library.removeAll { ids.contains(ObjectIdentifier($0)) }
                    for other in absorbed { index.remove(other) }
                    entry.pinned = absorbed.contains { $0.pinned }
                }
            }
            if entry.pinned {
                let pinnedCount = s.library.filter { $0.pinned }.count
                s.library.insert(entry, at: pinnedCount)
            } else {
                s.library.insert(entry, at: at)
            }
            at += 1
            index.insert(entry)
            outcome.added.append(full)
        }
    }

    // MARK: Tidying, removing, pinning

    /// Tidy-up: entries reachable by another folder entry's scan are merged into it (repairs duplicates saved before "add the subfolder
    /// first, then the parent" was handled). Returns how many were merged.
    /// `reachable`: which paths have a confirmed mounted volume; the rest are skipped and tidied at a later start
    @discardableResult
    static func tidy(_ settings: Settings, reachable: ((String) -> Bool)? = nil) -> Int {
        let there = reachable ?? { _ in true }
        func coveredEntries(_ values: SettingsValues) -> [LibraryEntry] {
            let kinds = values.enabledKinds
            let skip = values.skipDirs
            let index = EntryIndex(values.library)
            // Pick by key first (only an entry inside another can be covered; most lists have no such pair, so no disk queries)
            return values.library.filter { x in
                for ancestor in ancestorKeys(of: index.key(of: x)) {
                    for folder in index.entries(withKey: ancestor) where folder !== x {
                        if there(x.path) && covers(folder: folder.path, path: x.path, kinds: kinds, skipDirs: skip) { return true }
                    }
                }
                return false
            }
        }
        if coveredEntries(settings.current).isEmpty { return 0 }
        var count = 0
        settings.update { s in
            let covered = coveredEntries(s)
            let ids = Set(covered.map { ObjectIdentifier($0) })
            let kinds = s.enabledKinds
            let skip = s.skipDirs
            for entry in covered where entry.pinned {
                for folder in s.library where !ids.contains(ObjectIdentifier(folder)) {
                    if covers(folder: folder.path, path: entry.path, kinds: kinds, skipDirs: skip) { folder.pinned = true }
                }
            }
            let rest = s.library.filter { !ids.contains(ObjectIdentifier($0)) }
            s.library = rest.filter { $0.pinned } + rest.filter { !$0.pinned }
            count = covered.count
        }
        return count
    }

    /// Removes from the list (files aren't deleted; the UI shows a confirmation first). Returns how many were removed. Expanded records of
    /// the removed entries and of everything inside them go too. When the open item is among those removed, "last selected" is cleared
    /// (otherwise nothing is selected at the next start)
    @discardableResult
    static func remove(_ settings: Settings, where which: @escaping (LibraryEntry) -> Bool) -> Int {
        var removed = 0
        settings.update { s in
            // Compare by keys: with pairs, removing thousands of separate files would normalize paths tens of millions of times
            let gone = s.library.filter(which)
            let ids = Set(gone.map { ObjectIdentifier($0) })
            let keys = Set(gone.map { Library.key($0.path) })
            // Inside a removed entry: walk up from this path one level at a time, and hitting a removed one means it is
            func covered(_ path: String) -> Bool {
                var current: String? = Library.key(path)
                while let k = current {
                    if keys.contains(k) { return true }
                    current = Library.parentKey(k)
                }
                return false
            }
            s.library.removeAll { ids.contains(ObjectIdentifier($0)) }
            s.expanded.removeAll(where: covered)
            if let selected = s.selected, covered(selected) { s.selected = nil }
            removed = gone.count
        }
        return removed
    }

    /// Pinning moves entries to the end of the pinned area; unpinning moves them to the front of the normal area. The UI pins by project
    /// and passes all entries of the project at once, whose order among themselves is unchanged
    static func pin(_ settings: Settings, paths: [String], pinned: Bool) throws {
        try settings.update { s in
            let listed = contains(paths)
            let targets = s.library.filter { listed($0.path) }
            if targets.isEmpty { throw LibraryError.notInLibrary(nil) }
            let ids = Set(targets.map { ObjectIdentifier($0) })
            s.library.removeAll { ids.contains(ObjectIdentifier($0)) }
            var at = s.library.filter { $0.pinned }.count
            for entry in targets {
                entry.pinned = pinned
                s.library.insert(entry, at: at)
                at += 1
            }
        }
    }
}

/// Library entries by comparison key, for finding the entries above a path without comparing it with every entry
private struct EntryIndex {
    private var keys: [ObjectIdentifier: String] = [:]
    private var byKey: [String: [LibraryEntry]] = [:]

    init(_ entries: [LibraryEntry]) {
        for entry in entries { insert(entry) }
    }

    mutating func insert(_ entry: LibraryEntry) {
        let k = Library.key(entry.path)
        keys[ObjectIdentifier(entry)] = k
        byKey[k, default: []].append(entry)
    }

    mutating func remove(_ entry: LibraryEntry) {
        guard let k = keys.removeValue(forKey: ObjectIdentifier(entry)) else { return }
        byKey[k]?.removeAll { $0 === entry }
        if byKey[k]?.isEmpty == true { byKey[k] = nil }
    }

    func key(of entry: LibraryEntry) -> String {
        keys[ObjectIdentifier(entry)] ?? Library.key(entry.path)
    }

    func entries(withKey k: String) -> [LibraryEntry] {
        byKey[k] ?? []
    }

    /// The path is an entry itself, or is reached by the scan of a folder entry above it
    func isListed(fullKey: String, full: String, kinds: Set<String>, skipDirs: Set<String>) -> Bool {
        if byKey[fullKey] != nil { return true }
        for ancestor in Library.ancestorKeys(of: fullKey) {
            for folder in entries(withKey: ancestor) where Library.covers(folder: folder.path, path: full, kinds: kinds, skipDirs: skipDirs) {
                return true
            }
        }
        return false
    }
}

/// Where an item's notes are stored (the "notes folder" is the folder holding .sniptoss, see DataDir):
/// 1. Search upward from the item's folder for an existing .sniptoss (or the older .pizhu) and use it if found: it was annotated in this
///    project, so keep using the same one, and agents need to read only one place;
/// 2. If there is none: an item that came from a folder entry in the list gets that folder; a file added on its own gets its own folder.
/// This only works out the location; .sniptoss is created when a note is first really written. One instance per scan (it remembers answers)
final class HomeFinder {
    /// Folder (by `Library.keyOf`) to the notes folder found at or above it; "" = none
    private var found: [String: String] = [:]

    func find(file: String, folderEntry: String?) -> String {
        let dir = Library.parentDirectory(of: file) ?? "/"
        return existing(dir) ?? folderEntry ?? dir
    }

    /// Searches upward from the folder of this path for an existing .sniptoss; nil if none (for entries that can't be found: only places
    /// that really have notes count, no guessing)
    func existingHome(of path: String) -> String? {
        Library.parentDirectory(of: path).flatMap { existing($0) }
    }

    /// The notes folder of a folder entry itself: the items inside it (when there is no deeper .sniptoss) are all stored here.
    /// `outer` is the outermost folder entry containing it (may be itself)
    func folderHome(of folder: String, outer: String) -> String {
        existing(folder) ?? outer
    }

    private func existing(_ dir: String) -> String? {
        let cacheKey = Library.keyOf(dir)
        if let hit = found[cacheKey] { return hit.isEmpty ? nil : hit }
        var home: String? = DataDir.existsIn(dir) ? dir : nil
        if home == nil, let parent = Library.parentDirectory(of: dir) { home = existing(parent) }
        found[cacheKey] = home ?? ""
        return home
    }
}

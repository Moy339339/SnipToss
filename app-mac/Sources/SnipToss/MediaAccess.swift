import Foundation

/// The request-to-file rule for the `media` host: what the page may read (docs/host-api.md, hard rule 2). Only
/// - the library entries (a file, or any file inside a folder entry), and
/// - `.sniptoss/` of a notes folder a scan has handed out
/// are served; everything else is a 404. The Windows shell maps whole drives, so it reads more than this; here nothing outside the list
/// is reachable even when it sits next to an item.
///
/// A request is checked twice: by its normalized path against the roots, and by its real path (every link resolved) against the real
/// path of the same root, so a link inside an item folder that points elsewhere cannot lead out of it. `.sniptoss` is held to the real
/// path of its notes folder plus `.sniptoss`, so a `.sniptoss` that is itself a link leads nowhere either.
///
/// Called on a background queue (see `FileSchemeHandler`), never on the main thread: it asks the disk
final class MediaAccess {
    private let roots: () -> [String]
    private let homes: () -> [String]
    private let rootsByKey = KeyMap()
    private let dataDirsByKey = KeyMap()

    /// - Parameters:
    ///   - roots: the library entries (files and folders)
    ///   - homes: the notes folders handed out so far
    init(roots: @escaping () -> [String], homes: @escaping () -> [String]) {
        self.roots = roots
        self.homes = homes
    }

    func resolve(_ url: URL) -> URL? {
        guard let requested = MediaURL.path(from: url) else { return nil }
        // The page never sends a dot segment (the URL parser removes them); one that arrives anyway is not a request to honor
        if Library.components(requested).contains("..") { return nil }
        guard let full = try? Library.norm(requested) else { return nil }
        // A volume that is not answering is not asked about the file: that would hold this thread for the system timeout
        Volumes.wait([full])
        guard Volumes.known(full) == true else { return nil }
        guard isGranted(full), PathPolicy.isRegularFile(full) else { return nil }
        // The path as requested, not the resolved one: the file's type is judged by the name the page used
        return URL(fileURLWithPath: full)
    }

    private func isGranted(_ full: String) -> Bool {
        let libraryRoots = rootsByKey.get(roots(), keyOf: { Library.key($0) })
        let dataDirs = dataDirsByKey.get(homes(), keyOf: { Library.key(Library.join($0, DataDir.name)) })
        guard let real = PathPolicy.realPath(full) else { return false }
        var current: String? = Library.keyOf(full)
        while let key = current {
            if let root = libraryRoots[key], let realRoot = PathPolicy.realPath(root), contains(realRoot, real) { return true }
            if let home = dataDirs[key], let realHome = PathPolicy.realPath(home), contains(Library.join(realHome, DataDir.name), real) {
                return true
            }
            current = Library.parentKey(key)
        }
        return false
    }

    private func contains(_ root: String, _ path: String) -> Bool {
        Library.same(path, root) || Library.inside(path, root)
    }
}

/// A list of paths by comparison key, rebuilt only when the list changes: requests come in by the dozen while a video plays, and the
/// library can hold thousands of entries
private final class KeyMap {
    private let lock = NSLock()
    private var source: [String] = []
    private var map: [String: String] = [:]

    /// Key to list element. The first of two elements with the same key wins
    func get(_ list: [String], keyOf: (String) -> String) -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        if list != source {
            var rebuilt: [String: String] = [:]
            for item in list {
                let key = keyOf(item)
                if rebuilt[key] == nil { rebuilt[key] = item }
            }
            source = list
            map = rebuilt
        }
        return map
    }
}

/// One scheme, two hosts: the UI (`app`) and the items on disk (`media`). Any other host is a 404
func hostResolver(ui: @escaping (URL) -> URL?, media: @escaping (URL) -> URL?) -> (URL) -> URL? {
    return { url in
        guard let host = url.host?.lowercased() else { return nil }
        if host == uiHost { return ui(url) }
        if host == MediaURL.host { return media(url) }
        return nil
    }
}

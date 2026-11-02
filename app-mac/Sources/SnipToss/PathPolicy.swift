import Foundation

/// The notes folders ("homes") a scan has handed to the page. Reading and writing notes, and serving `.sniptoss/` to the page, accept
/// only these. Compared the way the page compares paths (`Library.key`). Thread-safe: bridge methods run concurrently
final class NotesHomes {
    private let lock = NSLock()
    private var order: [String] = []
    private var keys = Set<String>()

    func insert(_ path: String) {
        let full = (try? Library.norm(path)) ?? path
        let key = Library.keyOf(full)
        lock.lock()
        defer { lock.unlock() }
        if keys.insert(key).inserted { order.append(full) }
    }

    func contains(_ path: String) -> Bool {
        let key = Library.key(path)
        lock.lock()
        defer { lock.unlock() }
        return keys.contains(key)
    }

    /// In the order they were handed out
    var all: [String] {
        lock.lock()
        defer { lock.unlock() }
        return order
    }

    /// The notes folder named in a call, normalized; refused unless a scan handed it out
    func require(_ raw: String) throws -> String {
        guard let home = try? Library.norm(raw) else { throw BridgeError("Invalid path: \(raw)") }
        guard contains(home) else { throw BridgeError("Unknown notes folder: \(home)", code: "denied") }
        return home
    }
}

/// What a path from the page may refer to (docs/host-api.md, hard rules 1 and 2). Every check works on the normalized path, so a `..`
/// cannot step out of a folder the check looked at
enum PathPolicy {
    /// The path is one of `roots` or inside one of them. False for a relative path and for one that cannot be normalized
    static func isUnder(_ path: String, roots: [String]) -> Bool {
        isUnder(path, rootKeys: Set(roots.map { Library.key($0) }))
    }

    /// Same, with the roots already turned into comparison keys (a long list is turned into keys once, not for every path asked about)
    static func isUnder(_ path: String, rootKeys: Set<String>) -> Bool {
        matchingKey(of: path, in: rootKeys) != nil
    }

    /// The nearest key in `keys` that is the path itself or a folder above it
    static func matchingKey(of path: String, in keys: Set<String>) -> String? {
        guard path.unicodeScalars.first == "/", let full = try? Library.norm(path) else { return nil }
        var current: String? = Library.keyOf(full)
        while let key = current {
            if keys.contains(key) { return key }
            current = Library.parentKey(key)
        }
        return nil
    }

    /// A file under `.sniptoss/` of a notes folder: `rel` is relative to the notes folder and, once normalized, must land inside
    /// `.sniptoss/`. Refused when the notes folder is gone, or when `.sniptoss` or a folder under it on the way is a link (the access would
    /// land wherever the link points). `home` is a notes folder `NotesHomes` accepted. The file itself need not exist
    static func inDataDir(home: String, rel: String) throws -> String {
        if rel.unicodeScalars.first == "/" { throw BridgeError("Relative path required: \(rel)") }
        let dataDir = Library.join(home, DataDir.name)
        guard let full = try? Library.norm(Library.join(home, rel)) else { throw BridgeError("Invalid path: \(rel)") }
        guard Library.inside(full, dataDir) else {
            throw BridgeError("Only files in \(DataDir.name)/ can be accessed: \(rel)", code: "denied")
        }
        Volumes.wait([home])
        guard Volumes.known(home) == true, Library.isDirectory(home) else {
            throw BridgeError("The notes folder is gone: \(home)", code: "notFound")
        }
        let limit = Library.key(dataDir)
        var dir = Library.parentDirectory(of: full)
        while let current = dir {
            if isSymbolicLink(current) {
                throw BridgeError("\(DataDir.name) contains a link, refused: \(current)", code: "denied")
            }
            if Library.key(current) == limit { break }
            dir = Library.parentDirectory(of: current)
        }
        return full
    }

    /// The path with every link resolved; nil when it does not exist
    static func realPath(_ path: String) -> String? {
        guard let resolved = Darwin.realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    /// The path itself is a link (what it points at is not looked at)
    static func isSymbolicLink(_ path: String) -> Bool {
        var st = stat()
        return Darwin.lstat(path, &st) == 0 && (Int(st.st_mode) & 0o170000) == 0o120000
    }

    /// A regular file, following links
    static func isRegularFile(_ path: String) -> Bool {
        var st = stat()
        return stat(path, &st) == 0 && (Int(st.st_mode) & 0o170000) == 0o100000
    }
}

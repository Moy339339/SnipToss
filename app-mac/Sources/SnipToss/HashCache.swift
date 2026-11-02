import CryptoKit
import Foundation

/// SHA-256 of items, recorded on this computer by full path plus size plus modification time (`cache/sha256.json` next to the settings).
/// The page needs to recognize which notes were written on an older version of an item (docs/adr/0008-earlier-versions.md), so it must
/// know the item's current fingerprint; reading a large video takes seconds, and the same file is not read again at the next start.
/// At most `maxEntries` are kept, the least recently used dropped beyond that. A record file that is damaged or unreadable counts as empty:
/// it is only a cache. Thread-safe
final class HashCache {
    static let defaultMax = 4000

    static let shared = HashCache(location: AppPaths.hashCacheFile)

    private struct Stamp: Equatable {
        let size: Int64
        /// Modification time in nanoseconds since 1970
        let mtime: Int64
    }

    private struct Entry {
        var stamp: Stamp
        var sha: String
        /// When it was last asked for (milliseconds since 1970 by default); decides what is dropped first
        var used: Int64
    }

    private let location: String
    private let maxEntries: Int
    private let now: () -> Int64
    /// Guards `entries`
    private let lock = NSLock()
    /// Taken around "take a snapshot and write it", so two writers cannot leave the older snapshot on disk
    private let writeLock = NSLock()
    private var entries: [String: Entry]?

    /// - Parameter now: the clock that stamps "last used"; a test replaces it with a counter so the order never ties
    init(
        location: String, maxEntries: Int = HashCache.defaultMax,
        now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.location = location
        self.maxEntries = maxEntries
        self.now = now
    }

    /// The SHA-256 of the file as lower-case hex. `path` is absolute
    func sha256(of path: String) throws -> String {
        guard path.unicodeScalars.first == "/" else { throw BridgeError("Absolute path required: \(path)") }
        let stamp = try HashCache.stamp(of: path)
        let key = Library.key(path)
        let hit: String? = withEntries { map in
            guard var entry = map[key], entry.stamp == stamp else { return nil }
            entry.used = now()
            map[key] = entry
            return entry.sha
        }
        if let sha = hit { return sha }

        let sha = try HashCache.compute(path)
        // The file changed again while it was being read (an agent just re-exported it): the result may belong to neither version, so
        // it is not recorded
        if let after = try? HashCache.stamp(of: path), after == stamp {
            record(key: key, entry: Entry(stamp: stamp, sha: sha, used: now()))
        }
        return sha
    }

    private func record(key: String, entry: Entry) {
        writeLock.lock()
        defer { writeLock.unlock() }
        let data: Data? = withEntries { map in
            map[key] = entry
            if map.count > maxEntries {
                let drop = map.sorted { $0.value.used < $1.value.used }.prefix(map.count - maxEntries).map { $0.key }
                for old in drop { map[old] = nil }
            }
            return encode(map)
        }
        guard let bytes = data else { return }
        do {
            try AtomicFile.write(location, bytes)
        } catch {
            Log.info("Hash cache not saved: \(error)")
        }
    }

    private func withEntries<T>(_ body: (inout [String: Entry]) -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        if entries == nil { entries = load() }
        return body(&entries!)
    }

    // MARK: The record file

    private func encode(_ map: [String: Entry]) -> Data? {
        var object: [String: Any] = [:]
        for (key, entry) in map {
            object[key] = ["size": entry.stamp.size, "mtime": entry.stamp.mtime, "sha": entry.sha, "used": entry.used] as [String: Any]
        }
        return try? JSONSerialization.data(withJSONObject: object)
    }

    private func load() -> [String: Entry] {
        guard FileManager.default.fileExists(atPath: location) else { return [:] }
        do {
            let data = try AtomicFile.readAllBytes(location)
            guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw SettingsFormatError(detail: "not a JSON object")
            }
            var map: [String: Entry] = [:]
            for (key, value) in root {
                guard let item = value as? [String: Any], let size = (item["size"] as? NSNumber)?.int64Value,
                    let mtime = (item["mtime"] as? NSNumber)?.int64Value, let sha = item["sha"] as? String,
                    let used = (item["used"] as? NSNumber)?.int64Value
                else { continue }
                map[key] = Entry(stamp: Stamp(size: size, mtime: mtime), sha: sha, used: used)
            }
            return map
        } catch {
            Log.info("Hash cache unreadable, starting empty: \(error)")
            return [:]
        }
    }

    // MARK: The file

    private static func stamp(of path: String) throws -> Stamp {
        var st = stat()
        if stat(path, &st) != 0 { throw FileOperationError(operation: "stat", path: path, code: errno) }
        if (Int(st.st_mode) & 0o170000) == 0o040000 { throw FileOperationError(operation: "read", path: path, code: EISDIR) }
        let mtime = Int64(st.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(st.st_mtimespec.tv_nsec)
        return Stamp(size: Int64(st.st_size), mtime: mtime)
    }

    /// Reads in 1 MiB pieces, so a large video never sits in memory whole. Does not hold the file shut: an agent re-exporting it meanwhile
    /// is not blocked
    private static func compute(_ path: String) throws -> String {
        let fd = Darwin.open(path, O_RDONLY)
        if fd < 0 { throw FileOperationError(operation: "open", path: path, code: errno) }
        defer { Darwin.close(fd) }
        var hasher = SHA256()
        var buffer = [UInt8](repeating: 0, count: 1 << 20)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count < 0 {
                let code = errno
                if code == EINTR { continue }
                throw FileOperationError(operation: "read", path: path, code: code)
            }
            if count == 0 { break }
            buffer.withUnsafeBytes { raw in
                hasher.update(bufferPointer: UnsafeRawBufferPointer(rebasing: raw.prefix(count)))
            }
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

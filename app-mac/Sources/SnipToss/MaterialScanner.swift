import Foundation

/// The folder scan: which files in a library folder entry are items. What counts as an item (extension tables, More formats) is
/// `MaterialKinds`; this is the walk over the disk and the notes it takes on the way (files that look like items but cannot be annotated
/// yet, folders it skipped). Same rules as the Windows shell's scanner
enum MaterialScanner {
    /// At most this many items are listed per folder entry (the page could not list more anyway). The scan stops there and the page marks
    /// it on the project row
    static let limit = 20000

    /// Files that look like items but cannot be annotated yet: not listed during a scan, only counted, and the end of the folder says
    /// "N more files aren't supported yet". PDF and slides are here too until annotating them is done
    private static let notYet: Set<String> = [
        ".pdf", ".pptx", ".ppt", ".key",
        ".psd", ".psb", ".ai", ".eps", ".jxl", ".tga", ".exr", ".hdr", ".dds",
        ".raw", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".xcf", ".kra", ".sketch", ".fig", ".xd", ".afdesign", ".afphoto",
        ".avi", ".wmv", ".flv", ".f4v", ".mpg", ".mpeg", ".3gp", ".m2ts", ".mts", ".vob", ".ogv", ".rm", ".rmvb",
    ]

    /// One item found. `mtime` and `ctime` are milliseconds since 1970; the creation time drives the "New" marker in the library
    struct Found: Equatable {
        let fullPath: String
        let kind: String
        let size: Int64
        let mtime: Int64
        let ctime: Int64
    }

    /// What a scan notes as a by-product: how many unsupported files and which extensions (lower case, no dot), and which folders were
    /// skipped (by name)
    final class Stats {
        var others = 0
        var otherExts = Set<String>()
        /// Files in a More format left out because that setting is off (the folder's last line says how to show them)
        var moreOff = 0
        var moreOffExts = Set<String>()
        /// Skipped folder names by lower-case name, keeping the spelling seen first: `DIST` and `dist` are one note
        var skippedByName: [String: String] = [:]
        /// There are items beyond the limit that were not listed (exactly at the limit does not count)
        var truncated = false

        var sortedOtherExts: [String] { otherExts.sorted() }
        var sortedMoreOffExts: [String] { moreOffExts.sorted() }
        var skippedDirs: [String] { skippedByName.values.sorted { $0.lowercased() < $1.lowercased() } }
    }

    /// What is on disk at a path
    private struct DiskEntry {
        let isDirectory: Bool
        /// A link to a folder is not entered: one pointing back to a parent would loop until the limit
        let isLink: Bool
        let hidden: Bool
        let size: Int64
        let mtime: Int64
        let ctime: Int64
    }

    /// The item at this path, or nil when it is not a file or its extension is not a supported kind
    static func describe(_ file: String) -> Found? {
        guard let kind = MaterialKinds.kindOf(file), let entry = inspect(file), !entry.isDirectory else { return nil }
        return Found(fullPath: file, kind: kind, size: entry.size, mtime: entry.mtime, ctime: entry.ctime)
    }

    /// Lists the items under `root`. Hidden files and folders (a leading dot, or the hidden flag) and Office lock files (`~$`) are left out
    /// entirely and are not counted as unsupported. `skipDirs` is lower case. A folder that cannot be read is left out, the rest is listed
    static func scan(
        _ root: String, enabledKinds: Set<String>, skipDirs: Set<String>, limit: Int = MaterialScanner.limit, stats: Stats? = nil
    ) -> [Found] {
        var found: [Found] = []
        var stack = [root]
        var more = false
        while let dir = stack.popLast(), !more {
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
            // The disk's order is arbitrary; a fixed order keeps what is cut off at the limit the same from one scan to the next
            for name in names.sorted() {
                if name.unicodeScalars.first == "." { continue }
                let path = Library.join(dir, name)
                guard let entry = inspect(path), !entry.hidden else { continue }
                if entry.isDirectory {
                    let lower = name.lowercased()
                    if skipDirs.contains(lower) {
                        if let stats = stats, stats.skippedByName[lower] == nil { stats.skippedByName[lower] = name }
                    } else if !entry.isLink {
                        stack.append(path)
                    }
                } else if !name.hasPrefix("~$") {
                    if let kind = MaterialKinds.listed(name, enabledKinds: enabledKinds) {
                        // Hit the limit with more left: record that the list is incomplete and stop searching
                        if found.count >= limit {
                            more = true
                            break
                        }
                        found.append(Found(fullPath: path, kind: kind, size: entry.size, mtime: entry.mtime, ctime: entry.ctime))
                    } else if let stats = stats {
                        note(name, enabledKinds: enabledKinds, in: stats)
                    }
                }
            }
        }
        stats?.truncated = more
        return found
    }

    /// A file that is not listed: counted when it is a format that is not supported yet, or a More format left out by the setting
    private static func note(_ name: String, enabledKinds: Set<String>, in stats: Stats) {
        let ext = Library.extensionOf(name).lowercased()
        let bare = String(ext.dropFirst())
        if notYet.contains(ext) {
            stats.others += 1
            stats.otherExts.insert(bare)
        } else if MaterialKinds.more.contains(ext), let kind = MaterialKinds.kindOf(name), enabledKinds.contains(kind) {
            // Only when its kind is on: with videos turned off, an MKV is no more missing than an MP4
            stats.moreOff += 1
            stats.moreOffExts.insert(bare)
        }
    }

    /// One look at the disk for a path. A link is described by what it points at (size and times of the target); one that points
    /// nowhere is not an item. Anything that is neither a folder nor a regular file (a socket, a pipe) is nil
    private static func inspect(_ path: String) -> DiskEntry? {
        var st = stat()
        guard Darwin.lstat(path, &st) == 0 else { return nil }
        // UF_HIDDEN: the flag Finder's "hidden" sets, apart from the leading dot
        let hidden = (st.st_flags & 0x8000) != 0
        let isLink = (Int(st.st_mode) & 0o170000) == 0o120000
        if isLink {
            guard stat(path, &st) == 0 else { return nil }
        }
        let type = Int(st.st_mode) & 0o170000
        guard type == 0o040000 || type == 0o100000 else { return nil }
        return DiskEntry(
            isDirectory: type == 0o040000, isLink: isLink, hidden: hidden, size: Int64(st.st_size),
            mtime: milliseconds(st.st_mtimespec), ctime: milliseconds(st.st_birthtimespec))
    }

    private static func milliseconds(_ time: timespec) -> Int64 {
        Int64(time.tv_sec) * 1000 + Int64(time.tv_nsec) / 1_000_000
    }
}

import Foundation

/// Whether the volume an item is on is mounted. An item under /Volumes/<name> lives on that mounted volume (a USB drive, a network
/// share, a disk image); when the folder /Volumes/<name> is gone, the volume is not connected, and the item was not deleted: it is
/// back once the volume is. Everything outside /Volumes is on the boot volume, which is always there.
///
/// This is a plain synchronous check. A network volume that stopped answering can make one check wait a long time, so call it from a
/// background thread only (bridge methods already run on one). Bounding the wait is left for later
enum Volumes {
    /// The mount point an absolute path is on: /Volumes/<name>; nil when the path is not under /Volumes (or is /Volumes itself)
    static func rootOf(_ path: String) -> String? {
        guard let full = try? Library.norm(path) else { return nil }
        let parts = Library.components(full)
        guard parts.count >= 2, parts[0].lowercased() == "volumes" else { return nil }
        return "/Volumes/" + parts[1]
    }

    /// Whether the volume of this path is mounted (always true for paths outside /Volumes)
    static func isThere(_ path: String) -> Bool {
        guard let root = rootOf(path) else { return true }
        return FileManager.default.fileExists(atPath: root)
    }
}

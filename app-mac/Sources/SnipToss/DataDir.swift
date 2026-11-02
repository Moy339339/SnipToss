import Foundation

/// The folder inside a notes folder that holds the notes data: .sniptoss (format in docs/annotation-format.md).
/// The names, the "is there one" check and the `.gitignore` placed inside it live here; reading and writing the notes belong to the
/// notes code
enum DataDir {
    static let name = ".sniptoss"

    /// The name used by earlier versions: recognized so existing notes folders are still found; nothing is ever written to it
    static let legacyName = ".pizhu"

    /// A path component that names the data folder (either name)
    static func isName(_ component: String) -> Bool {
        let lower = component.lowercased()
        return lower == name || lower == legacyName
    }

    /// Notes have been kept in this folder (either name counts)
    static func existsIn(_ dir: String) -> Bool {
        Library.isDirectory(Library.join(dir, name)) || Library.isDirectory(Library.join(dir, legacyName))
    }

    /// Contents of .sniptoss/.gitignore: ignores only the temporary and lock files left by writing; whether the notes themselves go
    /// into git is up to the user, so they are not ignored. The same text as `DataDir.GitIgnore` in the Windows shell
    static let gitIgnore =
        "# SnipToss: temporary and lock files left while saving notes (normally removed right away).\n"
        + "# Your notes are not ignored; commit them or not as you like.\n"
        + "*.tmp\n"
        + "*.lock\n"

    /// After something has been written into .sniptoss, puts a .gitignore there if there is none (a .tmp or .lock left by a power cut
    /// mid-write would otherwise show up in the git changes of the user's project). An existing one is left alone, the user may have edited
    /// it; failing to write it is harmless and only logged
    static func ensureGitIgnore(home: String) {
        let dir = Library.join(home, name)
        let path = Library.join(dir, ".gitignore")
        if FileManager.default.fileExists(atPath: path) || !Library.isDirectory(dir) { return }
        let fd = Darwin.open(path, O_WRONLY | O_CREAT | O_EXCL, 0o644)
        if fd < 0 {
            let code = errno
            // Another process just placed one
            if code != EEXIST { Log.info("Could not write .gitignore (\(String(cString: strerror(code)))): \(path)") }
            return
        }
        let bytes = Array(gitIgnore.utf8)
        let written = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, $0.count) }
        Darwin.close(fd)
        if written != bytes.count {
            Log.info("Could not write .gitignore: \(path)")
            _ = Darwin.unlink(path)
        }
    }
}

import Foundation

/// A failed file operation with the POSIX error number, so callers can tell "missing" from "busy" from "denied"
struct FileOperationError: Error, CustomStringConvertible {
    let operation: String
    let path: String
    let code: Int32

    var description: String { "\(operation) failed (\(String(cString: strerror(code)))): \(path)" }

    /// No such file, or a parent that is not a folder
    var isMissing: Bool { code == ENOENT || code == ENOTDIR }
}

/// Writes a file safely (docs/adr/0005-write-protocol.md): write a uniquely named temp file in the same folder, flush it to disk, then
/// replace the target in one step. If the process crashes or the power goes out mid-write, the original file is still intact; two writers
/// never step on each other's temp files.
/// rename(2) replaces the target even while another process has it open, and whoever has it open keeps reading the complete old content,
/// so unlike Windows there is no gap a busy reader can hold shut. The retry loop only covers the transient errors a network volume reports
enum AtomicFile {
    static let attempts = 10

    /// - Parameter backup: when given, the file being replaced is kept under this name first (the settings file's .bak). The copy is
    ///   itself written atomically, and the target is never missing in between
    static func write(_ path: String, _ data: Data, backup: String? = nil) throws {
        let tmp = try tempFor(path)
        do {
            try writeTemp(tmp, data)
            if let backup = backup { try keepBackup(of: path, as: backup) }
            try renameReplacing(tmp, path)
        } catch {
            removeQuietly(tmp)
            throw error
        }
    }

    /// Reads a whole file. Retries the transient errors, like `write`
    static func readAllBytes(_ path: String) throws -> Data {
        var attempt = 1
        while true {
            let fd = Darwin.open(path, O_RDONLY)
            if fd < 0 {
                let code = errno
                if isRetryable(code) && attempt < attempts {
                    pause(attempt)
                    attempt += 1
                    continue
                }
                throw FileOperationError(operation: "open", path: path, code: code)
            }
            defer { Darwin.close(fd) }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 64 * 1024)
            while true {
                let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
                if count < 0 {
                    let code = errno
                    if code == EINTR { continue }
                    throw FileOperationError(operation: "read", path: path, code: code)
                }
                if count == 0 { return data }
                data.append(contentsOf: buffer[0..<count])
            }
        }
    }

    /// Reads a text file as UTF-8; a byte order mark is dropped
    static func readAllText(_ path: String) throws -> String {
        let data = try readAllBytes(path)
        return String(decoding: stripBOM(data), as: UTF8.self)
    }

    static func stripBOM(_ data: Data) -> Data {
        data.starts(with: [0xEF, 0xBB, 0xBF]) ? Data(data.dropFirst(3)) : data
    }

    /// Creates a folder and the missing folders above it
    static func ensureDirectory(_ dir: String) throws {
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: dir, isDirectory: &isDir) {
            if isDir.boolValue { return }
            throw FileOperationError(operation: "create folder", path: dir, code: ENOTDIR)
        }
        let parent = (dir as NSString).deletingLastPathComponent
        if !parent.isEmpty && parent != dir { try ensureDirectory(parent) }
        if Darwin.mkdir(dir, 0o755) != 0 {
            let code = errno
            if code != EEXIST { throw FileOperationError(operation: "create folder", path: dir, code: code) }
        }
    }

    /// Same folder, leading dot (inconspicuous), process id plus a random string (two writers never collide), .tmp suffix
    /// (a watcher on *.json is not triggered by mistake). Creates the folder if it is missing
    private static func tempFor(_ path: String) throws -> String {
        var dir = (path as NSString).deletingLastPathComponent
        if dir.isEmpty { dir = "." }
        try ensureDirectory(dir)
        let name = (path as NSString).lastPathComponent
        let unique = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        return dir + "/." + name + "." + String(ProcessInfo.processInfo.processIdentifier) + "-" + unique + ".tmp"
    }

    /// Creates `tmp` (it must not exist), writes everything and flushes it to the disk itself, not only to the cache
    private static func writeTemp(_ tmp: String, _ data: Data) throws {
        let fd = Darwin.open(tmp, O_WRONLY | O_CREAT | O_EXCL, 0o644)
        if fd < 0 { throw FileOperationError(operation: "create", path: tmp, code: errno) }
        var failure: FileOperationError?
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            var offset = 0
            while offset < raw.count {
                let written = Darwin.write(fd, raw.baseAddress! + offset, raw.count - offset)
                if written < 0 {
                    let code = errno
                    if code == EINTR { continue }
                    failure = FileOperationError(operation: "write", path: tmp, code: code)
                    return
                }
                offset += written
            }
        }
        // F_FULLFSYNC asks the drive to flush its own cache too; file systems that do not support it fall back to fsync
        if failure == nil && Darwin.fcntl(fd, F_FULLFSYNC) != 0 && Darwin.fsync(fd) != 0 {
            failure = FileOperationError(operation: "flush", path: tmp, code: errno)
        }
        if Darwin.close(fd) != 0 && failure == nil {
            failure = FileOperationError(operation: "close", path: tmp, code: errno)
        }
        if let failure = failure { throw failure }
    }

    /// Copies what is on disk now to `backup`, atomically. Nothing to keep when the target does not exist yet
    private static func keepBackup(of path: String, as backup: String) throws {
        guard FileManager.default.fileExists(atPath: path) else { return }
        let old = try readAllBytes(path)
        let tmp = try tempFor(backup)
        do {
            try writeTemp(tmp, old)
            try renameReplacing(tmp, backup)
        } catch {
            removeQuietly(tmp)
            throw error
        }
    }

    private static func renameReplacing(_ from: String, _ to: String) throws {
        var attempt = 1
        while true {
            if Darwin.rename(from, to) == 0 { return }
            let code = errno
            if isRetryable(code) && attempt < attempts {
                pause(attempt)
                attempt += 1
                continue
            }
            throw FileOperationError(operation: "rename", path: to, code: code)
        }
    }

    /// Errors that usually pass after a short wait (a busy file, an interrupted call, a network volume that lost its handle)
    private static func isRetryable(_ code: Int32) -> Bool {
        code == EBUSY || code == EAGAIN || code == EINTR || code == ETXTBSY || code == ESTALE
    }

    private static func pause(_ attempt: Int) {
        Thread.sleep(forTimeInterval: 0.02 * Double(attempt))
    }

    private static func removeQuietly(_ path: String) {
        // A leftover .tmp file harms nothing; it is never read on the next start
        _ = Darwin.unlink(path)
    }
}

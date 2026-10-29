import Foundation

/// URL scheme and host the UI is served from (`sniptoss://app/index.html`); the bridge accepts messages from this origin only
let uiScheme = "sniptoss"
let uiHost = "app"

/// Plain log file at ~/Library/Logs/SnipToss/SnipToss-yyyyMMdd.log, also echoed to stderr. The home folder is written as ~ because
/// the log can end up attached to a public issue report
enum Log {
    private static let lock = NSLock()
    private static let home = NSHomeDirectory()

    static func info(_ text: String) { write("INFO", text) }
    static func error(_ text: String) { write("ERROR", text) }

    private static func write(_ level: String, _ text: String) {
        lock.lock()
        defer { lock.unlock() }
        let stamp = ISO8601DateFormatter().string(from: Date())
        let line = "\(stamp) \(level) \(text.replacingOccurrences(of: home, with: "~"))\n"
        FileHandle.standardError.write(Data(line.utf8))
        let dir = URL(fileURLWithPath: home).appendingPathComponent("Library/Logs/SnipToss", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let day = String(stamp.prefix(10)).replacingOccurrences(of: "-", with: "")
        let file = dir.appendingPathComponent("SnipToss-\(day).log")
        if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
        if let fh = try? FileHandle(forWritingTo: file) {
            defer { try? fh.close() }
            _ = try? fh.seekToEnd()
            try? fh.write(contentsOf: Data(line.utf8))
        }
    }
}

import Darwin
import Foundation

/// Recording for the performance budget (startup, and pressing the shortcut until the capture layer appears): when SNIPTOSS_PERF_LOG names a
/// file a line is appended to it, otherwise nothing happens. The lines read the same as the Windows shell's ("Process start → UI ready N ms",
/// "Hotkey → capture overlay shown N ms"), which is how the performance tests find them
enum Perf {
    private static let file = ProcessInfo.processInfo.environment["SNIPTOSS_PERF_LOG"]
    private static let lock = NSLock()
    private static var readyRecorded = false

    static func record(_ line: String) {
        guard let file else { return }
        let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withInternetDateTime, .withFractionalSeconds])
        lock.lock()
        defer { lock.unlock() }
        // Not recorded is fine: this only measures
        if !FileManager.default.fileExists(atPath: file) { FileManager.default.createFile(atPath: file, contents: nil) }
        guard let handle = FileHandle(forWritingAtPath: file) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data("\(stamp) \(line)\n".utf8))
    }

    /// The page said it is ready: the first time, how long since the process started
    static func uiReady() {
        lock.lock()
        let first = !readyRecorded
        readyRecorded = true
        lock.unlock()
        guard first, let start = processStart else { return }
        record("Process start → UI ready \(Int((Date().timeIntervalSince(start) * 1000).rounded())) ms")
    }

    /// When this process started, as the kernel recorded it
    static var processStart: Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return nil }
        let started = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: TimeInterval(started.tv_sec) + TimeInterval(started.tv_usec) / 1_000_000)
    }
}

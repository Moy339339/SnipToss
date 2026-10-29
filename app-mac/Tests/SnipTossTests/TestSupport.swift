import XCTest

@testable import SnipToss

/// Base class for tests that touch the disk: every test gets its own temporary folders, removed afterwards, and the log is written to a
/// temporary folder too, so nothing lands in the real ~/Library
class SnipTestCase: XCTestCase {
    private var tempRoots: [String] = []

    override func setUp() {
        super.setUp()
        Log.directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("snip-tests-logs", isDirectory: true)
    }

    override func tearDown() {
        for root in tempRoots {
            // A test that made a folder read-only must have put it back; this is the safety net
            _ = chmod(root, 0o755)
            try? FileManager.default.removeItem(atPath: root)
        }
        tempRoots = []
        super.tearDown()
    }

    /// A new empty folder (absolute path, no trailing slash)
    func makeTempDir() -> String {
        let root = (NSTemporaryDirectory() as NSString).appendingPathComponent("snip-tests/" + UUID().uuidString)
        try! FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        tempRoots.append(root)
        return root
    }

    func writeText(_ text: String, to path: String) {
        try! FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try! Data(text.utf8).write(to: URL(fileURLWithPath: path))
    }

    func readText(_ path: String) -> String {
        String(decoding: (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data(), as: UTF8.self)
    }

    /// Names in a folder (not the full paths), sorted
    func names(in dir: String) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? []).sorted()
    }

    /// Leftover temp files of AtomicFile in a folder
    func tempFiles(in dir: String) -> [String] {
        names(in: dir).filter { $0.hasSuffix(".tmp") }
    }
}

/// A counter several threads can bump
final class Counter {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var value: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

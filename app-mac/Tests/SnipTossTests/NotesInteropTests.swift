import XCTest

@testable import SnipToss

/// The shell and the command line (`sniptoss`, Node) writing the same notes file at the same time. Both take the same lock file and
/// follow the same rules (docs/adr/0005-write-protocol.md, item 7), so an agent writing a status back while the page saves a note must
/// lose neither. These tests start real Node processes; they are skipped when `node` or the built command line (`npm run build`) is missing
final class NotesInteropTests: SnipTestCase {
    private let materialSha = "9f2c1b7e0d4a6c3f8b5e2d1a0c9f8e7d6b5a4c3f2e1d0c9b8a7f6e5d4c3b2a19"

    // MARK: Tools

    private struct Tools {
        let node: String
        let repo: String
    }

    private func findNode() -> String? {
        var dirs = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { String($0) }
        dirs += ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        for dir in dirs {
            let candidate = dir + "/node"
            if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        }
        return nil
    }

    /// The repository root: the closest folder above this file that holds the built command line
    private func repoRoot(from file: String) -> String? {
        var dir = (file as NSString).deletingLastPathComponent
        while dir != "/" && !dir.isEmpty {
            if FileManager.default.fileExists(atPath: dir + "/packages/cli/dist/index.js") { return dir }
            dir = (dir as NSString).deletingLastPathComponent
        }
        return nil
    }

    private func locateTools(file: String = #filePath) throws -> Tools {
        guard let node = findNode() else { throw XCTSkip("node is not installed") }
        guard let repo = repoRoot(from: file) else { throw XCTSkip("the command line is not built (packages/cli/dist)") }
        return Tools(node: node, repo: repo)
    }

    /// A child process with everything it prints going to a file
    private final class Child {
        let process = Process()
        let logPath: String
        private let log: FileHandle

        init(node: String, arguments: [String], logPath: String) throws {
            FileManager.default.createFile(atPath: logPath, contents: nil)
            self.logPath = logPath
            self.log = try FileHandle(forWritingTo: URL(fileURLWithPath: logPath))
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = arguments
            process.standardOutput = log
            process.standardError = log
            try process.run()
        }

        var output: String {
            String(decoding: (try? Data(contentsOf: URL(fileURLWithPath: logPath))) ?? Data(), as: UTF8.self)
        }

        /// True if it has exited within `seconds`
        func waitForExit(seconds: TimeInterval) -> Bool {
            let deadline = Date().addingTimeInterval(seconds)
            while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
            return !process.isRunning
        }

        func stop() {
            if process.isRunning { process.terminate() }
            try? log.close()
        }
    }

    // MARK: Notes files

    private func note(_ id: String) -> [String: Any] {
        [
            "id": id, "status": "open", "category": "change", "body": "note \(id)", "anchor": [String: Any](), "author": "user",
            "created_at": "2026-10-25T12:00:00Z", "updated_at": "2026-10-25T12:00:00Z", "replies": [Any](),
        ]
    }

    private func fileText(_ ids: [String]) -> String {
        let material: [String: Any] = ["path": "assets/hero.png", "kind": "image", "sha256": materialSha, "width": 1920, "height": 1080]
        let root: [String: Any] = ["schema": "sniptoss/5", "material": material, "annotations": ids.map { note($0) }]
        return JSONText.document(root)
    }

    private func notes(in text: String) throws -> [[String: Any]] {
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        return try XCTUnwrap(root["annotations"] as? [[String: Any]])
    }

    private func replies(in text: String, noteId: String) throws -> [String] {
        let all = try notes(in: text)
        let match = try XCTUnwrap(all.first { ($0["id"] as? String) == noteId })
        return ((match["replies"] as? [[String: Any]]) ?? []).compactMap { $0["body"] as? String }
    }

    private func status(in text: String, noteId: String) throws -> String? {
        let all = try notes(in: text)
        let match = all.first { ($0["id"] as? String) == noteId }
        return match?["status"] as? String
    }

    /// What the page does: the text with one more reply on a note
    private func addingReply(to text: String, noteId: String, body: String) throws -> String {
        var root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        var all = try XCTUnwrap(root["annotations"] as? [[String: Any]])
        let index = try XCTUnwrap(all.firstIndex { ($0["id"] as? String) == noteId })
        var list = (all[index]["replies"] as? [[String: Any]]) ?? []
        list.append(["author": "shell", "body": body, "at": "2026-10-29T00:00:00Z"])
        all[index]["replies"] = list
        root["annotations"] = all
        return JSONText.document(root)
    }

    /// One write the way the page does it: read, change, write with the fingerprint that was read; when refused (someone just wrote) read
    /// again. Returns how many times it was refused
    @discardableResult
    private func writeReply(_ full: String, noteId: String, body: String) throws -> Int {
        var refused = 0
        while true {
            let text = try AtomicFile.readAllText(full)
            let next = try addingReply(to: text, noteId: noteId, body: body)
            let outcome = try NotesStore.writeIfUnchanged(full, text: next, check: true, expectSha256: NotesStore.textSha256(text))
            if outcome.written { return refused }
            refused += 1
        }
    }

    // MARK: Tests

    func testShellAndCommandLineAddingRepliesToTheSameNoteAtOnceLoseNoChange() throws {
        let tools = try locateTools()
        let writer = tools.repo + "/packages/cli/test/stress/writer.mjs"
        try XCTSkipUnless(FileManager.default.fileExists(atPath: writer), "the stress writer is missing")
        let home = makeTempDir()
        let logs = makeTempDir()
        let full = home + "/.sniptoss/annotations/assets__hero.png.json"
        writeText(fileText(["k3f9a2", "done01"]), to: full)
        let each = 60

        // Two command-line processes, each writing back `each` replies through the same path an agent's write-back takes
        var children: [Child] = []
        for tag in ["n0", "n1"] {
            children.append(
                try Child(node: tools.node, arguments: [writer, home, "k3f9a2", tag, String(each)], logPath: logs + "/" + tag + ".log"))
        }
        defer { for child in children { child.stop() } }

        // Wait until the command line has really started writing, so the shell does not finish before Node is up
        let deadline = Date().addingTimeInterval(20)
        while !readText(full).contains("\"n0-") && Date() < deadline { Thread.sleep(forTimeInterval: 0.005) }

        var refused = 0
        for k in 0..<each { refused += try writeReply(full, noteId: "k3f9a2", body: "sw-\(k)") }

        for child in children {
            XCTAssertTrue(child.waitForExit(seconds: 60), "the command line did not finish: \(child.output)")
            XCTAssertEqual(child.process.terminationStatus, 0, "the command line failed: \(child.output)")
        }

        let after = try replies(in: try AtomicFile.readAllText(full), noteId: "k3f9a2")
        var expected: [String] = []
        for tag in ["n0", "n1", "sw"] { for k in 0..<each { expected.append("\(tag)-\(k)") } }
        let lost = Set(expected).subtracting(after)
        XCTAssertTrue(lost.isEmpty, "lost \(lost.count) changes, e.g. \(lost.sorted().prefix(5))")
        XCTAssertEqual(after.count, expected.count, "a change was written twice")
        // They really took turns: the shell's writes sit between the command line's
        if let first = after.firstIndex(where: { $0.hasPrefix("sw-") }), let last = after.lastIndex(where: { $0.hasPrefix("sw-") }) {
            XCTAssertTrue(after[first..<last].contains { $0.hasPrefix("n") }, "the writers never overlapped (\(refused) refusals)")
        }
        XCTAssertEqual(names(in: home + "/.sniptoss/annotations"), ["assets__hero.png.json"], "no lock or temp file is left")
    }

    func testTheCommandLinesStatusWriteBackAndTheShellsWritesToOtherNotesOfTheSameFileAreBothKept() throws {
        let tools = try locateTools()
        let cli = tools.repo + "/packages/cli/dist/index.js"
        let home = makeTempDir()
        let logs = makeTempDir()
        let full = home + "/.sniptoss/annotations/assets__hero.png.json"
        let ids = ["cli001", "cli002", "cli003", "cli004", "cli005", "cli006"]
        writeText(fileText(ids + ["shell1"]), to: full)

        var children: [Child] = []
        for id in ids {
            let arguments = [cli, "resolve", id, "--root", home, "-m", "done-" + id]
            children.append(try Child(node: tools.node, arguments: arguments, logPath: logs + "/" + id + ".log"))
        }
        defer { for child in children { child.stop() } }

        // The shell keeps writing until every write-back has finished (and at least a few times)
        var written = 0
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            let running = children.contains { $0.process.isRunning }
            if !running && written >= 10 { break }
            try writeReply(full, noteId: "shell1", body: "sw-\(written)")
            written += 1
        }

        for child in children {
            XCTAssertTrue(child.waitForExit(seconds: 30), "the command line did not finish: \(child.output)")
            XCTAssertEqual(child.process.terminationStatus, 0, "the command line failed: \(child.output)")
        }
        let text = try AtomicFile.readAllText(full)
        for id in ids {
            XCTAssertEqual(try status(in: text, noteId: id), "resolved", id)
            XCTAssertEqual(try replies(in: text, noteId: id), ["done-" + id], id)
        }
        let shellReplies = try replies(in: text, noteId: "shell1")
        XCTAssertEqual(shellReplies, (0..<written).map { "sw-\($0)" }, "the shell's writes were lost or reordered")
        XCTAssertEqual(try status(in: text, noteId: "shell1"), "open")
        XCTAssertEqual(names(in: home + "/.sniptoss/annotations"), ["assets__hero.png.json"], "no lock or temp file is left")
    }

    func testTheCommandLineWaitsForALockTakenByTheShell() throws {
        let tools = try locateTools()
        let cli = tools.repo + "/packages/cli/dist/index.js"
        let home = makeTempDir()
        let logs = makeTempDir()
        let full = home + "/.sniptoss/annotations/assets__hero.png.json"
        let original = fileText(["cli001"])
        writeText(original, to: full)

        let held = try FileLock.acquire(full)
        defer { held.release() }
        let child = try Child(node: tools.node, arguments: [cli, "resolve", "cli001", "--root", home], logPath: logs + "/cli.log")
        defer { child.stop() }

        // Long enough for Node to start and reach the lock; it must still be waiting, with the file untouched
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(child.process.isRunning, "the command line did not wait for the shell's lock: \(child.output)")
        XCTAssertEqual(readText(full), original)

        held.release()
        XCTAssertTrue(child.waitForExit(seconds: 30), "the command line did not finish: \(child.output)")
        XCTAssertEqual(child.process.terminationStatus, 0, child.output)
        XCTAssertEqual(try status(in: readText(full), noteId: "cli001"), "resolved")
    }

    func testTheShellWaitsForALockTakenByTheCommandLineAndReadsWhoHoldsIt() throws {
        let tools = try locateTools()
        let store = tools.repo + "/packages/cli/dist/fs-store.js"
        try XCTSkipUnless(FileManager.default.fileExists(atPath: store), "fs-store.js is missing")
        let home = makeTempDir()
        let logs = makeTempDir()
        let full = home + "/.sniptoss/annotations/assets__hero.png.json"
        writeText(fileText(["cli001"]), to: full)
        let lockPath = FileLock.pathFor(full)

        // The command line's own lock, held for 2 seconds
        let script =
            "import { pathToFileURL } from 'node:url';"
            + " const { withFileLock } = await import(pathToFileURL(process.argv[2]).href);"
            + " await withFileLock(process.argv[1], () => new Promise((resolve) => setTimeout(resolve, 2000)));"
        let child = try Child(
            node: tools.node, arguments: ["--input-type=module", "-e", script, full, store], logPath: logs + "/lock.log")
        defer { child.stop() }
        // The lock file is created empty and then filled in: wait for the content
        let appeared = Date().addingTimeInterval(20)
        while readText(lockPath).isEmpty && Date() < appeared { Thread.sleep(forTimeInterval: 0.005) }
        XCTAssertFalse(readText(lockPath).isEmpty, "the command line never took its lock: \(child.output)")

        // Its lock reads the way ours does: "process id, time, computer name"
        let parts = readText(lockPath).components(separatedBy: " ")
        XCTAssertEqual(parts.count, 3, readText(lockPath))
        XCTAssertEqual(Int32(parts[0]), child.process.processIdentifier)
        XCTAssertNotNil(Int64(parts[1]))
        let machine = parts.count == 3 ? parts[2].lowercased() : ""
        XCTAssertEqual(machine, FileLock.machine.lowercased(), "the computer name differs from the command line's")
        XCTAssertNil(FileLock.staleContent(lockPath), "a live lock from the command line was taken for a left-over one")

        // The shell does not take it away, and gets in once the command line lets go
        XCTAssertThrowsError(try NotesStore.writeIfUnchanged(full, text: "x", check: false, expectSha256: nil, lockWait: 0.3)) { error in
            guard case FileLockError.stayedLocked = error else { return XCTFail("\(error)") }
        }
        let outcome = try NotesStore.writeIfUnchanged(
            full, text: fileText(["cli001", "second"]), check: false, expectSha256: nil, lockWait: 15)
        XCTAssertTrue(outcome.written)
        XCTAssertTrue(child.waitForExit(seconds: 30))
        XCTAssertEqual(try notes(in: readText(full)).count, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: lockPath))
    }

    func testALockTheCommandLineLeftBehindWhenItWasKilledIsTakenOverAtOnce() throws {
        let tools = try locateTools()
        let store = tools.repo + "/packages/cli/dist/fs-store.js"
        try XCTSkipUnless(FileManager.default.fileExists(atPath: store), "fs-store.js is missing")
        let home = makeTempDir()
        let logs = makeTempDir()
        let full = home + "/.sniptoss/annotations/assets__hero.png.json"
        writeText(fileText(["cli001"]), to: full)
        let lockPath = FileLock.pathFor(full)

        let script =
            "import { pathToFileURL } from 'node:url';"
            + " const { withFileLock } = await import(pathToFileURL(process.argv[2]).href);"
            + " await withFileLock(process.argv[1], () => new Promise((resolve) => setTimeout(resolve, 60000)));"
        let child = try Child(
            node: tools.node, arguments: ["--input-type=module", "-e", script, full, store], logPath: logs + "/lock.log")
        defer { child.stop() }
        // The lock file is created empty and then filled in: wait for the content
        let appeared = Date().addingTimeInterval(20)
        while readText(lockPath).isEmpty && Date() < appeared { Thread.sleep(forTimeInterval: 0.005) }
        XCTAssertFalse(readText(lockPath).isEmpty, "the command line never took its lock: \(child.output)")

        // Killed while holding it: nothing deletes the lock file
        kill(child.process.processIdentifier, SIGKILL)
        XCTAssertTrue(child.waitForExit(seconds: 10))
        XCTAssertTrue(FileManager.default.fileExists(atPath: lockPath))

        let started = Date()
        let outcome = try NotesStore.writeIfUnchanged(
            full, text: fileText(["cli001", "second"]), check: false, expectSha256: nil, lockWait: 5)
        XCTAssertTrue(outcome.written)
        XCTAssertLessThan(Date().timeIntervalSince(started), 3.0, "the dead process's lock was waited out")
    }
}

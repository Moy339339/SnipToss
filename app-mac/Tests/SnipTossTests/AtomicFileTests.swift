import XCTest

@testable import SnipToss

final class AtomicFileTests: SnipTestCase {
    func testCreateAndOverwriteBothWriteCorrectlyLeavingNoTempFile() throws {
        let dir = makeTempDir()
        let path = dir + "/a.json"
        try AtomicFile.write(path, Data("1".utf8))
        try AtomicFile.write(path, Data("22".utf8))
        XCTAssertEqual(readText(path), "22")
        XCTAssertEqual(tempFiles(in: dir), [])
    }

    func testCreatesTheFolderIfItDoesNotExist() throws {
        let dir = makeTempDir()
        let path = dir + "/x/y/a.json"
        try AtomicFile.write(path, Data("ok".utf8))
        XCTAssertEqual(readText(path), "ok")
    }

    func testEmptyContentIsWritten() throws {
        let dir = makeTempDir()
        let path = dir + "/a.json"
        try AtomicFile.write(path, Data("full".utf8))
        try AtomicFile.write(path, Data())
        XCTAssertEqual(readText(path), "")
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))
    }

    func testTwoWritersWritingAtOnceEveryReadSeesCompleteContent() throws {
        let dir = makeTempDir()
        let path = dir + "/a.json"
        try AtomicFile.write(path, Data(String(repeating: "a", count: 4096).utf8))
        let finished = Counter()
        let failed = Counter()
        let group = DispatchGroup()
        for writer in 0..<4 {
            group.enter()
            DispatchQueue.global().async {
                let letter = String(Character(UnicodeScalar(UInt8(97 + writer))))
                for _ in 0..<50 {
                    do {
                        try AtomicFile.write(path, Data(String(repeating: letter, count: 4096).utf8))
                    } catch {
                        failed.increment()
                    }
                }
                finished.increment()
                group.leave()
            }
        }
        var torn = 0
        while finished.value < 4 {
            let text = try AtomicFile.readAllText(path)
            if text.count != 4096 || Set(text).count != 1 { torn += 1 }
        }
        group.wait()
        XCTAssertEqual(failed.value, 0)
        XCTAssertEqual(torn, 0)
        XCTAssertEqual(tempFiles(in: dir), [])
    }

    func testTargetOpenForReadingIsStillReplacedAndTheReaderFinishesTheOldContent() throws {
        // A reader that has the file open must not hold the writer up, and must not see a half-written file
        let dir = makeTempDir()
        let path = dir + "/a.json"
        try AtomicFile.write(path, Data("old".utf8))
        let reader = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
        defer { try? reader.close() }
        let started = Date()
        try AtomicFile.write(path, Data("new".utf8))
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0, "the write waited for the reader")
        let rest = try reader.readToEnd() ?? Data()
        XCTAssertEqual(String(decoding: rest, as: UTF8.self), "old")
        XCTAssertEqual(try AtomicFile.readAllText(path), "new")
        XCTAssertEqual(tempFiles(in: dir), [])
    }

    func testReplaceWithBackupKeepsTheOldContentInTheBackup() throws {
        let dir = makeTempDir()
        let path = dir + "/s.json"
        try AtomicFile.write(path, Data("v1".utf8), backup: path + ".bak")
        XCTAssertFalse(FileManager.default.fileExists(atPath: path + ".bak"), "the first write has no old file to keep")
        try AtomicFile.write(path, Data("v2".utf8), backup: path + ".bak")
        XCTAssertEqual(readText(path), "v2")
        XCTAssertEqual(readText(path + ".bak"), "v1")
        try AtomicFile.write(path, Data("v3".utf8), backup: path + ".bak")
        XCTAssertEqual(readText(path + ".bak"), "v2")
        XCTAssertEqual(tempFiles(in: dir), [])
    }

    func testAByteOrderMarkIsDroppedWhenReadingText() throws {
        let dir = makeTempDir()
        let path = dir + "/a.json"
        try Data([0xEF, 0xBB, 0xBF] + Array("{}".utf8)).write(to: URL(fileURLWithPath: path))
        XCTAssertEqual(try AtomicFile.readAllText(path), "{}")
    }

    func testReadingAMissingFileSaysSo() {
        let dir = makeTempDir()
        XCTAssertThrowsError(try AtomicFile.readAllBytes(dir + "/none.json")) { error in
            XCTAssertEqual((error as? FileOperationError)?.isMissing, true)
        }
    }

    func testAWriteThatCannotCreateItsTempFileThrowsAndLeavesTheOriginal() throws {
        try XCTSkipIf(getuid() == 0, "folder permissions do not apply to root")
        let dir = makeTempDir()
        let path = dir + "/a.json"
        try AtomicFile.write(path, Data("old".utf8))
        XCTAssertEqual(chmod(dir, 0o555), 0)
        defer { _ = chmod(dir, 0o755) }
        XCTAssertThrowsError(try AtomicFile.write(path, Data("new".utf8))) { error in
            XCTAssertEqual((error as? FileOperationError)?.code, EACCES)
        }
        XCTAssertEqual(chmod(dir, 0o755), 0)
        XCTAssertEqual(readText(path), "old")
        XCTAssertEqual(tempFiles(in: dir), [])
    }
}

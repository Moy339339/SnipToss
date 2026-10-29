import CryptoKit
import XCTest

@testable import SnipToss

/// Item fingerprints are cached on this computer by path, size and modified time (docs/adr/0008-earlier-versions.md: recognising notes on
/// an older version needs the item's current fingerprint, and large videos must not be read again)
final class HashCacheTests: SnipTestCase {
    private func sha(_ path: String) -> String {
        let data = (try? Data(contentsOf: URL(fileURLWithPath: path))) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// A cache whose "last used" stamps come from a counter, so the order never ties
    private func makeCache(_ location: String, maxEntries: Int = HashCache.defaultMax) -> HashCache {
        let counter = Counter()
        return HashCache(
            location: location, maxEntries: maxEntries,
            now: {
                counter.increment()
                return Int64(counter.value)
            })
    }

    private func recordedKeys(_ location: String) throws -> Set<String> {
        let data = try Data(contentsOf: URL(fileURLWithPath: location))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return Set(root.keys)
    }

    func testComputesCorrectlyRecordsItAndReturnsTheRecordedValueWhileTheFileIsUnchanged() throws {
        let dir = makeTempDir()
        let location = dir + "/cache/sha256.json"
        let file = dir + "/a.png"
        writeText("abc", to: file)
        let cache = makeCache(location)
        XCTAssertEqual(try cache.sha256(of: file), sha(file))
        XCTAssertEqual(try cache.sha256(of: file), sha(file))
        XCTAssertTrue(FileManager.default.fileExists(atPath: location))

        // Tamper with the recorded fingerprint: a file with the same size and modified time returns the recorded value, so it was not read
        let fake = String(repeating: "f", count: 64)
        let text = readText(location).replacingOccurrences(of: sha(file), with: fake)
        writeText(text, to: location)
        XCTAssertEqual(try makeCache(location).sha256(of: file), fake, "a new process reads the record file")
    }

    func testRecomputesWhenTheSizeChangedOrTheModifiedTimeMovedOn() throws {
        let dir = makeTempDir()
        let file = dir + "/b.png"
        writeText("abc", to: file)
        let cache = makeCache(dir + "/cache/sha256.json")
        let first = try cache.sha256(of: file)

        writeText("abcd", to: file)
        let second = try cache.sha256(of: file)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(second, sha(file))

        // Same size, later modification time: also another version
        writeText("abce", to: file)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(60)], ofItemAtPath: file)
        let third = try cache.sha256(of: file)
        XCTAssertNotEqual(second, third)
        XCTAssertEqual(third, sha(file))
    }

    func testACorruptRecordFileCountsAsEmptyAndTheHashIsStillComputed() throws {
        let dir = makeTempDir()
        let location = dir + "/cache/sha256.json"
        writeText("{ 坏了", to: location)
        let file = dir + "/c.png"
        writeText("c", to: file)
        XCTAssertEqual(try makeCache(location).sha256(of: file), sha(file))
        XCTAssertEqual(try recordedKeys(location), [Library.key(file)], "and the record file is sound again")
    }

    func testRecordsWithMissingFieldsAreIgnored() throws {
        let dir = makeTempDir()
        let location = dir + "/cache/sha256.json"
        let file = dir + "/c.png"
        writeText("c", to: file)
        let partial: [String: Any] = [Library.key(file): ["size": 1], "other": 5]
        try FileManager.default.createDirectory(atPath: dir + "/cache", withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: partial).write(to: URL(fileURLWithPath: location))
        XCTAssertEqual(try makeCache(location).sha256(of: file), sha(file))
    }

    func testRelativePathsAreRejected() {
        let cache = makeCache(makeTempDir() + "/cache/sha256.json")
        XCTAssertThrowsError(try cache.sha256(of: "a.png")) { error in
            XCTAssertNotNil(error as? BridgeError)
        }
    }

    func testAMissingFileAndAFolderCannotBeHashed() {
        let dir = makeTempDir()
        let cache = makeCache(dir + "/cache/sha256.json")
        XCTAssertThrowsError(try cache.sha256(of: dir + "/none.png")) { error in
            XCTAssertEqual((error as? FileOperationError)?.isMissing, true)
        }
        XCTAssertThrowsError(try cache.sha256(of: dir))
    }

    func testAnEmptyFileHasTheWellKnownDigest() throws {
        let dir = makeTempDir()
        writeText("", to: dir + "/empty.png")
        let emptyDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        XCTAssertEqual(try makeCache(dir + "/cache/sha256.json").sha256(of: dir + "/empty.png"), emptyDigest)
    }

    func testALargeFileIsReadInPiecesAndGivesTheSameDigestAsReadingItWhole() throws {
        let dir = makeTempDir()
        let file = dir + "/big.mov"
        // Three and a bit MiB of a repeating pattern: more than three reads of one MiB, the last one short
        let count = 3 * 1024 * 1024 + 17
        var bytes = [UInt8]()
        bytes.reserveCapacity(count)
        for i in 0..<count { bytes.append(UInt8(truncatingIfNeeded: i &* 31 &+ i >> 8)) }
        try Data(bytes).write(to: URL(fileURLWithPath: file))
        XCTAssertEqual(try makeCache(dir + "/cache/sha256.json").sha256(of: file), sha(file))
    }

    func testTheLeastRecentlyUsedEntriesAreDroppedBeyondTheLimit() throws {
        let dir = makeTempDir()
        let location = dir + "/cache/sha256.json"
        let cache = makeCache(location, maxEntries: 3)
        let files = ["a", "b", "c", "d"].map { name -> String in
            let path = dir + "/" + name + ".png"
            writeText("content " + name, to: path)
            return path
        }
        for file in files { _ = try cache.sha256(of: file) }
        let keys = try recordedKeys(location)
        XCTAssertEqual(keys.count, 3)
        XCTAssertFalse(keys.contains(Library.key(files[0])), "the oldest one went")
        XCTAssertTrue(keys.contains(Library.key(files[3])))
    }

    func testSeveralThreadsHashingAtOnceAllGetTheRightAnswerAndTheRecordFileStaysSound() throws {
        let dir = makeTempDir()
        let location = dir + "/cache/sha256.json"
        let cache = makeCache(location)
        let files = (0..<5).map { i -> String in
            let path = dir + "/f\(i).png"
            writeText("content \(i)", to: path)
            return path
        }
        let expected = files.map { sha($0) }
        let wrong = Counter()
        DispatchQueue.concurrentPerform(iterations: 40) { n in
            let i = n % files.count
            if (try? cache.sha256(of: files[i])) != expected[i] { wrong.increment() }
        }
        XCTAssertEqual(wrong.value, 0)
        XCTAssertEqual(try recordedKeys(location), Set(files.map { Library.key($0) }))
        XCTAssertTrue(tempFiles(in: dir + "/cache").isEmpty)
    }

    func testTheDefaultRecordFileIsInTheCacheFolderNextToTheSettings() {
        XCTAssertEqual(AppPaths.hashCacheFile, AppPaths.localDir + "/cache/sha256.json")
    }
}

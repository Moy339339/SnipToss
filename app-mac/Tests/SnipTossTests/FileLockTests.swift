import XCTest

@testable import SnipToss

/// The cross-process write lock (FileLock.swift, the "Lock" section of docs/adr/0005-write-protocol.md). The command line takes the same
/// lock, so these tests check the file name, the content and the rules for a lock left behind exactly as the command line reads them
final class FileLockTests: SnipTestCase {
    /// How many holders are inside the lock right now, counted safely from several threads
    private final class Occupancy {
        private let guardLock = NSLock()
        private var inside = 0

        /// True if somebody else was already inside
        func enter() -> Bool {
            guardLock.lock()
            defer { guardLock.unlock() }
            inside += 1
            return inside > 1
        }

        func leave() {
            guardLock.lock()
            inside -= 1
            guardLock.unlock()
        }
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    /// The id of a process that has already exited
    private func deadProcessId() throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        try process.run()
        process.waitUntilExit()
        return process.processIdentifier
    }

    private func backdate(_ path: String, seconds: TimeInterval) throws {
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -seconds)], ofItemAtPath: path)
    }

    func testTheLockFileIsNamedLikeTheCommandLinesAndSitsNextToTheNotesFile() {
        XCTAssertEqual(FileLock.pathFor("/p/.sniptoss/annotations/a.png.json"), "/p/.sniptoss/annotations/.a.png.json.lock")
        XCTAssertEqual(FileLock.pathFor("/p/./x/../a.json"), "/p/.a.json.lock", "the path is normalized first")
        XCTAssertEqual(FileLock.pathFor("/a.json"), "/.a.json.lock")
    }

    func testTakingTheLockCreatesTheLockFileAndReleasingDeletesIt() throws {
        let dir = makeTempDir()
        let file = dir + "/a.json"
        let lockPath = FileLock.pathFor(file)
        XCTAssertEqual(lockPath, dir + "/.a.json.lock")

        let held = try FileLock.acquire(file)
        XCTAssertTrue(FileManager.default.fileExists(atPath: lockPath))
        XCTAssertTrue(readText(lockPath).hasPrefix("\(ProcessInfo.processInfo.processIdentifier) "))
        held.release()
        XCTAssertFalse(FileManager.default.fileExists(atPath: lockPath))
        held.release()  // twice is harmless
    }

    func testTheLockSaysProcessIdTimeAndComputerNameSeparatedBySingleSpaces() throws {
        let dir = makeTempDir()
        let file = dir + "/a.json"
        let before = nowMillis()
        let held = try FileLock.acquire(file)
        defer { held.release() }
        let after = nowMillis()
        // The command line reads these three fields in this order with a split on " "
        let parts = readText(FileLock.pathFor(file)).components(separatedBy: " ")
        XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(Int32(parts[0]), ProcessInfo.processInfo.processIdentifier)
        let stamp = try XCTUnwrap(Int64(parts[1]))
        XCTAssertGreaterThanOrEqual(stamp, before)
        XCTAssertLessThanOrEqual(stamp, after)
        XCTAssertEqual(parts[2], FileLock.machine)
    }

    func testTheFolderOfTheLockIsCreatedWhenMissing() throws {
        let dir = makeTempDir()
        let file = dir + "/.sniptoss/annotations/a.json"
        try FileLock.withLock(file) {
            XCTAssertTrue(FileManager.default.fileExists(atPath: FileLock.pathFor(file)))
        }
        XCTAssertEqual(names(in: dir + "/.sniptoss/annotations"), [])
    }

    func testWithLockReleasesWhenTheBodyThrows() throws {
        struct Boom: Error {}
        let file = makeTempDir() + "/a.json"
        XCTAssertThrowsError(try FileLock.withLock(file) { () throws -> Void in throw Boom() })
        XCTAssertFalse(FileManager.default.fileExists(atPath: FileLock.pathFor(file)))
    }

    func testASecondWriterGetsTheLockOnlyAfterTheFirstReleasesIt() throws {
        let file = makeTempDir() + "/a.json"
        let first = try FileLock.acquire(file)
        let done = DispatchSemaphore(value: 0)
        let failed = Counter()
        DispatchQueue.global().async {
            do {
                let second = try FileLock.acquire(file)
                second.release()
            } catch {
                failed.increment()
            }
            done.signal()
        }
        XCTAssertEqual(done.wait(timeout: .now() + 0.3), .timedOut, "the second one got the lock while the first still held it")
        first.release()
        XCTAssertEqual(done.wait(timeout: .now() + 3), .success)
        XCTAssertEqual(failed.value, 0)
    }

    func testAHolderThatIsDroppedWithoutReleasingGivesTheLockUp() throws {
        let file = makeTempDir() + "/a.json"
        func takeAndForget() throws {
            _ = try FileLock.acquire(file)
        }
        try takeAndForget()
        XCTAssertFalse(FileManager.default.fileExists(atPath: FileLock.pathFor(file)))
    }

    func testReleasingDoesNotDeleteALockSomeoneElseHasPutInItsPlace() throws {
        // This lock was judged left over (its writer was slow) and another writer has taken the file: releasing must leave theirs alone
        let file = makeTempDir() + "/a.json"
        let lockPath = FileLock.pathFor(file)
        let held = try FileLock.acquire(file)
        writeText("99999 \(nowMillis()) SOME-OTHER-PC", to: lockPath)
        held.release()
        XCTAssertTrue(readText(lockPath).hasSuffix("SOME-OTHER-PC"))
    }

    func testALockWhoseOwnerProcessIsGoneIsReclaimedAtOnce() throws {
        // The command line is killed while holding the lock: its lock file does not disappear by itself
        let file = makeTempDir() + "/a.json"
        let dead = try deadProcessId()
        writeText("\(dead) \(nowMillis()) \(FileLock.machine)", to: FileLock.pathFor(file))
        let started = Date()
        let held = try FileLock.acquire(file, wait: 3)
        held.release()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
    }

    func testALockWithoutAComputerNameIsJudgedByItsProcessToo() throws {
        // The shortest form the command line accepts: only the fields up to the time
        let file = makeTempDir() + "/a.json"
        let dead = try deadProcessId()
        writeText("\(dead) \(nowMillis())", to: FileLock.pathFor(file))
        let started = Date()
        try FileLock.acquire(file, wait: 3).release()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
    }

    func testALockWrittenByAnotherComputerIsNotJudgedByProcessIdAndAFreshOneIsNotTaken() throws {
        // The item is on a network volume and an agent writes back from another computer: the process id in the lock belongs to that
        // computer, so finding no such process here does not mean it crashed
        let file = makeTempDir() + "/a.json"
        let lockPath = FileLock.pathFor(file)
        let dead = try deadProcessId()
        writeText("\(dead) \(nowMillis()) SOME-OTHER-PC", to: lockPath)
        XCTAssertThrowsError(try FileLock.acquire(file, wait: 0.5)) { error in
            guard case FileLockError.stayedLocked = error else { return XCTFail("\(error)") }
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: lockPath), "a lock held by another computer was deleted")
    }

    func testTheComputerNameIsComparedIgnoringCase() throws {
        let file = makeTempDir() + "/a.json"
        let dead = try deadProcessId()
        writeText("\(dead) \(nowMillis()) \(FileLock.machine.uppercased())", to: FileLock.pathFor(file))
        let started = Date()
        try FileLock.acquire(file, wait: 3).release()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
    }

    func testALockWrittenByAnotherComputerBecomesStaleWhenUntouchedForLong() throws {
        let file = makeTempDir() + "/a.json"
        let lockPath = FileLock.pathFor(file)
        writeText("12345 \(nowMillis()) SOME-OTHER-PC", to: lockPath)
        try backdate(lockPath, seconds: 60)
        let started = Date()
        try FileLock.acquire(file, wait: 3).release()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
    }

    func testALockWhoseProcessExistsButHasNotBeenTouchedForLongIsTreatedAsStale() throws {
        // The process id was reused by another process: it looks alive, but the lock file has not been touched for a minute
        let file = makeTempDir() + "/a.json"
        let lockPath = FileLock.pathFor(file)
        writeText("\(ProcessInfo.processInfo.processIdentifier) 0", to: lockPath)
        try backdate(lockPath, seconds: 60)
        let started = Date()
        try FileLock.acquire(file, wait: 3).release()
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.0)
    }

    func testALockJustTakenByALiveProcessIsNotStolenAndWaitingGivesUpAtTheDeadline() throws {
        let file = makeTempDir() + "/a.json"
        let lockPath = FileLock.pathFor(file)
        writeText("\(ProcessInfo.processInfo.processIdentifier) \(nowMillis())", to: lockPath)
        let started = Date()
        XCTAssertThrowsError(try FileLock.acquire(file, wait: 0.5)) { error in
            guard case FileLockError.stayedLocked(let path) = error else { return XCTFail("\(error)") }
            XCTAssertEqual(path, lockPath)
        }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.5)
        XCTAssertTrue(FileManager.default.fileExists(atPath: lockPath), "someone else's lock was deleted")
    }

    func testALockThatIsNotFilledInYetIsJudgedByAgeOnly() throws {
        // Created and not yet written to by its holder: no process id to look at
        let file = makeTempDir() + "/a.json"
        let lockPath = FileLock.pathFor(file)
        writeText("", to: lockPath)
        XCTAssertThrowsError(try FileLock.acquire(file, wait: 0.3))
        XCTAssertTrue(FileManager.default.fileExists(atPath: lockPath))
        try backdate(lockPath, seconds: 60)
        try FileLock.acquire(file, wait: 3).release()
        XCTAssertFalse(FileManager.default.fileExists(atPath: lockPath))
    }

    func testAFolderThatRefusesWritesGivesUpAfterAboutASecondNotTheFullTen() throws {
        try XCTSkipIf(getuid() == 0, "folder permissions do not apply to root")
        let dir = makeTempDir()
        XCTAssertEqual(chmod(dir, 0o555), 0)
        defer { _ = chmod(dir, 0o755) }
        let started = Date()
        XCTAssertThrowsError(try FileLock.acquire(dir + "/a.json")) { error in
            XCTAssertEqual((error as? FileOperationError)?.code, EACCES)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3.0)
    }

    func testThreadsTakingTheLockOneAfterAnotherNeverOverlap() throws {
        let file = makeTempDir() + "/a.json"
        let occupancy = Occupancy()
        let overlaps = Counter()
        let failures = Counter()
        let group = DispatchGroup()
        for _ in 0..<6 {
            group.enter()
            DispatchQueue.global().async {
                for _ in 0..<25 {
                    do {
                        try FileLock.withLock(file) { () throws -> Void in
                            if occupancy.enter() { overlaps.increment() }
                            Thread.sleep(forTimeInterval: 0.001)
                            occupancy.leave()
                        }
                    } catch {
                        failures.increment()
                    }
                }
                group.leave()
            }
        }
        group.wait()
        XCTAssertEqual(failures.value, 0)
        XCTAssertEqual(overlaps.value, 0, "two holders were inside the lock at once")
        XCTAssertFalse(FileManager.default.fileExists(atPath: FileLock.pathFor(file)))
    }
}

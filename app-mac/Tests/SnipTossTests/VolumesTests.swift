import XCTest

@testable import SnipToss

/// Asking whether a volume is mounted must never hold the caller for the system timeout of a network volume that stopped answering
/// (10 to 40 seconds for one `stat`). A volume that never answers is stood in for by a probe that blocks until the test lets it go
final class VolumesTests: XCTestCase {
    /// Holds probes shut until `open`; the test's cleanup opens it so no thread is left waiting
    private final class Gate {
        private let semaphore = DispatchSemaphore(value: 0)

        func hold() {
            semaphore.wait()
        }

        func open() {
            for _ in 0..<16 { semaphore.signal() }
        }
    }

    private final class FakeClock {
        private let lock = NSLock()
        private var time: TimeInterval = 1000

        func now() -> TimeInterval {
            lock.lock()
            defer { lock.unlock() }
            return time
        }

        func advance(_ seconds: TimeInterval) {
            lock.lock()
            time += seconds
            lock.unlock()
        }
    }

    private func makeGate() -> Gate {
        let gate = Gate()
        addTeardownBlock { gate.open() }
        return gate
    }

    private func eventually(timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return condition()
    }

    private let slow = "/Volumes/SnipTossSlow/a.png"

    func testACallerWaitsOnlyAboutFourTenthsOfASecondForAVolumeThatDoesNotAnswerAndItCountsAsNotConnected() {
        let gate = makeGate()
        let checker = VolumeChecker(probe: { _ in
            gate.hold()
            return true
        })
        let started = Date()
        checker.wait(for: [slow])
        let waited = Date().timeIntervalSince(started)
        XCTAssertGreaterThanOrEqual(waited, 0.35)
        XCTAssertLessThan(waited, 2)
        XCTAssertNil(checker.known(slow), "no answer yet: callers treat that as not connected")
    }

    func testTheQueryKeepsRunningAfterTheCallerGaveUpAndItsAnswerIsKept() {
        let gate = makeGate()
        let probes = Counter()
        let checker = VolumeChecker(probe: { _ in
            probes.increment()
            gate.hold()
            return true
        })
        checker.wait(for: [slow])
        XCTAssertNil(checker.known(slow))
        gate.open()
        XCTAssertTrue(eventually { checker.known(slow) == true })
        XCTAssertEqual(probes.value, 1)
    }

    func testAVolumeThatAnswersAtOnceIsNotWaitedOnForTheWholePatience() {
        let checker = VolumeChecker(probe: { _ in true })
        let started = Date()
        checker.wait(for: [slow])
        XCTAssertLessThan(Date().timeIntervalSince(started), 0.3)
        XCTAssertEqual(checker.known(slow), true)
    }

    func testManyCallersAskingAboutTheSameVolumeStartOnlyOneQuery() {
        let probes = Counter()
        let checker = VolumeChecker(probe: { _ in
            probes.increment()
            Thread.sleep(forTimeInterval: 0.1)
            return true
        })
        DispatchQueue.concurrentPerform(iterations: 8) { _ in
            checker.wait(for: ["/Volumes/SnipTossBusy/a.png"])
        }
        XCTAssertEqual(probes.value, 1)
        XCTAssertEqual(checker.known("/Volumes/SnipTossBusy/b.png"), true, "any path on the volume shares the answer")
    }

    func testPathsOnTheSameVolumeInAnySpellingShareOneQuery() {
        let probes = Counter()
        let checker = VolumeChecker(probe: { _ in
            probes.increment()
            return true
        })
        checker.wait(for: ["/Volumes/Disk/a.png", "/volumes/disk/b.png", "/Volumes//Disk/./c/d.png"])
        XCTAssertEqual(probes.value, 1)
    }

    func testAnAnswerIsRememberedForTwoSecondsAndAskedAgainAfterThat() {
        let clock = FakeClock()
        let probes = Counter()
        let checker = VolumeChecker(
            probe: { _ in
                probes.increment()
                return true
            }, clock: { clock.now() })
        checker.wait(for: [slow])
        XCTAssertEqual(probes.value, 1)
        clock.advance(1.9)
        checker.wait(for: [slow])
        XCTAssertEqual(probes.value, 1, "still fresh")
        clock.advance(0.2)
        checker.wait(for: [slow])
        XCTAssertEqual(probes.value, 2, "older than two seconds: a volume plugged back in is seen")
    }

    func testAVolumeFoundAbsentIsWaitedOnOnlyBrieflyWhenAskedAgain() {
        let gate = makeGate()
        let clock = FakeClock()
        let hangs = Counter()
        let checker = VolumeChecker(
            patience: 1, quick: 0.05, freshFor: 2,
            probe: { _ in
                if hangs.value > 0 { gate.hold() }
                return false
            }, clock: { clock.now() })
        checker.wait(for: [slow])
        XCTAssertEqual(checker.known(slow), false)

        // Now the volume stops answering: it was found absent last time, so the caller does not give it the whole patience again
        hangs.increment()
        clock.advance(3)
        let started = Date()
        checker.wait(for: [slow])
        XCTAssertLessThan(Date().timeIntervalSince(started), 0.5)
        XCTAssertNil(checker.known(slow))
    }

    func testAVolumeThatDoesNotAnswerDoesNotHoldUpAnotherThatDoes() {
        let gate = makeGate()
        let checker = VolumeChecker(probe: { root in
            if root.hasSuffix("Slow") { gate.hold() }
            return true
        })
        checker.wait(for: ["/Volumes/Slow/a.png", "/Volumes/Fast/b.png"])
        XCTAssertEqual(checker.known("/Volumes/Fast/b.png"), true)
        XCTAssertNil(checker.known("/Volumes/Slow/a.png"))
    }

    func testPathsOutsideVolumesAreAlwaysThereAndNeverQueried() {
        let probes = Counter()
        let checker = VolumeChecker(probe: { _ in
            probes.increment()
            return false
        })
        let paths = ["/Users/me/a.png", "/", "/Volumes", "not\0valid"]
        checker.wait(for: paths)
        XCTAssertEqual(checker.known("/Users/me/a.png"), true)
        XCTAssertEqual(checker.known("/Volumes"), true)
        XCTAssertTrue(checker.thereWait("/Users/me/a.png"))
        XCTAssertEqual(probes.value, 0)
    }

    func testWaitingUntilItIsCertainGivesTheProbesAnswer() {
        let present = VolumeChecker(probe: { _ in
            Thread.sleep(forTimeInterval: 0.6)
            return true
        })
        let started = Date()
        XCTAssertTrue(present.thereWait("/Volumes/SnipTossPresent/a.png"), "waits past the patience of a bounded wait")
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.5)
        XCTAssertFalse(VolumeChecker(probe: { _ in false }).thereWait("/Volumes/SnipTossGone/a.png"))
    }

    func testPrefetchStartsTheQueryAndReturnsAtOnce() {
        let gate = makeGate()
        let probes = Counter()
        let checker = VolumeChecker(probe: { _ in
            probes.increment()
            gate.hold()
            return true
        })
        let started = Date()
        checker.prefetch([slow, "/Volumes/SnipTossSlow/b.png", "/Users/me/a.png"])
        XCTAssertLessThan(Date().timeIntervalSince(started), 0.3)
        XCTAssertTrue(eventually { probes.value == 1 })
        XCTAssertNil(checker.known(slow))
    }

    func testTheSharedCheckerSaysAMountPointThatDoesNotExistIsNotThere() {
        let absent = "/Volumes/SnipTossAbsent-" + UUID().uuidString + "/a.png"
        XCTAssertNil(Volumes.known(absent), "never asked")
        Volumes.wait([absent])
        XCTAssertEqual(Volumes.known(absent), false)
        XCTAssertEqual(Volumes.known(NSTemporaryDirectory()), true)
    }
}

import XCTest

@testable import SnipToss

/// The zip writer behind the diagnostics package: what it writes is read back from its own central directory, and checked by the
/// system's `unzip`
final class ZipWriterTests: SnipTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    private func utcDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int, _ second: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second))!
    }

    // MARK: CRC-32

    func testTheChecksumOfTheStandardCheckString() {
        XCTAssertEqual(CRC32.checksum(Data("123456789".utf8)), 0xCBF4_3926)
        XCTAssertEqual(CRC32.checksum(Data()), 0)
    }

    // MARK: The archive

    func testEntriesComeBackAsTheyWentIn() throws {
        var zip = ZipWriter()
        let binary = Data([0, 1, 2, 253, 254, 255])
        try zip.add(name: "diagnostics.txt", text: "hello", modified: utcDate(2026, 11, 2, 5, 45, 12))
        try zip.add(name: "logs/日志.log", data: binary)
        try zip.add(name: "empty", data: Data())
        XCTAssertEqual(zip.count, 3)

        let entries = try TestZip.entries(zip.finish())

        XCTAssertEqual(entries.map { $0.name }, ["diagnostics.txt", "logs/日志.log", "empty"])
        XCTAssertEqual(entries[0].data, Data("hello".utf8))
        XCTAssertEqual(entries[1].data, binary)
        XCTAssertEqual(entries[2].data, Data())
        for entry in entries {
            XCTAssertEqual(entry.method, 0, "stored, not compressed: \(entry.name)")
            XCTAssertEqual(entry.flags & 0x0800, 0x0800, "names are UTF-8: \(entry.name)")
            XCTAssertEqual(entry.crc, CRC32.checksum(entry.data), entry.name)
            XCTAssertEqual(entry.mode, 0o644, entry.name)
        }
    }

    func testAnArchiveWithNothingInItIsOnlyTheEndRecord() throws {
        let data = try ZipWriter().finish()
        XCTAssertEqual(data.count, 22)
        XCTAssertEqual(try TestZip.entries(data).count, 0)
    }

    func testFinishingDoesNotChangeTheWriter() throws {
        var zip = ZipWriter()
        try zip.add(name: "a", text: "1")
        let first = try zip.finish()
        try zip.add(name: "b", text: "2")
        XCTAssertEqual(try TestZip.names(first), ["a"])
        XCTAssertEqual(try TestZip.names(zip.finish()), ["a", "b"])
    }

    func testANameThatDoesNotFitIsRefused() {
        var zip = ZipWriter()
        XCTAssertThrowsError(try zip.add(name: String(repeating: "a", count: 70_000), data: Data())) { error in
            guard case ZipWriter.ZipError.nameTooLong = error else { return XCTFail("wrong error: \(error)") }
        }
        XCTAssertEqual(zip.count, 0, "nothing was added")
    }

    // MARK: Dates

    func testTheDateIsWrittenTheWayZipKeepsIt() {
        let (time, date) = ZipWriter.dosDateTime(utcDate(2026, 11, 2, 5, 45, 12), timeZone: utc)
        XCTAssertEqual(time, UInt16(5 << 11 | 45 << 5 | 6))
        XCTAssertEqual(date, UInt16((2026 - 1980) << 9 | 11 << 5 | 2))
    }

    func testADateBeforeTheEpochOfZipIsPulledForward() {
        let (time, date) = ZipWriter.dosDateTime(Date(timeIntervalSince1970: 0), timeZone: utc)
        XCTAssertEqual(time, 0)
        XCTAssertEqual(date, UInt16(0 << 9 | 1 << 5 | 1), "1980-01-01")
    }

    func testTheLocalTimeZoneIsUsedForTheDate() {
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        let (time, _) = ZipWriter.dosDateTime(utcDate(2026, 11, 2, 23, 0, 0), timeZone: tokyo)
        XCTAssertEqual(time >> 11, 8, "23:00 UTC is 08:00 the next day in Tokyo")
    }

    // MARK: The system's unzip

    private func run(_ tool: String, _ arguments: [String]) throws -> (status: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    func testTheSystemUnzipAcceptsTheArchiveAndFindsTheSameText() throws {
        let unzip = "/usr/bin/unzip"
        try XCTSkipUnless(FileManager.default.isExecutableFile(atPath: unzip), "unzip is not installed")
        var zip = ZipWriter()
        let big = String(repeating: "a log line that is long enough to matter\n", count: 5_000)
        try zip.add(name: "diagnostics.txt", text: "line one\nline two\n")
        try zip.add(name: "logs/SnipToss-20261102.log", text: big)
        try zip.add(name: "settings.json", text: "{\n  \"Topmost\": false\n}\n")
        let file = makeTempDir() + "/package.zip"
        try zip.finish().write(to: URL(fileURLWithPath: file))

        let test = try run(unzip, ["-t", file])
        XCTAssertEqual(test.status, 0, test.output)
        XCTAssertTrue(test.output.contains("No errors detected"), test.output)

        let diagnostics = try run(unzip, ["-p", file, "diagnostics.txt"])
        XCTAssertEqual(diagnostics.output, "line one\nline two\n")
        let log = try run(unzip, ["-p", file, "logs/SnipToss-20261102.log"])
        XCTAssertEqual(log.output, big)
    }
}

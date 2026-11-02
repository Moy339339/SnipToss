import Foundation

/// CRC-32 as zip stores it (polynomial 0xEDB88320, the same as zlib's `crc32`)
enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 { value = (value & 1) != 0 ? (0xEDB8_8320 ^ (value >> 1)) : (value >> 1) }
        return value
    }

    static func checksum(_ data: Data) -> UInt32 {
        var value: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            for byte in bytes { value = table[Int((value ^ UInt32(byte)) & 0xFF)] ^ (value >> 8) }
        }
        return ~value
    }
}

/// Builds a zip archive in memory. Every entry is stored, not compressed: the writer is a few dozen lines with nothing to get wrong, needs no
/// system library and no helper process, and what it writes can be checked against `unzip` byte for byte. The files that go into the
/// diagnostics package are small text logs, so compressing them would save little.
/// Names are written as UTF-8 (flag bit 11). No zip64: an entry or an archive of 4 GiB or more, or 65535 entries or more, is refused
struct ZipWriter {
    enum ZipError: Error, CustomStringConvertible, Equatable {
        case nameTooLong(String)
        case tooLarge(String)
        case tooManyEntries

        var description: String {
            switch self {
            case .nameTooLong(let name): return "Zip entry name is too long: \(name.prefix(80))"
            case .tooLarge(let name): return "Zip entry or archive is too large: \(name.prefix(80))"
            case .tooManyEntries: return "Too many zip entries"
            }
        }
    }

    private struct Entry {
        let name: [UInt8]
        let crc: UInt32
        let size: UInt32
        let offset: UInt32
        let dosTime: UInt16
        let dosDate: UInt16
    }

    private var body = Data()
    private var entries: [Entry] = []

    /// General purpose flag: the name is UTF-8
    private static let utf8Flag: UInt16 = 0x0800
    /// "Version needed to extract" and the version made by (2.0), stored method
    private static let version: UInt16 = 20
    /// Made on Unix (host 3), so the permission bits below are honoured when the archive is extracted
    private static let versionMadeBy: UInt16 = (3 << 8) | 20
    /// A regular file, rw-r--r--, in the high half of the external attributes
    private static let unixAttributes: UInt32 = UInt32(0o100644) << 16

    init() {}

    var count: Int { entries.count }

    mutating func add(name: String, data content: Data, modified: Date = Date()) throws {
        let nameBytes = Array(name.utf8)
        guard nameBytes.count <= Int(UInt16.max) else { throw ZipError.nameTooLong(name) }
        guard entries.count < Int(UInt16.max) else { throw ZipError.tooManyEntries }
        guard content.count < Int(UInt32.max), body.count < Int(UInt32.max) - content.count - nameBytes.count - 64 else {
            throw ZipError.tooLarge(name)
        }
        let (dosTime, dosDate) = ZipWriter.dosDateTime(modified)
        let crc = CRC32.checksum(content)
        let entry = Entry(
            name: nameBytes, crc: crc, size: UInt32(content.count), offset: UInt32(body.count), dosTime: dosTime, dosDate: dosDate)

        body.appendLE(UInt32(0x0403_4B50))  // local file header signature
        body.appendLE(ZipWriter.version)
        body.appendLE(ZipWriter.utf8Flag)
        body.appendLE(UInt16(0))  // method: stored
        body.appendLE(dosTime)
        body.appendLE(dosDate)
        body.appendLE(crc)
        body.appendLE(entry.size)  // compressed size
        body.appendLE(entry.size)  // uncompressed size
        body.appendLE(UInt16(nameBytes.count))
        body.appendLE(UInt16(0))  // extra field length
        body.append(contentsOf: nameBytes)
        body.append(content)
        entries.append(entry)
    }

    mutating func add(name: String, text: String, modified: Date = Date()) throws {
        try add(name: name, data: Data(text.utf8), modified: modified)
    }

    /// The whole archive: the entries added so far, the central directory and the end record
    func finish() throws -> Data {
        var out = body
        let directoryOffset = out.count
        for entry in entries {
            out.appendLE(UInt32(0x0201_4B50))  // central directory header signature
            out.appendLE(ZipWriter.versionMadeBy)
            out.appendLE(ZipWriter.version)
            out.appendLE(ZipWriter.utf8Flag)
            out.appendLE(UInt16(0))  // method: stored
            out.appendLE(entry.dosTime)
            out.appendLE(entry.dosDate)
            out.appendLE(entry.crc)
            out.appendLE(entry.size)
            out.appendLE(entry.size)
            out.appendLE(UInt16(entry.name.count))
            out.appendLE(UInt16(0))  // extra field length
            out.appendLE(UInt16(0))  // comment length
            out.appendLE(UInt16(0))  // disk number where the file starts
            out.appendLE(UInt16(0))  // internal attributes
            out.appendLE(ZipWriter.unixAttributes)
            out.appendLE(entry.offset)
            out.append(contentsOf: entry.name)
        }
        let directorySize = out.count - directoryOffset
        guard out.count < Int(UInt32.max) - 22 else { throw ZipError.tooLarge("archive") }
        out.appendLE(UInt32(0x0605_4B50))  // end of central directory signature
        out.appendLE(UInt16(0))  // this disk
        out.appendLE(UInt16(0))  // disk with the central directory
        out.appendLE(UInt16(entries.count))
        out.appendLE(UInt16(entries.count))
        out.appendLE(UInt32(directorySize))
        out.appendLE(UInt32(directoryOffset))
        out.appendLE(UInt16(0))  // comment length
        return out
    }

    /// The date and time in the 16-bit pieces zip uses (local time, two-second steps, years 1980 to 2107)
    static func dosDateTime(_ date: Date, timeZone: TimeZone = .current) -> (time: UInt16, date: UInt16) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let year = min(max(parts.year ?? 1980, 1980), 2107)
        let month = min(max(parts.month ?? 1, 1), 12)
        let day = min(max(parts.day ?? 1, 1), 31)
        let hour = min(max(parts.hour ?? 0, 0), 23)
        let minute = min(max(parts.minute ?? 0, 0), 59)
        let second = min(max(parts.second ?? 0, 0), 59)
        let time = UInt16(hour << 11 | minute << 5 | second / 2)
        let day16 = UInt16((year - 1980) << 9 | month << 5 | day)
        return (time, day16)
    }
}

extension Data {
    fileprivate mutating func appendLE(_ value: UInt16) {
        append(UInt8(value & 0xFF))
        append(UInt8(value >> 8))
    }

    fileprivate mutating func appendLE(_ value: UInt32) {
        append(UInt8(value & 0xFF))
        append(UInt8((value >> 8) & 0xFF))
        append(UInt8((value >> 16) & 0xFF))
        append(UInt8(value >> 24))
    }
}

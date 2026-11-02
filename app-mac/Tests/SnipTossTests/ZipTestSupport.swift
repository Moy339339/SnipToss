import Foundation

/// Reads back an archive made by `ZipWriter` straight from its central directory, so tests can look at what a package holds without
/// a zip tool. It reads only what the writer writes (stored entries, no zip64, no archive comment)
enum TestZip {
    struct Entry {
        let name: String
        let data: Data
        let flags: Int
        let method: Int
        let crc: UInt32
        /// The unix permission bits in the external attributes (high half), when the entry was made on Unix
        let mode: Int
    }

    enum ReadError: Error {
        case notAnArchive(String)
    }

    static func entries(_ zip: Data) throws -> [Entry] {
        func u16(_ at: Int) -> Int { Int(zip[at]) | Int(zip[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        guard zip.count >= 22, u32(zip.count - 22) == 0x0605_4B50 else { throw ReadError.notAnArchive("no end record") }
        let end = zip.count - 22
        let count = u16(end + 10)
        var offset = u32(end + 16)
        var result: [Entry] = []
        for _ in 0..<count {
            guard u32(offset) == 0x0201_4B50 else { throw ReadError.notAnArchive("bad central directory entry at \(offset)") }
            let flags = u16(offset + 8)
            let method = u16(offset + 10)
            let crc = UInt32(u32(offset + 16))
            let size = u32(offset + 24)
            let nameLength = u16(offset + 28)
            let extraLength = u16(offset + 30)
            let commentLength = u16(offset + 32)
            let attributes = u32(offset + 38)
            let local = u32(offset + 42)
            let name = String(decoding: zip[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self)
            guard u32(local) == 0x0403_4B50 else { throw ReadError.notAnArchive("bad local header for \(name)") }
            let start = local + 30 + u16(local + 26) + u16(local + 28)
            let data = zip.subdata(in: start..<(start + size))
            result.append(Entry(name: name, data: data, flags: flags, method: method, crc: crc, mode: (attributes >> 16) & 0o7777))
            offset += 46 + nameLength + extraLength + commentLength
        }
        return result
    }

    /// Entry names in order
    static func names(_ zip: Data) throws -> [String] {
        try entries(zip).map { $0.name }
    }

    /// The text of the entry with this name; nil when there is none
    static func text(_ zip: Data, _ name: String) throws -> String? {
        try entries(zip).first { $0.name == name }.map { String(decoding: $0.data, as: UTF8.self) }
    }
}

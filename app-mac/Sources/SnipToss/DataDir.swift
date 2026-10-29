import Foundation

/// The folder inside a notes folder that holds the notes data: .sniptoss (format in docs/annotation-format.md).
/// Only the names and the "is there one" check live here; reading, migrating and writing belong to the notes code
enum DataDir {
    static let name = ".sniptoss"

    /// The name used by earlier versions: recognized so existing notes folders are still found; nothing is ever written to it
    static let legacyName = ".pizhu"

    /// A path component that names the data folder (either name)
    static func isName(_ component: String) -> Bool {
        let lower = component.lowercased()
        return lower == name || lower == legacyName
    }

    /// Notes have been kept in this folder (either name counts)
    static func existsIn(_ dir: String) -> Bool {
        Library.isDirectory(Library.join(dir, name)) || Library.isDirectory(Library.join(dir, legacyName))
    }
}

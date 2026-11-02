import Foundation

/// Which files are items that can be annotated, and which kind each is. The rules are the extension tables of the Windows shell's
/// MaterialScanner (the UI's KIND_OF_EXT and MORE_EXTS in library.ts and the e2e mock host match them); the folder scan itself is not part of this
enum MaterialKinds {
    /// Extension (lower case, with the dot) and its kind. jfif, jpe, pjpeg, pjp are JPEG, apng is animated PNG
    static let table: [(ext: String, kind: String)] = [
        (".png", "image"), (".jpg", "image"), (".jpeg", "image"), (".jfif", "image"), (".jpe", "image"), (".pjpeg", "image"),
        (".pjp", "image"), (".webp", "image"), (".gif", "image"), (".apng", "image"), (".bmp", "image"), (".avif", "image"),
        (".ico", "image"), (".svg", "image"), (".tif", "image"), (".tiff", "image"), (".heic", "image"), (".heif", "image"),
        (".mp4", "video"), (".webm", "video"), (".mov", "video"), (".m4v", "video"), (".mkv", "video"),
    ]

    private static let kinds: [String: String] = {
        var map: [String: String] = [:]
        for entry in table { map[entry.ext] = entry.kind }
        return map
    }()

    /// Less common formats: folders list them (and the file dialog offers them) only when Settings > Advanced > More formats is on.
    /// A file added on its own is annotatable either way
    static let more: Set<String> = [".jfif", ".jpe", ".pjpeg", ".pjp", ".apng", ".ico", ".tif", ".tiff", ".heic", ".heif", ".mkv"]

    /// In the set of listed kinds (`SettingsValues.enabledKinds`): the formats in `more` are listed too
    static let moreKind = "more"

    /// Folders a scan skips unless the user changed the list in Settings
    static let defaultSkipDirs = ["node_modules", "bin", "obj", "dist", "build", "__pycache__", "venv"]

    static var extensions: [String] { table.map { $0.ext } }

    /// The kind of an item from its extension; nil if it is not supported
    static func kindOf(_ path: String) -> String? {
        kinds[Library.extensionOf(path).lowercased()]
    }

    /// The file's kind if a folder scan lists it with these kinds turned on (`moreKind` included or not); otherwise nil
    static func listed(_ name: String, enabledKinds: Set<String>) -> String? {
        guard let kind = kindOf(name), enabledKinds.contains(kind) else { return nil }
        return enabledKinds.contains(moreKind) || !more.contains(Library.extensionOf(name).lowercased()) ? kind : nil
    }
}

import Foundation

/// How the page addresses an item on disk: `sniptoss://media/<absolute path>`. The Windows shell maps each drive to a virtual host of its
/// own; WKWebView cannot map a folder to an https host, so the one custom scheme the UI is served from carries the items too, under the
/// host `media` (the UI itself is the host `app`).
///
/// The path is percent-encoded so that nothing in a file name can be taken for URL syntax: only letters, digits and `-._~` stay as they
/// are besides the slashes. `?`, `#`, `%`, spaces, `+` and non-ASCII characters are all encoded. The page appends `?v=<mtime>-<size>`
/// to the address it is given; only the path part is read here
enum MediaURL {
    static let host = "media"

    /// Sent with every answer for the `media` host. The UI is another host, so reading an item (an image drawn into a canvas, a video
    /// header fetched with a Range header) is a cross-origin read; the Windows virtual hosts allow it the same way
    static let responseHeaders: [String: String] = [
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    ]

    private static let unescaped = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~/")

    /// The address of an item. `path` is an absolute path
    static func string(for path: String) -> String {
        let absolute = path.unicodeScalars.first == "/" ? path : "/" + path
        let encoded = absolute.addingPercentEncoding(withAllowedCharacters: unescaped) ?? ""
        return "\(uiScheme)://\(host)\(encoded)"
    }

    /// The path an address names, decoded; nil for an address that is not on the `media` host
    static func path(from url: URL) -> String? {
        guard url.scheme == uiScheme, url.host?.lowercased() == host else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let path = components.path
        return path.unicodeScalars.first == "/" ? path : nil
    }
}

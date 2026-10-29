import Foundation

/// Takes personal information out of text that can end up in a public issue report (log lines, error windows, diagnostics): the home
/// folder becomes `~`, and the user name where it still appears as a path segment (`/Volumes/Disk/Users/name/...`, a project on an
/// external drive) becomes `<user>`. Case is ignored because the default APFS volume does not tell `Name` from `name`.
/// A match counts only when the next character cannot continue a folder name (a letter, digit, `_` or `-`): `/Users/ann` is not taken out of
/// `/Users/anna`, but is out of `'/Users/ann'` in an error message. The home folder also cannot follow such a character, so `/Users/ann`
/// is not taken out of `/Volumes/Disk/Users/ann` (that one gets `<user>`). A root as the home folder (`/`) is ignored.
/// The Windows shell has the same rule (`Crash.Scrub`); `tests/golden/scrub.json` holds the cases both sides must agree on
enum Scrub {
    private static let notAfterNameChar = "(?<![\\p{L}\\p{N}_-])"
    private static let notNameChar = "(?![\\p{L}\\p{N}_-])"

    static func text(_ text: String, home: String = NSHomeDirectory(), user: String = NSUserName(), homeToken: String = "~") -> String {
        var result = text
        if home.utf16.count > 3 {
            result = replace(
                notAfterNameChar + NSRegularExpression.escapedPattern(for: home) + notNameChar, in: result,
                with: NSRegularExpression.escapedTemplate(for: homeToken))
        }
        if !user.isEmpty {
            result = replace("(?<=[\\\\/])" + NSRegularExpression.escapedPattern(for: user) + notNameChar, in: result, with: "<user>")
        }
        return result
    }

    private static func replace(_ pattern: String, in text: String, with template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
        return regex.stringByReplacingMatches(in: text, options: [], range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
}

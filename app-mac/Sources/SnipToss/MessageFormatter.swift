import Foundation
import JavaScriptCore

/// ICU MessageFormat (placeholders, plurals, selects) for the shell's own text. The messages are the UI's (i18n/locales), and they are
/// formatted by the package the UI formats them with, `intl-messageformat`, bundled into one script (app-mac/scripts/build-resources.mjs)
/// and run in JavaScriptCore, which is part of the system. Plural rules and the rest are the same code on both sides, so a message reads the
/// same in the window and in the menu bar (tests/golden/messages.json checks it)
final class MessageFormatter {
    enum Failure: Error {
        case noContext
        case scriptFailed(String)
        case formatFailed(String)
    }

    /// The exception a call left behind, if any (the context hands it to a handler)
    private final class Caught {
        var text: String?
    }

    private let context: JSContext
    private let function: JSValue
    private let caught: Caught
    /// A JSContext is not for use from two threads at once; messages are formatted from the main thread and from bridge queues
    private let lock = NSLock()

    init(script: String) throws {
        guard let context = JSContext() else { throw Failure.noContext }
        let caught = Caught()
        context.exceptionHandler = { _, exception in caught.text = exception?.toString() ?? "unknown error" }
        context.evaluateScript(script)
        if let text = caught.text { throw Failure.scriptFailed(text) }
        guard let function = context.objectForKeyedSubscript("snipFormat"), function.isObject else {
            throw Failure.scriptFailed("the script does not define snipFormat")
        }
        self.context = context
        self.function = function
        self.caught = caught
    }

    convenience init(scriptAt url: URL) throws {
        try self.init(script: String(contentsOf: url, encoding: .utf8))
    }

    /// `args` hold strings and integers (plurals need the integers as they are)
    func format(locale: String, pattern: String, args: [String: Any]) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        caught.text = nil
        let result = function.call(withArguments: [locale, pattern, args])
        if let text = caught.text { throw Failure.formatFailed(text) }
        return result?.toString() ?? ""
    }

    /// A catalog with the shortcuts in its messages written the Mac way: the messages spell them with words ("Undo (Ctrl Z)", German
    /// "Strg Z"), the Mac writes ⌘Z. The UI's own function (packages/web/src/macKeys.ts), which rewrites the UI's messages on the Mac too.
    /// The catalog as it was when the script cannot do it (an older script)
    func macify(_ catalog: [String: String]) -> [String: String] {
        guard let data = try? JSONEncoder().encode(catalog), let text = String(data: data, encoding: .utf8) else { return catalog }
        lock.lock()
        defer { lock.unlock() }
        caught.text = nil
        guard let function = context.objectForKeyedSubscript("snipMacify"), function.isObject,
            let result = function.call(withArguments: [text])?.toString(), caught.text == nil, let out = result.data(using: .utf8),
            let rewritten = try? JSONDecoder().decode([String: String].self, from: out)
        else {
            if let error = caught.text { Log.error("The messages could not be rewritten for the Mac: \(error)") }
            return catalog
        }
        return rewritten
    }

    /// One text written the Mac way with the key names of `catalog` (the raw one): for comparing with the golden messages, which are the
    /// Windows wording
    func macifyText(_ text: String, catalog: [String: String]) -> String {
        guard let data = try? JSONEncoder().encode(catalog), let json = String(data: data, encoding: .utf8) else { return text }
        lock.lock()
        defer { lock.unlock() }
        caught.text = nil
        guard let function = context.objectForKeyedSubscript("snipMacifyText"), function.isObject,
            let result = function.call(withArguments: [text, json])?.toString(), caught.text == nil
        else { return text }
        return result
    }

    /// Runs a script in the same context and returns its value as text: for tests that ask what the engine can do
    func evaluate(_ script: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        caught.text = nil
        let value = context.evaluateScript(script)
        return caught.text == nil ? value?.toString() : "error: \(caught.text ?? "")"
    }
}

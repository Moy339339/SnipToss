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

    /// Runs a script in the same context and returns its value as text: for tests that ask what the engine can do
    func evaluate(_ script: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        caught.text = nil
        let value = context.evaluateScript(script)
        return caught.text == nil ? value?.toString() : "error: \(caught.text ?? "")"
    }
}

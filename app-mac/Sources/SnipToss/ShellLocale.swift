import Foundation

/// Where the shell finds the files it reads at run time (the message catalogs and the formatter script): SNIPTOSS_RESOURCES_DIR
/// (development, CI and tests), otherwise the app bundle's Resources folder
enum AppResources {
    static func directory() -> URL? {
        // getenv, not ProcessInfo: a test changes the variable while it runs
        if let value = getenv("SNIPTOSS_RESOURCES_DIR") { return URL(fileURLWithPath: String(cString: value), isDirectory: true) }
        return Bundle.main.resourceURL
    }
}

/// The language of the shell's own text and the message catalogs (i18n/locales/<language>.json), by the same rules as the UI
/// (resolveLocale in packages/web/src/i18n.tsx and Locale.cs of the Windows shell; tests/golden/locale.json checks them all).
/// The language chosen in Settings (Prefs.language) wins; "follow the system" looks at the system's preferred language
enum ShellLocale {
    static let source = "zh-CN"
    /// Fills in missing messages (a language that is not translated yet falls back to English)
    static let fallback = "en"
    static let all = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "it", "pt-BR", "ru"]
    /// What "follow the system" can pick: the languages the whole app is translated into
    static let followSystem = all

    /// Maps the language tag the system gives (zh-Hans-CN, zh-HK, pt-PT, en-GB, en_US ...) to a supported language
    static func match(_ tag: String?) -> String {
        let t = (tag ?? "").lowercased()
        if t == "zh" || t.hasPrefix("zh-") {
            return ["hant", "-tw", "-hk", "-mo"].contains { t.contains($0) } ? "zh-TW" : "zh-CN"
        }
        if t == "pt" || t.hasPrefix("pt-") { return "pt-BR" }
        let language = t.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? ""
        return all.first { $0.lowercased() == language } ?? fallback
    }

    /// The one chosen in settings ("system" = follow the system; a missing or unrecognized value counts as it too) and the system's language
    /// → which language to use
    static func resolve(pref: String?, system: String?) -> String {
        if let pref, pref != "system", all.contains(pref) { return pref }
        let matched = match(system)
        if followSystem.contains(matched) { return matched }
        return followSystem.contains(fallback) ? fallback : source
    }

    private static let lock = NSLock()
    private static var currentLanguage = fallback
    private static var catalogs: [String: [String: String]] = [:]
    private static var formatterLoaded = false
    private static var loadedFormatter: MessageFormatter?

    /// The language in use now
    static var current: String {
        lock.lock()
        defer { lock.unlock() }
        return currentLanguage
    }

    /// Decides the language from the language setting: at startup and whenever the UI changes it. Returns whether it changed
    @discardableResult
    static func use(pref: String?, system: String? = Locale.preferredLanguages.first) -> Bool {
        let next = resolve(pref: pref, system: system)
        lock.lock()
        defer { lock.unlock() }
        if next == currentLanguage { return false }
        currentLanguage = next
        Log.info("Language: \(next)")
        return true
    }

    /// The text of `key` in the current language, filled in by ICU MessageFormat; nil when the resources are not there (the caller has its
    /// own text then) or no catalog has the key
    static func text(_ key: String, _ args: [String: Any] = [:]) -> String? {
        text(key, in: current, args)
    }

    static func text(_ key: String, in language: String, _ args: [String: Any] = [:]) -> String? {
        guard let formatter = formatter() else { return nil }
        var from = language
        var pattern = catalog(language)[key]
        if pattern == nil {
            from = fallback
            pattern = catalog(fallback)[key]
        }
        guard let pattern else { return nil }
        do {
            return try formatter.format(locale: from, pattern: pattern, args: args)
        } catch {
            // A broken message must not take the tray or the menus down with it: the caller falls back to its own text
            Log.error("Message \(key) could not be formatted: \(error)")
            return nil
        }
    }

    private static func catalog(_ language: String) -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        if let known = catalogs[language] { return known }
        var loaded: [String: String] = [:]
        if let dir = AppResources.directory(), let data = try? Data(contentsOf: dir.appendingPathComponent("locales/\(language).json")),
            let parsed = try? JSONDecoder().decode([String: String].self, from: data)
        {
            loaded = parsed
        }
        catalogs[language] = loaded
        return loaded
    }

    private static func formatter() -> MessageFormatter? {
        lock.lock()
        defer { lock.unlock() }
        if formatterLoaded { return loadedFormatter }
        formatterLoaded = true
        guard let dir = AppResources.directory() else { return nil }
        do {
            loadedFormatter = try MessageFormatter(scriptAt: dir.appendingPathComponent("shell-messages.js"))
        } catch {
            Log.error("The message formatter could not be loaded: \(error)")
        }
        return loadedFormatter
    }

    /// For tests: forget what was loaded and go back to English
    static func reset() {
        lock.lock()
        defer { lock.unlock() }
        currentLanguage = fallback
        catalogs = [:]
        formatterLoaded = false
        loadedFormatter = nil
    }
}

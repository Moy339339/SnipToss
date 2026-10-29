import Foundation

extension Notification.Name {
    /// Posted on the main queue after `ShellLocale.use` changed the language: parts that show text for good (menus, the status item) redo it
    static let shellLanguageChanged = Notification.Name("SnipTossShellLanguageChanged")
}

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
    private static var macCatalogs: [String: [String: String]] = [:]
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
        let changed = next != currentLanguage
        if changed { currentLanguage = next }
        lock.unlock()
        guard changed else { return false }
        Log.info("Language: \(next)")
        DispatchQueue.main.async { NotificationCenter.default.post(name: .shellLanguageChanged, object: nil) }
        return true
    }

    /// The text of `key` in the current language, filled in by ICU MessageFormat; nil when the resources are not there (the caller has its
    /// own text then) or no catalog has the key
    static func text(_ key: String, _ args: [String: Any] = [:]) -> String? {
        text(key, in: current, args)
    }

    static func text(_ key: String, in language: String, _ args: [String: Any] = [:]) -> String? {
        format(key, in: language, args, catalog: catalog)
    }

    /// The same from the messages as i18n/locales has them, shortcuts not rewritten: word for word what the UI formats on Windows
    /// (tests/golden/messages.json)
    static func rawText(_ key: String, in language: String, _ args: [String: Any] = [:]) -> String? {
        format(key, in: language, args, catalog: rawCatalog)
    }

    private static func format(_ key: String, in language: String, _ args: [String: Any], catalog: (String) -> [String: String]) -> String? {
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

    /// A language's messages as the Mac shows them: the shortcuts written inside them are rewritten the Mac way (⌘Z, ⌥1), as the UI does
    private static func catalog(_ language: String) -> [String: String] {
        let raw = rawCatalog(language)
        lock.lock()
        if let known = macCatalogs[language] {
            lock.unlock()
            return known
        }
        lock.unlock()
        // Outside the lock: the formatter takes it too
        let rewritten = formatter()?.macify(raw) ?? raw
        lock.lock()
        defer { lock.unlock() }
        macCatalogs[language] = rewritten
        return rewritten
    }

    /// A language's messages as i18n/locales has them (the Windows wording)
    static func rawCatalog(_ language: String) -> [String: String] {
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

    /// A text written the way the Mac writes shortcuts, with the key names of `language`
    static func macify(_ text: String, in language: String) -> String {
        formatter()?.macifyText(text, catalog: rawCatalog(language)) ?? text
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
        macCatalogs = [:]
        formatterLoaded = false
        loadedFormatter = nil
    }
}

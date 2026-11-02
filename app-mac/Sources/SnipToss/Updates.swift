import AppKit
import Foundation

/// The update check (docs/host-api.md `checkUpdates`, `updateAvailable`, `updateDismissed`; the Windows shell's Updates.cs): asks GitHub
/// Releases whether there is a version newer than this one, and goes to the download page only when the user clicks. The app goes online
/// only here, with one request that carries nothing about the user (the User-Agent is the app's name and version).
/// Channel: a stable build looks only at stable releases, a beta (1.2.0-beta.N) at pre-releases too; drafts never count.
/// Platform: Windows and the Mac share version numbers, so only a release that carries a Mac package counts (`isPackage`)
enum Updates {
    static let releasesAPI = URL(string: "https://api.github.com/repos/Moy339339/SnipToss/releases?per_page=30")!

    /// A version newer than this one: its number, its download page, whether it is a beta
    struct Release: Equatable {
        let version: String
        let url: String
        let prerelease: Bool
    }

    /// What a check came to: a newer version, nothing newer, or no answer (offline, rate limited…: `error`, in English, only logged)
    struct Result: Equatable {
        let newer: Release?
        let error: String?
    }

    /// How long after a successful automatic check the next one is due (at most about once a day)
    static let interval: TimeInterval = 20 * 60 * 60

    /// Due: never checked, the last successful check is at least `interval` old, or the clock was set back
    static func due(lastChecked: Date?, now: Date) -> Bool {
        guard let last = lastChecked else { return true }
        return now.timeIntervalSince(last) >= interval || now < last
    }

    /// As people read a version (versionLabel in packages/web/src/brand.ts): 1.2.0 → v1.2.0, 1.2.0-beta.3 → v1.2.0 Beta 3
    static func label(_ version: String) -> String {
        guard let dash = version.range(of: "-beta.") else { return "v" + version }
        return "v\(version[..<dash.lowerBound]) Beta \(version[dash.upperBound...])"
    }

    /// A Mac package among a release's files: SnipToss-1.2.0-mac-universal.dmg (the Windows ones are SnipToss-1.2.0-win-x64-setup.exe /
    /// -portable.zip). A release without one (a fix for Windows alone) is no update for the Mac: there would be nothing to download
    static func isPackage(_ name: String) -> Bool {
        let lower = name.lowercased()
        return lower.contains("-mac-") && lower.hasSuffix(".dmg")
    }

    /// The newest release in the list that is newer than `current`, in its channel, with a Mac package; nil if none
    static func newest(_ releases: Any, current: String) -> Release? {
        guard let list = releases as? [[String: Any]] else { return nil }
        let beta = current.contains("-")
        var best: Release?
        for release in list {
            if release["draft"] as? Bool == true { continue }
            let assets = release["assets"] as? [[String: Any]] ?? []
            guard assets.contains(where: { ($0["name"] as? String).map(isPackage) == true }) else { continue }
            let prerelease = release["prerelease"] as? Bool == true
            if prerelease && !beta { continue }
            guard let tag = release["tag_name"] as? String, let page = release["html_url"] as? String else { continue }
            let version = tag.hasPrefix("v") || tag.hasPrefix("V") ? String(tag.dropFirst()) : tag
            guard parse(version) != nil, compare(version, current) > 0 else { continue }
            if best == nil || compare(version, best!.version) > 0 { best = Release(version: version, url: page, prerelease: prerelease) }
        }
        return best
    }

    /// Semantic version: major.minor.patch[-prerelease] (build metadata after + does not count); nil if not one
    static func parse(_ version: String) -> (core: [Int], pre: [String])? {
        let main = version.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? version
        let dash = main.firstIndex(of: "-")
        let coreText = dash.map { String(main[..<$0]) } ?? main
        let parts = coreText.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var core: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.allSatisfy({ $0.isASCII && $0.isNumber }), let n = Int(part) else { return nil }
            core.append(n)
        }
        let pre = dash.map { main[main.index(after: $0)...].split(separator: ".", omittingEmptySubsequences: false).map(String.init) } ?? []
        return pre.contains(where: \.isEmpty) ? nil : (core, pre)
    }

    /// By semantic version: 1.0.0-beta.9 < 1.0.0-beta.10 < 1.0.0 < 1.0.1. One that is not a version counts as the smallest
    static func compare(_ a: String, _ b: String) -> Int {
        guard let x = parse(a) else { return parse(b) == nil ? 0 : -1 }
        guard let y = parse(b) else { return 1 }
        for i in 0..<3 where x.core[i] != y.core[i] { return x.core[i] < y.core[i] ? -1 : 1 }
        let (p, q) = (x.pre, y.pre)
        // The one without a prerelease part is the larger
        if p.isEmpty || q.isEmpty { return p.isEmpty == q.isEmpty ? 0 : (p.isEmpty ? 1 : -1) }
        for i in 0..<min(p.count, q.count) {
            let (m, n) = (Int(p[i]), Int(q[i]))
            let c: Int
            if let m, let n { c = m == n ? 0 : (m < n ? -1 : 1) } else if m != nil { c = -1 } else if n != nil { c = 1 } else { c = p[i] < q[i] ? -1 : (p[i] == q[i] ? 0 : 1) }
            if c != 0 { return c }
        }
        return p.count == q.count ? 0 : (p.count < q.count ? -1 : 1)
    }

    /// Asks GitHub. `fetch` stands in for the network in the tests
    static func check(current: String, fetch: (URL) async throws -> (Data, Int)) async -> Result {
        do {
            let (data, status) = try await fetch(releasesAPI)
            guard (200..<300).contains(status) else { return Result(newer: nil, error: "HTTP \(status)") }
            let json = try JSONSerialization.jsonObject(with: data)
            return Result(newer: newest(json, current: current), error: nil)
        } catch {
            return Result(newer: nil, error: error.localizedDescription)
        }
    }

    /// The real request: no cookies, nothing cached, 15 seconds at most
    static func fetchFromGitHub(version: String) -> (URL) async throws -> (Data, Int) {
        { url in
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
            request.setValue("SnipToss/\(version)", forHTTPHeaderField: "User-Agent")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.httpShouldHandleCookies = false
            let session = URLSession(configuration: .ephemeral)
            defer { session.finishTasksAndInvalidate() }
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    /// The reply of `checkUpdates` (and what the automatic check logs): `newer` null when there is none, `error` when it could not check
    static func reply(_ result: Result) -> [String: Any] {
        if let error = result.error { Log.info("Update check: could not check (\(error))") }
        let newer: Any = result.newer.map { ["version": $0.version, "url": $0.url, "prerelease": $0.prerelease] as [String: Any] } ?? NSNull()
        return ["newer": newer, "error": result.error ?? NSNull()]
    }
}

/// The new version this run knows of, and everyone who shows it: the page (title bar, Help menu) through `updateAvailable` /
/// `updateDismissed`, the menu bar item through `show`. Main thread only, except `checkNow`, which the bridge calls on its own queue
final class UpdateCenter {
    private let settings: Settings
    private let current: String
    private let isTestInstance: Bool
    private let emit: (String, [String: Any]) -> Void
    private let fetch: (URL) async throws -> (Data, Int)
    private let openURL: (URL) -> Void
    /// Told the version to show on the menu bar item, nil when there is none any more
    var show: (Updates.Release?) -> Void = { _ in }
    private(set) var newer: Updates.Release?
    private var checking = false
    private var timer: Timer?

    init(
        settings: Settings, current: String, isTestInstance: Bool = AppPaths.isTestInstance, emit: @escaping (String, [String: Any]) -> Void,
        fetch: ((URL) async throws -> (Data, Int))? = nil, openURL: @escaping (URL) -> Void = { NSWorkspace.shared.open($0) }
    ) {
        self.settings = settings
        self.current = current
        self.isTestInstance = isTestInstance
        self.emit = emit
        self.fetch = fetch ?? Updates.fetchFromGitHub(version: current)
        self.openURL = openURL
    }

    /// 10 seconds after startup, then once an hour while the app runs, window shown or not; each round asks GitHub only when due. An app
    /// that waits in the menu bar for days, or was started at login and never showed its window, still hears of a new version
    func startAutomaticChecks() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in self?.autoCheck() }
        timer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in self?.autoCheck() }
    }

    /// The automatic check: only when switched on in Settings, due, and not a test instance (tests never go online). When it cannot check
    /// it only logs; the next hourly round tries again
    func autoCheck(now: Date = Date()) {
        guard !isTestInstance, settings.current.updateCheck, !checking,
            Updates.due(lastChecked: settings.current.updatesCheckedAt, now: now)
        else { return }
        checking = true
        Task { @MainActor [weak self, fetch, current] in
            let result = await Updates.check(current: current, fetch: fetch)
            guard let self else { return }
            self.checking = false
            _ = Updates.reply(result)
            if result.error != nil { return }
            self.settings.update { $0.updatesCheckedAt = Date() }
            if let newer = result.newer { self.found(newer) }
        }
    }

    /// Help → Check for Updates…: what is found is shown as an automatic find would be. Called on the bridge's queue; waits for the answer
    func checkNow() -> [String: Any] {
        let done = DispatchSemaphore(value: 0)
        var result = Updates.Result(newer: nil, error: "not checked")
        Task { [fetch, current] in
            result = await Updates.check(current: current, fetch: fetch)
            done.signal()
        }
        done.wait()
        if let newer = result.newer { runOnMain { [weak self] in self?.found(newer) } }
        return Updates.reply(result)
    }

    /// A newer version: shown unless it is the one the user skipped (a newer one than that is shown again). No notification or sound
    func found(_ release: Updates.Release) {
        if release.version == settings.current.updateSkipped { return }
        newer = release
        show(release)
        pageReady()
    }

    /// The page is ready (first shown, or reloaded): it hears of the version again
    func pageReady() {
        if let n = newer { emit("updateAvailable", ["version": n.version, "url": n.url, "prerelease": n.prerelease]) }
    }

    /// Menu bar → Download: the release page in the browser (only https)
    func openDownload() {
        guard let n = newer, let url = ExternalURL.allowed(n.url) else { return }
        openURL(url)
    }

    /// Menu bar → Skip This Version: kept in the settings; the dot and the title bar notice go until a newer version comes out
    func skip() {
        guard let n = newer else { return }
        settings.update { $0.updateSkipped = n.version }
        clear()
    }

    /// Settings changed: with the automatic check switched off, a version already shown goes away too
    func prefsChanged() {
        if !settings.current.updateCheck && newer != nil { clear() }
    }

    private func clear() {
        newer = nil
        show(nil)
        emit("updateDismissed", [:])
    }
}

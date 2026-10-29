import AppKit
import WebKit

/// Unattended run for CI (SNIPTOSS_SMOKE_OUT=<folder>): wait until the UI says it has drawn, take a picture of the page, write what the
/// bridge and the page saw to result.json, and quit. Exit code 0 = the UI came up, 2 = it did not before the time ran out
final class SmokeRun {
    /// True once the UI has drawn its first screen. With an empty library that is the welcome screen, which only appears after the
    /// preferences, app info, locale and library calls all went through (the e2e first-run test waits for the same element)
    static let welcomeScript = "!!document.querySelector('.stage-empty.is-welcome')"

    /// With a project in the library and an item selected: the item is on the canvas (it has a size there: right after a switch it is 0 × 0),
    /// loaded through the media scheme and decoded
    static let imageScript = "(() => { const el = document.querySelector('.zoom-media'); if (!el || !el.complete || el.naturalWidth === 0) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })()"

    /// The onboarding tour card is on screen (first run, an item shown)
    static let tourScript = "!!document.querySelector('.tour-card')"

    /// SNIPTOSS_SMOKE_READY picks what to wait for: `welcome` (default, an empty library), `image`, `tour`, or `keys` (the welcome screen, then
    /// the key experiment of KeyExperiment.swift, whose answers go into result.json)
    static let mode = ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_READY"] ?? "welcome"

    static var readyScript: String {
        switch mode {
        case "image": return imageScript
        case "tour": return tourScript
        case "keys": return welcomeScript
        default: return welcomeScript
        }
    }

    /// What the page says about itself: the title, the first words, how many library rows there are, the image on the canvas and, when
    /// the tour card is up, the text and style of each of its parts (a card that is drawn but empty is a rendering problem, not a missing string)
    private static let probeScript = """
        (() => {
          const media = document.querySelector('.zoom-media');
          const card = document.querySelector('.tour-card');
          const parts = card
            ? Array.from(card.querySelectorAll('*')).slice(0, 12).map((el) => {
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return { cls: String(el.className), text: (el.textContent || '').slice(0, 40), color: s.color, opacity: s.opacity,
                  visibility: s.visibility, fontSize: s.fontSize, width: Math.round(r.width), height: Math.round(r.height) };
              })
            : null;
          return JSON.stringify({
            title: document.title,
            text: (document.body ? document.body.innerText : '').slice(0, 400),
            libraryRows: document.querySelectorAll('.lib-row').length,
            media: media ? { width: media.naturalWidth, height: media.naturalHeight, src: media.currentSrc.slice(0, 200) } : null,
            tour: card ? { text: card.innerText, opacity: getComputedStyle(card).opacity, animation: getComputedStyle(card).animationName, parts } : null,
          });
        })()
        """

    private let outDir: URL
    private let web: WKWebView
    private let window: NSWindow
    private let bridge: BridgeHost
    private let console: ConsoleCollector
    private let began = Date()
    private var finished = false
    /// The picture taken the moment the tour card appeared (tour mode only)
    private var firstShot: String?
    /// What the key experiment found (keys mode only)
    private var keyExperiment: [String: Any]?
    private var experiment: KeyExperiment?
    private let timeoutSeconds = Double(ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_TIMEOUT"] ?? "") ?? 60

    init(outDir: URL, web: WKWebView, window: NSWindow, bridge: BridgeHost, console: ConsoleCollector) {
        self.outDir = outDir
        self.web = web
        self.window = window
        self.bridge = bridge
        self.console = console
    }

    func start() {
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) { [self] in
            if !finished { capture(ready: false) }
        }
        poll()
    }

    private func poll() {
        if finished { return }
        web.evaluateJavaScript(Self.readyScript) { [self] result, _ in
            if (result as? Bool) == true {
                // The tour card fades in over a few frames: a picture the moment it exists shows what those first frames look like
                if Self.mode == "tour" { snapshot("ui-first.png") { [self] shot in firstShot = shot } }
                // The layout fades in over 160 ms and fonts may still be settling: wait before the picture. Anything with an entrance
                // animation is photographed at least 0.6 s after it appears: `takeSnapshot` can catch the first frames half painted
                // (the first picture of the tour card has body and buttons but no title), which is the snapshot call, not the page
                if Self.mode == "keys" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in
                        let run = KeyExperiment(window: window, web: web)
                        experiment = run
                        run.run { [self] found in
                            keyExperiment = found
                            capture(ready: true)
                        }
                    }
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in capture(ready: true) }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + (Self.mode == "tour" ? 0.02 : 0.25)) { [self] in poll() }
            }
        }
    }

    /// The page's own account of itself, as a parsed object (nil when the page does not answer)
    private func probePage(_ done: @escaping (Any?) -> Void) {
        web.evaluateJavaScript(Self.probeScript) { page, _ in
            if let text = page as? String, let data = text.data(using: .utf8) {
                done(try? JSONSerialization.jsonObject(with: data))
            } else {
                done(nil)
            }
        }
    }

    /// A picture of the page written to `fileName` in the output folder; `done` gets what to say about it in result.json
    private func snapshot(_ fileName: String, _ done: @escaping (String) -> Void) {
        web.takeSnapshot(with: WKSnapshotConfiguration()) { [self] image, error in
            if let image, let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                do {
                    try png.write(to: outDir.appendingPathComponent(fileName))
                    done("\(fileName) (\(Int(image.size.width))x\(Int(image.size.height)))")
                } catch {
                    done("write failed: \(error)")
                }
            } else {
                done(error.map { "failed: \($0)" } ?? "none")
            }
        }
    }

    private func capture(ready: Bool) {
        if finished { return }
        finished = true
        let elapsed = Int(Date().timeIntervalSince(began) * 1000)
        probePage { [self] page in
            snapshot("ui.png") { [self] shot in
                if ready && Self.mode == "tour" {
                    // The card animates in: a second picture and probe a moment later show whether the first one caught it half way
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [self] in
                        probePage { [self] laterPage in
                            snapshot("ui-later.png") { [self] laterShot in
                                finish(ready: ready, elapsed: elapsed, page: page, shot: shot, laterPage: laterPage, laterShot: laterShot)
                            }
                        }
                    }
                } else {
                    finish(ready: ready, elapsed: elapsed, page: page, shot: shot, laterPage: nil, laterShot: nil)
                }
            }
        }
    }

    private func finish(ready: Bool, elapsed: Int, page: Any?, shot: String, laterPage: Any?, laterShot: String?) {
        var result: [String: Any] = [
            "ready": ready, "afterMs": elapsed, "snapshot": shot, "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
            "bridgeCalls": bridge.calls, "bridgeUnhandled": bridge.unhandled, "pageErrors": console.errors, "pageLogs": bridge.pageLogs,
        ]
        if let page { result["page"] = page }
        if let laterPage { result["pageLater"] = laterPage }
        if let laterShot { result["snapshotLater"] = laterShot }
        if let keyExperiment { result["keyExperiment"] = keyExperiment }
        if let firstShot { result["snapshotFirst"] = firstShot }
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: outDir.appendingPathComponent("result.json"))
            print(String(data: data, encoding: .utf8) ?? "")
        }
        fflush(stdout)
        exit(ready ? 0 : 2)
    }
}

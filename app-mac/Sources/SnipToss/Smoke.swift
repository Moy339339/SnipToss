import AppKit
import WebKit

/// Unattended run for CI (SNIPTOSS_SMOKE_OUT=<folder>): wait until the UI says it has drawn, take a picture of the page, write what the
/// bridge and the page saw to result.json, and quit. Exit code 0 = the UI came up, 2 = it did not before the time ran out
final class SmokeRun {
    /// True once the UI has drawn its first screen. With an empty library that is the welcome screen, which only appears after the
    /// preferences, app info, locale and library calls all went through (the e2e first-run test waits for the same element)
    static let readyScript = "!!document.querySelector('.stage-empty.is-welcome')"

    private let outDir: URL
    private let web: WKWebView
    private let bridge: BridgeHost
    private let console: ConsoleCollector
    private let began = Date()
    private var finished = false
    private let timeoutSeconds = Double(ProcessInfo.processInfo.environment["SNIPTOSS_SMOKE_TIMEOUT"] ?? "") ?? 60

    init(outDir: URL, web: WKWebView, bridge: BridgeHost, console: ConsoleCollector) {
        self.outDir = outDir
        self.web = web
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
                // The layout fades in over 160 ms and fonts may still be settling: wait before the picture
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [self] in capture(ready: true) }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [self] in poll() }
            }
        }
    }

    private func capture(ready: Bool) {
        if finished { return }
        finished = true
        let elapsed = Int(Date().timeIntervalSince(began) * 1000)
        web.evaluateJavaScript("JSON.stringify({ title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 400) })") {
            [self] page, _ in
            web.takeSnapshot(with: WKSnapshotConfiguration()) { [self] image, error in
                var snapshot = "none"
                if let image, let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                    do {
                        try png.write(to: outDir.appendingPathComponent("ui.png"))
                        snapshot = "ui.png (\(Int(image.size.width))x\(Int(image.size.height)))"
                    } catch { snapshot = "write failed: \(error)" }
                } else if let error {
                    snapshot = "failed: \(error)"
                }
                var result: [String: Any] = [
                    "ready": ready, "afterMs": elapsed, "snapshot": snapshot, "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
                    "bridgeCalls": bridge.calls, "bridgeUnhandled": bridge.unhandled, "pageErrors": console.errors, "pageLogs": bridge.pageLogs,
                ]
                if let text = page as? String, let data = text.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) {
                    result["page"] = obj
                }
                if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
                    try? data.write(to: outDir.appendingPathComponent("result.json"))
                    print(String(data: data, encoding: .utf8) ?? "")
                }
                fflush(stdout)
                exit(ready ? 0 : 2)
            }
        }
    }
}

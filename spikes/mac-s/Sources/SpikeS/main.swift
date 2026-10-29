// Throwaway probe, not product code: what a WKWebView shell for SnipToss can and cannot do (see docs/proposals/mac-port-prep.md).
//
// Opens a window, loads a test page through a custom snip:// scheme (a file server with Range support, streaming), and writes what the page
// and the native side observed to SPIKE_OUT as JSON. Runs unattended: it exits by itself, or by the watchdog.
//
//   SpikeS [--phase=write|read] [--tab-focuses-links]
//   env: SPIKE_MEDIA_DIR (where the generated media goes), SPIKE_VIDEO (a small mp4 to copy in), SPIKE_OUT (result file), SPIKE_TIMEOUT (s)
import AppKit
import WebKit

let env = ProcessInfo.processInfo.environment
let args = CommandLine.arguments
let phase = args.contains("--phase=read") ? "read" : "write"
let tabFocusesLinks = args.contains("--tab-focuses-links")
let mediaDir = URL(fileURLWithPath: env["SPIKE_MEDIA_DIR"] ?? (NSTemporaryDirectory() + "spike-media"), isDirectory: true)
let outPath = env["SPIKE_OUT"] ?? (NSTemporaryDirectory() + "spike-result.json")
let timeoutSeconds = Double(env["SPIKE_TIMEOUT"] ?? "") ?? 150
let patternSize = 268_435_456  // 256 MiB; the page knows this number too

func residentMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? (Double(info.resident_size) / 1_048_576).rounded() : -1
}

func prepareMedia() {
    let fm = FileManager.default
    try? fm.createDirectory(at: mediaDir, withIntermediateDirectories: true)
    let pattern = mediaDir.appendingPathComponent("pattern.bin")
    let existing = ((try? fm.attributesOfItem(atPath: pattern.path))?[.size] as? NSNumber)?.intValue
    if existing != patternSize {
        fm.createFile(atPath: pattern.path, contents: nil)
        let fh = try! FileHandle(forWritingTo: pattern)
        let block = 1 << 20
        var buf = [UInt8](repeating: 0, count: block)
        var offset = 0
        while offset < patternSize {
            let base = offset
            buf.withUnsafeMutableBufferPointer { p in
                for k in 0..<block {
                    let i = base + k
                    p[k] = UInt8(truncatingIfNeeded: i &* 31 &+ (i >> 8))
                }
            }
            fh.write(Data(buf))
            offset += block
        }
        try? fh.close()
    }
    try? "hello spike".write(to: mediaDir.appendingPathComponent("small.txt"), atomically: true, encoding: .utf8)
    if let video = env["SPIKE_VIDEO"] {
        let dest = mediaDir.appendingPathComponent("video.mp4")
        try? fm.removeItem(at: dest)
        try? fm.copyItem(at: URL(fileURLWithPath: video), to: dest)
    }
}

func contentType(_ name: String) -> String {
    switch (name as NSString).pathExtension.lowercased() {
    case "mp4": return "video/mp4"
    case "txt": return "text/plain; charset=utf-8"
    default: return "application/octet-stream"
    }
}

/// bytes=START-END | bytes=START- | bytes=-SUFFIX (a single range); nil = not satisfiable
func parseRange(_ header: String, size: Int64) -> (Int64, Int64)? {
    guard header.hasPrefix("bytes="), !header.contains(",") else { return nil }
    let parts = header.dropFirst("bytes=".count).split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    if parts[0].isEmpty {
        guard let n = Int64(parts[1]), n > 0 else { return nil }
        return (max(0, size - n), size - 1)
    }
    guard let s = Int64(parts[0]), s < size else { return nil }
    if parts[1].isEmpty { return (s, size - 1) }
    guard let e = Int64(parts[1]), e >= s else { return nil }
    return (s, min(e, size - 1))
}

/// Serves the test page and the files in mediaDir. Task methods are only called on the main thread; the file is read on a queue and
/// handed over in 256 KiB chunks, so a 64 MiB range never sits in memory whole
final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "spike.scheme", attributes: .concurrent)
    private let lock = NSLock()
    private var stopped = Set<ObjectIdentifier>()
    private(set) var bytesServed: Int64 = 0

    private func isStopped(_ id: ObjectIdentifier) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped.contains(id)
    }

    private func send(_ task: WKURLSchemeTask, status: Int, type: String, body: Data, extra: [String: String] = [:]) {
        var headers = ["Content-Type": type, "Content-Length": String(body.count), "Cache-Control": "no-store"]
        headers.merge(extra) { $1 }
        task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(body)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task as AnyObject)
        let url = task.request.url!
        let path = url.path
        if path == "/app/test.html" {
            let html = testPage.replacingOccurrences(of: "__PHASE__", with: phase)
            send(task, status: 200, type: "text/html; charset=utf-8", body: Data(html.utf8))
            return
        }
        let prefix = "/media/"
        let name = String(path.dropFirst(prefix.count))
        guard path.hasPrefix(prefix), !name.isEmpty, !name.contains("/"), !name.contains("..") else {
            send(task, status: 404, type: "text/plain", body: Data("not found".utf8))
            return
        }
        let file = mediaDir.appendingPathComponent(name)
        guard let size = ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber)?.int64Value else {
            send(task, status: 404, type: "text/plain", body: Data("not found".utf8))
            return
        }
        var start: Int64 = 0
        var end: Int64 = size - 1
        var status = 200
        if let range = task.request.value(forHTTPHeaderField: "Range") {
            guard let parsed = parseRange(range, size: size) else {
                send(task, status: 416, type: "text/plain", body: Data(), extra: ["Content-Range": "bytes */\(size)"])
                return
            }
            (start, end) = parsed
            status = 206
        }
        let length = end - start + 1
        var headers = ["Content-Type": contentType(name), "Content-Length": String(length), "Accept-Ranges": "bytes", "Cache-Control": "no-store"]
        if status == 206 { headers["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)

        queue.async { [self] in
            guard let fh = try? FileHandle(forReadingFrom: file) else { return }
            defer { try? fh.close() }
            try? fh.seek(toOffset: UInt64(start))
            var remaining = Int(length)
            while remaining > 0 {
                if isStopped(id) { return }
                guard let data = try? fh.read(upToCount: min(256 * 1024, remaining)), !data.isEmpty else { break }
                remaining -= data.count
                var alive = true
                DispatchQueue.main.sync {
                    if isStopped(id) { alive = false } else {
                        task.didReceive(data)
                        bytesServed += Int64(data.count)
                    }
                }
                if !alive { return }
            }
            DispatchQueue.main.sync { if !isStopped(id) { task.didFinish() } }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock()
        stopped.insert(ObjectIdentifier(task as AnyObject))
        lock.unlock()
    }
}

final class SpikeApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    let handler = MediaSchemeHandler()
    var native: [String: Any] = [:]
    var finished = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        prepareMedia()
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(handler, forURLScheme: "snip")
        config.userContentController.add(self, name: "bridge")
        config.preferences.tabFocusesLinks = tabFocusesLinks
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700), configuration: config)
        if #available(macOS 13.3, *) { web.isInspectable = true }
        window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 1000, height: 700), styleMask: [.titled, .closable, .resizable], backing: .buffered,
            defer: false)
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(web)
        native["macOS"] = ProcessInfo.processInfo.operatingSystemVersionString
        native["tabFocusesLinks"] = tabFocusesLinks
        native["rssAtStartMB"] = residentMB()
        web.load(URLRequest(url: URL(string: "snip://host/app/test.html")!))
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) { self.finish(code: 2, note: "timeout") }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        switch kind {
        case "ready":
            runTabTest { order in
                self.native["tabOrderFromFirstInput"] = order  // elements: i, b1, b2, l (link), j
                self.web.evaluateJavaScript("window.__start()", completionHandler: nil)
            }
        case "rss":
            reply(body, ["rssMB": residentMB()])
        case "echo":
            let n = (body["data"] as? String)?.utf16.count ?? -1
            reply(body, ["length": n, "data": String(repeating: "A", count: max(n, 0))])
        case "done":
            finish(code: 0, pageResults: body["results"] as? String)
        default:
            break
        }
    }

    func reply(_ body: [String: Any], _ payload: [String: Any]) {
        guard let id = body["id"] as? Int, let json = try? JSONSerialization.data(withJSONObject: payload),
            let text = String(data: json, encoding: .utf8)
        else { return }
        web.evaluateJavaScript("window.__native(\(id), \(text))", completionHandler: nil)
    }

    /// Real Tab key events sent to the window, then what the page says has the focus
    func runTabTest(done: @escaping ([String]) -> Void) {
        var order: [String] = []
        func step(_ n: Int) {
            if n == 5 { done(order); return }
            sendKey(code: 48, chars: "\t")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                let script = "document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'"
                self.web.evaluateJavaScript(script) { result, _ in
                    order.append(result as? String ?? "?")
                    step(n + 1)
                }
            }
        }
        step(0)
    }

    func sendKey(code: UInt16, chars: String) {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            if let event = NSEvent.keyEvent(
                with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false,
                keyCode: code)
            {
                window.sendEvent(event)
            }
        }
    }

    func finish(code: Int32, note: String? = nil, pageResults: String? = nil) {
        if finished { return }
        finished = true
        native["rssAtEndMB"] = residentMB()
        var out: [String: Any] = ["native": native, "handlerBytesServedMB": Double(handler.bytesServed) / 1_048_576]
        if let text = pageResults, let data = text.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) { out["page"] = obj }
        if let note { out["note"] = note }
        let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
        try? data.write(to: URL(fileURLWithPath: outPath))
        print(String(data: data, encoding: .utf8)!)
        fflush(stdout)
        exit(code)
    }
}

let app = NSApplication.shared
let delegate = SpikeApp()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

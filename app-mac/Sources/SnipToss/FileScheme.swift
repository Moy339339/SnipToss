import Foundation
import UniformTypeIdentifiers
import WebKit

/// Content type by file extension; the web assets are spelled out, anything else asks the system
func mimeType(forExtension ext: String) -> String {
    switch ext.lowercased() {
    case "html", "htm": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "wasm": return "application/wasm"
    case "txt": return "text/plain; charset=utf-8"
    default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
}

/// `bytes=START-END`, `bytes=START-` or `bytes=-SUFFIX` (one range only); nil means not satisfiable
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

/// One request in flight. WebKit tells us when it cancels one (`stop`); the file is read on another queue, so the flag is locked
private final class Job {
    private let lock = NSLock()
    private var cancelled = false
    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }
    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

/// Serves files for a custom URL scheme, with Range support. `resolve` maps a request URL to the file to serve (nil = 404); it is the only
/// place that decides what the page may read. Task methods run on the main thread; a file is read in 256 KiB chunks on a queue and handed
/// over one chunk at a time, so a large range never sits in memory whole.
final class FileSchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "snip.scheme", attributes: .concurrent)
    /// Main thread only. A job leaves this table when its task is cancelled or finished, so a later task that reuses the address is never
    /// mistaken for a cancelled one
    private var jobs: [ObjectIdentifier: Job] = [:]
    private let resolve: (URL) -> URL?

    init(resolve: @escaping (URL) -> URL?) {
        self.resolve = resolve
    }

    private func send(_ task: WKURLSchemeTask, status: Int, type: String, body: Data, extra: [String: String] = [:]) {
        var headers = ["Content-Type": type, "Content-Length": String(body.count), "Cache-Control": "no-store"]
        headers.merge(extra) { $1 }
        task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(body)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = resolve(url),
            let size = ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber)?.int64Value
        else {
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
        var headers = [
            "Content-Type": mimeType(forExtension: file.pathExtension), "Content-Length": String(length), "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        ]
        if status == 206 { headers["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)

        let id = ObjectIdentifier(task as AnyObject)
        let job = Job()
        jobs[id] = job
        queue.async { [self] in
            var failed = false
            if let fh = try? FileHandle(forReadingFrom: file) {
                defer { try? fh.close() }
                try? fh.seek(toOffset: UInt64(start))
                var remaining = Int(length)
                while remaining > 0 {
                    if job.isCancelled { return }
                    guard let data = try? fh.read(upToCount: min(256 * 1024, remaining)), !data.isEmpty else {
                        failed = true
                        break
                    }
                    remaining -= data.count
                    var alive = true
                    DispatchQueue.main.sync {
                        if job.isCancelled { alive = false } else { task.didReceive(data) }
                    }
                    if !alive { return }
                }
            } else {
                failed = true
            }
            DispatchQueue.main.sync {
                if job.isCancelled { return }
                // Fewer bytes than the Content-Length we promised: fail the request instead of finishing it short
                if failed { task.didFailWithError(URLError(.cannotOpenFile)) } else { task.didFinish() }
                jobs[id] = nil
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task as AnyObject)
        jobs[id]?.cancel()
        jobs[id] = nil
    }
}

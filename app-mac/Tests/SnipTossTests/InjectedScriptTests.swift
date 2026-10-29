import JavaScriptCore
import XCTest

@testable import SnipToss

/// Everything the shell injects into the page or sends to it is JavaScript inside a Swift string, and a quote that slips out of one of
/// them fails only when the page runs it (twice the key experiment ran against a page that had thrown a syntax error). Each script is
/// parsed here, not run, so such a slip fails the unit tests
final class InjectedScriptTests: XCTestCase {
    /// The syntax error `new Function(source)` throws for this source, nil if it parses
    private func parseError(_ source: String) -> String? {
        let context = JSContext()!
        var message: String?
        context.exceptionHandler = { _, exception in message = exception?.toString() }
        context.setObject(source, forKeyedSubscript: "source" as NSString)
        context.evaluateScript("new Function(source)")
        return message
    }

    func testEveryScriptSentToThePageParses() {
        var scripts: [(String, String)] = [
            ("bridge shim", bridgeShimScript), ("console hook", consoleHookScript),
            ("smoke: welcome", SmokeRun.welcomeScript), ("smoke: image", SmokeRun.imageScript),
            ("smoke: tour", SmokeRun.tourScript), ("smoke: probe", SmokeRun.probeScript),
        ]
        for (index, source) in KeyExperiment.Scripts.all.enumerated() { scripts.append(("key experiment \(index)", source)) }
        for (name, source) in scripts {
            XCTAssertNil(parseError(source), "\(name) does not parse")
        }
    }

    func testTheCheckCatchesABrokenScript() {
        XCTAssertNotNil(parseError("window.__prevent = ';"))
        XCTAssertNil(parseError("window.__prevent = '';"))
    }
}
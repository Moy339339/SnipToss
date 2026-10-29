import AppKit
import CoreGraphics
import ScreenCaptureKit

/// A picture of one screen taken at the moment the capture started. It lives in memory only: it is never written to disk, and it is dropped
/// when the capture ends
struct FrozenScreen {
    let displayID: CGDirectDisplayID
    /// The screen's frame in AppKit's global coordinates (points, origin at the bottom left of the main screen)
    let frame: CGRect
    /// Pixels per point of this screen
    let scale: CGFloat
    /// The picture: `frame.size × scale` pixels
    let image: CGImage
}

enum ScreenCaptureFailure: Error, Equatable {
    /// The system does not let the app record the screen (the user has not allowed it, or turned it off again)
    case noAccess
    case noScreens
    case failed(String)
}

/// Where the frozen pictures come from: the system (ScreenCaptureKit), or a made-up pattern in tests and the smoke run, which have no
/// permission to record a screen and must never upload a real one
protocol ScreenSource {
    /// A frozen picture of every screen, taken now
    func capture() async throws -> [FrozenScreen]
}

/// The system's screen capture: one picture per display, at the display's own resolution, without the cursor
struct ScreenCaptureKitSource: ScreenSource {
    /// ScreenCaptureKit's "the user declined" (SCStreamError.userDeclined); it is also what a first use without any answer yet reports
    private static let userDeclined = -3801

    func capture() async throws -> [FrozenScreen] {
        do {
            // NSScreen belongs to the main thread; this runs off it
            let frames = await MainActor.run { Self.screenFrames() }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            var frozen: [FrozenScreen] = []
            for display in content.displays {
                guard let frame = frames[display.displayID] else { continue }
                let filter = SCContentFilter(display: display, excludingWindows: [])
                // The display's size is in points, the picture's in pixels: the two scales are one factor apart
                let scale = CGFloat(filter.pointPixelScale)
                let configuration = SCStreamConfiguration()
                configuration.width = Int((CGFloat(display.width) * scale).rounded())
                configuration.height = Int((CGFloat(display.height) * scale).rounded())
                configuration.showsCursor = false
                configuration.captureResolution = .best
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
                frozen.append(FrozenScreen(displayID: display.displayID, frame: frame, scale: scale, image: image))
            }
            if frozen.isEmpty { throw ScreenCaptureFailure.noScreens }
            return frozen
        } catch let failure as ScreenCaptureFailure {
            throw failure
        } catch {
            if (error as NSError).code == Self.userDeclined { throw ScreenCaptureFailure.noAccess }
            throw ScreenCaptureFailure.failed("\(error)")
        }
    }

    /// Each screen's frame in AppKit's global coordinates, by display
    @MainActor private static func screenFrames() -> [CGDirectDisplayID: CGRect] {
        var frames: [CGDirectDisplayID: CGRect] = [:]
        for screen in NSScreen.screens { frames[ScreenID.of(screen)] = screen.frame }
        return frames
    }
}

enum ScreenID {
    /// The display a screen is (0 when the system does not say)
    static func of(_ screen: NSScreen) -> CGDirectDisplayID {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }
}

/// Screens that are a pattern: the pixel at (x, y) has a color made of x and y, so a test can tell where on the screen a picture comes from
struct PatternScreenSource: ScreenSource {
    struct Screen {
        let displayID: CGDirectDisplayID
        let frame: CGRect
        let scale: CGFloat
    }

    let screens: [Screen]

    static func color(x: Int, y: Int) -> (red: UInt8, green: UInt8, blue: UInt8) {
        (UInt8(x % 251), UInt8(y % 241), UInt8((x + y) % 239))
    }

    func capture() async throws -> [FrozenScreen] {
        if screens.isEmpty { throw ScreenCaptureFailure.noScreens }
        return screens.map { screen in
            let width = Int((screen.frame.width * screen.scale).rounded())
            let height = Int((screen.frame.height * screen.scale).rounded())
            return FrozenScreen(
                displayID: screen.displayID, frame: screen.frame, scale: screen.scale, image: Self.image(width: width, height: height))
        }
    }

    static func image(width: Int, height: Int) -> CGImage {
        var pixels = [UInt8](repeating: 255, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                let c = color(x: x, y: y)
                let offset = (y * width + x) * 4
                pixels[offset] = c.red
                pixels[offset + 1] = c.green
                pixels[offset + 2] = c.blue
            }
        }
        let provider = CGDataProvider(data: Data(pixels) as CFData)!
        return CGImage(
            width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil,
            shouldInterpolate: false, intent: .defaultIntent)!
    }
}

/// Whether the app may record the screen, asking for it, and the page of System Settings where the user allows it
protocol ScreenAccess {
    /// Whether the system lets this app record the screen now (asks nothing, shows nothing; any thread)
    var allowed: Bool { get }
    func request()
    /// Main thread
    func openSettings()
}

struct SystemScreenAccess: ScreenAccess {
    var allowed: Bool { CGPreflightScreenCaptureAccess() }

    /// Asks the system once; it shows its own question only while the user has not answered yet
    func request() {
        _ = CGRequestScreenCaptureAccess()
    }

    func openSettings() {
        // The new spelling first; the old one for systems that do not know it
        for address in [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        ] {
            if let url = URL(string: address), NSWorkspace.shared.open(url) { return }
        }
    }
}

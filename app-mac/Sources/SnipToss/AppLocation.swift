import Foundation

/// Where the app runs from, for the prompt to move it into Applications. A downloaded app opened where it lies (in Downloads, or on the
/// disk image) is run by macOS from a random read-only copy ("App Translocation"), a new one each time: what the system keys by the app's
/// path, such as the screen capture confirmation to bypass the private window picker (macOS 15), is asked again at every start
enum AppLocation {
    enum Problem: Equatable {
        /// Run from a copy the system made under a random path (…/AppTranslocation/…)
        case translocated
        /// Run straight from a disk image: a read-only volume under /Volumes
        case diskImage
    }

    /// What is wrong with running from `bundlePath`; nil when nothing is (Applications or any folder of the user's, or a development build,
    /// which is no bundle)
    static func problem(bundlePath: String, isReadOnlyVolume: (String) -> Bool = AppLocation.isReadOnlyVolume) -> Problem? {
        guard bundlePath.hasSuffix(".app") else { return nil }
        if bundlePath.contains("/AppTranslocation/") { return .translocated }
        if bundlePath.hasPrefix("/Volumes/") && isReadOnlyVolume(bundlePath) { return .diskImage }
        return nil
    }

    static func isReadOnlyVolume(_ path: String) -> Bool {
        let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.volumeIsReadOnlyKey])
        return values?.volumeIsReadOnly ?? false
    }

    /// The copy the user opened, for a translocated app (shown selected in Finder, next to Applications).
    /// The system says it through SecTranslocateCreateOriginalPathForURL, which the Security framework exports but the SDK does not
    /// declare. That is acceptable here: the app is not distributed through the App Store, the function is looked up at run time rather
    /// than linked, and all that depends on it is selecting one item in Finder. When it is missing or gives no answer, the result is nil,
    /// the log says why, and only Applications is opened
    static func originalPath(of bundlePath: String) -> String? {
        typealias OriginalPath = @convention(c) (CFURL, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> Unmanaged<CFURL>?
        let security = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY)
        defer { if let security { dlclose(security) } }
        guard let symbol = dlsym(security, "SecTranslocateCreateOriginalPathForURL") else {
            Log.info("Where the app was opened from is unknown: SecTranslocateCreateOriginalPathForURL is not available")
            return nil
        }
        let original = unsafeBitCast(symbol, to: OriginalPath.self)
        var error: Unmanaged<CFError>?
        guard let url = original(URL(fileURLWithPath: bundlePath) as CFURL, &error)?.takeRetainedValue() else {
            let reason = error.map { "\($0.takeRetainedValue())" } ?? "no answer"
            Log.info("Where the app was opened from is unknown: SecTranslocateCreateOriginalPathForURL failed (\(reason))")
            return nil
        }
        return (url as URL).path
    }
}

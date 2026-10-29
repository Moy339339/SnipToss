import Foundation

/// Where the app keeps its own files. The folder name (the technical name) is written once, here.
/// Same convention as the Windows shell: when SNIPTOSS_SETTINGS names a settings file, this is a test instance and every other local file
/// (logs, pasted images, caches) lives next to that file, so a test run never touches the user's own data.
enum AppPaths {
    static let dirName = "SnipToss"

    struct Layout: Equatable {
        /// The settings file
        let settingsFile: String
        /// Local data (pasted images, caches): the folder that holds the settings file
        let localDir: String
        let logDir: String
        /// SNIPTOSS_SETTINGS was set
        let testInstance: Bool
    }

    /// A test instance when `customSettings` is given (an empty value counts as not given), otherwise the standard locations under `home`:
    /// ~/Library/Application Support/SnipToss for the settings and local data, ~/Library/Logs/SnipToss for the log.
    /// There is no portable layout on the Mac: an app bundle is never written to
    static func resolve(customSettings: String?, home: String) -> Layout {
        if let custom = customSettings, !custom.isEmpty {
            let file = (try? Library.norm(custom)) ?? custom
            let dir = (file as NSString).deletingLastPathComponent
            return Layout(settingsFile: file, localDir: dir, logDir: dir + "/logs", testInstance: true)
        }
        let support = home + "/Library/Application Support/" + dirName
        return Layout(settingsFile: support + "/settings.json", localDir: support, logDir: home + "/Library/Logs/" + dirName, testInstance: false)
    }

    /// Resolved once per process
    static let current: Layout = resolve(customSettings: ProcessInfo.processInfo.environment["SNIPTOSS_SETTINGS"], home: NSHomeDirectory())

    static var isTestInstance: Bool { current.testInstance }
    static var settingsFile: String { current.settingsFile }
    static var localDir: String { current.localDir }
    static var logDir: String { current.logDir }

    /// Images pasted with Cmd+V: the app's own folder, so no files are added to the user's projects (the app only writes a project's
    /// .sniptoss). The whole folder is one project in the library; it is never cleaned up automatically (these are items, not a screenshot archive)
    static var pastedDir: String { current.localDir + "/Pasted Images" }
}

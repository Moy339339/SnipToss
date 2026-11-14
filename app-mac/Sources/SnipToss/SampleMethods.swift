import Foundation

/// The tutorial's picture (docs/host-api.md, `addSample`; the Windows shell's AddSampleAsync): the picture that ships with the UI
/// (`ui/sample/landing-page.jpg`) is copied into the app's own Sample folder (`appInfo.sampleDir`, AppPaths.sampleDir) when it is not there
/// yet, that folder is added to the library and the picture located. An item has to be a file in a folder its notes can be written next
/// to, so the picture is not shown from inside the app bundle
enum Sample {
    static let fileName = "landing-page.jpg"

    /// Where the picture ships: the UI folder's `sample` folder; nil when it is not there (the UI then does not offer the tutorial)
    static func source(ui: URL?) -> String? {
        guard let path = ui?.appendingPathComponent("sample", isDirectory: true).appendingPathComponent(fileName).path,
            FileManager.default.fileExists(atPath: path)
        else { return nil }
        return path
    }

    /// The tutorial starts on a clean picture: the notes left on it last time (the folder is the app's own) are deleted first, then the
    /// picture is copied if it is missing, then the folder is added and the picture is the one to locate
    static func add(settings: Settings, dir: String, source: String) throws -> [String: Any] {
        let file = (dir as NSString).appendingPathComponent(fileName)
        let notes = (dir as NSString).appendingPathComponent(DataDir.name)
        let files = FileManager.default
        if files.fileExists(atPath: notes) {
            do {
                try files.removeItem(atPath: notes)
            } catch {
                Log.info("Could not clear the sample's notes: \(error)")
            }
        }
        if !files.fileExists(atPath: file) {
            do {
                try AtomicFile.ensureDirectory(dir)
                try AtomicFile.write(file, try Data(contentsOf: URL(fileURLWithPath: source)))
            } catch let error as FileOperationError {
                throw bridgeError(error)
            }
            Log.info("Added the sample picture: \(file)")
        }
        let added = Library.add(settings, paths: [dir])
        // The folder may be in the library already, which makes `added` empty and the focus the folder; the page should land on the picture
        return addReply(Library.AddResult(added: added.added, focus: file, skipped: added.skipped, relocated: added.relocated))
    }
}

/// `addSample`. Registered only when the picture ships with the UI (`source`), as `appInfo.sampleDir` is only given then
func installSampleMethods(into bridge: BridgeHost, settings: Settings, dir: String = AppPaths.sampleDir, source: String) {
    bridge.register("addSample") { _ in
        try Sample.add(settings: settings, dir: dir, source: source)
    }
}

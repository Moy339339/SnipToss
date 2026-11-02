import Foundation
import ServiceManagement

/// What the system says about starting the app when the user signs in (Settings > General "start at login")
enum LoginItemState: Equatable {
    /// Registered and allowed: the app starts at login
    case on
    /// Not registered, or the system cannot find the app to register it
    case off
    /// Registered, but switched off in System Settings > General > Login Items. Only the user can switch it back on there
    case needsApproval
}

/// Why the login item could not be changed
enum LoginItemError: Error, Equatable {
    /// A test instance (SNIPTOSS_SETTINGS) never touches it: the login item belongs to the installed copy, which has the same identity
    case testInstance
    /// Registered, and now waiting for the user to allow it in System Settings
    case needsApproval
    /// The system refused; what it said
    case failed(String)
}

/// The login item of the app. A protocol so tests stand in a fake and never register anything on the machine they run on
protocol LoginItemControl {
    /// What the system says now (it can change outside the app: the user can switch the item off in System Settings)
    var state: LoginItemState { get }
    /// Registers the app as a login item, or removes it. Throws `LoginItemError`. Nothing happens when it already is as asked
    func set(_ on: Bool) throws
    /// Opens the page of System Settings that lists the login items
    func openSystemSettings()
}

/// The real one: `SMAppService.mainApp`, the app itself as a login item (macOS 13 and later; the app needs no helper). It is started
/// like any app opened by hand; `LoginLaunch` tells that it was started this way
struct SystemLoginItem: LoginItemControl {
    private let isTestInstance: Bool

    init(isTestInstance: Bool = AppPaths.isTestInstance) {
        self.isTestInstance = isTestInstance
    }

    var state: LoginItemState {
        SystemLoginItem.state(of: SMAppService.mainApp.status)
    }

    static func state(of status: SMAppService.Status) -> LoginItemState {
        switch status {
        case .enabled: return .on
        case .requiresApproval: return .needsApproval
        case .notRegistered, .notFound: return .off
        @unknown default: return .off
        }
    }

    func set(_ on: Bool) throws {
        if isTestInstance { throw LoginItemError.testInstance }
        let service = SMAppService.mainApp
        do {
            if on {
                switch service.status {
                case .enabled: return
                // Registered earlier and switched off by the user: registering again changes nothing, the user has to allow it
                case .requiresApproval: throw LoginItemError.needsApproval
                default: try service.register()
                }
                // A first registration can end up waiting for the user's approval too
                if service.status == .requiresApproval { throw LoginItemError.needsApproval }
            } else {
                switch service.status {
                case .notRegistered, .notFound: return
                // Also removes an item the user had switched off, so it does not stay in the list
                default: try service.unregister()
                }
            }
        } catch let error as LoginItemError {
            throw error
        } catch {
            throw LoginItemError.failed(error.localizedDescription)
        }
    }

    func openSystemSettings() {
        runOnMain { SMAppService.openSystemSettingsLoginItems() }
    }
}

enum LoginItemChange {
    /// Turns the login item on or off as the page asked. Nil when it is as asked; otherwise the refusal to send back (the page shows its
    /// text). When it waits for the user's approval, System Settings is opened at the list of login items
    static func apply(_ on: Bool, to control: LoginItemControl) -> BridgeError? {
        let app = ShellText.t("brand.name")
        do {
            try control.set(on)
            return nil
        } catch LoginItemError.testInstance {
            // Only seen during development, so not translated (like the Windows shell's)
            return BridgeError("Test instances don't change the login item, so the installed version's setting stays as it is")
        } catch LoginItemError.needsApproval {
            control.openSystemSettings()
            return BridgeError(ShellText.t("shell.autostart.needsApproval", ["app": app]))
        } catch LoginItemError.failed(let reason) {
            Log.info("The login item could not be changed: \(reason)")
            return BridgeError(ShellText.t("shell.autostart.failed", ["app": app, "reason": Scrub.text(reason)]))
        } catch {
            return BridgeError("\(error)")
        }
    }
}

/// Whether the system started the app as a login item. The Apple event that opened the application says so: its `keyAEPropData`
/// parameter is `keyAELaunchedAsLogInItem`. The event is only available while the launch is being handled, so ask in
/// `applicationDidFinishLaunching` (`NSAppleEventManager.shared().currentAppleEvent`).
/// Started this way with the menu bar item on, the app opens no window and waits in the menu bar, as the Windows shell does when it
/// is started at sign-in (`--tray`); the capture shortcut works from the start. With the menu bar item off there would be no way back
/// to the app but the Dock, so the window opens as usual
enum LoginLaunch {
    // The four-character codes of the constants named above (AERegistry.h), so nothing depends on how the headers import them
    private static let openApplication = fourCharCode("oapp")  // kAEOpenApplication
    private static let propertyData = fourCharCode("prdt")  // keyAEPropData
    private static let launchedAsLoginItem = fourCharCode("lgit")  // keyAELaunchedAsLogInItem

    static func fourCharCode(_ text: String) -> UInt32 {
        text.utf8.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    }

    /// The event is the "open application" one with the login item marker. Nil (no event) is not a login launch
    static func isLoginLaunch(_ event: NSAppleEventDescriptor?) -> Bool {
        guard let event, event.eventID == openApplication else { return false }
        return event.paramDescriptor(forKeyword: propertyData)?.enumCodeValue == launchedAsLoginItem
    }

    /// The window stays closed: started at login, and the menu bar item is there to open it again
    static func startsHidden(event: NSAppleEventDescriptor?, keepInTray: Bool) -> Bool {
        isLoginLaunch(event) && TrayPolicy.showsStatusItem(keepInTray: keepInTray)
    }
}

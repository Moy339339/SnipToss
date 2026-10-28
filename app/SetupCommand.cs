using System.IO;

namespace SnipToss.App;

/// <summary>
/// Commands called by the setup wizard and the uninstaller (installer/SnipToss.iss, ADR-0002): the context menu has to be registered the same way as in Settings → System,
/// so the app writes it itself instead of the install script writing the registry a second time. No window, not a single instance; exit code 0 on success, 1 on failure (the reason is logged)
/// </summary>
static class SetupCommand
{
    /// <summary>"Add to the File Explorer context menu" was ticked during installation</summary>
    public const string RegisterContextMenu = "--register-context-menu";

    /// <summary>Before uninstalling: asks the running window to quit, removes the context menu, autostart and the long-path directory junctions. The user's data (settings, library, the notes inside each project) is untouched</summary>
    public const string UninstallCleanup = "--uninstall-cleanup";

    /// <summary>The longest to wait for the running window to quit (normally a second or two)</summary>
    static readonly TimeSpan QuitTimeout = TimeSpan.FromSeconds(15);

    /// <summary>Whether the command line is one of these commands (only a lone argument counts, so it can't be mixed up with files to open)</summary>
    public static string? Of(string[] args) => args is [RegisterContextMenu or UninstallCleanup] ? args[0] : null;

    public static int Run(string command)
    {
        try
        {
            if (command == RegisterContextMenu)
            {
                // The context menu text follows the UI language (with no settings file yet at install time it follows the system); later changes of language are applied by the app itself (ShellIntegration.RefreshLabel)
                var settings = Settings.Load();
                Locale.Use(settings.Language);
                ShellIntegration.Set(true, settings.MoreFormats);
                Log.Info("Setup: context menu added");
            }
            else
            {
                // Ask the running one to quit and wait until it has (the uninstaller then deletes the program files, which can't be deleted while in use)
                if (!SingleInstance.AskRunningToQuit(QuitTimeout)) Log.Warn("Uninstall: the running window didn't quit in time, the program files may not be fully deleted");
                // Delete the junctions first, and only the junctions themselves: when the uninstaller deletes the install directory or the user deletes the data directory, nothing should follow a junction and delete the user's items (LongPaths)
                LongPaths.Clean();
                ShellIntegration.Set(false, more: false);
                Autostart.Set(false);
                Log.Info("Uninstall: removed the context menu, autostart and long-path directory junctions");
            }
            return 0;
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException or InvalidOperationException)
        {
            Log.Error($"{command} did not finish", ex);
            return 1;
        }
    }
}

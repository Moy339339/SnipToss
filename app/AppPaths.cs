using System.IO;

namespace SnipToss.App;

/// <summary>
/// Where the app keeps its own files. The directory name (the technical name) is written once, here (docs/adr/0007-rename.md)
/// </summary>
static class AppPaths
{
    public const string DirName = "SnipToss";

    /// <summary>The directory name before the rename: only used to move old data over (LegacyMigration); nothing is written to it</summary>
    public const string LegacyDirName = "pizhu";

    /// <summary>For development checks: when set, this is a test instance; settings, logs, screenshots and WebView2 data live next to it and the user's own are untouched</summary>
    static readonly string? CustomSettings = Environment.GetEnvironmentVariable("SNIPTOSS_SETTINGS") is { Length: > 0 } s ? Path.GetFullPath(s) : null;

    /// <summary>Portable-build marker: a folder with this name next to the exe (the portable zip ships with it) holds all data (like VS Code's portable mode)</summary>
    public const string PortableDirName = "data";

    static readonly Layout Paths = Resolve(
        CustomSettings,
        AppContext.BaseDirectory,
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Directory.Exists);

    /// <summary>Where the app's files go: the settings file, the local data folder (logs, screenshots, WebView2), and whether this is a test instance / portable build</summary>
    internal sealed record Layout(string SettingsFile, string LocalDir, bool TestInstance, bool Portable);

    /// <summary>
    /// Test instance first (SNIPTOSS_SETTINGS), then portable build (a data folder next to the exe holds settings, logs, screenshots and WebView2 data);
    /// otherwise it is an installed copy: %APPDATA%\SnipToss\settings.json and %LOCALAPPDATA%\SnipToss
    /// </summary>
    internal static Layout Resolve(string? customSettings, string exeDir, string appData, string localAppData, Func<string, bool> dirExists)
    {
        if (customSettings is not null) return new(customSettings, Path.GetDirectoryName(customSettings)!, TestInstance: true, Portable: false);
        var portable = Path.Combine(exeDir, PortableDirName);
        if (dirExists(portable)) return new(Path.Combine(portable, "settings.json"), portable, TestInstance: false, Portable: true);
        return new(Path.Combine(appData, DirName, "settings.json"), Path.Combine(localAppData, DirName), TestInstance: false, Portable: false);
    }

    /// <summary>Test instance: old data is not migrated and the registry is not touched (the context menu and autostart belong to the user's own copy)</summary>
    public static bool IsTestInstance => Paths.TestInstance;

    /// <summary>Portable build (a data folder next to the exe): no registry writes (copy it to a USB stick, delete the folder and nothing is left) and no migration of old data</summary>
    public static bool IsPortable => Paths.Portable;

    /// <summary>Anything that writes to the registry (context menu, autostart): neither a test instance nor a portable build does</summary>
    public static bool WritesRegistry => !IsTestInstance && !IsPortable;

    /// <summary>Settings file: %APPDATA%\SnipToss\settings.json (in data for a portable build; SNIPTOSS_SETTINGS for a test instance)</summary>
    public static string SettingsFile => Paths.SettingsFile;

    /// <summary>Local data (logs, Screen Capture files, WebView2): %LOCALAPPDATA%\SnipToss; data for a portable build; next to the settings file for a test instance</summary>
    public static string LocalDir => Paths.LocalDir;

    public static string LogDir => Path.Combine(LocalDir, "logs");

    /// <summary>
    /// Images pasted with Ctrl+V: the app's own folder, so no files are added to the user's projects (the app only writes a project's .sniptoss).
    /// The whole folder is one project in the library, shown in the UI as "Pasted Images"; it is never cleaned up automatically (these are items, not a screenshot archive)
    /// </summary>
    public static string PastedDir => Path.Combine(LocalDir, "pasted");

    /// <summary>
    /// WebView2 data (localStorage such as the sidebar width, cache). It used to use the default location, pizhu.exe.WebView2 next to the exe,
    /// which broke when the app was installed in a read-only directory; moved here on the rename. The WEBVIEW2_USER_DATA_FOLDER environment variable wins if set
    /// </summary>
    public static string WebViewDataDir => Path.Combine(LocalDir, "WebView2");
}

static class AppVersion
{
    /// <summary>
    /// The csproj &lt;Version&gt;, including the pre-release suffix (1.0.0-beta.3). The assembly version is numeric only and can't show a beta;
    /// the SDK appends "+git commit hash" after it, which is removed
    /// </summary>
    public static string Text { get; } =
        typeof(AppVersion).Assembly.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion.Split('+')[0] ?? "dev";
}

using System.Diagnostics;
using System.IO;
using Microsoft.Win32;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>The File Explorer context menu entry "Open with SnipToss". Writes only the current user's registry (HKCU), needs no administrator rights, and turning it off removes everything cleanly</summary>
static class ShellIntegration
{
    const string Verb = "SnipToss";

    /// <summary>The name registered before the rename (docs/adr/0007-rename.md): when LegacyMigration finds it, it swaps it for the new one under the same switch and deletes the old</summary>
    const string LegacyVerb = "pizhu";

    /// <summary>The text shown in the menu: follows the interface language (RefreshLabel rewrites it when the language changes)</summary>
    static string Label => Locale.T("shell.contextMenu", ("app", MainWindow.AppName));

    /// <param name="exts">Which file types get an entry (every type when null: renaming and removing reach all of them)</param>
    /// <param name="withFormer">Include the entries registered earlier and no longer accepted (PDF, PPT): deletion has to remove them all</param>
    static IEnumerable<string> KeyPaths(string verb, IEnumerable<string>? exts = null, bool withFormer = false)
    {
        yield return @"Software\Classes\Directory\shell\" + verb;
        yield return @"Software\Classes\Directory\Background\shell\" + verb;
        exts ??= MaterialScanner.Extensions;
        foreach (var ext in withFormer ? exts.Concat(MaterialScanner.FormerExtensions) : exts)
            yield return $@"Software\Classes\SystemFileAssociations\{ext}\shell\{verb}";
    }

    /// <summary>
    /// Settings → Advanced → More formats, read from the settings file without loading it (no backup restore, no logging): for registering
    /// before the window has loaded the settings (startup, installer, migration). An unreadable file counts as off, the default
    /// </summary>
    internal static bool MoreFormatsSetting() => Settings.Peek()?.MoreFormats ?? false;

    static string Exe => Environment.ProcessPath ?? throw new InvalidOperationException("Cannot get the program path");

    /// <summary>
    /// Test instances (SNIPTOSS_SETTINGS) don't touch the registry: the context menu and autostart are one per user, so writing would overwrite the user's installed copy with the test program in a temp directory.
    /// Only seen during development, so not translated
    /// </summary>
    internal static void RefuseInTestInstance()
    {
        if (AppPaths.IsTestInstance)
            throw new InvalidOperationException("Test instances don't change the context menu or startup entries, so the installed version's settings stay as they are");
        // The portable build doesn't write the registry (copy it away, delete the folder and nothing is left): this is text the user can see (the switches in Settings are greyed out too; this is the backstop)
        if (AppPaths.IsPortable) throw new InvalidOperationException(Locale.T("shell.portable.noRegistry"));
    }

    /// <summary>The interface language changed: a registered context menu is rewritten with the new language's text (nothing is written if it isn't registered or the text is the same). Test instances don't touch the registry</summary>
    public static void RefreshLabel()
    {
        if (!AppPaths.WritesRegistry || !IsEnabled()) return;
        var label = Label;
        foreach (var path in KeyPaths(Verb))
        {
            using var key = Registry.CurrentUser.OpenSubKey(path, writable: true);
            if (key is not null && key.GetValue(null) as string != label) key.SetValue(null, label);
        }
    }

    /// <summary>Registered, and pointing at this very SnipToss.exe</summary>
    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Classes\Directory\shell\" + Verb + @"\command");
        return key?.GetValue(null) is string cmd && cmd.Contains(Exe, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Every entry registered when the context menu is turned on: key (under HKCU), icon, command</summary>
    /// <param name="more">Settings → Advanced → More formats: also register those file types</param>
    internal static IEnumerable<(string Key, string Icon, string Command)> Entries(string exe, bool more) =>
        // Right-clicking blank space in a folder gives %V (the current folder), otherwise %1 (the clicked file / folder)
        KeyPaths(Verb, MaterialScanner.MenuExtensions(more))
            .Select(path => (path, $"\"{exe}\",0", $"\"{exe}\" \"{(path.Contains(@"\Background\") ? "%V" : "%1")}\""));

    /// <summary>To delete when turning it off (and before re-registering): includes the PDF and PPT entries registered earlier and no longer accepted</summary>
    internal static IEnumerable<string> KeysToRemove() => KeyPaths(Verb, withFormer: true);

    public static void Set(bool enable, bool more)
    {
        RefuseInTestInstance();
        foreach (var path in KeysToRemove())
            Registry.CurrentUser.DeleteSubKeyTree(path, throwOnMissingSubKey: false);
        if (!enable) return;
        foreach (var (path, icon, cmd) in Entries(Exe, more)) Write(path, icon, cmd);
    }

    static void Write(string path, string icon, string cmd)
    {
        using var key = Registry.CurrentUser.CreateSubKey(path);
        key.SetValue(null, Label);
        key.SetValue("Icon", icon);
        using var command = key.CreateSubKey("command");
        command.SetValue(null, cmd);
    }

    /// <summary>
    /// With the context menu on, makes the registered extensions match what should be there: types newly recognized in this version are added
    /// (an earlier version didn't register them, so without an installer upgrade they would be missing forever), and
    /// switching More formats off drops those entries. Runs at startup and when that setting changes; only touches what differs.
    /// Test instances and portable builds don't touch the registry
    /// </summary>
    public static void Sync(bool more)
    {
        if (!AppPaths.WritesRegistry || !IsEnabled()) return;
        var wanted = Entries(Exe, more).ToList();
        var keep = wanted.Select(e => e.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var path in KeysToRemove().Where(p => !keep.Contains(p)))
            Registry.CurrentUser.DeleteSubKeyTree(path, throwOnMissingSubKey: false);
        foreach (var (path, icon, cmd) in wanted)
        {
            using (var existing = Registry.CurrentUser.OpenSubKey(path))
                if (existing is not null) continue;
            Write(path, icon, cmd);
        }
    }

    /// <summary>An old version (pizhu.exe) registered the context menu</summary>
    public static bool HasLegacy()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Classes\Directory\shell\" + LegacyVerb);
        return key is not null;
    }

    public static void RemoveLegacy()
    {
        foreach (var path in KeyPaths(LegacyVerb, withFormer: true))
            Registry.CurrentUser.DeleteSubKeyTree(path, throwOnMissingSubKey: false);
    }

    /// <summary>
    /// Deletes the context menu entries once registered for PDF and PPT (no longer accepted; opening one showed only "supported in a later version"). Runs at startup, only deletes, never adds;
    /// test instances don't touch the registry
    /// </summary>
    public static void RemoveFormer()
    {
        if (!AppPaths.WritesRegistry) return;
        foreach (var ext in MaterialScanner.FormerExtensions)
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\SystemFileAssociations\{ext}\shell\{Verb}", throwOnMissingSubKey: false);
    }
}

static class Shell
{
    /// <summary>Shows it in File Explorer: selects the file, or opens the folder</summary>
    public static void Reveal(string path)
    {
        if (File.Exists(path))
        {
            if (!SelectInFolder(path)) Process.Start("explorer.exe", $"/select,\"{path}\"");
        }
        else if (Directory.Exists(path)) Process.Start("explorer.exe", $"\"{path}\"");
        else throw new FileNotFoundException(Locale.T("shell.notFound", ("path", path)));
    }

    /// <summary>
    /// Opens the file's folder and selects it, via the system API (like Electron's showItemInFolder; if that folder is already open its existing window is used).
    /// It used to use explorer.exe /select, which sometimes opened the window without selecting the file.
    /// The API must be called on an STA thread; this already runs on a background thread (RevealAsync), so a separate one is started and discarded afterwards. Returns false on failure, and the caller falls back to /select
    /// </summary>
    static bool SelectInFolder(string path)
    {
        var ok = false;
        var thread = new Thread(() =>
        {
            if (SHParseDisplayName(path, IntPtr.Zero, out var pidl, 0, out _) != 0) return;
            try
            {
                ok = SHOpenFolderAndSelectItems(pidl, 0, null, 0) == 0;
            }
            finally
            {
                CoTaskMemFree(pidl);
            }
        })
        {
            IsBackground = true,
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return ok;
    }

    /// <summary>
    /// Opens a URL in the default browser (Help, Report a Problem, the download page). Accepts only http / https:
    /// it used to take any path and hand it to the system's "open", which meant the UI could launch any program
    /// </summary>
    public static void OpenUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp))
            throw new ArgumentException($"Only http and https addresses can be opened: {url}");
        Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }
}

/// <summary>Start at login (writes only HKCU Run, needs no administrator rights). With --tray: no window pops up at login, the app waits in the tray and the Screen Capture shortcut works</summary>
static class Autostart
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    /// <summary>The registered name is the technical name and does not change with the language (ADR-0001 item 8)</summary>
    const string Name = "SnipToss";

    /// <summary>The name registered before Beta 55 (the product's Chinese name): still recognized; LegacyMigration swaps it for Name</summary>
    const string FormerName = "\u8d85\u7ea7\u6279\u6ce8"; // 超级批注, the Chinese product name, written as escapes: it isn't UI text, and scripts/check-i18n.mjs shouldn't count it

    static string Exe => Environment.ProcessPath ?? throw new InvalidOperationException("Cannot get the program path");

    static string? Command(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(name) as string;
    }

    public static bool IsOn() =>
        new[] { Name, FormerName }.Any(n => Command(n) is { } cmd && cmd.Contains(Exe, StringComparison.OrdinalIgnoreCase));

    public static void Set(bool on)
    {
        ShellIntegration.RefuseInTestInstance();
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        key.DeleteValue(FormerName, throwOnMissingValue: false);
        if (on) key.SetValue(Name, $"\"{Exe}\" --tray");
        else key.DeleteValue(Name, throwOnMissingValue: false);
    }

    /// <summary>
    /// Autostart is on but registers the pizhu.exe from before the rename, or uses an earlier name (FormerName): LegacyMigration replaces it with the current program and the current name
    /// </summary>
    public static bool NeedsMigration() =>
        Command(Name) is { } cmd && IsLegacyCommand(cmd) || Command(FormerName) is not null;

    internal static bool IsLegacyCommand(string cmd) =>
        cmd.Contains($@"\{AppPaths.LegacyDirName}.exe", StringComparison.OrdinalIgnoreCase);
}

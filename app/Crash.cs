using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// Global safety net (any uncaught exception used to crash the app with nothing left behind):
/// - everything is written to the log (Log)
/// - on the UI thread: show the error window and keep going if possible; if errors repeat in a short time, offer only "Restart / Exit"
/// - on a background thread (the process is about to end): write a crash dump and show a message saying where the log is
/// </summary>
static class Crash
{
    /// <summary>Installed as soon as the process starts: AppDomain and Task handlers, independent of any window</summary>
    public static void InstallEarly()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Fatal(e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("Background task failed and nobody handled it", e.Exception);
            e.SetObserved();
        };
    }

    /// <summary>Installed once Application exists: exceptions on the UI thread</summary>
    public static void Install(Application app) =>
        app.DispatcherUnhandledException += (_, e) =>
        {
            e.Handled = true;
            OnUiError(e.Exception);
        };

    static readonly Queue<DateTime> recent = new();
    static bool showing;

    /// <summary>Cleanup to do before ending the process directly (the error window's Exit / Restart): the main window saves its position, the tray icon and global hotkeys are released</summary>
    public static Action? BeforeExit { get; set; }

    static void Exit(int code)
    {
        try
        {
            BeforeExit?.Invoke();
        }
        catch (Exception ex)
        {
            Log.Warn("Cleanup before exit failed", ex);
        }
        Environment.Exit(code);
    }

    static void OnUiError(Exception ex)
    {
        Log.Error("UI thread error", ex);
        var now = DateTime.Now;
        recent.Enqueue(now);
        while (recent.Count > 0 && now - recent.Peek() > TimeSpan.FromSeconds(10)) recent.Dequeue();
        if (showing) return; // another error while the error window is open: logging is enough
        showing = true;
        try
        {
            var dialog = new CrashDialog(ex, repeated: recent.Count >= 3);
            dialog.ShowDialog();
            switch (dialog.Choice)
            {
                case CrashDialog.Result.Restart:
                    Restart();
                    break;
                case CrashDialog.Result.Quit:
                    Exit(1);
                    break;
            }
        }
        catch (Exception again)
        {
            Log.Error("The error window itself failed", again);
        }
        finally
        {
            showing = false;
        }
    }

    static void Fatal(Exception? ex)
    {
        Log.Error("App crashed (unhandled exception), exiting now", ex);
        var dump = WriteMiniDump();
        try
        {
            // A system message box also works from a background thread. It only tells the user to attach the log (the user name is removed before the log is written, see Log.Write); the crash dump carries the program's memory (possibly notes and paths),
            // and issue reports get pasted on public GitHub, so the message doesn't mention it; it stays in the log folder and the maintainer asks for it separately when needed
            MessageBox.Show(
                Locale.T("shell.crash.fatal", ("app", MainWindow.AppName), ("log", Log.CurrentFile)),
                MainWindow.AppName, MessageBoxButton.OK, MessageBoxImage.Error);
        }
        catch
        {
            // Not even the message box could be shown: the log already has it
        }
    }

    /// <summary>Restart: release the single-instance lock first, so the new process doesn't take itself for a "second window" and hand off to the one that is exiting</summary>
    public static void Restart()
    {
        try
        {
            SingleInstance.Release();
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false });
        }
        catch (Exception ex)
        {
            Log.Error("Restart failed", ex);
        }
        Exit(0);
    }

    /// <summary>
    /// Diagnostic info for the user to copy and attach to an issue report. Same as the UI's "Copy diagnostic info" (diagnostics.ts): always English so anyone can read any report;
    /// no Windows user name (reports get pasted on public GitHub), and the user directory in exception paths is replaced with %USERPROFILE%.
    /// The labels used to be Chinese and carried the full path of the log file
    /// </summary>
    public static string Diagnostics(Exception? ex) =>
        $"""
        {AppPaths.DirName} {AppVersion.Text}
        OS: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture}) · .NET {Environment.Version}
        Time: {DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss zzz", CultureInfo.InvariantCulture)}

        {Scrub(ex?.ToString() ?? "")}
        """;

    /// <summary>Replaces the user directory (C:\Users\name) with %USERPROFILE%; where the user name appears in other paths (Users\name on another drive) that segment becomes &lt;user&gt;</summary>
    internal static string Scrub(string text)
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (profile.Length > 3) text = text.Replace(profile, "%USERPROFILE%", StringComparison.OrdinalIgnoreCase);
        var user = Environment.UserName;
        if (user.Length > 0)
            text = System.Text.RegularExpressions.Regex.Replace(text, $@"(?<=[\\/]){System.Text.RegularExpressions.Regex.Escape(user)}(?=[\\/]|$)", "<user>",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Multiline);
        return text;
    }

    /// <summary>"Copy diagnostic info" (error window, notice page): if another program holds the clipboard the copy fails, so the button says "Copy failed" rather than letting the user think it worked (it used to only log)</summary>
    public static bool CopyDiagnostics(Exception ex)
    {
        try
        {
            Clipboard.SetText(Diagnostics(ex));
            return true;
        }
        catch (Exception clip)
        {
            Log.Warn("Copying the diagnostic info failed", clip);
            return false;
        }
    }

    public static void OpenLogFolder()
    {
        try
        {
            Directory.CreateDirectory(Log.Dir);
            Process.Start("explorer.exe", $"\"{Log.Dir}\"");
        }
        catch (Exception ex)
        {
            Log.Warn("Could not open the log folder", ex);
        }
    }

    // ---------- Crash dump: kept in the log directory, the latest 3 (Log's cleanup deletes anything older than 7 days) ----------

    static string? WriteMiniDump()
    {
        try
        {
            Directory.CreateDirectory(Log.Dir);
            foreach (var old in new DirectoryInfo(Log.Dir).GetFiles("crash-*.dmp").OrderByDescending(f => f.LastWriteTime).Skip(2))
                old.Delete();
            var path = Path.Combine(Log.Dir, $"crash-{DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture)}.dmp");
            using var file = new FileStream(path, FileMode.Create, FileAccess.Write);
            using var self = Process.GetCurrentProcess();
            // Threads, stacks and the memory the stacks reference: a few MB, enough to see where it crashed
            const uint type = 0x00000001 /* WithDataSegs */ | 0x00000040 /* WithIndirectlyReferencedMemory */ | 0x00001000 /* WithThreadInfo */;
            return MiniDumpWriteDump(self.Handle, (uint)self.Id, file.SafeFileHandle, type, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero) ? path : null;
        }
        catch (Exception ex)
        {
            Log.Warn("Writing the crash dump failed", ex);
            return null;
        }
    }
}

/// <summary>The error window (an uncaught exception on the UI thread). See NativeUi for how it looks</summary>
sealed class CrashDialog : Window
{
    public enum Result { Continue, Restart, Quit }

    public Result Choice { get; private set; } = Result.Continue;

    public CrashDialog(Exception ex, bool repeated)
    {
        Title = MainWindow.AppName;
        Width = 520;
        SizeToContent = SizeToContent.Height;
        ResizeMode = ResizeMode.NoResize;
        if (Application.Current?.MainWindow is { IsVisible: true } owner && owner != this)
        {
            Owner = owner;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
        }
        else
        {
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
        Background = NativeUi.Surface2;
        Topmost = true;
        ShowInTaskbar = Owner is null;
        FontFamily = NativeUi.UiFont;
        FontSize = 13;
        Foreground = NativeUi.Text;

        var root = new StackPanel { Margin = new Thickness(24, 20, 24, 20) };
        root.Children.Add(NativeUi.Title(Locale.T(repeated ? "shell.error.titleRepeated" : "shell.error.title")));
        root.Children.Add(NativeUi.Body(Locale.T(repeated ? "shell.error.bodyRepeated" : "shell.error.body")));
        root.Children.Add(NativeUi.Detail($"{ex.GetType().Name}: {ex.Message}"));

        var buttons = new ButtonRow();
        buttons.Children.Add(NativeUi.CopyDiagnosticsButton(ex, Dock.Left));
        buttons.Children.Add(NativeUi.MakeButton(Locale.T("app.error.openLog"), false, _ => Crash.OpenLogFolder(), Dock.Left));
        if (repeated)
        {
            buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.exit"), false, _ => Close(Result.Quit), Dock.Right));
            buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.restart"), true, _ => Close(Result.Restart), Dock.Right));
        }
        else
        {
            buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.continue"), true, _ => Close(Result.Continue), Dock.Right));
            buttons.Children.Add(NativeUi.MakeButton(Locale.T("shell.button.restart"), false, _ => Close(Result.Restart), Dock.Right));
        }
        root.Children.Add(buttons);
        Content = root;
        // Esc is the same as ×: ignore the error this time and keep using the app (Esc used to do nothing)
        PreviewKeyDown += (_, e) =>
        {
            if (e.Key != System.Windows.Input.Key.Escape) return;
            e.Handled = true;
            Close();
        };
        SourceInitialized += (_, _) => DarkChrome.Apply(this, Color.FromRgb(0x23, 0x23, 0x27));
    }

    void Close(Result r)
    {
        Choice = r;
        Close();
    }
}


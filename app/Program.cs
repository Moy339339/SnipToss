using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows;
using static SnipToss.App.Native;

namespace SnipToss.App;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Installed first: any uncaught exception after this goes into the log (Crash)
        Crash.InstallEarly();
        // Called by the setup wizard and the uninstaller (SetupCommand): does its work and exits, opens no window, hands nothing to a running instance
        if (SetupCommand.Of(args) is { } setup)
        {
            Environment.ExitCode = SetupCommand.Run(setup);
            return;
        }
        // --tray: used by autostart at login; no window pops up, it just waits in the tray (the Screen Capture hotkey works)
        var toTray = args.Contains("--tray");
        args = args.Where(a => a != "--tray").Select(ArgPath).ToArray();
        // SnipToss.exe <file or folder>...: add to the library and locate it. If the app is already running, hand over to that window and exit
        if (SingleInstance.ForwardToRunning(args, toTray)) return;
        // Once we're the "first", start receiving paths forwarded by other processes right away, queued until the window is built. It used to listen only after the window was built: when File Explorer opens a multi-selection through the context menu it starts several processes at once,
        // and with a slow cold start the other processes couldn't connect in 3 seconds and opened a window of their own
        SingleInstance.Listen();
        Log.Info($"Starting {AppVersion.Text} · {RuntimeInformation.OSDescription} · .NET {Environment.Version}{(toTray ? " · tray" : "")}");
        // First start after the rename (pizhu → SnipToss): the old settings must be moved over before the settings are read (the MainWindow constructor)
        LegacyMigration.MigrateAppData();
        LegacyMigration.MigrateRegistry();
        try
        {
            ShellIntegration.RemoveFormer();
            ShellIntegration.Sync(ShellIntegration.MoreFormatsSetting());
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            Log.Warn("Failed to tidy the context menu registration (deleting what was registered for PDF and PPT earlier, adding the extensions recognized newly in this version)", ex);
        }
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        Crash.Install(app);
        var window = new MainWindow(args) { StartedInTray = toTray };
        // Shutdown or logoff: with "keep in the tray when the window is closed" on, closing the window is intercepted; here it must really exit, otherwise Windows says "this app is preventing shutdown"
        app.SessionEnding += (_, _) => window.PrepareForSessionEnd();
        SingleInstance.Deliver(a => window.Dispatcher.InvokeAsync(() =>
        {
            // The uninstaller is about to delete the program files: really quit, don't hide to the tray
            if (SingleInstance.IsQuit(a))
            {
                Log.Info("The uninstaller asked this window to quit");
                window.Quit();
            }
            else
            {
                window.OpenFromOutside(a);
            }
        }));
        if (toTray)
        {
            // The window handle must be created even when not shown: the hotkey and the tray hang off SourceInitialized
            app.MainWindow = window;
            new System.Windows.Interop.WindowInteropHelper(window).EnsureHandle();
            app.Run();
        }
        else
        {
            app.Run(window);
        }
        Log.Info("Exit");
    }

    /// <summary>
    /// One path from the command line. When right-clicking blank space at a drive root (E:\, a USB stick's root) and choosing Open with SnipToss, the command is "exe" "E:\":
    /// Windows parses \" in the command line as an escaped quote, so the program receives E:" (it used to say "invalid path"). A path never contains quotes, so trailing ones are removed; a lone E: gets the \ added back
    /// (without it, it would mean "the current folder on drive E")
    /// </summary>
    internal static string ArgPath(string arg)
    {
        if (!arg.EndsWith('"')) return arg;
        var path = arg.TrimEnd('"');
        return path.Length == 2 && path[1] == ':' ? path + "\\" : path;
    }
}

/// <summary>
/// Only one window: when the app is already open and "Open with SnipToss" is used from the right-click menu, the path is forwarded to the open one, so there is only one library.
/// "One" is counted per settings file (test instances with SNIPTOSS_SETTINGS pointing elsewhere each count separately).
/// The pipe accepts only the current user (CurrentUserOnly); a message is at most 1 MB and must be read within 3 seconds, so a stuck peer can't hang the listening thread
/// </summary>
static class SingleInstance
{
    static readonly string Id = IdFor(Settings.Location);

    /// <summary>Computed from the settings file path (case-insensitive): one window per settings file</summary>
    internal static string IdFor(string settingsPath) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(settingsPath.ToLowerInvariant())))[..16];
    static string PipeName => $"{AppPaths.DirName}-{Id}";
    static Mutex? mutex;

    internal const int MaxMessageBytes = 1 << 20;
    internal static readonly TimeSpan ReadTimeout = TimeSpan.FromSeconds(3);

    /// <param name="quiet">Autostart (--tray) ran into one that is already open: nothing to forward, just exit</param>
    public static bool ForwardToRunning(string[] args, bool quiet = false)
    {
        mutex = new Mutex(true, $@"Local\{PipeName}", out var first);
        if (first) return false;
        if (quiet) return true;
        try
        {
            // Let the open window bring itself to the foreground (Windows only lets "the process that was just operated by the user" grab the foreground)
            AllowSetForegroundWindow(-1);
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.CurrentUserOnly);
            // The first process starts listening right after getting the lock, so a connection normally succeeds within a few hundred milliseconds; when a dozen processes start at once and the machine is busy, wait longer
            pipe.Connect(5000);
            pipe.Write(JsonSerializer.SerializeToUtf8Bytes(args.Select(FullPathOrRaw).ToArray()));
            return true;
        }
        catch (Exception ex) when (ex is IOException or TimeoutException or UnauthorizedAccessException)
        {
            Log.Warn("Could not reach the window that is already open; opening one ourselves", ex);
            return false; // can't reach it (e.g. it is exiting): open a window ourselves
        }
    }

    /// <summary>"Please quit": forwarded by the uninstaller (AskRunningToQuit). A path never contains NUL, so it can't be confused with something to open</summary>
    const string QuitMessage = "\0quit";

    public static bool IsQuit(string[] args) => args is [QuitMessage];

    /// <summary>
    /// Before the uninstaller deletes the program files (SetupCommand's --uninstall-cleanup): asks the running instance (same settings) to quit by itself, and waits until it has.
    /// On an upgrade the installer closes it with the system Restart Manager; the uninstaller doesn't: uninstalling while the app was open left it running and the install directory not fully deleted.
    /// What it waits for is the lock it holds (the system releases it when the process exits). Returns true if none was running or it has quit; false if it couldn't be reached or hasn't quit within timeout
    /// </summary>
    public static bool AskRunningToQuit(TimeSpan timeout)
    {
        if (!Mutex.TryOpenExisting($@"Local\{PipeName}", out var running)) return true;
        using (running)
        {
            try
            {
                using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.CurrentUserOnly);
                pipe.Connect((int)timeout.TotalMilliseconds);
                pipe.Write(JsonSerializer.SerializeToUtf8Bytes(new[] { QuitMessage }));
            }
            catch (Exception ex) when (ex is IOException or TimeoutException or UnauthorizedAccessException)
            {
                Log.Warn("Could not reach the open window, so can't ask it to quit", ex);
                return false;
            }
            try
            {
                if (!running.WaitOne(timeout)) return false;
            }
            catch (AbandonedMutexException)
            {
                // The process exited without releasing the lock (that is what a normal exit does), and the lock came to us: equivalent to it having quit
            }
            running.ReleaseMutex();
            return true;
        }
    }

    /// <summary>Released before a restart, so the new process can be the "first"</summary>
    public static void Release()
    {
        try
        {
            mutex?.ReleaseMutex();
        }
        catch (ApplicationException)
        {
            // Not a lock taken by this thread: the system releases it when the process exits
        }
        mutex?.Dispose();
        mutex = null;
    }

    /// <summary>If the path can't be normalized (illegal characters etc.) it is forwarded as is, and the other side's Library.Add reports "invalid path"</summary>
    static string FullPathOrRaw(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return path;
        }
    }

    static readonly ArgsInbox Inbox = new();

    /// <summary>The window is built: paths queued earlier are handed to it in order, and later ones are delivered directly</summary>
    public static void Deliver(Action<string[]> onArgs) => Inbox.SetHandler(onArgs);

    public static void Listen()
    {
        var thread = new Thread(() =>
        {
            var failures = 0;
            while (true)
            {
                try
                {
                    using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    failures = 0;
                    pipe.WaitForConnection();
                    Inbox.Post(ReadMessage(pipe, MaxMessageBytes, ReadTimeout));
                }
                catch (Exception ex)
                {
                    // The peer disconnected midway, sent bad data, too large, too slow: log it and wait for the next one. The thread must not die, otherwise every later open would start a window of its own.
                    // For consecutive failures (usually another window holds the pipe: it couldn't be reached and we opened a window ourselves) log only the first, waiting longer each time, at most 5 seconds;
                    // it used to log an entry with a stack trace every 50 ms
                    if (++failures == 1) Log.Warn("Single instance: the forwarded message was not received", ex);
                    Thread.Sleep(Math.Min(5000, 50 << Math.Min(failures, 7)));
                }
            }
        })
        { IsBackground = true, Name = "Single-instance listener" };
        thread.Start();
    }

    /// <summary>Reads one forwarded message (a JSON array of strings): gives up if it exceeds maxBytes or isn't fully read within timeout</summary>
    internal static string[] ReadMessage(Stream stream, int maxBytes, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        while (true)
        {
            var n = stream.ReadAsync(chunk, cts.Token).AsTask().GetAwaiter().GetResult();
            if (n == 0) break;
            buffer.Write(chunk, 0, n);
            if (buffer.Length > maxBytes) throw new InvalidDataException($"Message exceeds {maxBytes} bytes");
        }
        // Connected and hung up without saying anything: treat it as carrying no paths (it only brings the window to the front)
        if (buffer.Length == 0) return [];
        return JsonSerializer.Deserialize<string[]>(buffer.ToArray())?.Where(a => a is not null).ToArray() ?? [];
    }
}

/// <summary>Paths forwarded from other processes: queued while the handler (the window) isn't built yet, and passed over in order of arrival once it is</summary>
sealed class ArgsInbox
{
    readonly Lock gate = new();
    readonly List<string[]> queued = [];
    Action<string[]>? handler;

    public void Post(string[] args)
    {
        // The handoff action (Dispatcher.InvokeAsync) doesn't block; doing it inside the lock keeps the order
        lock (gate)
        {
            if (handler is null) queued.Add(args);
            else handler(args);
        }
    }

    public void SetHandler(Action<string[]> onArgs)
    {
        lock (gate)
        {
            handler = onArgs;
            foreach (var args in queued) onArgs(args);
            queued.Clear();
        }
    }
}

/// <summary>
/// Things opened from outside (command line, context menu, forwarded from another process) while the UI isn't listening are queued: the UI isn't built yet, the page is loading, or the page must reload (new drive).
/// What's queued is the location, the notes on what wasn't added, and recognized moved items. The page loaded this time takes them the first time it reads the library, and from then on it listens for libraryChanged;
/// later reads of the list don't take them: when the page is to be reloaded the old page may still read the list once, and that read used to take away what was queued for the new page and lose it
/// </summary>
sealed class PendingOpens
{
    string? focus;
    readonly List<string> skipped = [];
    readonly List<Library.Relocation> relocated = [];

    /// <summary>The page loaded this time has read the library: the libraryChanged listener is attached by now, so a push won't be lost</summary>
    public bool Listening { get; private set; }

    public void Stash(Library.AddResult r)
    {
        focus = r.Focus ?? focus;
        skipped.AddRange(r.Skipped);
        relocated.AddRange(r.Relocated ?? []);
    }

    /// <summary>The page starts navigating (reload, reload after the UI process crashed): the new page isn't listening yet</summary>
    public void Navigating() => Listening = false;

    public (string? Focus, List<string> Skipped, List<Library.Relocation> Relocated) Take()
    {
        if (Listening) return (null, [], []);
        Listening = true;
        var r = (focus, skipped.ToList(), relocated.ToList());
        focus = null;
        skipped.Clear();
        relocated.Clear();
        return r;
    }
}

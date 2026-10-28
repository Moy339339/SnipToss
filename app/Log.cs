using System.Globalization;
using System.IO;
using System.Text;

namespace SnipToss.App;

/// <summary>
/// Log: %LOCALAPPDATA%\SnipToss\logs\SnipToss-YYYYMMDD.log, kept for 7 days. Look here first when something goes wrong (it can be opened from the Help menu and the error window).
/// Logging itself never throws: if it can't write, it gives up; logging must not crash the program.
/// Before writing, the user directory is replaced with %USERPROFILE% and the user name in paths with &lt;user&gt; (Crash.Scrub): the error window and the notice page tell users to attach the log to an issue report,
/// and reports get pasted on public GitHub (same rule as "Copy diagnostic info")
/// </summary>
static class Log
{
    static readonly object Gate = new();
    static readonly UTF8Encoding Utf8NoBom = new(false);
    /// <summary>The day cleanup last ran: it runs again when the day changes (the app stays in the tray for weeks without restarting, and cleaning only on the process's first log write left logs older than 7 days in place)</summary>
    static DateOnly cleanedOn;

    /// <summary>Log directory. Tests change it to a temp directory</summary>
    internal static string Dir { get; set; } = AppPaths.LogDir;

    public static string CurrentFile =>
        Path.Combine(Dir, $"{AppPaths.DirName}-{DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}.log");

    public static void Info(string message) => Write("INFO", message, null);

    public static void Warn(string message, Exception? ex = null) => Write("WARN", message, ex);

    public static void Error(string message, Exception? ex = null) => Write("ERROR", message, ex);

    static void Write(string level, string message, Exception? ex)
    {
        var line = $"{DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss.fff zzz", CultureInfo.InvariantCulture)} [{level}] {message}";
        if (ex is not null) line += Environment.NewLine + ex;
        line = Crash.Scrub(line);
        System.Diagnostics.Debug.WriteLine(line);
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Dir);
                var today = DateOnly.FromDateTime(DateTime.Now);
                if (cleanedOn != today)
                {
                    cleanedOn = today;
                    CleanOld();
                }
                // Allow other processes to append at the same time (e.g. old and new processes handing over during an update), and let the user keep the log open while reading
                using var stream = new FileStream(CurrentFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                var bytes = Utf8NoBom.GetBytes(line + Environment.NewLine);
                stream.Write(bytes);
            }
        }
        catch
        {
            // Nowhere else left to report to
        }
    }

    /// <summary>Logs and crash dumps are kept for 7 days</summary>
    internal static void CleanOld()
    {
        var before = DateTime.Now.AddDays(-7);
        foreach (var pattern in new[] { "*.log", "*.dmp" })
        foreach (var f in Directory.EnumerateFiles(Dir, pattern))
        {
            try
            {
                if (File.GetLastWriteTime(f) < before) File.Delete(f);
            }
            catch
            {
                // In use: delete it next time
            }
        }
    }
}

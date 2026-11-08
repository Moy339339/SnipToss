using System.Diagnostics;
using System.Globalization;
using System.Windows.Threading;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// Hang watchdog: when the UI thread stops responding (after 5 seconds Windows calls the window "not responding"), the log records how long it was stuck,
/// whether it was busy or waiting, and where it was (HangReport, read from a separate process). A freeze can then be reported with the log or the diagnostics package
/// (Help → Export Diagnostics Package…). While all is well it costs next to nothing: a background thread has the UI thread run an empty step once a second;
/// the stack is only read once the UI thread has been stuck for Threshold
/// </summary>
static class HangWatch
{
    /// <summary>Stuck this long counts as a hang. Shorter than the 5 seconds after which Windows offers to close the program, so the report is written before that</summary>
    internal static readonly TimeSpan Threshold = TimeSpan.FromSeconds(3);

    static readonly TimeSpan Period = TimeSpan.FromSeconds(1);

    /// <summary>At most this many stack reads per run: something that keeps stalling gets a line per stall in the log, but not a new process each time</summary>
    const int MaxReports = 3;

    /// <summary>Stopwatch timestamp of the last check the UI thread ran (0 = none yet)</summary>
    static long answered;

    /// <summary>Call on the UI thread once it is up (the thread it is called on is the one watched)</summary>
    public static void Start(Dispatcher dispatcher)
    {
        // Stopping at a breakpoint is not a hang
        if (Debugger.IsAttached) return;
        var uiThread = GetCurrentThreadId();
        // Only for reading how much CPU the UI thread used while stuck (running in a loop, or waiting on something); kept for the life of the process
        var handle = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, false, uiThread);
        new Thread(() => Run(dispatcher, uiThread, handle)) { IsBackground = true, Name = "Hang watchdog" }.Start();
    }

    static void Run(Dispatcher dispatcher, uint uiThread, IntPtr handle)
    {
        var detector = new HangDetector(Threshold, Period);
        var start = Stopwatch.GetTimestamp();
        var check = new Action(() => Volatile.Write(ref answered, Stopwatch.GetTimestamp()));
        TimeSpan? cpuAtCheck = null;
        var reports = 0;
        while (!dispatcher.HasShutdownStarted)
        {
            var at = Volatile.Read(ref answered);
            var step = detector.Next(Stopwatch.GetElapsedTime(start), at == 0 ? null : Stopwatch.GetElapsedTime(start, at));
            switch (step.Kind)
            {
                case HangDetector.Kind.Check:
                    cpuAtCheck = Cpu(handle);
                    dispatcher.BeginInvoke(DispatcherPriority.Send, check);
                    break;
                case HangDetector.Kind.Hang:
                    var reading = ++reports <= MaxReports;
                    Log.Warn($"The UI thread has not responded for {Seconds(step.For)} s ({Busy(Cpu(handle) - cpuAtCheck, step.For)})"
                        + (reading ? "; reading where it is stuck" : $"; already read {MaxReports} times this run, not again"));
                    if (reading) HangReport.Start(uiThread);
                    break;
                case HangDetector.Kind.Back:
                    Log.Info($"The UI thread responded again after {Seconds(step.For)} s");
                    break;
            }
            Thread.Sleep(Period);
        }
    }

    static TimeSpan? Cpu(IntPtr thread) =>
        thread != IntPtr.Zero && GetThreadTimes(thread, out _, out _, out var kernel, out var user) ? TimeSpan.FromTicks(kernel + user) : null;

    /// <summary>Most of the time on the CPU = running code (a loop, heavy work); hardly any = waiting (on a lock, another program, a reply that does not come)</summary>
    internal static string Busy(TimeSpan? cpu, TimeSpan stuck) => cpu switch
    {
        null => "CPU time unknown",
        { } c when c.TotalSeconds >= stuck.TotalSeconds / 2 => $"busy: {Seconds(c)} s of CPU",
        { } c => $"waiting: {Seconds(c)} s of CPU",
    };

    static string Seconds(TimeSpan t) => t.TotalSeconds.ToString("0.0", CultureInfo.InvariantCulture);
}

/// <summary>
/// The watchdog's decisions, apart from the thread and the clock so they can be tested (tests/AppTests/HangWatchTests.cs).
/// One check is out at a time: it is sent, the UI thread runs it and notes when (answeredAt); a check still not run after threshold is a hang, reported once,
/// and when it does run the hang is over (Back, with how long it lasted)
/// </summary>
sealed class HangDetector(TimeSpan threshold, TimeSpan period)
{
    public enum Kind
    {
        /// <summary>Send a new check to the UI thread</summary>
        Check,
        /// <summary>The check is out and not run yet, still under the threshold</summary>
        Wait,
        /// <summary>The check has not run for threshold: report the hang (once per hang)</summary>
        Hang,
        /// <summary>The check of a reported hang has run: For is how long the UI thread was stuck</summary>
        Back,
    }

    public readonly record struct Step(Kind Kind, TimeSpan For);

    TimeSpan? sentAt;
    TimeSpan? lastStep;
    bool reported;

    /// <param name="now">A monotonic clock</param>
    /// <param name="answeredAt">When the UI thread last ran a check, on the same clock (null = never)</param>
    public Step Next(TimeSpan now, TimeSpan? answeredAt)
    {
        var paused = lastStep is { } last && now - last > period * 3;
        lastStep = now;
        if (sentAt is { } sent)
        {
            if (answeredAt is not { } a || a < sent)
            {
                // This thread itself did not run for a while (the computer slept, the process was paused): the UI thread isn't to blame for that time, count again from now.
                // Only for a check not run yet: one already run is simply followed by the next
                if (paused && !reported) sentAt = sent = now;
                if (reported || now - sent < threshold) return new(Kind.Wait, now - sent);
                reported = true;
                return new(Kind.Hang, now - sent);
            }
            sentAt = null;
            if (reported)
            {
                reported = false;
                return new(Kind.Back, a - sent);
            }
        }
        sentAt = now;
        return new(Kind.Check, TimeSpan.Zero);
    }
}

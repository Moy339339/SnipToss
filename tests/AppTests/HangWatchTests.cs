using SnipToss.App;
using Kind = SnipToss.App.HangDetector.Kind;

namespace AppTests;

/// <summary>
/// The hang watchdog's decisions (HangDetector), its wording, and the hang report's command line (HangReport.Of).
/// Reading a real stuck UI thread (another process, the stack, the names) is tested in the real-shell tests (tests/shell/hang.spec.ts)
/// </summary>
public class HangWatchTests
{
    static readonly TimeSpan Threshold = TimeSpan.FromSeconds(3), Period = TimeSpan.FromSeconds(1);

    static TimeSpan S(double seconds) => TimeSpan.FromSeconds(seconds);

    [Fact]
    public void A_UI_thread_that_runs_every_check_is_never_reported()
    {
        var d = new HangDetector(Threshold, Period);
        TimeSpan? answered = null;
        for (var t = 0; t < 30; t++)
        {
            Assert.Equal(Kind.Check, d.Next(S(t), answered).Kind);
            answered = S(t + 0.01);
        }
    }

    [Fact]
    public void A_check_not_run_for_the_threshold_is_one_hang_and_running_it_ends_the_hang_with_how_long_it_lasted()
    {
        var d = new HangDetector(Threshold, Period);
        Assert.Equal(Kind.Check, d.Next(S(0), null).Kind);
        Assert.Equal(new HangDetector.Step(Kind.Wait, S(1)), d.Next(S(1), null));
        Assert.Equal(Kind.Wait, d.Next(S(2), null).Kind);
        Assert.Equal(new HangDetector.Step(Kind.Hang, S(3)), d.Next(S(3), null));
        // Reported once, however long it goes on
        for (var t = 4; t < 20; t++) Assert.Equal(Kind.Wait, d.Next(S(t), null).Kind);
        Assert.Equal(new HangDetector.Step(Kind.Back, S(19.5)), d.Next(S(20), S(19.5)));
        Assert.Equal(Kind.Check, d.Next(S(21), S(19.5)).Kind);
    }

    [Fact]
    public void A_stall_shorter_than_the_threshold_is_neither_a_hang_nor_a_recovery()
    {
        var d = new HangDetector(Threshold, Period);
        d.Next(S(0), null);
        d.Next(S(1), null);
        d.Next(S(2), null);
        Assert.Equal(Kind.Check, d.Next(S(3), S(2.9)).Kind);
    }

    [Fact]
    public void After_the_watchdog_itself_was_paused_with_a_check_out_the_count_starts_again()
    {
        // The computer slept for an hour: the UI thread runs the check as soon as it wakes, and must not be reported for the hour
        var d = new HangDetector(Threshold, Period);
        d.Next(S(0), null);
        Assert.Equal(new HangDetector.Step(Kind.Wait, TimeSpan.Zero), d.Next(S(3600), null));
        Assert.Equal(Kind.Wait, d.Next(S(3601), null).Kind);
        Assert.Equal(Kind.Check, d.Next(S(3602), S(3600.2)).Kind);
        // Still not run 3 seconds after waking: that is a hang
        d.Next(S(3603), null);
        Assert.Equal(new HangDetector.Step(Kind.Hang, S(3)), d.Next(S(3605), null));
    }

    [Fact]
    public void After_the_watchdog_was_paused_with_the_check_already_run_the_next_check_follows()
    {
        // It used to restart the count without sending a check, and with nothing left to run it reported a hang 3 seconds after waking
        var d = new HangDetector(Threshold, Period);
        d.Next(S(0), null);
        Assert.Equal(Kind.Check, d.Next(S(3600), S(0.01)).Kind);
        Assert.Equal(Kind.Check, d.Next(S(3601), S(3600.01)).Kind);
    }

    [Fact]
    public void A_hang_that_goes_on_while_the_watchdog_is_paused_is_still_one_hang()
    {
        var d = new HangDetector(Threshold, Period);
        d.Next(S(0), null);
        d.Next(S(1), null);
        d.Next(S(2), null);
        Assert.Equal(Kind.Hang, d.Next(S(3), null).Kind);
        Assert.Equal(Kind.Wait, d.Next(S(60), null).Kind);
        Assert.Equal(new HangDetector.Step(Kind.Back, S(61)), d.Next(S(62), S(61)));
    }

    [Theory]
    [InlineData(2.9, 3.0, "busy: 2.9 s of CPU")]
    [InlineData(1.5, 3.0, "busy: 1.5 s of CPU")]
    [InlineData(0.02, 3.0, "waiting: 0.0 s of CPU")]
    public void The_log_says_whether_the_UI_thread_was_busy_or_waiting(double cpu, double stuck, string expected) =>
        Assert.Equal(expected, HangWatch.Busy(S(cpu), S(stuck)));

    [Fact]
    public void Without_the_CPU_time_the_log_says_so() => Assert.Equal("CPU time unknown", HangWatch.Busy(null, S(3)));

    [Fact]
    public void The_hang_report_command_takes_exactly_a_process_and_a_thread_id()
    {
        Assert.Equal((1234, 5678u), HangReport.Of(["--hang-report", "1234", "5678"]));
        Assert.Null(HangReport.Of(["--hang-report", "1234"]));
        Assert.Null(HangReport.Of(["--hang-report", "1234", "5678", @"E:\assets"]));
        Assert.Null(HangReport.Of(["--hang-report", "-1", "5678"]));
        Assert.Null(HangReport.Of(["--hang-report", "12a", "5678"]));
        Assert.Null(HangReport.Of([@"E:\assets\hero.png"]));
    }
}

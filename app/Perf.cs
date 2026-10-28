using System.Globalization;
using System.IO;

namespace SnipToss.App;

/// <summary>
/// Recording for the performance budget (1.0 acceptance criteria: startup, and pressing the hotkey until the capture overlay appears): when the environment variable SNIPTOSS_PERF_LOG points at a file a line is appended,
/// otherwise nothing happens. scripts / tests/perf read these numbers
/// </summary>
static class Perf
{
    static readonly string? File = Environment.GetEnvironmentVariable("SNIPTOSS_PERF_LOG");

    public static void Record(string line)
    {
        if (File is null) return;
        try
        {
            System.IO.File.AppendAllText(File, string.Create(CultureInfo.InvariantCulture, $"{DateTime.Now:O} {line}\n"));
        }
        catch (IOException)
        {
            // If it can't be recorded, never mind
        }
    }
}

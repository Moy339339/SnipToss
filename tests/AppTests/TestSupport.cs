using System.IO;
using System.Runtime.CompilerServices;
using SnipToss.App;

namespace AppTests;

static class TestSupport
{
    /// <summary>
    /// Tests write their log to a temp directory so it does not mix into the user's own log. The language is pinned to Chinese:
    /// "follow system" would read the display language of the machine running the tests (not necessarily Chinese),
    /// and the expected values are written in Chinese. Use Locale.In for any other language
    /// </summary>
    [ModuleInitializer]
    internal static void Init()
    {
        Log.Dir = Path.Combine(Path.GetTempPath(), "app-tests-logs");
        Locale.Use(Locale.Source);
    }
}

/// <summary>One temp directory per test, deleted afterwards</summary>
sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "app-tests", Guid.NewGuid().ToString("N"));

    public TempDir() => Directory.CreateDirectory(Path);

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch
        {
            // A file the test deliberately keeps open may not be released yet
        }
    }
}

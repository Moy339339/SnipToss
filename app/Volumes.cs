using System.Collections.Concurrent;
using System.IO;

namespace SnipToss.App;

/// <summary>
/// Whether the drive an item is on (a drive-letter root E:\, a network share root \\server\share) is connected. A disconnected network drive or a sleeping NAS makes a query wait for the system timeout, ten-odd seconds or more:
/// it used to be queried on the UI thread at startup, and with one entry of the list on it the window waited ten-odd seconds in vain; reading the list, scanning and the background check for item changes all waited entry by entry too.
/// Here the query runs in the background, only once at a time per drive, with the answer remembered for a short while; a caller waits only a moment (Patience), and what hasn't answered counts as not connected for now.
/// No notification here when a drive comes back: the background check for item changes (MaterialWatcher) sees that entry change from "not connected" and the UI rescans it
/// </summary>
static class Volumes
{
    /// <summary>The longest to wait: a local drive takes under 1 ms, a connected network drive tens of ms</summary>
    public static readonly TimeSpan Patience = TimeSpan.FromMilliseconds(400);

    /// <summary>How long an answer is remembered: drives can be plugged and unplugged at any time, and remembering too long means a drive plugged back in isn't recognized</summary>
    const long FreshMs = 2000;

    sealed record Answer(bool There, long At);

    static readonly ConcurrentDictionary<string, Task<Answer>> checks = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>The drive of a path: E:\, \\server\share; null when the path is malformed</summary>
    public static string? RootOf(string path)
    {
        try
        {
            return Path.GetPathRoot(Path.GetFullPath(path)) is { Length: > 0 } root ? root : null;
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return null;
        }
    }

    /// <summary>How long to wait for a drive that was found absent last time: a USB stick that was plugged back in answers in under 1 ms, and a network drive that is still disconnected need not be waited on for the full Patience every time</summary>
    static readonly TimeSpan Quick = TimeSpan.FromMilliseconds(50);

    /// <summary>One being checked or just checked is used as is; otherwise check on a background thread</summary>
    static Task<Answer> Lookup(string root) =>
        checks.AddOrUpdate(
            root,
            Start,
            (r, old) => !old.IsCompleted || (old.IsCompletedSuccessfully && Environment.TickCount64 - old.Result.At < FreshMs) ? old : Start(r));

    static Task<Answer> Start(string root) =>
        Task.Run(() =>
        {
            bool there;
#if TEST_HOOKS
            if (TestHooks.DeadShare(root)) return new Answer(false, Environment.TickCount64);
#endif
            try
            {
                there = Directory.Exists(root);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
            {
                there = false;
            }
            return new Answer(there, Environment.TickCount64);
        });

    /// <summary>
    /// Whether the drive of this path was there at the last check; null if never checked or the first check hasn't finished. Doesn't query the disk, so it is safe on the UI thread.
    /// Call WaitAsync first and then use it: it reflects that moment
    /// </summary>
    public static bool? Known(string path)
    {
        if (RootOf(path) is not { } root || !checks.TryGetValue(root, out var t) || !t.IsCompletedSuccessfully) return null;
        return t.Result.There;
    }

    /// <summary>For background threads: waits until it is certain (a path the user explicitly added, where a sleeping NAS takes a few seconds to wake, mustn't be declared not found after a brief wait)</summary>
    public static bool ThereWait(string path) => RootOf(path) is { } root && Lookup(root).Result.There;

    /// <summary>
    /// Checks the drives of these paths together (different drives in parallel), waiting at most patience; for one found absent last time it waits only Quick (one still disconnected needn't be waited on the full time every time).
    /// After returning, use Known: what hasn't finished is null or the previous result, and both are treated as not connected. Awaiting it on the UI thread doesn't freeze the UI
    /// </summary>
    public static async Task WaitAsync(IEnumerable<string> paths, TimeSpan patience)
    {
        var waiting = new List<Task<Answer>>();
        var anyNew = false;
        foreach (var root in paths.Select(RootOf).OfType<string>().Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var before = checks.TryGetValue(root, out var old) && old.IsCompletedSuccessfully ? old.Result.There : (bool?)null;
            var t = Lookup(root);
            if (t.IsCompleted) continue;
            waiting.Add(t);
            anyNew |= before is not false;
        }
        if (waiting.Count > 0) await Task.WhenAny(Task.WhenAll(waiting), Task.Delay(anyNew ? patience : Quick)).ConfigureAwait(false);
    }
}

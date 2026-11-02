using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.Json;

namespace SnipToss.App;

/// <summary>
/// Update check (ADR-0002 item 4): queries GitHub Releases, tells the UI when something newer than the current version exists, and goes to the download page only when the user clicks.
/// The app goes online only here (the privacy notice says so, and the automatic check can be turned off in Settings); it sends one request that carries no user information.
/// Channel: a stable release looks only at stable releases; a beta (1.0.0-beta.N) also looks at betas (marked pre-release on GitHub). Drafts don't count.
/// Platform: the Mac app is released under the same version numbers, so only a release that carries a Windows package counts (see <see cref="PackageMark"/>).
/// Downloading, verifying SHA256 and installing silently after exit will come once the installer signature and Sandbox have been tested; for now it only links to the download page
/// </summary>
static class Updates
{
    public const string ReleasesApi = "https://api.github.com/repos/Moy339339/SnipToss/releases?per_page=30";

    /// <summary>A version newer than the current one: version number, download page, whether it is a beta</summary>
    public sealed record Release(string Version, string Url, bool Prerelease);

    /// <summary>The result of a check: a new version, already up to date, or can't check (offline, repository not public yet, GitHub rate limiting…; the reason is only logged)</summary>
    public sealed record Result(Release? Newer, string? Error);

    static readonly Lazy<HttpClient> Http = new(() =>
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        // GitHub's API requires a User-Agent
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"{AppPaths.DirName}/{AppVersion.Text}");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    });

    public static Task<Result> CheckAsync(CancellationToken ct = default) => CheckAsync(Http.Value, ReleasesApi, AppVersion.Text, ct);

    /// <summary>How long after a successful automatic check the next one is due (at most about once a day)</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromHours(20);

    /// <summary>Whether the automatic check is due: never checked, or the last successful check was at least <see cref="Interval"/> ago (a clock set back counts as due)</summary>
    internal static bool Due(DateTime? lastUtc, DateTime nowUtc) => lastUtc is not { } last || nowUtc - last >= Interval || nowUtc < last;

    /// <summary>How a version is written for people, as versionLabel in packages/web/src/brand.ts: 1.1.1 → v1.1.1, 1.1.1-beta.2 → v1.1.1 Beta 2</summary>
    internal static string Label(string version)
    {
        var dash = version.IndexOf("-beta.", StringComparison.Ordinal);
        return dash < 0 ? $"v{version}" : $"v{version[..dash]} Beta {version[(dash + 6)..]}";
    }

    internal static async Task<Result> CheckAsync(HttpClient http, string url, string current, CancellationToken ct)
    {
        try
        {
            using var response = await http.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return new(null, $"HTTP {(int)response.StatusCode}");
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct));
            return new(Newest(doc.RootElement, current), null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or IOException)
        {
            return new(null, ex.Message);
        }
    }

    /// <summary>
    /// How a Windows package is named among a release's files: SnipToss-1.2.0-win-x64-setup.exe, SnipToss-1.2.0-win-x64-portable.zip (the Mac
    /// packages are SnipToss-1.2.0-mac-universal.dmg / .zip). A release without one (a fix for the Mac app alone) is not an update for Windows:
    /// there would be nothing to download
    /// </summary>
    internal const string PackageMark = "-win-";

    static bool IsPackage(string name) =>
        name.Contains(PackageMark, StringComparison.OrdinalIgnoreCase)
        && (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase));

    static bool HasPackage(JsonElement release) =>
        release.TryGetProperty("assets", out var assets)
        && assets.ValueKind == JsonValueKind.Array
        && assets.EnumerateArray().Any(a => Text(a, "name") is { } name && IsPackage(name));

    /// <summary>The newest release in the list that is newer than current, in this channel and with a Windows package; null if none</summary>
    internal static Release? Newest(JsonElement releases, string current)
    {
        if (releases.ValueKind != JsonValueKind.Array) return null;
        var beta = IsPrerelease(current);
        Release? best = null;
        foreach (var r in releases.EnumerateArray())
        {
            if (Bool(r, "draft") || !HasPackage(r)) continue;
            var prerelease = Bool(r, "prerelease");
            if (prerelease && !beta) continue;
            if (Text(r, "tag_name") is not { } tag || Text(r, "html_url") is not { } page) continue;
            var version = tag.StartsWith('v') || tag.StartsWith('V') ? tag[1..] : tag;
            if (Parse(version) is null || Compare(version, current) <= 0) continue;
            if (best is null || Compare(version, best.Version) > 0) best = new(version, page, prerelease);
        }
        return best;
    }

    static bool Bool(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    static string? Text(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    internal static bool IsPrerelease(string version) => version.Contains('-', StringComparison.Ordinal);

    /// <summary>Semantic version: major.minor.patch[-prerelease] (build metadata after + doesn't count). null if not recognized</summary>
    internal static (int[] Core, string[] Pre)? Parse(string version)
    {
        var main = version.Split('+')[0];
        var dash = main.IndexOf('-', StringComparison.Ordinal);
        var core = (dash < 0 ? main : main[..dash]).Split('.');
        if (core.Length != 3) return null;
        var numbers = new int[3];
        for (var i = 0; i < 3; i++)
            if (!int.TryParse(core[i], NumberStyles.None, CultureInfo.InvariantCulture, out numbers[i])) return null;
        var pre = dash < 0 ? [] : main[(dash + 1)..].Split('.');
        return pre.Any(p => p.Length == 0) ? null : (numbers, pre);
    }

    /// <summary>Compares by semantic version: 1.0.0-beta.9 &lt; 1.0.0-beta.10 &lt; 1.0.0 &lt; 1.0.1. Unrecognized ones count as the smallest</summary>
    internal static int Compare(string a, string b)
    {
        var (x, y) = (Parse(a), Parse(b));
        if (x is null || y is null) return x is null ? (y is null ? 0 : -1) : 1;
        for (var i = 0; i < 3; i++)
            if (x.Value.Core[i] != y.Value.Core[i]) return x.Value.Core[i].CompareTo(y.Value.Core[i]);
        var (p, q) = (x.Value.Pre, y.Value.Pre);
        if (p.Length == 0 || q.Length == 0) return q.Length.CompareTo(p.Length); // one without a prerelease part is larger
        for (var i = 0; i < Math.Min(p.Length, q.Length); i++)
        {
            var pn = int.TryParse(p[i], NumberStyles.None, CultureInfo.InvariantCulture, out var m);
            var qn = int.TryParse(q[i], NumberStyles.None, CultureInfo.InvariantCulture, out var n);
            var c = pn && qn ? m.CompareTo(n) : pn ? -1 : qn ? 1 : string.CompareOrdinal(p[i], q[i]);
            if (c != 0) return c;
        }
        return p.Length.CompareTo(q.Length);
    }
}

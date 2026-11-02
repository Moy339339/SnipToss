using System.Net;
using System.Net.Http;
using System.Text.Json;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Update check (Updates.cs): how versions are compared, which release is picked, and what is reported when the check fails.
/// Never contacts the real GitHub (a fake HttpMessageHandler)
/// </summary>
public class UpdatesTests
{
    [Theory]
    [InlineData("1.0.0-beta.9", "1.0.0-beta.10")]
    [InlineData("1.0.0-beta.66", "1.0.0")]
    [InlineData("1.0.0", "1.0.1")]
    [InlineData("1.0.9", "1.1.0")]
    [InlineData("1.9.0", "2.0.0")]
    [InlineData("1.0.0-alpha", "1.0.0-beta")]
    [InlineData("1.0.0-beta", "1.0.0-beta.1")]
    [InlineData("1.0.0-beta.2", "1.0.0-rc.1")]
    [InlineData("不是版本", "1.0.0")]
    public void Versions_are_compared_by_semantic_versioning(string older, string newer)
    {
        Assert.True(Updates.Compare(older, newer) < 0);
        Assert.True(Updates.Compare(newer, older) > 0);
    }

    [Fact]
    public void Identical_versions_compare_equal_and_build_metadata_is_ignored()
    {
        Assert.Equal(0, Updates.Compare("1.0.0-beta.66", "1.0.0-beta.66"));
        Assert.Equal(0, Updates.Compare("1.2.3+abc", "1.2.3"));
        Assert.Null(Updates.Parse("1.0"));
        Assert.Null(Updates.Parse("1.0.0-"));
        Assert.Null(Updates.Parse("v1.0.0"));
    }

    static JsonElement Releases(string json) => JsonDocument.Parse(json).RootElement;

    const string Windows = """ "assets": [ { "name": "SnipToss-x-win-x64-setup.exe" }, { "name": "SHA256SUMS.txt" } ] """;

    const string List = $$"""
        [
          { "tag_name": "v1.0.2", "html_url": "https://x/v1.0.2", "draft": true, "prerelease": false, {{Windows}} },
          { "tag_name": "v1.1.0-beta.3", "html_url": "https://x/v1.1.0-beta.3", "draft": false, "prerelease": true, {{Windows}} },
          { "tag_name": "v1.0.1", "html_url": "https://x/v1.0.1", "draft": false, "prerelease": false, {{Windows}} },
          { "tag_name": "v1.0.0", "html_url": "https://x/v1.0.0", "draft": false, "prerelease": false, {{Windows}} },
          { "tag_name": "nightly", "html_url": "https://x/nightly", "draft": false, "prerelease": true, {{Windows}} }
        ]
        """;

    [Fact]
    public void A_stable_build_only_looks_at_stable_releases_and_drafts_do_not_count()
    {
        Assert.Equal(new Updates.Release("1.0.1", "https://x/v1.0.1", false), Updates.Newest(Releases(List), "1.0.0"));
        Assert.Null(Updates.Newest(Releases(List), "1.0.1"));
    }

    [Fact]
    public void A_beta_build_also_looks_at_betas_and_picks_the_newest()
    {
        Assert.Equal(new Updates.Release("1.1.0-beta.3", "https://x/v1.1.0-beta.3", true), Updates.Newest(Releases(List), "1.0.0-beta.66"));
        Assert.Null(Updates.Newest(Releases(List), "1.1.0-beta.3"));
    }

    [Fact]
    public void A_release_without_a_Windows_package_such_as_a_fix_for_the_Mac_app_alone_is_not_an_update()
    {
        const string list = """
            [
              { "tag_name": "v1.2.1", "html_url": "https://x/v1.2.1", "draft": false, "prerelease": false,
                "assets": [ { "name": "SnipToss-1.2.1-mac-universal.dmg" }, { "name": "SHA256SUMS.txt" } ] },
              { "tag_name": "v1.2.2", "html_url": "https://x/v1.2.2", "draft": false, "prerelease": false, "assets": [] },
              { "tag_name": "v1.2.3", "html_url": "https://x/v1.2.3", "draft": false, "prerelease": false },
              { "tag_name": "v1.2.4", "html_url": "https://x/v1.2.4", "draft": false, "prerelease": false,
                "assets": [ { "name": "SnipToss-1.2.4-win-x64-notes.txt" } ] },
              { "tag_name": "v1.2.0", "html_url": "https://x/v1.2.0", "draft": false, "prerelease": false,
                "assets": [ { "name": "SnipToss-1.2.0-mac-universal.dmg" }, { "name": "SnipToss-1.2.0-WIN-x64-portable.zip" } ] }
            ]
            """;
        Assert.Equal(new Updates.Release("1.2.0", "https://x/v1.2.0", false), Updates.Newest(Releases(list), "1.1.2"));
        Assert.Null(Updates.Newest(Releases(list), "1.2.0"));
    }

    [Fact]
    public void A_non_list_response_or_entries_missing_fields_do_not_cause_errors()
    {
        Assert.Null(Updates.Newest(Releases("""{ "message": "Not Found" }"""), "1.0.0"));
        Assert.Null(Updates.Newest(Releases("""[ { "tag_name": 3 }, { "html_url": "x" }, {} ]"""), "1.0.0"));
    }

    sealed class Fake(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public HttpRequestMessage? Seen { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Seen = request;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
        }
    }

    [Fact]
    public async Task A_successful_check_returns_the_newer_version()
    {
        var fake = new Fake(HttpStatusCode.OK, List);
        using var http = new HttpClient(fake);
        var r = await Updates.CheckAsync(http, Updates.ReleasesApi, "1.0.0", default);
        Assert.Equal("1.0.1", r.Newer?.Version);
        Assert.Null(r.Error);
        Assert.Equal(Updates.ReleasesApi, fake.Seen!.RequestUri!.ToString());
    }

    [Fact]
    public async Task A_repository_that_is_not_public_yet_or_is_rate_limited_counts_as_a_failed_check_not_as_no_new_version()
    {
        using var http = new HttpClient(new Fake(HttpStatusCode.NotFound, """{ "message": "Not Found" }"""));
        var r = await Updates.CheckAsync(http, Updates.ReleasesApi, "1.0.0", default);
        Assert.Null(r.Newer);
        Assert.Equal("HTTP 404", r.Error);
        using var broken = new HttpClient(new Fake(HttpStatusCode.OK, "<html>"));
        Assert.NotNull((await Updates.CheckAsync(broken, Updates.ReleasesApi, "1.0.0", default)).Error);
    }

    [Fact]
    public void The_automatic_check_is_due_when_never_checked_after_20_hours_or_when_the_clock_went_back()
    {
        var now = new DateTime(2026, 11, 2, 12, 0, 0, DateTimeKind.Utc);
        Assert.True(Updates.Due(null, now));
        Assert.False(Updates.Due(now.AddHours(-1), now));
        Assert.False(Updates.Due(now.AddHours(-19.9), now));
        Assert.True(Updates.Due(now.AddHours(-20), now));
        Assert.True(Updates.Due(now.AddDays(-9), now));
        // A last check "in the future" (the clock was set back) must not stop checks for good
        Assert.True(Updates.Due(now.AddHours(3), now));
    }

    [Theory]
    [InlineData("1.1.1", "v1.1.1")]
    [InlineData("1.1.1-beta.2", "v1.1.1 Beta 2")]
    [InlineData("2.0.0-rc.1", "v2.0.0-rc.1")]
    public void A_version_is_written_for_people_as_the_UI_writes_it(string version, string label) => Assert.Equal(label, Updates.Label(version));
}

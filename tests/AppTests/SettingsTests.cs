using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Reading and writing the settings file. A failed read (corrupt or locked) must not be treated as empty settings, or the next settings change
/// would write the empty list back and lose the whole library
/// </summary>
public class SettingsTests
{
    static Settings WithLibrary(string path, params string[] entries)
    {
        var s = Settings.LoadFrom(path);
        s.Update(x =>
        {
            x.Library.Clear();
            foreach (var e in entries) x.Library.Add(new LibraryEntry { Path = e });
        });
        return s;
    }

    static List<string> LibraryOnDisk(string path) =>
        JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("Library").EnumerateArray()
            .Select(e => e.GetProperty("Path").GetString()!).ToList();

    [Fact]
    public void First_run_with_no_settings_file_uses_defaults_and_shows_no_notice()
    {
        using var dir = new TempDir();
        var s = Settings.LoadFrom(dir.File("settings.json"));
        Assert.Empty(s.Library);
        Assert.Null(s.StartupNotice);
    }

    [Theory]
    [InlineData("""{ }""", true)]
    [InlineData("""{ "Prefs": { } }""", true)]
    [InlineData("""{ "Prefs": { "updateCheck": false } }""", false)]
    [InlineData("""{ "Prefs": { "updateCheck": true } }""", true)]
    [InlineData("""{ "Prefs": { "updateCheck": "no" } }""", true)]
    public void Automatic_update_check_is_off_only_when_written_as_false(string json, bool on)
    {
        // The settings file stores only changed items (storedPrefs in the UI's prefs.ts): absent means the default (on);
        // a hand-corrupted value counts as the default too
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, json);
        Assert.Equal(on, Settings.LoadFrom(path).UpdateCheck);
    }

    [Fact]
    public void The_time_of_the_last_update_check_is_persisted()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var at = new DateTime(2026, 10, 23, 1, 2, 3, DateTimeKind.Utc);
        Settings.LoadFrom(path).Update(s => s.UpdatesCheckedAt = at);
        Assert.Equal(at, Settings.LoadFrom(path).UpdatesCheckedAt?.ToUniversalTime());
    }
    // Since "follow system" can resolve to English: earlier versions were Chinese whatever the system language, and existing users should not
    // suddenly get English after upgrading
    [Fact]
    public void An_old_settings_file_with_no_language_chosen_on_a_non_Chinese_system_is_pinned_to_Chinese_only_once()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, """{ "Library": [] }""");
        var s = Settings.LoadFrom(path);
        s.Migrate("en-US");
        Assert.Equal("zh-CN", s.Language);
        Assert.Equal("zh-CN", Settings.LoadFrom(path).Language);
        Assert.Equal(Settings.LatestMigration, Settings.LoadFrom(path).Migrations);
        // Later choosing "follow system" again in settings (default values are not written to the settings file): it is not pinned again
        s.Update(x => x.Prefs!.Remove("language"));
        var again = Settings.LoadFrom(path);
        again.Migrate("en-US");
        Assert.Null(again.Language);
    }

    [Theory]
    // the system is already Chinese: follow-system gives Chinese anyway, so no pin is needed (settings still show "follow system")
    [InlineData("zh-CN", null)]
    [InlineData("zh-Hans-SG", null)]
    [InlineData("en-US", "zh-CN")]
    [InlineData("ja-JP", "zh-CN")]
    public void An_old_settings_file_is_pinned_or_not_depending_on_the_system_language(string system, string? want)
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, """{ "Library": [] }""");
        var s = Settings.LoadFrom(path);
        s.Migrate(system);
        Assert.Equal(want, s.Language);
        Assert.Equal(Settings.LatestMigration, s.Migrations);
    }

    [Fact]
    public void Neither_an_existing_user_who_chose_a_language_nor_a_fresh_install_is_pinned()
    {
        using var dir = new TempDir();
        var chosen = dir.File("chosen.json");
        File.WriteAllText(chosen, """{ "Prefs": { "language": "en" } }""");
        var s = Settings.LoadFrom(chosen);
        s.Migrate("en-US");
        Assert.Equal("en", s.Language);
        var fresh = Settings.LoadFrom(dir.File("fresh.json"));
        fresh.Migrate("en-US");
        Assert.Null(fresh.Language);
    }

    [Fact]
    public void Settings_just_written_can_be_read_back()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        WithLibrary(path, @"E:\a", @"E:\b");
        var again = Settings.LoadFrom(path);
        Assert.Equal([@"E:\a", @"E:\b"], again.Library.Select(e => e.Path));
        Assert.Null(again.StartupNotice);
    }

    [Fact]
    public void Every_write_keeps_the_previous_version_as_a_backup()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = WithLibrary(path, @"E:\a");
        s.Update(x => x.Library.Add(new LibraryEntry { Path = @"E:\b" }));
        Assert.Equal([@"E:\a", @"E:\b"], LibraryOnDisk(path));
        Assert.Equal([@"E:\a"], LibraryOnDisk(path + ".bak"));
    }

    [Fact]
    public void Writing_leaves_no_temp_file_behind()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = WithLibrary(path, @"E:\a");
        s.Update(x => x.Topmost = true);
        Assert.Empty(Directory.GetFiles(dir.Path, "*.tmp"));
    }

    [Fact]
    public void A_file_corrupt_at_startup_is_preserved_restored_from_the_backup_and_the_user_is_told()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = WithLibrary(path, @"E:\a");
        s.Update(x => x.Library.Add(new LibraryEntry { Path = @"E:\b" })); // .bak = [a]
        File.WriteAllText(path, "{ 坏了");

        var loaded = Settings.LoadFrom(path);

        Assert.Equal([@"E:\a"], loaded.Library.Select(e => e.Path));
        Assert.NotNull(loaded.StartupNotice);
        var kept = Assert.Single(Directory.GetFiles(dir.Path, "settings.corrupt-*.json"));
        Assert.Equal("{ 坏了", File.ReadAllText(kept));
    }

    [Fact]
    public void A_file_corrupt_at_startup_with_no_backup_uses_defaults_preserves_the_original_and_tells_the_user()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        File.WriteAllText(path, "");

        var loaded = Settings.LoadFrom(path);

        Assert.Empty(loaded.Library);
        Assert.Contains("默认设置", loaded.StartupNotice);
        Assert.Single(Directory.GetFiles(dir.Path, "settings.corrupt-*.json"));
    }

    [Fact]
    public void A_file_corrupted_while_in_use_does_not_empty_the_library_when_settings_change()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = WithLibrary(path, @"E:\a", @"E:\b");
        File.WriteAllText(path, "null");

        s.Update(x => x.Topmost = true);

        Assert.Equal([@"E:\a", @"E:\b"], LibraryOnDisk(path));
        Assert.True(s.Topmost);
        Assert.Single(Directory.GetFiles(dir.Path, "settings.corrupt-*.json"));
    }

    [Fact]
    public void A_file_held_exclusively_by_another_program_does_not_empty_the_library_and_the_original_is_intact_once_released()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = WithLibrary(path, @"E:\a", @"E:\b");
        var before = File.ReadAllText(path);

        using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            s.Update(x => x.Library.Add(new LibraryEntry { Path = @"E:\c" }));
        }

        // Memory has the new state; that write never reached the disk, but the original list is still there and was not overwritten by empty settings
        Assert.Equal([@"E:\a", @"E:\b", @"E:\c"], s.Library.Select(e => e.Path));
        Assert.Equal(before, File.ReadAllText(path));
        // By the next settings change the file is released: the entry that was not saved last time is written too
        // and is not wiped by the old content on disk
        s.Update(x => x.Topmost = true);
        Assert.Equal([@"E:\a", @"E:\b", @"E:\c"], LibraryOnDisk(path));
    }

    [Fact]
    public void When_the_file_is_held_exclusively_during_a_settings_change_the_caller_is_told_it_was_not_saved_and_a_later_change_saves_once_released()
    {
        // A UI settings change that was not saved must be reported (otherwise only the log knew, the UI showed the change as saved,
        // and it was noticed only after a restart)
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var s = WithLibrary(path, @"E:\a");
        using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Assert.False(s.Update(x => x.Topmost = true));
        }
        Assert.True(s.Update(x => x.Topmost = false));
    }

    [Fact]
    public void UI_settings_and_Screen_Capture_settings_round_trip()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        Settings.LoadFrom(path).Update(x =>
        {
            x.Prefs = JsonNode.Parse("""{"author":"小王","fresh":{"since":{"E:\\a":123}}}""") as JsonObject;
            x.Capture.Hotkey = "Ctrl+Alt+K";
            x.Capture.HotkeyCustom = true;
            x.Capture.KeepInTray = false;
            x.Capture.HideWindow = false;
            x.Capture.NotesInImage = false;
            x.Capture.Folder = @"E:\shots";
        });
        var back = Settings.LoadFrom(path);
        Assert.Equal("小王", back.Prefs?["author"]?.GetValue<string>());
        Assert.Equal(123, back.Prefs?["fresh"]?["since"]?[@"E:\a"]?.GetValue<int>());
        var c = back.Capture;
        Assert.Equal(("Ctrl+Alt+K", true, false, false, false, @"E:\shots"), (c.Hotkey, c.HotkeyCustom, c.KeepInTray, c.HideWindow, c.NotesInImage, c.Folder));
    }

    [Fact]
    public void An_item_added_by_another_window_is_not_overwritten_by_this_ones_stale_copy()
    {
        using var dir = new TempDir();
        var path = dir.File("settings.json");
        var mine = WithLibrary(path, @"E:\a");
        var other = Settings.LoadFrom(path);
        other.Update(x => x.Library.Add(new LibraryEntry { Path = @"E:\b" }));

        mine.Update(x => x.Topmost = true);

        Assert.Equal([@"E:\a", @"E:\b"], LibraryOnDisk(path));
    }
}

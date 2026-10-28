using System.IO;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Rename pizhu → SnipToss (docs/adr/0007-rename.md): each project's .pizhu is moved to .sniptoss, old settings are copied over,
/// and autostart recognises the old program
/// </summary>
public class RenameMigrationTests
{
    static string Make(string root, string rel, string text = "{}")
    {
        var path = Path.Combine(root, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    [Fact]
    public void After_notes_are_written_a_gitignore_is_added_if_missing_ignoring_only_temp_and_lock_files_and_an_existing_one_is_left_alone()
    {
        // A .tmp or .lock left behind by a power cut mid-write would otherwise show up in the user's project git changes
        using var home = new TempDir();
        DataDir.EnsureGitIgnore(home.Path); // no .sniptoss yet: not created
        Assert.False(Directory.Exists(home.File(".sniptoss")));
        Make(home.Path, ".sniptoss/annotations/a.json");
        var ignore = Path.Combine(home.File(".sniptoss"), ".gitignore");
        DataDir.EnsureGitIgnore(home.Path);
        var lines = File.ReadAllLines(ignore).Where(l => !l.StartsWith('#')).ToList();
        Assert.Equal(["*.tmp", "*.lock"], lines); // the notes themselves are not ignored: whether to commit them is the user's call
        File.WriteAllText(ignore, "我自己改的\n");
        DataDir.EnsureGitIgnore(home.Path);
        Assert.Equal("我自己改的\n", File.ReadAllText(ignore));
    }

    [Fact]
    public void With_only_the_old_folder_it_is_renamed_whole_and_the_old_write_back_script_is_deleted()
    {
        using var home = new TempDir();
        Make(home.Path, @".pizhu\annotations\a.png.json", "旧批注");
        Make(home.Path, @".pizhu\snapshots\x.png");
        Make(home.Path, @".pizhu\REVIEW.md");
        Make(home.Path, @".pizhu\pizhu.cmd");

        Assert.Equal(DataDir.Outcome.Moved, DataDir.Migrate(home.Path));

        Assert.False(Directory.Exists(home.File(".pizhu")));
        Assert.Equal("旧批注", File.ReadAllText(home.File(@".sniptoss\annotations\a.png.json")));
        Assert.True(File.Exists(home.File(@".sniptoss\snapshots\x.png")));
        Assert.True(File.Exists(home.File(@".sniptoss\REVIEW.md")));
        Assert.False(File.Exists(home.File(@".sniptoss\pizhu.cmd")));
    }

    [Fact]
    public void Migrating_again_after_a_completed_migration_does_nothing()
    {
        using var home = new TempDir();
        Make(home.Path, @".pizhu\annotations\a.png.json");
        DataDir.Migrate(home.Path);

        Assert.Equal(DataDir.Outcome.Nothing, DataDir.Migrate(home.Path));
        Assert.True(File.Exists(home.File(@".sniptoss\annotations\a.png.json")));
    }

    [Fact]
    public void With_both_old_and_new_present_the_new_one_is_used_and_the_old_one_is_untouched()
    {
        using var home = new TempDir();
        Make(home.Path, @".pizhu\annotations\old.png.json");
        Make(home.Path, @".sniptoss\annotations\new.png.json");

        Assert.Equal(DataDir.Outcome.BothExist, DataDir.Migrate(home.Path));
        Assert.True(File.Exists(home.File(@".pizhu\annotations\old.png.json")));
        Assert.False(File.Exists(home.File(@".sniptoss\annotations\old.png.json")));
        Assert.Equal(home.File(".sniptoss"), DataDir.Active(home.Path));
    }

    [Fact]
    public void With_no_notes_no_folder_is_created()
    {
        using var home = new TempDir();
        Assert.Equal(DataDir.Outcome.Nothing, DataDir.Migrate(home.Path));
        Assert.Empty(Directory.EnumerateFileSystemEntries(home.Path));
        Assert.Equal(home.File(".sniptoss"), DataDir.Active(home.Path));
    }

    [Fact]
    public void When_a_file_in_the_old_folder_is_locked_the_folder_is_copied_instead_and_no_note_is_lost()
    {
        using var home = new TempDir();
        Make(home.Path, @".pizhu\annotations\a.png.json", "甲");
        var locked = Make(home.Path, @".pizhu\annotations\b.png.json", "乙");

        DataDir.Outcome outcome;
        // delete not allowed: the folder can be neither renamed nor deleted
        using (new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.Read))
            outcome = DataDir.Migrate(home.Path);

        Assert.Equal(DataDir.Outcome.Copied, outcome);
        Assert.Equal("甲", File.ReadAllText(home.File(@".sniptoss\annotations\a.png.json")));
        Assert.Equal("乙", File.ReadAllText(home.File(@".sniptoss\annotations\b.png.json")));
        Assert.Empty(Directory.EnumerateDirectories(home.Path, ".sniptoss.migrating-*"));
        Assert.Equal(home.File(".sniptoss"), DataDir.Active(home.Path));
    }

    [Fact]
    public void Before_migration_the_old_folder_is_read()
    {
        using var home = new TempDir();
        Make(home.Path, @".pizhu\annotations\a.png.json");
        Assert.Equal(home.File(".pizhu"), DataDir.Active(home.Path));
        Assert.Single(Bridge.ReadAnnotations(home.Path));
    }

    [Fact]
    public void Searching_upward_for_the_notes_folder_recognises_the_old_name_too()
    {
        using var project = new TempDir();
        Make(project.Path, @".pizhu\annotations\a.png.json");
        var file = Make(project.Path, @"assets\deep\a.png", "");

        Assert.Equal(project.Path, new HomeFinder().Find(file, null));
    }

    [Theory]
    [InlineData(@".sniptoss\annotations\a.png.json", true)]
    [InlineData(@".sniptoss\snapshots\x.png", true)]
    [InlineData(@".pizhu\annotations\a.png.json", false)]
    [InlineData(@".sniptoss\..\a.png", false)]
    [InlineData(@"a.png", false)]
    public void Writing_is_only_allowed_inside_sniptoss(string rel, bool allowed)
    {
        using var home = new TempDir();
        if (allowed) Assert.EndsWith(rel, Bridge.InDataDir(home.Path, rel));
        else Assert.ThrowsAny<UnauthorizedAccessException>(() => Bridge.InDataDir(home.Path, rel));
    }

    // .sniptoss itself or a folder under it is a directory junction: what is written would land elsewhere, so nothing is written
    [Theory]
    [InlineData(".sniptoss")]
    [InlineData(@".sniptoss\annotations")]
    public void Nothing_is_written_when_sniptoss_contains_a_directory_junction(string linked)
    {
        using var home = new TempDir();
        using var elsewhere = new TempDir();
        Directory.CreateDirectory(Path.Combine(home.Path, DataDir.Name));
        var link = Path.Combine(home.Path, linked);
        if (Directory.Exists(link)) Directory.Delete(link);
        LongPaths.CreateJunction(link, elsewhere.Path);
        try
        {
            Assert.ThrowsAny<UnauthorizedAccessException>(() => Bridge.InDataDir(home.Path, @".sniptoss\annotations\a.png.json"));
            Assert.Empty(Directory.GetFileSystemEntries(elsewhere.Path));
        }
        finally
        {
            Directory.Delete(link);
        }
    }

    [Fact]
    public void Old_settings_are_copied_over_with_their_backup_and_the_old_ones_are_kept()
    {
        using var root = new TempDir();
        var oldDir = Path.Combine(root.Path, "pizhu");
        var newDir = Path.Combine(root.Path, "SnipToss");
        Make(oldDir, "settings.json", "设置");
        Make(oldDir, "settings.json.bak", "备份");
        Make(oldDir, @"logs\pizhu-20261017.log", "日志");

        Assert.True(LegacyMigration.CopySettings(oldDir, newDir));

        Assert.Equal("设置", File.ReadAllText(Path.Combine(newDir, "settings.json")));
        Assert.Equal("备份", File.ReadAllText(Path.Combine(newDir, "settings.json.bak")));
        Assert.False(Directory.Exists(Path.Combine(newDir, "logs")));
        Assert.True(File.Exists(Path.Combine(oldDir, "settings.json")));
    }

    [Fact]
    public void Old_settings_copy_the_preserved_corrupt_file_too_but_not_temp_files()
    {
        // Both the code comment and ADR-0007 say the preserved corrupt file is copied along; matching settings.json* missed it,
        // because it is named settings.corrupt-<time>.json
        using var root = new TempDir();
        var oldDir = Path.Combine(root.Path, "pizhu");
        var newDir = Path.Combine(root.Path, "SnipToss");
        Make(oldDir, "settings.json", "设置");
        Make(oldDir, "settings.corrupt-20261017-101010-123.json", "坏的");
        Make(oldDir, "settings.json.1a2b3c.tmp", "写到一半");

        Assert.True(LegacyMigration.CopySettings(oldDir, newDir));

        Assert.Equal("坏的", File.ReadAllText(Path.Combine(newDir, "settings.corrupt-20261017-101010-123.json")));
        Assert.False(File.Exists(Path.Combine(newDir, "settings.json.1a2b3c.tmp")));
    }

    [Fact]
    public void When_neither_rename_nor_copy_works_the_old_folder_is_still_read_no_half_folder_is_left_and_nothing_throws()
    {
        using var home = new TempDir();
        Make(home.Path, @".pizhu\annotations\a.png.json", "甲");
        var locked = Make(home.Path, @".pizhu\annotations\b.png.json", "乙");

        DataDir.Outcome outcome;
        using (new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None)) // nobody else can read it: it can be neither renamed nor copied
            outcome = DataDir.Migrate(home.Path);

        Assert.Equal(DataDir.Outcome.Failed, outcome);
        Assert.False(Directory.Exists(home.File(".sniptoss")));
        Assert.Empty(Directory.EnumerateDirectories(home.Path, ".sniptoss.migrating-*"));
        Assert.Equal(home.File(".pizhu"), DataDir.Active(home.Path));
        Assert.Equal(DataDir.Outcome.Moved, DataDir.Migrate(home.Path)); // once released, the next open migrates it
    }

    [Fact]
    public void When_new_settings_already_exist_nothing_is_copied_and_nothing_is_overwritten()
    {
        using var root = new TempDir();
        var oldDir = Path.Combine(root.Path, "pizhu");
        var newDir = Path.Combine(root.Path, "SnipToss");
        Make(oldDir, "settings.json", "旧");
        Make(newDir, "settings.json", "新");

        Assert.False(LegacyMigration.CopySettings(oldDir, newDir));
        Assert.Equal("新", File.ReadAllText(Path.Combine(newDir, "settings.json")));
    }

    [Fact]
    public void With_no_old_settings_nothing_happens()
    {
        using var root = new TempDir();
        var newDir = Path.Combine(root.Path, "SnipToss");
        Assert.False(LegacyMigration.CopySettings(Path.Combine(root.Path, "pizhu"), newDir));
        Assert.False(Directory.Exists(newDir));
    }

    [Fact]
    public void Screenshot_archive_copies_only_what_is_missing()
    {
        using var root = new TempDir();
        var from = Path.Combine(root.Path, "old");
        var to = Path.Combine(root.Path, "new");
        Make(from, "a.png", "旧a");
        Make(from, @"sub\b.png", "旧b");
        Make(to, "a.png", "新a");

        LegacyMigration.CopyMissing(from, to);

        Assert.Equal("新a", File.ReadAllText(Path.Combine(to, "a.png")));
        Assert.Equal("旧b", File.ReadAllText(Path.Combine(to, @"sub\b.png")));
    }

    [Theory]
    [InlineData("\"E:\\work\\pizhu\\app\\bin\\Release\\net10.0-windows\\pizhu.exe\" --tray", true)]
    [InlineData("\"E:\\X\\PIZHU.EXE\" --tray", true)]
    [InlineData("\"E:\\work\\pizhu\\app\\bin\\Release\\net10.0-windows\\SnipToss.exe\" --tray", false)]
    [InlineData("\"E:\\x\\notpizhu.exe\" --tray", false)]
    public void Autostart_recognises_the_pre_rename_program(string cmd, bool legacy) => Assert.Equal(legacy, Autostart.IsLegacyCommand(cmd));
}

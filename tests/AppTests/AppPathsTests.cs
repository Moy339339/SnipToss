using System.IO;
using System.Text.Json;
using SnipToss.App;

namespace AppTests;

/// <summary>Where the app keeps its own files, and how the version number is written</summary>
public class AppPathsTests
{
    [Fact]
    public void Standard_layout_settings_in_roaming_dir_data_in_local_dir_subdirs_under_local_data()
    {
        // Static fields are computed once per process: when the tests run with SNIPTOSS_SETTINGS set (a test instance)
        // the other branch is taken; this checks only that one
        var local = AppPaths.IsTestInstance
            ? Path.GetDirectoryName(Path.GetFullPath(Environment.GetEnvironmentVariable("SNIPTOSS_SETTINGS")!))!
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SnipToss");
        if (!AppPaths.IsTestInstance)
            Assert.Equal(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SnipToss", "settings.json"), AppPaths.SettingsFile);
        Assert.Equal(local, AppPaths.LocalDir);
        Assert.Equal(Path.Combine(local, "logs"), AppPaths.LogDir);
        Assert.Equal(Path.Combine(local, "pasted"), AppPaths.PastedDir);
        Assert.Equal(Path.Combine(local, "WebView2"), AppPaths.WebViewDataDir);
        Assert.Equal(Path.Combine(local, "captures"), CaptureSettings.DefaultFolder);
    }

    [Fact]
    public void Installed_build_settings_in_roaming_dir_data_in_local_dir_writes_registry()
    {
        var p = AppPaths.Resolve(null, @"C:\Program Files\SnipToss", @"C:\Users\u\AppData\Roaming", @"C:\Users\u\AppData\Local", _ => false);
        Assert.Equal(new AppPaths.Layout(@"C:\Users\u\AppData\Roaming\SnipToss\settings.json", @"C:\Users\u\AppData\Local\SnipToss", TestInstance: false, Portable: false), p);
    }

    [Fact]
    public void Portable_build_with_a_data_folder_next_to_the_exe_keeps_all_data_inside_it()
    {
        var seen = new List<string>();
        var p = AppPaths.Resolve(null, @"E:\Tools\SnipToss\", @"C:\Roaming", @"C:\Local", d => { seen.Add(d); return true; });
        Assert.Equal([@"E:\Tools\SnipToss\data"], seen);
        Assert.Equal(new AppPaths.Layout(@"E:\Tools\SnipToss\data\settings.json", @"E:\Tools\SnipToss\data", TestInstance: false, Portable: true), p);
    }

    [Fact]
    public void Test_instance_wins_a_data_folder_next_to_the_exe_does_not_make_it_portable()
    {
        var p = AppPaths.Resolve(@"D:\tmp\t1\settings.json", @"E:\Tools\SnipToss", @"C:\Roaming", @"C:\Local", _ => true);
        Assert.Equal(new AppPaths.Layout(@"D:\tmp\t1\settings.json", @"D:\tmp\t1", TestInstance: true, Portable: false), p);
    }

    [Fact]
    public void Portable_build_is_recognised_once_a_real_data_folder_is_created()
    {
        using var dir = new TempDir();
        Assert.False(AppPaths.Resolve(null, dir.Path, "r", "l", Directory.Exists).Portable);
        Directory.CreateDirectory(dir.File(AppPaths.PortableDirName));
        Assert.True(AppPaths.Resolve(null, dir.Path, "r", "l", Directory.Exists).Portable);
        // A file with the same name does not count (only a folder does)
        using var other = new TempDir();
        File.WriteAllText(other.File(AppPaths.PortableDirName), "");
        Assert.False(AppPaths.Resolve(null, other.Path, "r", "l", Directory.Exists).Portable);
    }

    [Fact]
    public void Version_matches_root_package_json_without_the_commit_suffix_after_the_plus_sign()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "app", "SnipToss.App.csproj"))) dir = dir.Parent;
        Assert.NotNull(dir);
        using var pkg = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir.FullName, "package.json")));
        Assert.Equal(pkg.RootElement.GetProperty("version").GetString(), AppVersion.Text);
        Assert.DoesNotContain("+", AppVersion.Text, StringComparison.Ordinal);
    }
}

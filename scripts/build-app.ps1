# Builds the desktop shell app/ (net10.0-windows, needs the .NET 10 SDK).
# find-dotnet.ps1 locates the SDK (set SNIPTOSS_DOTNET when the one on PATH is not 10).
# Running SnipToss.exe only needs the .NET 10 desktop runtime, not the SDK.
#
#   pwsh -File scripts/build-app.ps1                              # normal install (= npm run build:app):
#                                                                 #   bump the version -> build the UI -> build the shell, so UI and app always come from one build
#   pwsh -File scripts/build-app.ps1 -Out $env:TEMP\sniptoss-test  # build to another folder for self-testing: no version bump, no UI build (run npm run build yourself first),
#                                                                 #   an installed SnipToss.exe that is running is not affected
#   pwsh -File scripts/build-app.ps1 -NoBump                      # normal install, version unchanged (rebuilds the same version)
#   pwsh -File scripts/build-app.ps1 -Out tests/shell/.app -TestHooks  # for shell tests (npm run e2e:shell): includes the test hooks (app/TestHooks.cs)
#   pwsh -File scripts/build-app.ps1 -Out tests/shell/.app-r2r -TestHooks -Publish  # for the performance budget (npm run perf): built like a release (ReadyToRun, self-contained runtime, as in publish.ps1)
param(
    [string] $Configuration = 'Release',
    [string] $Out,
    [switch] $NoBump,
    [switch] $TestHooks,
    [switch] $Publish
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

$dotnet = & (Join-Path $PSScriptRoot 'find-dotnet.ps1')

$project = Join-Path $root 'app\SnipToss.App.csproj'
$exe = if ($Out) { Join-Path $Out 'SnipToss.exe' } else { Join-Path $root "app\bin\$Configuration\net10.0-windows\SnipToss.exe" }
$outDir = [IO.Path]::GetFullPath((Split-Path $exe))
# The pre-rename pizhu.exe counts too (docs/adr/0007-rename.md): while it runs, the dll and ui files they share are locked
$running = Get-Process SnipToss, pizhu -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [IO.Path]::GetFullPath((Split-Path $_.Path)) -eq $outDir }
if ($running) {
    throw "$($running[0].Path) is still running and its files would be locked. Close it and build again$(if (-not $Out) { ' (for self-testing, build to another folder with -Out)' })"
}

# Leftover pizhu.exe, pizhu.dll... from before the rename, plus the WebView2 data next to them (now kept in %LOCALAPPDATA%\SnipToss\WebView2)
function Remove-LegacyFiles {
    Get-ChildItem $outDir -Filter 'pizhu.*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}

# Test hooks (TestHooks) go only into the shell-test build; a normal install is checked again after building and stops if it reused intermediate files that contain them
$hooks = "-p:SnipTossTestHooks=$(if ($TestHooks) { 'true' } else { 'false' })"
function Assert-NoTestHooks([string] $dll) {
    if ([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($dll)).Contains('TestHooks')) {
        throw "$dll contains the test hooks (TestHooks) and must not be used for a normal install. Delete app\obj and build again"
    }
}

if ($Out) {
    if ($TestHooks -and $Out -notmatch 'tests[\\/]shell[\\/]\.app') { throw '-TestHooks is only for building to tests/shell/.app (shell tests)' }
    if ($Publish) {
        & $dotnet publish $project -c $Configuration -r win-x64 --self-contained true -p:PublishReadyToRun=true -o $Out -nologo -v quiet --disable-build-servers $hooks
    } else {
        & $dotnet build $project -c $Configuration -o $Out -nologo -v quiet --disable-build-servers $hooks
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Remove-LegacyFiles
    Write-Host "Built ($dotnet): $exe"
    exit 0
}

# ---------- Normal install: bump the version (in two places: the root package.json and the app's csproj; the UI build reads package.json) ----------
# During the beta the version is 1.0.0-beta.N (shown as "Beta N" in the UI) and N is incremented; for the release, change package.json to 1.0.0, after which the last number is incremented
$utf8 = [Text.UTF8Encoding]::new($false)
$pkgPath = Join-Path $root 'package.json'
$pkg = [IO.File]::ReadAllText($pkgPath)
if ($pkg -notmatch '"version":\s*"(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?"') { throw 'package.json has no "version": "x.y.z" or "x.y.z-beta.N"' }
$base = "$($Matches[1]).$($Matches[2]).$($Matches[3])"
$beta = $Matches[4]
$version = if ($beta) {
    "$base-beta.$(if ($NoBump) { $beta } else { [int]$beta + 1 })"
} elseif ($NoBump) {
    $base
} else {
    "$($Matches[1]).$($Matches[2]).$([int]$Matches[3] + 1)"
}
[IO.File]::WriteAllText($pkgPath, ([regex]'"version":\s*"[^"]*"').Replace($pkg, "`"version`": `"$version`"", 1), $utf8)
$csproj = [IO.File]::ReadAllText($project)
[IO.File]::WriteAllText($project, ([regex]'<Version>[^<]*</Version>').Replace($csproj, "<Version>$version</Version>", 1), $utf8)

Push-Location $root
try {
    npm run build --silent
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
} finally {
    Pop-Location
}
if ($TestHooks) { throw '-TestHooks is only for building to tests/shell/.app (shell tests), not for a normal install' }
if ($Publish) { throw '-Publish is only used together with -Out (performance budget); for release packages use scripts/publish.ps1' }
& $dotnet build $project -c $Configuration -nologo -v quiet --disable-build-servers $hooks
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Assert-NoTestHooks (Join-Path (Split-Path $exe) 'SnipToss.dll')
Remove-LegacyFiles
$label = if ($version -match '-beta\.(\d+)$') { "Beta $($Matches[1]) ($version)" } else { "v$version" }
Write-Host "Built $label ($dotnet): $exe"

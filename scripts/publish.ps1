# Release packages (ADR-0002): win-x64, self-contained (bundles the .NET runtime, so users need no separate install) and ReadyToRun (fast startup).
# No version bump (it publishes whatever version the root package.json has now) and it doesn't touch the installed copy under app/bin.
#
#   pwsh -File scripts/publish.ps1          # -> dist/release/:
#                                           #   win-x64/app/                           the app itself (what the installer wizard packages)
#                                           #   SnipToss-<version>-win-x64-portable.zip    portable build: unzips to a SnipToss folder containing an empty data folder
#                                           #                                          (with data present it is the portable build: settings, logs and screenshots go inside it, no registry writes, app/AppPaths.cs)
#                                           #   SnipToss-<version>-win-x64-setup.exe        installer (only when Inno Setup 6 is installed, installer/SnipToss.iss)
#                                           #   SHA256SUMS.txt                         SHA256 of the files above (attached to the Release when publishing)
#                                           #   manifests/                             winget and Scoop manifests (scripts/package-manifests.ps1; submitted by the maintainer by hand)
#   pwsh -File scripts/publish.ps1 -NoUi    # the UI has already been built with npm run build: don't build it again
param(
    [string] $Runtime = 'win-x64',
    [switch] $NoUi
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dotnet = & (Join-Path $PSScriptRoot 'find-dotnet.ps1')
$project = Join-Path $root 'app\SnipToss.App.csproj'

$pkg = [IO.File]::ReadAllText((Join-Path $root 'package.json'))
if ($pkg -notmatch '"version":\s*"([^"]+)"') { throw 'package.json has no version' }
$version = $Matches[1]

$release = Join-Path $root 'dist\release'
$app = Join-Path $release "$Runtime\app"
if (Test-Path $app) { Remove-Item $app -Recurse -Force }

if (-not $NoUi) {
    Push-Location $root
    try {
        npm run build --silent
        if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
    } finally {
        Pop-Location
    }
}
if (-not (Test-Path (Join-Path $root 'packages\web\dist\index.html'))) { throw 'No built UI (packages/web/dist); run npm run build first' }

# The test hooks (TestHooks) stay out of the release package; no pdb (crash dumps are read against the pdb of the same build)
& $dotnet publish $project -c Release -r $Runtime --self-contained true -p:PublishReadyToRun=true `
    -p:SnipTossTestHooks=false -p:DebugType=None -p:DebugSymbols=false -o $app -nologo -v quiet --disable-build-servers
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$dll = Join-Path $app 'SnipToss.dll'
if ([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($dll)).Contains('TestHooks')) {
    throw "$dll contains the test hooks (TestHooks) and must not be released. Delete app\obj and publish again"
}
# The third-party notices must match the dependencies bundled this time (stop if a dependency was upgraded without regenerating them)
node (Join-Path $PSScriptRoot 'build-notices.mjs') --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
foreach ($must in 'SnipToss.exe', 'ui\index.html', 'coreclr.dll', 'PresentationFramework.dll', 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt') {
    if (-not (Test-Path (Join-Path $app $must))) { throw "The published app is missing $must" }
}

# Portable build: the SnipToss folder = the app + an empty data folder (ZipFile includes empty folders, Compress-Archive doesn't)
$stage = Join-Path $release "$Runtime\portable"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$portableDir = Join-Path $stage 'SnipToss'
Copy-Item $app $portableDir -Recurse
New-Item -ItemType Directory (Join-Path $portableDir 'data') | Out-Null
$zip = Join-Path $release "SnipToss-$version-$Runtime-portable.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($portableDir, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
Remove-Item $stage -Recurse -Force

# Installer (installer/SnipToss.iss): only built when Inno Setup 6 is installed; otherwise only the portable build is produced
$iscc = @($env:SNIPTOSS_ISCC, "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($iscc) {
    & $iscc /Q "/DAppVersion=$version" "/DSourceDir=$app" "/DOutputDir=$release" (Join-Path $root 'installer\SnipToss.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
} else {
    Write-Host 'Inno Setup 6 not found (ISCC.exe, or set SNIPTOSS_ISCC): producing only the portable build this time'
}

$sums = Get-ChildItem $release -File -Filter "SnipToss-$version-*" | Sort-Object Name | ForEach-Object {
    "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"
}
[IO.File]::WriteAllText((Join-Path $release 'SHA256SUMS.txt'), ($sums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
# winget and Scoop manifests (only prepared; the maintainer submits them by hand)
& (Join-Path $PSScriptRoot 'package-manifests.ps1') -Version $version -Release $release

$size = (Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Published {0} ({1}, app {2:N0} MB, portable zip {3:N0} MB): {4}" -f $version, $Runtime, $size, ((Get-Item $zip).Length / 1MB), $release)

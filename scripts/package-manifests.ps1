# winget and Scoop manifests (ADR-0002 item 6): generated from this release's files and their SHA256, written to dist/release/manifests. scripts/publish.ps1 calls it after building.
# This only prepares them: submitting to winget-pkgs / a Scoop bucket is a public action that the maintainer does by hand. Before submitting, check again with winget validate and Scoop's checkver.
# Download URLs follow the GitHub Release convention (assets under the v<version> tag) and must match the file names uploaded by .github/workflows/release.yml.
#   pwsh -File scripts/package-manifests.ps1 -Version 1.0.0 -Release dist/release
param(
    [Parameter(Mandatory)] [string] $Version,
    [Parameter(Mandatory)] [string] $Release
)
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
$repo = 'https://github.com/Moy339339/SnipToss'
$download = "$repo/releases/download/v$Version"
$setup = "SnipToss-$Version-win-x64-setup.exe"
$zip = "SnipToss-$Version-win-x64-portable.zip"
$hash = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $Release 'SHA256SUMS.txt'))) {
    if ($line -match '^([0-9a-f]{64})  (.+)$') { $hash[$Matches[2]] = $Matches[1] }
}
$out = Join-Path $Release 'manifests'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$description = 'Annotate AI-generated images and videos, then hand the notes back to your coding agent.'

# ---------- winget: the installer (Inno Setup, per-user install). ProductCode is Inno's uninstall entry: AppId + _is1 (installer/SnipToss.iss) ----------
if ($hash[$setup]) {
    $id = 'MoyGoldenAge.SnipToss'
    $dir = Join-Path $out "winget\$Version"
    New-Item -ItemType Directory $dir -Force | Out-Null
    $schema = '1.12.0'
    $files = @{
        "$id.yaml"              = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: $schema
"@
        "$id.installer.yaml"    = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
MinimumOSVersion: 10.0.22000.0
InstallerType: inno
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
InstallerSwitches:
  Custom: /CURRENTUSER
UpgradeBehavior: install
ProductCode: '{4EBB9110-4867-4049-8EFB-B00255A69951}_is1'
Dependencies:
  PackageDependencies:
    - PackageIdentifier: Microsoft.EdgeWebView2Runtime
Installers:
  - Architecture: x64
    InstallerUrl: $download/$setup
    InstallerSha256: $($hash[$setup].ToUpperInvariant())
ManifestType: installer
ManifestVersion: $schema
"@
        "$id.locale.en-US.yaml" = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
PackageLocale: en-US
Publisher: MoyGoldenAge
PublisherUrl: https://github.com/Moy339339
PublisherSupportUrl: $repo/issues
Author: MoyGoldenAge
PackageName: SnipToss
PackageUrl: $repo
License: MIT
LicenseUrl: $repo/blob/main/LICENSE
Copyright: Copyright (c) 2026 MoyGoldenAge
ShortDescription: $description
Tags:
  - annotation
  - review
  - screenshot
  - ai
  - claude-code
  - codex
ReleaseNotesUrl: $repo/releases/tag/v$Version
ManifestType: defaultLocale
ManifestVersion: $schema
"@
        "$id.locale.zh-CN.yaml" = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.locale.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $Version
PackageLocale: zh-CN
Publisher: MoyGoldenAge
PackageName: 超级批注
License: MIT
ShortDescription: 给 AI 生成的图片和视频做批注，再把批注原样交回给 AI 修改。
ManifestType: locale
ManifestVersion: $schema
"@
    }
    foreach ($name in $files.Keys) { [IO.File]::WriteAllText((Join-Path $dir $name), $files[$name].Replace("`r`n", "`n") + "`n", $utf8) }
} else {
    Write-Host "SHA256SUMS.txt has no $setup (the installer was not built this time): no winget manifest"
}

# ---------- Scoop: the portable zip. persist data = settings, logs and screenshots stay in Scoop's persist folder and survive upgrades; with a data folder present the app runs as portable (app/AppPaths.cs) ----------
if ($hash[$zip]) {
    $dir = Join-Path $out 'scoop'
    New-Item -ItemType Directory $dir -Force | Out-Null
    $scoop = [ordered]@{
        version      = $Version
        description  = $description
        homepage     = $repo
        license      = 'MIT'
        architecture = [ordered]@{ '64bit' = [ordered]@{ url = "$download/$zip"; hash = $hash[$zip]; extract_dir = 'SnipToss' } }
        shortcuts    = @(, @('SnipToss.exe', 'SnipToss'))
        persist      = 'data'
        checkver     = 'github'
        autoupdate   = [ordered]@{ architecture = [ordered]@{ '64bit' = [ordered]@{
                    url = "$repo/releases/download/v`$version/SnipToss-`$version-win-x64-portable.zip"; extract_dir = 'SnipToss' } } }
    }
    [IO.File]::WriteAllText((Join-Path $dir 'sniptoss.json'), ($scoop | ConvertTo-Json -Depth 6).Replace("`r`n", "`n") + "`n", $utf8)
}
Write-Host "Manifests: $out"

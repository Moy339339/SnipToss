# Installer tests (run before a release): install, upgrade, downgrade and uninstall this version's installer in Windows Sandbox,
# try the portable build, and screenshot the installer wizard in every language. What runs inside the sandbox is inside.ps1.
# Needs Windows 11 Pro with "Windows Sandbox" turned on; opens a sandbox window on screen (about 15 minutes, closed when this script
# finishes), and only one sandbox can be open at a time. The sandbox has no network, is limited to 4 GB of memory and doesn't share the clipboard.
#
#   pwsh -File scripts/publish.ps1                 # first build this version's installer and portable build (dist/release)
#   pwsh -File tests/sandbox/run.ps1               # the previous version defaults to the newest other installer in dist/release
#   pwsh -File tests/sandbox/run.ps1 -Old <previous setup.exe> -KeepOpen   # leave the sandbox open when done (to inspect it)
#   pwsh -File tests/sandbox/run.ps1 -StageOnly    # only prepare the files and configuration shared with the sandbox (tests/sandbox/.run); don't open it
#
# Results are in tests/sandbox/.run/out: results.json (each check), log.txt, shots\ (screenshots), install / uninstall logs, the app's log,
# and the settings file of each step
param(
    [string] $Old,
    [switch] $KeepOpen,
    [switch] $StageOnly,
    [int] $TimeoutMinutes = 40
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$release = Join-Path $root 'dist\release'
$pkg = [IO.File]::ReadAllText((Join-Path $root 'package.json'))
if ($pkg -notmatch '"version":\s*"([^"]+)"') { throw 'package.json has no version' }
$version = $Matches[1]

$newSetup = Join-Path $release "SnipToss-$version-win-x64-setup.exe"
$portable = Join-Path $release "SnipToss-$version-win-x64-portable.zip"
foreach ($f in $newSetup, $portable) { if (-not (Test-Path $f)) { throw "$f does not exist: run pwsh -File scripts/publish.ps1 first" } }
if (-not $Old) {
    $Old = Get-ChildItem $release -Filter 'SnipToss-*-win-x64-setup.exe' | Where-Object FullName -ne $newSetup | Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $Old) { throw 'There is no installer for the previous version: pass -Old' }
}
if ((Split-Path $Old -Leaf) -notmatch '^SnipToss-(.+)-win-x64-setup\.exe$') { throw "Can't read the version from $Old (the file name must be SnipToss-<version>-win-x64-setup.exe)" }
$oldVersion = $Matches[1]

$sandboxExe = Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe'
if (-not (Test-Path $sandboxExe)) { throw 'Windows Sandbox is not turned on (Turn Windows features on or off → "Windows Sandbox"; a restart is needed)' }
# The sandboxes that are open. The current Windows Sandbox (the Store app) runs as WindowsSandboxRemoteSession plus WindowsSandboxServer
# (which stays up with no sandbox open) and has the wsb command, which lists them by ID; the older built-in one runs as WindowsSandbox /
# WindowsSandboxClient. Looking only for the old names missed an open sandbox and left this script's own sandbox open after the run
function Open-Sandboxes {
    if (Get-Command wsb -ErrorAction SilentlyContinue) { return @(wsb list 2>$null | Where-Object { $_ -match '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' }) }
    @(Get-Process WindowsSandbox, WindowsSandboxClient, WindowsSandboxRemoteSession -ErrorAction SilentlyContinue | ForEach-Object { "process $($_.Id)" })
}
if (Open-Sandboxes) { throw 'A sandbox is already open: only one can run at a time, close it first' }
# The sandbox has no PowerShell 7: share the host's, read-only. The Store version (under WindowsApps) can't be shared; use the portable build
# extracted from the ZIP: the environment variable SNIPTOSS_PWSH_DIR points to its folder, or just run this script with the portable pwsh
$pwshDir = @($env:SNIPTOSS_PWSH_DIR, [Environment]::GetEnvironmentVariable('SNIPTOSS_PWSH_DIR', 'User'), (Split-Path (Get-Process -Id $PID).Path)) |
    Where-Object { $_ -and (Test-Path (Join-Path $_ 'pwsh.exe')) -and $_ -notmatch '\\WindowsApps\\' } | Select-Object -First 1
if (-not $pwshDir) { throw 'No PowerShell 7 that can be shared into the sandbox was found: download the portable ZIP build, extract it and set SNIPTOSS_PWSH_DIR to that folder' }

# The AppId in the install script (upgrade and uninstall recognize it) and the wizard languages
$iss = [IO.File]::ReadAllText((Join-Path $root 'installer\SnipToss.iss'))
if ($iss -notmatch '(?m)^AppId=\{(\{[0-9A-F-]+\})') { throw 'SnipToss.iss has no AppId' }
$appId = $Matches[1]
$inno = @($env:SNIPTOSS_ISCC, "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1 | Split-Path
if (-not $inno) { throw 'Inno Setup 6 not found: the button captions are read from its language files' }
# The button captions for each language: inside the sandbox the wizard buttons are found by caption (Next, Install, Finish, Install for me only)
$keys = 'ButtonNext', 'ButtonInstall', 'ButtonFinish', 'PrivilegesRequiredOverrideCurrentUser', 'PrivilegesRequiredOverrideCurrentUserRecommended'
$isl = [ordered]@{}
foreach ($m in [regex]::Matches($iss, '(?m)^Name:\s*"(\w+)";\s*MessagesFile:\s*"([^"]+)"')) {
    $file = $m.Groups[2].Value -replace '^compiler:', "$inno\"
    if (-not [IO.Path]::IsPathRooted($file)) { $file = Join-Path $root "installer\$file" }
    $text = [IO.File]::ReadAllText($file, [Text.UTF8Encoding]::new($false))
    $strings = [ordered]@{}
    foreach ($k in $keys) { $strings[$k] = [regex]::Match($text, "(?m)^$k=(.*?)\r?$").Groups[1].Value.Trim() }
    $isl[$m.Groups[1].Value] = $strings
}

# Prepare the folders shared with the sandbox (.run is not in git)
$run = Join-Path $PSScriptRoot '.run'
$in = Join-Path $run 'in'
$out = Join-Path $run 'out'
foreach ($d in $in, $out) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory $d | Out-Null
}
Copy-Item (Join-Path $PSScriptRoot 'inside.ps1'), $newSetup, $portable, $Old $in
Copy-Item (Join-Path $root 'tests\e2e\fixtures\project') (Join-Path $in 'project') -Recurse
# The Windows in the sandbox has no WebView2 runtime (a normal Win11 ships with it) and no network: first test the notice page the app shows
# without it, then install it with the offline installer.
# The offline installer goes in tests/sandbox/.cache (not in git); if it isn't there, download it from Microsoft (about 180 MB):
#   Invoke-WebRequest 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile tests/sandbox/.cache/MicrosoftEdgeWebView2RuntimeInstallerX64.exe
$webView2 = Join-Path $PSScriptRoot '.cache\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
if (Test-Path $webView2) {
    if ((Get-AuthenticodeSignature $webView2).Status -ne 'Valid') { throw "$webView2 has an invalid signature: delete it and download it again" }
    Copy-Item $webView2 $in
} else {
    Write-Host "$webView2 does not exist: WebView2 can't be installed in the sandbox, the app's UI can't start and every UI-related check will fail"
}
$config = [ordered]@{
    appId     = $appId
    webView2  = (Test-Path $webView2) ? 'C:\In\MicrosoftEdgeWebView2RuntimeInstallerX64.exe' : $null
    languages = @($isl.Keys)
    isl       = $isl
    new       = @{ version = $version; setup = "C:\In\$(Split-Path $newSetup -Leaf)"; portable = "C:\In\$(Split-Path $portable -Leaf)" }
    old       = @{ version = $oldVersion; setup = "C:\In\$(Split-Path $Old -Leaf)" }
}
[IO.File]::WriteAllText((Join-Path $in 'config.json'), ($config | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

$wsb = Join-Path $run 'sniptoss.wsb'
$xml = @"
<Configuration>
  <Networking>Disable</Networking>
  <MemoryInMB>4096</MemoryInMB>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$pwshDir</HostFolder><SandboxFolder>C:\Tools\pwsh</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$in</HostFolder><SandboxFolder>C:\In</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\Out</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>C:\Tools\pwsh\pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\In\inside.ps1</Command>
  </LogonCommand>
</Configuration>
"@
[IO.File]::WriteAllText($wsb, $xml, [Text.UTF8Encoding]::new($false))

Write-Host "Sandbox test: previous version $oldVersion → this version $version (results in $out)"
if ($StageOnly) {
    Write-Host "Only prepared the files: $in, $wsb"
    exit 0
}
& $sandboxExe $wsb
$sw = [Diagnostics.Stopwatch]::StartNew()
$done = Join-Path $out 'done.txt'
while (-not (Test-Path $done) -and $sw.Elapsed.TotalMinutes -lt $TimeoutMinutes) { Start-Sleep -Seconds 10 }
if (-not (Test-Path $done)) { Write-Host "Not finished after $TimeoutMinutes minutes, see $out\log.txt" }
# Close the sandbox (everything inside is discarded): none was open before the run (checked above), so every open one is this run's.
# wsb stop for the current Windows Sandbox, ending the window's process for the older one
# (shutting down inside the sandbox makes the window pop up a "connection lost" box)
if (-not $KeepOpen) {
    if (Get-Command wsb -ErrorAction SilentlyContinue) { foreach ($id in Open-Sandboxes) { wsb stop --id $id | Out-Null } }
    Get-Process WindowsSandboxClient, WindowsSandbox, WindowsSandboxRemoteSession -ErrorAction SilentlyContinue | Stop-Process -Force
    if (Open-Sandboxes) { Write-Host 'The sandbox is still open: close it by hand (wsb list / wsb stop --id <id>)' }
}

$results = if (Test-Path "$out\results.json") { Get-Content "$out\results.json" -Raw | ConvertFrom-Json } else { @() }
foreach ($r in $results) {
    $mark = if ($r.ok -eq $true) { 'pass' } elseif ($r.ok -eq $false) { 'FAIL' } else { '    ' }
    Write-Host ("{0} [{1}] {2}{3}" -f $mark, $r.phase, $r.name, ($r.detail ? ": $($r.detail)" : ''))
}
$failed = @($results | Where-Object { $_.ok -eq $false }).Count
Write-Host ("{0} passed, {1} failed, took {2:N0} minutes; screenshots {3}" -f @($results | Where-Object { $_.ok -eq $true }).Count, $failed, $sw.Elapsed.TotalMinutes, (Join-Path $out 'shots'))
if ($failed -or -not (Test-Path $done)) { exit 1 }

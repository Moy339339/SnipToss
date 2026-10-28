# Installer tests: run inside Windows Sandbox (started by the LogonCommand when tests/sandbox/run.ps1 launches the sandbox).
# It really installs, uninstalls and edits the registry, so it only accepts the sandbox's account and exits anywhere else.
# Reads C:\In\config.json and writes the results back to C:\Out: results.json (each check), log.txt (progress), shots\ (screenshots),
# the logs of each install / uninstall, the app's logs, and snapshots of the settings file;
# when finished it writes done.txt, and run.ps1 closes the sandbox when it sees that (unless -KeepOpen).
#
# Tested in order (an error in one step doesn't affect the next):
#   env       the system in the sandbox and the WebView2 runtime
#   portable  portable build: unzip and use, all data under data, no registry writes, %APPDATA% untouched
#   wizard    the installer wizard in every language, up to "ready to install" (a screenshot of every page), then quit
#   first     really install with the Chinese wizard → the finish page opens the app (first launch, feature tour)
#             → the app switches "start at login" and the Explorer context menu (incl. More formats) on and off and the registry is read back
#             → silent reinstall in English (does a second shortcut appear?) → uninstall (app closed)
#   upgrade   silent install of the previous version → upgrade to this version with the app running → downgrade back
#             → upgrade again → uninstall with the app running and autostart on
#   allusers  install for all users (Program Files), launch, uninstall
$ErrorActionPreference = 'Stop'
if ($env:USERNAME -ne 'WDAGUtilityAccount') { throw 'This script only runs inside Windows Sandbox (tests/sandbox/run.ps1): it really installs, uninstalls and edits the registry' }
$In = 'C:\In'
$Out = 'C:\Out'
$cfg = Get-Content "$In\config.json" -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force "$Out\shots" | Out-Null

Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type -Namespace SandboxTest -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumChildWindows(System.IntPtr parent, EnumProc proc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hwnd, System.Text.StringBuilder s, int n);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetClassName(System.IntPtr hwnd, System.Text.StringBuilder s, int n);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hwnd, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetParent(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hwnd, uint msg, System.IntPtr w, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr context);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
# Take screenshots and read coordinates in physical pixels
[void][SandboxTest.Win]::SetProcessDpiAwarenessContext([IntPtr]-4)

# ---------- Recording ----------
$results = [System.Collections.Generic.List[object]]::new()
$script:phase = 'setup'
$script:shotN = 0

function Say([string]$m) {
    $line = "$(Get-Date -Format 'HH:mm:ss') [$script:phase] $m"
    Add-Content -Path "$Out\log.txt" -Value $line -Encoding utf8
}

function Save-Results {
    [IO.File]::WriteAllText("$Out\results.json", ($results | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
}

function Check([string]$name, [bool]$ok, $detail = '') {
    $results.Add([ordered]@{ phase = $script:phase; name = $name; ok = $ok; detail = "$detail" })
    Say ('{0} {1}{2}' -f ($ok ? 'PASS' : 'FAIL'), $name, ($detail ? ": $detail" : ''))
    Save-Results
}

# Records a piece of information (neither pass nor fail)
function Note([string]$name, $detail) {
    $results.Add([ordered]@{ phase = $script:phase; name = $name; ok = $null; detail = "$detail" })
    Say "INFO $name - $detail"
    Save-Results
}

function Phase([string]$name, [scriptblock]$body) {
    $script:phase = $name
    Say '-- start'
    try {
        & $body
    } catch {
        Check 'This step did not finish (script error)' $false "$($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber)"
        Shot 'error'
    }
    Stop-App
    Say '-- end'
}

function Shot([string]$name) {
    $script:shotN++
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    Save-Shot $b.X $b.Y $b.Width $b.Height $name -Jpeg # the whole screen with its photo wallpaper: a PNG is six or seven MB each
}

function Shot-Window([IntPtr]$hwnd, [string]$name) {
    $script:shotN++
    $r = [SandboxTest.Win+RECT]::new()
    [void][SandboxTest.Win]::GetWindowRect($hwnd, [ref]$r)
    Save-Shot $r.Left $r.Top ($r.Right - $r.Left) ($r.Bottom - $r.Top) $name
}

function Save-Shot([int]$x, [int]$y, [int]$w, [int]$h, [string]$name, [switch]$Jpeg) {
    if ($w -le 0 -or $h -le 0) { return }
    $bmp = [System.Drawing.Bitmap]::new($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
        $file = '{0}\shots\{1:D2}-{2}-{3}' -f $Out, $script:shotN, $script:phase, $name
        if ($Jpeg) {
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
            $params = [System.Drawing.Imaging.EncoderParameters]::new(1)
            $params.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]88)
            $bmp.Save("$file.jpg", $codec, $params)
        } else {
            $bmp.Save("$file.png", [System.Drawing.Imaging.ImageFormat]::Png)
        }
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }
}

# ---------- The app ----------
$AppIdKey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$($cfg.appId)_is1"
$UserDir = "$env:LOCALAPPDATA\Programs\SnipToss"
$MachineDir = "$env:ProgramFiles\SnipToss"
$Project = "$env:USERPROFILE\Desktop\project"
$ContextKey = 'HKCU:\Software\Classes\Directory\shell\SnipToss'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$Cdp = 'http://127.0.0.1:9333'

# How the version is written at the bottom right of the library panel (versionLabel in brand.ts): 1.0.0-beta.84 → Beta 84, 1.0.0 → v1.0.0
function Label([string]$v) { if ($v -match '-beta\.(\d+)$') { "Beta $($Matches[1])" } else { "v$v" } }

function Invoke-Cdp([string]$expression) {
    $targets = Invoke-RestMethod "$Cdp/json" -TimeoutSec 3 -NoProxy
    $page = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -notlike 'edge://*' })[0]
    if (-not $page) { throw 'No UI page on the debugging port' }
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $ws.Options.Proxy = $null # connecting to a local port: don't look for a proxy (the sandbox may have automatic proxy detection on)
    $cts = [System.Threading.CancellationTokenSource]::new(15000)
    try {
        # Waiting on a Task's GetResult() leaks a VoidTaskResult into the output, so the return value becomes an array (always true in an if)
        $null = $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $cts.Token).GetAwaiter().GetResult()
        $msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expression; returnByValue = $true; awaitPromise = $true } } | ConvertTo-Json -Compress -Depth 5
        $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
        $null = $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
        $buf = [byte[]]::new(65536)
        $ms = [IO.MemoryStream]::new()
        do {
            $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
            $ms.Write($buf, 0, $r.Count)
        } while (-not $r.EndOfMessage)
        $resp = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
        $err = $resp.result.exceptionDetails
        if ($err) { throw "Error running in the UI: $($err.exception.description ?? $err.text)" }
        return $resp.result.result.value
    } finally {
        $ws.Dispose()
        $cts.Dispose()
    }
}

# The app is up: the app itself records "Process start → UI ready" in SNIPTOSS_PERF_LOG (Perf.cs).
# Doesn't rely on the debugging port: in the sandbox the UI is long up while the debugging port may never connect
# (see the step below that turns the debugging port on)
# Versions before 1.0.0-beta.102 wrote this label in Chinese ("UI ready" in the Chinese UI's words); the upgrade phase starts one of those as the previous version
$UiReadyBefore102 = -join ([char[]](0x754C, 0x9762, 0x5C31, 0x7EEA))
function Wait-Ui([int]$seconds = 120) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $seconds) {
        if ((Test-Path $env:SNIPTOSS_PERF_LOG) -and (Select-String -Path $env:SNIPTOSS_PERF_LOG -Pattern "UI ready|$UiReadyBefore102" -Quiet)) {
            Start-Sleep -Seconds 3 # let the library and the tour finish painting before the screenshot
            return [int]$sw.Elapsed.TotalSeconds
        }
        Start-Sleep -Milliseconds 500
    }
    return -1
}

# When the debugging port can't be reached, record why: whether the port is listening, whether WebView2 received the debugging arguments,
# and what the connection reported
function Cdp-Diagnose([string]$why) {
    if ($script:cdpDiagnosed) { return }
    $script:cdpDiagnosed = $true
    $listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -eq 9333).Count
    $browser = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    $commandLine = if ($browser) { $browser.CommandLine.Substring(0, [Math]::Min(400, $browser.CommandLine.Length)) } else { '(no WebView2 browser process)' }
    $version = try { (Invoke-RestMethod "$Cdp/json/version" -TimeoutSec 3 -NoProxy).Browser } catch { "cannot connect: $($_.Exception.Message)" }
    Note 'Debugging port diagnosis' "9333 listening: $listen; /json/version: $version; error reading the UI: $why; command line of the WebView2 browser process: $commandLine; environment variable: $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
}

function Ui-State {
    Invoke-Cdp @'
(() => {
  const v = document.querySelector('.app-version');
  return JSON.stringify({
    lang: document.documentElement.lang,
    version: v ? v.textContent : null,
    mismatch: !!document.querySelector('.app-version.is-mismatch'),
    rows: document.querySelectorAll('.lib-row-wrap').length,
    tour: !!document.querySelector('.tour'),
    broken: !!document.querySelector('.error-boundary, .error-page, .boot-error'),
    text: document.body.innerText.slice(0, 600),
  });
})()
'@ | ConvertFrom-Json
}

# Reads the UI state through the debugging port, trying for up to 20 seconds; returns $null if it can't (and records a diagnosis once)
function Read-Ui {
    $last = ''
    for ($i = 0; $i -lt 20; $i++) {
        try {
            if (Invoke-Cdp "!!document.querySelector('.app-version')") { return Ui-State }
            $last = 'the version cell is not on the page yet'
        } catch {
            $last = $_.Exception.Message
        }
        Start-Sleep -Seconds 1
    }
    Cdp-Diagnose $last
    return $null
}

# Starts the app (with the debugging port; the milliseconds until the UI is ready go into perf-*.txt), waits for the UI, checks the version,
# the library and the error fallback, and takes a screenshot
function Start-App([string]$exe, [string]$expectVersion, [string]$name, [string[]]$arguments = @(), [int]$minRows = 0) {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'
    $env:SNIPTOSS_PERF_LOG = "$Out\perf-$script:phase-$name.txt"
    $p = if ($arguments) { Start-Process $exe -ArgumentList $arguments -PassThru } else { Start-Process $exe -PassThru }
    $secs = Wait-Ui
    # (the backtick before each colon keeps "$name:" from being read as a scope-qualified variable)
    Check "$name`: the UI came up" ($secs -ge 0) ($secs -ge 0 ? "$secs s" : 'did not come up within 120 s')
    if ($secs -lt 0) {
        Shot "$name-no-ui"
        return $null
    }
    Shot $name
    $ui = Read-Ui
    if (-not $ui) {
        Check "$name`: the UI state can be read (debugging port)" $false
        return $p
    }
    Check "$name`: version $(Label $expectVersion)" ($ui.version -eq (Label $expectVersion)) "the UI shows '$($ui.version)'"
    Check "$name`: the UI and the app itself have matching versions" (-not $ui.mismatch)
    Check "$name`: the UI shows no error" (-not $ui.broken) ($ui.broken ? $ui.text : '')
    if ($minRows -gt 0) { Check "$name`: the library is still there (≥ $minRows rows)" ($ui.rows -ge $minRows) "$($ui.rows) rows" }
    Note "$name`: UI state" "language $($ui.lang), library $($ui.rows) rows, feature tour $($ui.tour)"
    return $p
}

# Ends every SnipToss (closing the window only hides it in the tray) and waits for the debugging port to be released,
# so the next run doesn't connect to the one that is exiting
function Stop-App {
    Get-Process SnipToss -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 30; $i++) {
        try { Invoke-RestMethod "$Cdp/json/version" -TimeoutSec 1 -NoProxy | Out-Null } catch { return }
        Start-Sleep -Milliseconds 500
    }
}

function Running { @(Get-Process SnipToss -ErrorAction SilentlyContinue).Count -gt 0 }

function WebView2-Version {
    @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') |
        ForEach-Object { (Get-ItemProperty $_ -ErrorAction SilentlyContinue).pv } | Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
}

# The text and buttons in a process's native windows (UI Automation; WPF windows provide it themselves, so FromHandle is enough)
function Window-Texts([int]$processId) {
    $texts = [System.Collections.Generic.List[string]]::new()
    $buttons = [System.Collections.Generic.List[string]]::new()
    foreach ($w in Top-Windows @($processId)) {
        $texts.Add("【$($w.Title)】")
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)
        foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            $type = $e.Current.ControlType.ProgrammaticName
            if ($type -eq 'ControlType.Button') { $buttons.Add($e.Current.Name) }
            elseif ($type -eq 'ControlType.Text' -and $e.Current.Name) { $texts.Add($e.Current.Name) }
        }
    }
    [pscustomobject]@{ Texts = $texts; Buttons = $buttons }
}

# Waits for a process to exit, at most this long; on timeout it is ended
# (so a silent install that pops up a window waiting for a click doesn't hang the whole run)
function Wait-Exit($p, [int]$seconds, [string]$what) {
    if ($p.WaitForExit($seconds * 1000)) { return $p.ExitCode }
    Shot "$what-hung"
    $p | Stop-Process -Force -ErrorAction SilentlyContinue
    Stop-Setup
    return "(did not exit within $seconds seconds; ended)"
}

# Silent install: /TASKS ticks only the context menu (same as the wizard's default)
function Install-Silent([string]$setup, [string]$name, [string[]]$extra = @()) {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=contextmenu', "/LOG=$Out\setup-$script:phase-$name.log") + $extra
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process $setup -ArgumentList $arguments -PassThru
    $null = $p.Handle # without taking the handle first, the exit code can't be read after the process exits
    $code = Wait-Exit $p 300 $name
    Check "${name}: installer exit code 0" ($code -eq 0) "exit code $code, $([int]$sw.Elapsed.TotalSeconds) s"
}

# Silent uninstall: the uninstaller copies itself to the temp folder and runs from there (_iu*.tmp); wait for those to exit
function Uninstall-Silent([string]$dir, [string]$name) {
    $unins = Join-Path $dir 'unins000.exe'
    if (-not (Test-Path $unins)) {
        Check "${name}: an uninstaller exists" $false $unins
        return
    }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process $unins -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$Out\uninstall-$script:phase-$name.log" -PassThru
    $null = $p.Handle
    $code = Wait-Exit $p 180 $name
    $quiet = 0
    while ($sw.Elapsed.TotalSeconds -lt 180 -and $quiet -lt 4) {
        $busy = @(Get-Process | Where-Object { $_.ProcessName -like '_iu*' -or $_.ProcessName -like 'unins0*' }).Count
        $quiet = $busy ? 0 : $quiet + 1
        Start-Sleep -Milliseconds 500
    }
    Check "${name}: uninstaller exit code 0" ($code -eq 0) "exit code $code, $([int]$sw.Elapsed.TotalSeconds) s"
}

# When the previous step didn't clean up (it exited on an error), the next step first uninstalls what is installed and ends installers still open
function Ensure-Clean {
    Stop-Setup
    Stop-App
    foreach ($d in $UserDir, $MachineDir) {
        if (Test-Path "$d\unins000.exe") {
            Say "First uninstalling what the previous step left in $d"
            Start-Process "$d\unins000.exe" -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
            Start-Sleep -Seconds 3
        }
    }
}

function Product-Version([string]$exe) {
    if (-not (Test-Path $exe)) { return '(file does not exist)' }
    (Get-Item $exe).VersionInfo.ProductVersion
}

# Compares the installed app folder with the files of the portable build one by one: extras (left by an old version) and missing ones
function Compare-Files([string]$dir, [string]$name) {
    $have = @(Get-ChildItem $dir -Recurse -File | ForEach-Object { $_.FullName.Substring($dir.Length + 1) } |
            Where-Object { $_ -notmatch '^unins\d+\.(exe|dat|msg)$' })
    $extra = @($have | Where-Object { -not $script:expectedFiles.Contains($_) })
    $missing = @($script:expectedFiles | Where-Object { $have -notcontains $_ })
    Check "${name}: the app files match this version's package (none missing)" ($missing.Count -eq 0) (($missing | Select-Object -First 5) -join '; ')
    $staleUi = @($extra | Where-Object { $_ -like 'ui\*' })
    Check "${name}: no UI files from the old version left behind" ($staleUi.Count -eq 0) (($staleUi | Select-Object -First 5) -join '; ')
    if ($extra.Count) { Note "${name}: other files left by the old version" "$($extra.Count) files: $((($extra | Where-Object { $_ -notlike 'ui\*' }) | Select-Object -First 8) -join '; ')" }
}

function Shortcuts {
    $shell = New-Object -ComObject WScript.Shell
    $dirs = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:USERPROFILE\Desktop", "$env:PUBLIC\Desktop"
    @(foreach ($d in $dirs) {
            Get-ChildItem $d -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | Where-Object { $shell.CreateShortcut($_.FullName).TargetPath -like '*\SnipToss.exe' } | ForEach-Object { $_.FullName }
        })
}

function Context-Menu {
    $k = Get-Item "$ContextKey\command" -ErrorAction SilentlyContinue
    if ($k) { $k.GetValue('') } else { $null }
}

function Errors-In-Log([string]$logDir, [string]$name) {
    $lines = @(Get-ChildItem $logDir -Filter *.log -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName -Encoding utf8 } |
            Where-Object { $_ -match '\[ERROR\]' })
    Check "${name}: no ERROR in the app log" ($lines.Count -eq 0) (($lines | Select-Object -First 3) -join ' ‖ ')
    $warns = @(Get-ChildItem $logDir -Filter *.log -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName -Encoding utf8 } | Where-Object { $_ -match '\[WARN\]' })
    if ($warns.Count) { Note "${name}: WARN lines in the log" "$($warns.Count) lines: $(($warns | Select-Object -First 3) -join ' ‖ ')" }
}

function Save-Settings([string]$name) {
    $f = "$env:APPDATA\SnipToss\settings.json"
    if (Test-Path $f) { Copy-Item $f "$Out\settings-$script:phase-$name.json" }
}

function Reset-UserData {
    Stop-App
    Remove-Item "$env:APPDATA\SnipToss", "$env:LOCALAPPDATA\SnipToss" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty $RunKey -Name SnipToss -ErrorAction SilentlyContinue
}

# ---------- The app writing the registry itself (through the bridge, the way the Settings page does) ----------

# Calls a shell method the way the UI does (window.chrome.webview.postMessage) over the debugging port and returns the reply as an object ($null for an empty reply).
# A shell error comes back as an exception (the same Invoke-Cdp error as any other failure in the UI)
function Ask-Host([string]$method, $params = $null) {
    $json = $params | ConvertTo-Json -Compress -Depth 6
    $reply = Invoke-Cdp @"
new Promise((resolve, reject) => {
  const wv = window.chrome.webview;
  const id = 920000 + Math.floor(Math.random() * 1000);
  const on = (e) => {
    const d = e.data;
    if (d?.id !== id) return;
    wv.removeEventListener('message', on);
    if (d.error !== undefined) reject(new Error(d.error)); else resolve(JSON.stringify(d.result ?? null));
  };
  wv.addEventListener('message', on);
  wv.postMessage({ id, method: '$method', params: $json });
})
"@
    $reply | ConvertFrom-Json
}

# A step that must not stop the rest of the phase when it breaks
function Guarded([string]$what, [scriptblock]$body) {
    try {
        & $body
    } catch {
        Check "$what did not finish (script error)" $false "$($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber)"
    }
}

# "Start at login" (Settings → General): the app writes HKCU Run\SnipToss itself. $exe is the installed program, which is running and listening on the debugging port
function Check-Autostart([string]$exe) {
    $name = 'SnipToss'
    $former = -join ([char[]](0x8d85, 0x7ea7, 0x6279, 0x6ce8)) # the product's Chinese name: the value name used before it became SnipToss
    $expected = "`"$exe`" --tray"
    # (not Get-ItemPropertyValue: for a value that isn't there it throws even with -ErrorAction SilentlyContinue)
    $value = { param($n) (Get-ItemProperty $RunKey -ErrorAction SilentlyContinue).$n }
    Remove-ItemProperty $RunKey -Name $name, $former -ErrorAction SilentlyContinue
    Check 'Autostart: with nothing registered the app reports it off' ((Ask-Host 'captureSettings').autostart -eq $false)

    $on = Ask-Host 'setCaptureSettings' @{ autostart = $true }
    Check 'Autostart: switching it on answers "on"' ($on.autostart -eq $true)
    Check 'Autostart: the Run value SnipToss starts the installed program with --tray' ((& $value $name) -eq $expected) (& $value $name)
    Check 'Autostart: reading the state again says "on"' ((Ask-Host 'captureSettings').autostart -eq $true)

    $off = Ask-Host 'setCaptureSettings' @{ autostart = $false }
    Check 'Autostart: switching it off answers "off" and removes the value' ($off.autostart -eq $false -and $null -eq (& $value $name)) (& $value $name)

    # The program was moved or reinstalled elsewhere: a value that points to another program does not count as on, and switching on replaces it
    Set-ItemProperty $RunKey -Name $name -Value '"C:\Somewhere else\SnipToss.exe" --tray'
    Check 'Autostart: a value pointing to another program counts as off' ((Ask-Host 'captureSettings').autostart -eq $false)
    $null = Ask-Host 'setCaptureSettings' @{ autostart = $true }
    Check 'Autostart: switching on replaces a value that pointed elsewhere' ((& $value $name) -eq $expected) (& $value $name)

    # The pre-rename value name still counts as on, and switching on moves it to the new name
    Remove-ItemProperty $RunKey -Name $name
    Set-ItemProperty $RunKey -Name $former -Value $expected
    Check 'Autostart: the value name from before the rename counts as on' ((Ask-Host 'captureSettings').autostart -eq $true)
    $null = Ask-Host 'setCaptureSettings' @{ autostart = $true }
    Check 'Autostart: switching on moves the old value name to SnipToss' ((& $value $name) -eq $expected -and $null -eq (& $value $former)) "SnipToss=$(& $value $name); old=$(& $value $former)"

    $null = Ask-Host 'setCaptureSettings' @{ autostart = $false }
    Check 'Autostart: left off at the end' ($null -eq (& $value $name) -and $null -eq (& $value $former))
}

# The Explorer context menu (Settings → Advanced → Windows integration, and More formats): which registry keys exist for which switch.
# The extension lists are the same as ShellIntegrationTests (MaterialScanner.Kinds without / with the More set)
function Check-ContextMenuKeys([string]$exe) {
    $classes = 'HKCU:\Software\Classes'
    $verb = 'SnipToss'
    $common = '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.mp4', '.webm', '.mov', '.m4v'
    $more = '.jfif', '.jpe', '.pjpeg', '.pjp', '.apng', '.ico', '.tif', '.tiff', '.heic', '.heif', '.mkv'
    $former = '.pdf', '.pptx', '.ppt'
    $extKey = { param($e) "$classes\SystemFileAssociations\$e\shell\$verb" }
    $present = { param($exts) @($exts | Where-Object { Test-Path (& $extKey $_) }) }
    $missing = { param($exts) @($exts | Where-Object { -not (Test-Path (& $extKey $_)) }) }
    $command = { param($key) (Get-Item "$key\command" -ErrorAction SilentlyContinue)?.GetValue('') }
    $setMore = {
        param([bool]$on)
        $h = @{}
        $current = Ask-Host 'getPrefs'
        if ($current) { $current.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }
        $h['moreFormats'] = $on
        $null = Ask-Host 'setPrefs' @{ prefs = $h }
    }

    # Entries left by an earlier version for PDF and PPT (no longer accepted): turning the menu on must clear them
    foreach ($e in $former) { New-Item "$(& $extKey $e)\command" -Force | Out-Null }
    $null = Ask-Host 'setShellIntegration' @{ enable = $true }
    Check 'Context menu: switching it on answers "on"' ((Ask-Host 'shellIntegration') -eq $true)
    Check 'Context menu: folders, folder blank space and the 12 common types each have a key' ((Test-Path "$classes\Directory\shell\$verb") -and (Test-Path "$classes\Directory\Background\shell\$verb") -and (& $missing $common).Count -eq 0) "missing: $((& $missing $common) -join ' ')"
    Check 'Context menu: the commands open the clicked item (%1) and, on folder blank space, the current folder (%V)' (
        (& $command "$classes\Directory\shell\$verb") -eq "`"$exe`" `"%1`"" -and
        (& $command "$classes\Directory\Background\shell\$verb") -eq "`"$exe`" `"%V`"" -and
        @($common | Where-Object { (& $command (& $extKey $_)) -ne "`"$exe`" `"%1`"" }).Count -eq 0) (& $command "$classes\Directory\Background\shell\$verb")
    $wrongIcon = @($common | Where-Object { (Get-Item (& $extKey $_)).GetValue('Icon') -ne "`"$exe`",0" })
    Check 'Context menu: every entry uses the program''s own icon' ($wrongIcon.Count -eq 0 -and (Get-Item "$classes\Directory\shell\$verb").GetValue('Icon') -eq "`"$exe`",0") ($wrongIcon -join ' ')
    Note 'Context menu: text' (Get-Item "$classes\Directory\shell\$verb").GetValue('')
    Check 'Context menu: none of the 11 More formats and none of PDF / PPT yet' ((& $present ($more + $former)).Count -eq 0) "present: $((& $present ($more + $former)) -join ' ')"

    # Settings → Advanced → More formats: the extra types are added and removed under a registered menu at once
    & $setMore $true
    Check 'Context menu: More formats on adds the 11 extra types' ((& $missing $more).Count -eq 0 -and (& $missing $common).Count -eq 0) "missing: $((& $missing ($more + $common)) -join ' ')"
    & $setMore $false
    Check 'Context menu: More formats off removes them again and keeps the 12 common ones' ((& $present $more).Count -eq 0 -and (& $missing $common).Count -eq 0) "left: $((& $present $more) -join ' '); missing: $((& $missing $common) -join ' ')"

    # Off: everything goes, including the extra types and the PDF / PPT entries an earlier version registered
    & $setMore $true
    foreach ($e in $former) { New-Item "$(& $extKey $e)\command" -Force | Out-Null }
    $null = Ask-Host 'setShellIntegration' @{ enable = $false }
    $left = @(@('Directory', 'Directory\Background') | Where-Object { Test-Path "$classes\$_\shell\$verb" }) + (& $present ($common + $more + $former))
    Check 'Context menu: switching it off deletes every key (folders, blank space, all types, PDF / PPT)' ($left.Count -eq 0 -and (Ask-Host 'shellIntegration') -eq $false) ($left -join ' ')

    # Back to how the installer left it: on, common types only
    & $setMore $false
    $null = Ask-Host 'setShellIntegration' @{ enable = $true }
    Check 'Context menu: switched on again for the rest of the run' ((Ask-Host 'shellIntegration') -eq $true -and (& $missing $common).Count -eq 0 -and (& $present $more).Count -eq 0)
}

# Explorer: select several files, right-click, "Open with SnipToss". The shell runs the verb once per selected file, each in its own process,
# all within a moment; they must end up as one window with every file in its library. FolderItems.InvokeVerbEx is the shell's own
# multi-selection invocation (the same verb on the same selection as the context menu), so no mouse is needed.
# Warm: the app is running. Cold: nothing is running, so the processes race to become the window (the case most likely to break).
# Needs the context menu registered (Check-ContextMenuKeys leaves it on)
function Check-MultiSelectOpen {
    $log = "$env:LOCALAPPDATA\SnipToss\logs\SnipToss-$(Get-Date -Format yyyyMMdd).log"
    $logSize = { if (Test-Path $log) { (Get-Item $log).Length } else { 0 } }
    foreach ($mode in 'warm', 'cold') {
        $dir = "$env:USERPROFILE\Desktop\multi-$mode"
        New-Item -ItemType Directory -Force $dir | Out-Null
        $picks = 1..5 | ForEach-Object { $f = "$dir\pick$_.png"; Copy-Item "$Project\assets\hero.png" $f; $f }
        if ($mode -eq 'cold') { Stop-App }
        $logFrom = & $logSize
        $items = (New-Object -ComObject Shell.Application).Namespace($dir).Items()
        $items.Filter(0x40, '*.png') # SHCONTF_NONFOLDERS: the five files, as if selected together
        Note "Multi-select open ($mode): selection" "$($items.Count) files"
        $items.InvokeVerbEx('SnipToss')
        # Wait until every file is in the library of the one window that stays (cold: its UI has to come up first)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $inLib = @()
        while ($sw.Elapsed.TotalSeconds -lt 90) {
            Start-Sleep -Seconds 2
            try { $paths = @((Ask-Host 'library').entries.path) } catch { continue }
            $inLib = @($picks | Where-Object { $paths -contains $_ })
            if ($inLib.Count -eq $picks.Count -and @(Get-Process SnipToss -ErrorAction SilentlyContinue).Count -eq 1) { break }
        }
        Check "Multi-select open ($mode): all five files are in the library" ($inLib.Count -eq $picks.Count) "$($inLib.Count) of $($picks.Count) after $([int]$sw.Elapsed.TotalSeconds) s"
        Start-Sleep -Seconds 3 # let a forwarding process that is slow to exit finish
        $procs = @(Get-Process SnipToss -ErrorAction SilentlyContinue)
        $windows = @($procs | Where-Object { $_.MainWindowHandle -ne 0 })
        Check "Multi-select open ($mode): exactly one process and one window are left" ($procs.Count -eq 1 -and $windows.Count -eq 1) "processes $($procs.Count), with a window $($windows.Count)"
        # What the log gained since the invocation (read shared: the app may be writing to it)
        $added = ''
        if (Test-Path $log) {
            $fs = [IO.FileStream]::new($log, 'Open', 'Read', 'ReadWrite, Delete')
            try {
                $null = $fs.Seek([Math]::Min($logFrom, $fs.Length), 'Begin')
                $added = [IO.StreamReader]::new($fs).ReadToEnd()
            } finally {
                $fs.Dispose()
            }
        }
        $lost = @($added -split "`n" | Where-Object { $_ -match 'Could not reach the window that is already open|the forwarded message was not received' })
        Check "Multi-select open ($mode): no process failed to hand its file to the open window" ($lost.Count -eq 0) ($lost | Select-Object -First 2)
        Shot "multi-select-$mode"
    }
}

# ---------- Installer wizard (UI automation) ----------
# The installer: setup.exe unpacks the wizard to %TEMP%\is-*.tmp\ and runs it from there, so the window belongs to that process
function Setup-Processes {
    Get-Process | Where-Object {
        $path = try { $_.Path } catch { $null }
        $_.ProcessName -like 'SnipToss-*setup*' -or $path -like '*\is-*.tmp\*'
    }
}

function Setup-Pids { @(Setup-Processes | ForEach-Object { $_.Id }) }

function Top-Windows([int[]]$pids) {
    $found = [System.Collections.Generic.List[object]]::new()
    [void][SandboxTest.Win]::EnumWindows({
            param($h, $l)
            $p = 0
            [void][SandboxTest.Win]::GetWindowThreadProcessId($h, [ref]$p)
            if ($pids -contains [int]$p -and [SandboxTest.Win]::IsWindowVisible($h)) {
                $r = [SandboxTest.Win+RECT]::new()
                [void][SandboxTest.Win]::GetWindowRect($h, [ref]$r)
                if ($r.Right - $r.Left -gt 50) {
                    $c = [Text.StringBuilder]::new(256)
                    [void][SandboxTest.Win]::GetClassName($h, $c, 256)
                    $t = [Text.StringBuilder]::new(512)
                    [void][SandboxTest.Win]::GetWindowText($h, $t, 512)
                    $found.Add([pscustomobject]@{ Handle = $h; Class = "$c"; Title = "$t" })
                }
            }
            return $true
        }, [IntPtr]::Zero)
    $found
}

function Plain([string]$s) { ($s -replace '&', '').Trim() }

# The visible buttons in a window (Inno's TNewButton is a subclass of the Win32 button): text and position
function Child-Buttons([IntPtr]$hwnd) {
    $found = [System.Collections.Generic.List[object]]::new()
    [void][SandboxTest.Win]::EnumChildWindows($hwnd, {
            param($h, $l)
            $c = [Text.StringBuilder]::new(256)
            [void][SandboxTest.Win]::GetClassName($h, $c, 256)
            if ("$c" -match 'Button' -and "$c" -notmatch 'Radio|Check' -and [SandboxTest.Win]::IsWindowVisible($h)) {
                $t = [Text.StringBuilder]::new(512)
                [void][SandboxTest.Win]::GetWindowText($h, $t, 512)
                $r = [SandboxTest.Win+RECT]::new()
                [void][SandboxTest.Win]::GetWindowRect($h, [ref]$r)
                $found.Add([pscustomobject]@{ Handle = $h; Text = (Plain "$t"); Left = $r.Left; Top = $r.Top })
            }
            return $true
        }, [IntPtr]::Zero)
    $found
}

# Clicks a button: sends WM_COMMAND / BN_CLICKED to the parent window (the VCL finds the button by lParam and calls its Click);
# the window needn't be in the foreground, and it doesn't wait for what the click triggers to finish
function Click-Button($button) {
    [void][SandboxTest.Win]::PostMessage([SandboxTest.Win]::GetParent($button.Handle), 0x0111, [IntPtr]::Zero, $button.Handle)
}

# The dialog for choosing how to install (for me only / for all users): it may be a task dialog (the buttons aren't child windows),
# so when no child-window button is found, UI Automation is used
function Choose-CurrentUser($window, $strings) {
    $want = @((Plain $strings.PrivilegesRequiredOverrideCurrentUserRecommended), (Plain $strings.PrivilegesRequiredOverrideCurrentUser)) | Where-Object { $_ }
    $b = Child-Buttons $window.Handle | Where-Object { $t = $_.Text; $want | Where-Object { $t.StartsWith($_) } } | Select-Object -First 1
    if ($b) {
        Click-Button $b
        return $true
    }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
    foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($e.Current.ControlType.ProgrammaticName -ne 'ControlType.Button') { continue }
        $n = Plain $e.Current.Name
        if (-not ($want | Where-Object { $n.StartsWith($_) })) { continue }
        $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        return $true
    }
    return $false
}

function Wait-SetupWindow([int]$seconds = 60) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $seconds) {
        $w = Top-Windows (Setup-Pids) | Select-Object -First 1
        if ($w) { return $w }
        Start-Sleep -Milliseconds 300
    }
    return $null
}

function Stop-Setup { Setup-Processes | Stop-Process -Force -ErrorAction SilentlyContinue }

# Walks through the wizard: a screenshot of each page, clicking Next; at "ready to install", -Install goes on to install,
# screenshots the finish page and clicks Finish ("run the app" is ticked by default); otherwise it quits
function Drive-Wizard([string]$lang, [switch]$Install) {
    $s = $cfg.isl.$lang
    Stop-Setup
    $p = Start-Process $cfg.new.setup -ArgumentList "/LANG=$lang", "/LOG=$Out\wizard-$lang.log" -PassThru
    $w = Wait-SetupWindow
    if (-not $w) {
        Check "${lang}: the wizard came up" $false
        return
    }
    Start-Sleep -Milliseconds 800
    # What comes up first is "choose how to install" (PrivilegesRequiredOverridesAllowed=dialog): there is no Next in the window
    if (-not (Child-Buttons $w.Handle | Where-Object { $_.Text -eq (Plain $s.ButtonNext) })) {
        Shot-Window $w.Handle "$lang-mode"
        $ok = Choose-CurrentUser $w $s
        Check "${lang}: choose Install for me only" $ok "window '$($w.Title)' ($($w.Class))"
        if (-not $ok) {
            Stop-Setup
            return
        }
        Start-Sleep -Milliseconds 1500
    }
    for ($page = 1; $page -le 8; $page++) {
        $w = Wait-SetupWindow 10
        if ($page -eq 1 -and $w) { Say "Wizard window: $($w.Class) '$($w.Title)'" }
        if (-not $w) {
            Check "${lang}: page $page is still there" $false
            return
        }
        Start-Sleep -Milliseconds 700
        $buttons = @(Child-Buttons $w.Handle)
        $bottom = ($buttons | Measure-Object Top -Maximum).Maximum
        $row = @($buttons | Where-Object { $_.Top -ge $bottom - 8 } | Sort-Object Left)
        # Don't name the variable $install: PowerShell variables are case-insensitive and it would collide with the -Install switch
        $finishButton = $row | Where-Object { $_.Text -eq (Plain $s.ButtonFinish) } | Select-Object -First 1
        $installButton = $row | Where-Object { $_.Text -eq (Plain $s.ButtonInstall) } | Select-Object -First 1
        $next = if ($finishButton) { $finishButton } elseif ($installButton) { $installButton } elseif ($row.Count -ge 2) { $row[-2] } else { $row[-1] }
        Shot-Window $w.Handle "$lang-p$page"
        if ($finishButton) {
            Click-Button $finishButton
            Check "${lang}: reached the finish page" $true
            return
        }
        if ($installButton) {
            if (-not $Install) {
                Check "${lang}: reached Ready to Install" $true "page $page"
                Stop-Setup
                return
            }
            Click-Button $installButton
            # While installing, the row of buttons that held Next changes; wait for Finish to appear
            $sw = [Diagnostics.Stopwatch]::StartNew()
            while ($sw.Elapsed.TotalSeconds -lt 180) {
                Start-Sleep -Seconds 1
                $w = Top-Windows (Setup-Pids) | Select-Object -First 1
                if ($w -and (Child-Buttons $w.Handle | Where-Object { $_.Text -eq (Plain $s.ButtonFinish) })) { break }
            }
            Check "${lang}: install finished and reached the finish page" ($sw.Elapsed.TotalSeconds -lt 180) "$([int]$sw.Elapsed.TotalSeconds) s"
            continue
        }
        if (-not $next) {
            Check "${lang}: Next found on page $page" $false (($buttons | ForEach-Object Text) -join ', ')
            Stop-Setup
            return
        }
        Click-Button $next
        Start-Sleep -Milliseconds 1200
    }
    Check "${lang}: finished within 8 pages" $false
    Stop-Setup
}

# =====================================================================
Say "Sandbox test started: previous version $($cfg.old.version), this version $($cfg.new.version)"
# Wait for the desktop and taskbar first
for ($i = 0; $i -lt 60 -and -not (Get-Process explorer -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
Start-Sleep -Seconds 8
Copy-Item "$In\project" $Project -Recurse -Force

Phase 'env' {
    $os = Get-CimInstance Win32_OperatingSystem
    Note 'System' "$($os.Caption) $($os.Version), display language $((Get-Culture).Name) / $([Globalization.CultureInfo]::CurrentUICulture.Name)"
    $wv = WebView2-Version
    Note 'WebView2 runtime' ($wv ? $wv : 'not installed')
    $admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $script:isAdmin = $admin
    Note 'Administrator (elevated)' $admin
    # Every process in the sandbox is an elevated administrator: from version 150 WebView2 ignores
    # WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS and the HKCU policy for an elevated app, so the debugging port can only be turned on
    # through the HKLM policy (with only the environment variable the port isn't listening, and the browser process's command line
    # has only the arguments the app gave itself)
    $policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
    New-Item $policy -Force | Out-Null
    Set-ItemProperty $policy -Name 'SnipToss.exe' -Value '--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required'
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    Note 'Screen' "$($b.Width)x$($b.Height)"
    Shot 'desktop'
}

Phase 'portable' {
    $root = "$env:USERPROFILE\Desktop\portable"
    Expand-Archive $cfg.new.portable $root -Force
    $dir = "$root\SnipToss"
    Check 'The extracted folder has SnipToss\data' (Test-Path "$dir\data")
    $script:expectedFiles = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    Get-ChildItem $dir -Recurse -File | ForEach-Object { [void]$script:expectedFiles.Add($_.FullName.Substring($dir.Length + 1)) }
    Note 'App files in the package' "$($script:expectedFiles.Count) files"

    # The sandbox has no WebView2 (a normal Win11 ships with it): first look at the notice page the app shows without it,
    # then install it (offline installer, shared in by run.ps1)
    if (-not (WebView2-Version)) {
        $p = Start-Process "$dir\SnipToss.exe" -PassThru
        Start-Sleep -Seconds 12
        Shot 'no-webview2'
        $ui = Window-Texts $p.Id
        Note 'No WebView2: text in the window' ($ui.Texts -join ' ‖ ')
        Check 'No WebView2: the app does not crash and shows a notice page' (-not $p.HasExited -and ($ui.Texts -join ' ') -match 'WebView2') "buttons: $($ui.Buttons -join ', ')"
        Check 'No WebView2: there is a "download WebView2" button' (@($ui.Buttons | Where-Object { $_ -match 'WebView2' }).Count -eq 1) ($ui.Buttons -join ', ')
        Stop-App
        Remove-Item "$dir\data\*" -Recurse -Force -ErrorAction SilentlyContinue # the portable build starts from a clean data folder from here on
        if ($cfg.webView2) {
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $w = Start-Process $cfg.webView2 -ArgumentList '/silent', '/install' -PassThru
            $null = $w.Handle
            $code = Wait-Exit $w 300 'webview2'
            Check 'WebView2 runtime installed (offline installer)' ([bool](WebView2-Version)) "exit code $code, $([int]$sw.Elapsed.TotalSeconds) s, version $(WebView2-Version)"
        } else {
            Note 'WebView2' 'There is no offline installer (tests/sandbox/.cache), the UI cannot start, and every UI-related check below will fail'
        }
    }

    Start-App "$dir\SnipToss.exe" $cfg.new.version 'start' @("`"$Project`"") 1 | Out-Null
    Check 'Settings are written to data\settings.json' (Test-Path "$dir\data\settings.json")
    Check 'Logs are written to data\logs' (Test-Path "$dir\data\logs")
    Check 'WebView2 data is under data' (Test-Path "$dir\data\WebView2")
    Check '%APPDATA%\SnipToss untouched' (-not (Test-Path "$env:APPDATA\SnipToss"))
    Check '%LOCALAPPDATA%\SnipToss untouched' (-not (Test-Path "$env:LOCALAPPDATA\SnipToss"))
    Check 'No context menu written' (-not (Test-Path $ContextKey))
    Check 'No autostart written' ($null -eq (Get-ItemProperty $RunKey -ErrorAction SilentlyContinue).SnipToss)
    Stop-App
    Errors-In-Log "$dir\data\logs" 'portable build'
    Copy-Item "$dir\data\logs" "$Out\applogs-portable" -Recurse -ErrorAction SilentlyContinue
}

Phase 'wizard' {
    foreach ($lang in $cfg.languages) {
        if ($lang -eq 'zhCN') { continue } # Chinese is covered by the real install in the next step
        Drive-Wizard $lang
    }
    Check 'Nothing installed after quitting the wizard' (-not (Test-Path $UserDir))
}

Phase 'first' {
    Ensure-Clean
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333' # the app the finish page opens inherits this environment
    $env:SNIPTOSS_PERF_LOG = "$Out\perf-first-wizard.txt"
    Drive-Wizard 'zhCN' -Install
    $secs = Wait-Ui
    Check 'The finish page opened the app' ($secs -ge 0) ($secs -ge 0 ? "$secs s" : 'did not come up')
    if ($secs -ge 0) {
        Shot 'first-run'
    }
    $ui = if ($secs -ge 0) { Read-Ui } else { $null }
    if ($secs -ge 0 -and -not $ui) { Check 'First launch: the UI state can be read (debugging port)' $false }
    if ($ui) {
        Check "First launch: version $(Label $cfg.new.version)" ($ui.version -eq (Label $cfg.new.version)) $ui.version
        # The library is empty: the welcome page shows, and the feature tour only runs once a file is first shown
        # (onboarding.ts; the portable-build step starts with a file, so it shows the tour)
        Check 'First launch: library empty, welcome page shown, no tour' ($ui.rows -eq 0 -and -not $ui.tour) "library $($ui.rows) rows, tour $($ui.tour)"
        Check 'First launch: the UI shows no error' (-not $ui.broken)
        Note 'First launch: UI language' $ui.lang
    }
    Check 'Installed in %LOCALAPPDATA%\Programs\SnipToss' (Test-Path "$UserDir\SnipToss.exe")
    Check 'Version is right' ((Product-Version "$UserDir\SnipToss.exe") -like "$($cfg.new.version)*") (Product-Version "$UserDir\SnipToss.exe")
    $key = Get-ItemProperty "HKCU:\$AppIdKey" -ErrorAction SilentlyContinue
    Check 'Listed in Apps & features (per user)' ($null -ne $key) "$($key.DisplayName) $($key.DisplayVersion), publisher $($key.Publisher)"
    Check 'Nothing written to HKLM' (-not (Test-Path "HKLM:\$AppIdKey"))
    $menu = Context-Menu
    Check 'The context menu points to the installed app' ($menu -like "*$UserDir\SnipToss.exe*") $menu
    Note 'Context menu text' ((Get-Item $ContextKey -ErrorAction SilentlyContinue)?.GetValue(''))
    $links = Shortcuts
    Check 'A Start menu shortcut exists and none on the desktop (not ticked by default)' (@($links | Where-Object { $_ -like '*Start Menu*' }).Count -eq 1 -and -not ($links | Where-Object { $_ -like '*Desktop*' })) ($links -join '; ')
    Check 'WebView2 data is in %LOCALAPPDATA%\SnipToss' (Test-Path "$env:LOCALAPPDATA\SnipToss\WebView2")
    Check 'No WebView2 data next to the app' (-not (Get-ChildItem $UserDir -Directory -Filter '*.WebView2' -ErrorAction SilentlyContinue))
    Save-Settings 'after-first-run'
    # The app is running (the finish page opened it, with the debugging port on): switch things the way the Settings page does and read the registry back.
    # A sandbox is thrown away afterwards, so nothing here touches anyone's real context menu or startup entries
    if ($ui) {
        Guarded 'Start at login' { Check-Autostart "$UserDir\SnipToss.exe" }
        Guarded 'Context menu registration' { Check-ContextMenuKeys "$UserDir\SnipToss.exe" }
        Guarded 'Multi-select open' { Check-MultiSelectOpen }
    } else {
        Note 'Start at login and context menu registration' 'Skipped: the UI state could not be read over the debugging port'
    }
    Stop-App

    # Silent reinstall (repair) in English: the shortcut's name follows the install language (the Chinese name for Chinese,
    # SnipToss for English); does it coexist with the Chinese one?
    Install-Silent $cfg.new.setup 'reinstall-en' @('/LANG=en')
    $links = Shortcuts
    Note 'Shortcuts after the English reinstall' ($links -join '; ')
    Check 'Only one Start menu shortcut after the reinstall' (@($links | Where-Object { $_ -like '*Start Menu*' }).Count -eq 1) ($links -join '; ')

    Uninstall-Silent $UserDir 'uninstall'
    Check 'Uninstall: the app folder was deleted' (-not (Test-Path $UserDir)) ((Get-ChildItem $UserDir -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object Name) -join '; ')
    Check 'Uninstall: gone from Apps & features' (-not (Test-Path "HKCU:\$AppIdKey"))
    Check 'Uninstall: the context menu was removed' (-not (Test-Path $ContextKey))
    Check 'Uninstall: the shortcuts were removed' (-not (Shortcuts)) ((Shortcuts) -join '; ')
    Check 'Uninstall: user settings are still there' (Test-Path "$env:APPDATA\SnipToss\settings.json")
    Check 'Uninstall: the notes in the project are still there' (Test-Path "$Project\.sniptoss\annotations")
    Errors-In-Log "$env:LOCALAPPDATA\SnipToss\logs" 'first install'
    Copy-Item "$env:LOCALAPPDATA\SnipToss\logs" "$Out\applogs-first" -Recurse -ErrorAction SilentlyContinue
}

Phase 'upgrade' {
    Ensure-Clean
    Reset-UserData
    $exe = "$UserDir\SnipToss.exe"

    Install-Silent $cfg.old.setup 'old'
    Check "Previous version installed ($($cfg.old.version))" ((Product-Version $exe) -like "$($cfg.old.version)*") (Product-Version $exe)
    Start-App $exe $cfg.old.version 'old' @("`"$Project`"") 1 | Out-Null
    Save-Settings 'old'

    # Upgrading with the app running: the installer must first make it quit (CloseApplications, Restart Manager)
    Install-Silent $cfg.new.setup 'upgrade'
    Start-Sleep -Seconds 2
    Check 'Upgrade: the running old app was closed' (-not (Running))
    Stop-App
    Check "Upgrade: the app is this version ($($cfg.new.version))" ((Product-Version $exe) -like "$($cfg.new.version)*") (Product-Version $exe)
    Compare-Files $UserDir 'upgrade'
    Check 'Upgrade: the version in Apps & features changed along' ((Get-ItemProperty "HKCU:\$AppIdKey" -ErrorAction SilentlyContinue).DisplayVersion -eq $cfg.new.version) (Get-ItemProperty "HKCU:\$AppIdKey" -ErrorAction SilentlyContinue).DisplayVersion
    Check 'Upgrade: the context menu still points to the app' ((Context-Menu) -like "*$exe*") (Context-Menu)
    Start-App $exe $cfg.new.version 'new' @() 1 | Out-Null
    Save-Settings 'new'

    # Downgrade: with this version running, install the previous one over it
    Install-Silent $cfg.old.setup 'downgrade'
    Start-Sleep -Seconds 2
    Check 'Downgrade: the running app was closed' (-not (Running))
    Stop-App
    Check "Downgrade: the app is back to the previous version" ((Product-Version $exe) -like "$($cfg.old.version)*") (Product-Version $exe)
    Start-App $exe $cfg.old.version 'downgraded' @() 1 | Out-Null
    Save-Settings 'downgraded'

    # Upgrade again
    Install-Silent $cfg.new.setup 'reupgrade'
    Start-Sleep -Seconds 2
    Check 'Upgrade again: the running app was closed' (-not (Running))
    Stop-App
    Compare-Files $UserDir 'upgrade again'
    Start-App $exe $cfg.new.version 'reupgraded' @() 1 | Out-Null
    Save-Settings 'reupgraded'

    # Uninstall with the app running and autostart on (autostart is written the way the app writes it: Autostart in HostServices.cs)
    Set-ItemProperty $RunKey -Name SnipToss -Value "`"$exe`" --tray"
    Uninstall-Silent $UserDir 'uninstall'
    Start-Sleep -Seconds 2
    Check 'Uninstall: the running app was closed' (-not (Running))
    Check 'Uninstall: the app folder was deleted' (-not (Test-Path $UserDir)) ((Get-ChildItem $UserDir -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object Name) -join '; ')
    Check 'Uninstall: gone from Apps & features' (-not (Test-Path "HKCU:\$AppIdKey"))
    Check 'Uninstall: the context menu was removed' (-not (Test-Path $ContextKey))
    Check 'Uninstall: the autostart entry was removed' ($null -eq (Get-ItemProperty $RunKey -ErrorAction SilentlyContinue).SnipToss)
    Check 'Uninstall: the shortcuts were removed' (-not (Shortcuts))
    Check 'Uninstall: the library (in settings) is still there' ((Get-Content "$env:APPDATA\SnipToss\settings.json" -Raw -ErrorAction SilentlyContinue) -match 'project')
    Stop-App
    Errors-In-Log "$env:LOCALAPPDATA\SnipToss\logs" 'upgrade and downgrade'
    Copy-Item "$env:LOCALAPPDATA\SnipToss\logs" "$Out\applogs-upgrade" -Recurse -ErrorAction SilentlyContinue
}

Phase 'allusers' {
    if (-not $script:isAdmin) {
        Note 'Skipped' 'The sandbox account has no elevated administrator rights, and installing for all users would pop up a UAC prompt'
        return
    }
    Ensure-Clean
    Reset-UserData
    $exe = "$MachineDir\SnipToss.exe"
    Install-Silent $cfg.new.setup 'install' @('/ALLUSERS')
    Check 'Installed in Program Files' (Test-Path $exe)
    Check 'Listed in Apps & features (HKLM)' (Test-Path "HKLM:\$AppIdKey")
    Check 'The per-user entry was not installed' (-not (Test-Path "HKCU:\$AppIdKey"))
    Check 'The Start menu (all users) has a shortcut' (@(Shortcuts | Where-Object { $_ -like "$env:ProgramData*" }).Count -eq 1) ((Shortcuts) -join '; ')
    Check 'The context menu points to the app in Program Files' ((Context-Menu) -like "*$exe*") (Context-Menu)
    Start-App $exe $cfg.new.version 'start' @("`"$Project`"") 1 | Out-Null
    Check 'WebView2 data is in %LOCALAPPDATA%\SnipToss' (Test-Path "$env:LOCALAPPDATA\SnipToss\WebView2")
    Check 'Nothing was written into Program Files' (-not (Get-ChildItem $MachineDir -Directory -Filter '*.WebView2' -ErrorAction SilentlyContinue))
    Stop-App
    Uninstall-Silent $MachineDir 'uninstall'
    Check 'Uninstall: deleted from Program Files' (-not (Test-Path $MachineDir))
    Check 'Uninstall: gone from Apps & features' (-not (Test-Path "HKLM:\$AppIdKey"))
    Check 'Uninstall: the shortcuts were removed' (-not (Shortcuts))
    Check 'Uninstall: the context menu was removed' (-not (Test-Path $ContextKey))
    Errors-In-Log "$env:LOCALAPPDATA\SnipToss\logs" 'all users'
    Copy-Item "$env:LOCALAPPDATA\SnipToss\logs" "$Out\applogs-allusers" -Recurse -ErrorAction SilentlyContinue
}

$script:phase = 'done'
$failed = @($results | Where-Object { $_.ok -eq $false }).Count
$passed = @($results | Where-Object { $_.ok -eq $true }).Count
Say "All done: $passed passed, $failed failed"
[IO.File]::WriteAllText("$Out\done.txt", "passed=$passed failed=$failed`n", [Text.UTF8Encoding]::new($false))
# The sandbox is closed by run.ps1 (shutting down here would make the sandbox window think the connection dropped
# and pop up "The connection to the sandbox was lost")

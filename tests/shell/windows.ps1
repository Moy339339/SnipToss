# For tests: lists (or closes, restores, moves, reads the text of, clicks a button in) the top-level windows a process shows.
# No mouse or keyboard input; closing sends WM_CLOSE (what Alt+F4 ends up as).
#   pwsh -File windows.ps1 -ProcessId 1234            # one per line: handle WxH title
#   pwsh -File windows.ps1 -ProcessId 1234 -Close     # closes all the visible top-level windows of this process
#   pwsh -File windows.ps1 -ProcessId 1234 -Restore   # restores (ShowWindow SW_RESTORE, like clicking it in the taskbar;
#                                                      # one that was maximized before minimizing returns to maximized)
#   pwsh -File windows.ps1 -ProcessId 1234 -Info      # one JSON per line: title, maximized / minimized, topmost, window rect, top-left of the
#                                                      # client area on screen, the monitor and its work area (all in physical pixels)
#   pwsh -File windows.ps1 -ProcessId 1234 -Uia       # one JSON per line: title, the text and buttons in the window (and where each button is on
#                                                      # screen, physical pixels) (UI Automation; for native windows such as the error window,
#                                                      # the notice page and system message boxes)
#   pwsh -File windows.ps1 -ProcessId 1234 -Click Restart # clicks the button with that name (UI Automation Invoke, no mouse movement); an error if none is found
#   pwsh -File windows.ps1 -ProcessId 1234 -Handle 5678 -Move 100,80,1200,760
#                                                      # moves this window to x,y and resizes it to width,height (physical pixels, SetWindowPos)
#   -Handle: act on this one window only
param(
    [Parameter(Mandatory)] [int] $ProcessId,
    [switch] $Close,
    [switch] $Restore,
    [switch] $Info,
    [switch] $Uia,
    [string] $Click,
    [long] $Handle,
    [string] $Move
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace ShellTest -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hwnd, uint msg, System.IntPtr w, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hwnd, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hwnd, System.Text.StringBuilder s, int n);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hwnd, int cmd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsZoomed(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr hwnd, ref POINT p);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr MonitorFromWindow(System.IntPtr hwnd, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetMonitorInfo(System.IntPtr monitor, ref MONITORINFO info);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr context);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetWindowLongPtr(System.IntPtr hwnd, int index);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hwnd, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetWindow(System.IntPtr hwnd, uint cmd);
[System.Runtime.InteropServices.DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(System.IntPtr hwnd, int attr, out int value, int size);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
public struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
'@
# Read coordinates in physical pixels: otherwise a scaled monitor gives converted values that don't match the window's own
[void][ShellTest.Win]::SetProcessDpiAwarenessContext([IntPtr]-4)
if ($Uia -or $Click) { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes }
$found = [System.Collections.Generic.List[object]]::new()
[ShellTest.Win]::EnumWindows({
        param($h, $l)
        $p = 0
        [void][ShellTest.Win]::GetWindowThreadProcessId($h, [ref]$p)
        if ($p -eq $ProcessId -and [ShellTest.Win]::IsWindowVisible($h) -and (-not $Handle -or $h.ToInt64() -eq $Handle)) { $found.Add($h) }
        return $true
    }, [IntPtr]::Zero) | Out-Null

# UI Automation: one kind of control (Text, Button, ...) in a window. A window with an owner (the error window) counts as a child element of its owner
# in UI Automation: reading the main window skips them, and each one is read on its own.
# First look for the window from the desktop root element: the .NET UI Automation has no client proxy for Win32 controls, and FromHandle
# on a system message box returns only a few unnamed Panes; an owned window hangs under its owner and isn't found under the root,
# so fall back to FromHandle (WPF windows provide UI Automation themselves, so that works).
# The window may be gone between listing and reading (a toast that closes itself after a moment): UI Automation then reports
# "Unrecognized error" or "Could not open the process token"; treat that as gone and return null
function Get-Element($hwnd) {
    try {
        $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$hwnd.ToInt64())
        $top = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
        if ($top) { $top } else { [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) }
    }
    catch {
        if ([ShellTest.Win]::IsWindowVisible($hwnd)) { throw }
        $null
    }
}
$ownedIds = [System.Collections.Generic.HashSet[string]]::new()
if ($Uia -or $Click) {
    foreach ($h in $found) {
        if ([ShellTest.Win]::GetWindow($h, 4) -eq [IntPtr]::Zero) { continue } # GW_OWNER: no owner
        $el = Get-Element $h
        if (-not $el) { continue }
        [void]$ownedIds.Add(($el.GetRuntimeId() -join '.'))
        foreach ($d in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
            [void]$ownedIds.Add(($d.GetRuntimeId() -join '.'))
        }
    }
}
function Find-Controls($hwnd, $type) {
    $root = Get-Element $hwnd
    if (-not $root) { return }
    $mine = [System.Collections.Generic.HashSet[string]]::new()
    if ([ShellTest.Win]::GetWindow($hwnd, 4) -ne [IntPtr]::Zero) {
        foreach ($d in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { [void]$mine.Add(($d.GetRuntimeId() -join '.')) }
    }
    # Take everything and filter by type name: building a condition on ControlType, or comparing the objects, finds none of the text
    # and buttons in a system message box (Win32 controls)
    $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
        if ($_.Current.ControlType.ProgrammaticName -ne $type.ProgrammaticName) { return $false } # the same type isn't necessarily the same object
        $id = $_.GetRuntimeId() -join '.'
        $mine.Contains($id) -or -not $ownedIds.Contains($id)
    }
}

$clicked = $false
foreach ($h in $found) {
    $r = New-Object ShellTest.Win+RECT
    [void][ShellTest.Win]::GetWindowRect($h, [ref]$r)
    $t = New-Object System.Text.StringBuilder 256
    [void][ShellTest.Win]::GetWindowText($h, $t, 256)
    if ($Close) { [void][ShellTest.Win]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
    if ($Restore) { [void][ShellTest.Win]::ShowWindow($h, 9) }
    if ($Move) {
        $to = $Move.Split(',') | ForEach-Object { [int]$_ }
        # SWP_NOZORDER | SWP_NOACTIVATE
        [void][ShellTest.Win]::SetWindowPos($h, [IntPtr]::Zero, $to[0], $to[1], $to[2], $to[3], 0x0004 -bor 0x0010)
        continue
    }
    if ($Click) {
        foreach ($b in Find-Controls $h ([System.Windows.Automation.ControlType]::Button)) {
            if ($b.Current.Name -ne $Click) { continue }
            $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            $clicked = $true
            break
        }
        if ($clicked) { break }
        continue
    }
    if ($Uia) {
        try {
            $texts = @(Find-Controls $h ([System.Windows.Automation.ControlType]::Text) | ForEach-Object { $_.Current.Name })
            # a selectable details box (TextBox) is an Edit
            $texts += @(Find-Controls $h ([System.Windows.Automation.ControlType]::Edit) | ForEach-Object {
                    $_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value })
            $buttonElements = @(Find-Controls $h ([System.Windows.Automation.ControlType]::Button))
            $buttons = @($buttonElements | ForEach-Object { $_.Current.Name })
            # Where each button is on screen (physical pixels; this process is per-monitor DPI aware, see above), in the same order as the names;
            # null for a button with no place on screen (UI Automation gives an empty rectangle, at infinity, for one that is hidden or not laid out yet)
            $buttonRects = [System.Collections.Generic.List[object]]::new()
            foreach ($e in $buttonElements) {
                $b = $e.Current.BoundingRectangle
                $buttonRects.Add($(if ($b.IsEmpty) { $null } else { [ordered]@{ left = [int]$b.Left; top = [int]$b.Top; right = [int]$b.Right; bottom = [int]$b.Bottom } }))
            }
        }
        catch {
            if ([ShellTest.Win]::IsWindowVisible($h)) { throw }
            continue # the window closed while being read (same as Get-Element)
        }
        if (-not [ShellTest.Win]::IsWindowVisible($h)) { continue }
        [ordered]@{
            handle  = $h.ToInt64()
            title   = $t.ToString()
            texts   = $texts
            buttons = $buttons
            buttonRects = $buttonRects
        } | ConvertTo-Json -Compress -EscapeHandling EscapeNonAscii
        continue
    }
    if ($Info) {
        $c = New-Object ShellTest.Win+POINT
        [void][ShellTest.Win]::ClientToScreen($h, [ref]$c)
        $m = New-Object ShellTest.Win+MONITORINFO
        $m.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($m)
        [void][ShellTest.Win]::GetMonitorInfo([ShellTest.Win]::MonitorFromWindow($h, 2), [ref]$m)
        $rect = { param($x) [ordered]@{ left = $x.Left; top = $x.Top; right = $x.Right; bottom = $x.Bottom } }
        $cloak = 0
        [void][ShellTest.Win]::DwmGetWindowAttribute($h, 14, [ref]$cloak, 4) # DWMWA_CLOAKED
        [ordered]@{
            handle  = $h.ToInt64()
            title   = $t.ToString()
            zoomed  = [ShellTest.Win]::IsZoomed($h)
            iconic  = [ShellTest.Win]::IsIconic($h)
            # WS_EX_TOPMOST
            topmost = ([ShellTest.Win]::GetWindowLongPtr($h, -20).ToInt64() -band 0x8) -ne 0
            # the desktop compositor doesn't draw it (a restored window stays hidden until it has painted, MainWindow.ShowWithoutFlash)
            cloaked = $cloak -ne 0
            rect    = & $rect $r
            client  = @{ x = $c.X; y = $c.Y }
            monitor = & $rect $m.Monitor
            work    = & $rect $m.Work
        } | ConvertTo-Json -Compress -EscapeHandling EscapeNonAscii # non-ASCII titles become \uXXXX: redirected output is encoded in the system code page, and a reader decoding it as UTF-8 would get mojibake
        continue
    }
    "$h $($r.Right - $r.Left)x$($r.Bottom - $r.Top) $t"
}
if ($Click -and -not $clicked) { throw "Button not found: $Click" }

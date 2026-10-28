param([int]$ProcessId, [string]$Action, [string]$Arg1 = "", [string]$Arg2 = "", [string]$Arg3 = "", [string]$Arg4 = "")
# Tests Screen Capture with the real mouse and keyboard (the capture overlay is a WPF window that CDP can't reach). Usage: pwsh -File scripts/real-input.ps1 -ProcessId <test instance PID> -Action drag 300 200 1300 800
# Tests the capture overlay with real input. Before a mouse action it checks that the window under the cursor belongs to the test instance ($ProcessId); if not it gives up, so it never clicks another program by mistake.
#   drag x1 y1 x2 y2   press at (x1,y1) and drag to (x2,y2) (physical screen pixels)
#   click x y / dbl x y / right x y
#   key name           e.g. R, Enter, Escape, Ctrl+Z (sent to the current foreground window; the foreground must be the test instance)
#   type text          sends Unicode character by character
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class In {
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(P p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KI ki; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static void Char(char c) {
    var a = new INPUT[2];
    a[0].type = 1; a[0].ki.scan = c; a[0].ki.flags = 4;
    a[1].type = 1; a[1].ki.scan = c; a[1].ki.flags = 4 | 2;
    SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
function Owner([IntPtr]$h) { $id = 0; [In]::GetWindowThreadProcessId($h, [ref]$id) | Out-Null; $id }
function Guard([int]$x, [int]$y) {
  $pt = New-Object In+P; $pt.X = $x; $pt.Y = $y
  $root = [In]::GetAncestor([In]::WindowFromPoint($pt), 2)
  if ((Owner $root) -ne $ProcessId) { throw "The window under ($x,$y) is not the test instance's (it belongs to process $(Owner $root)); giving up" }
}
function MoveCursor([int]$x, [int]$y) { [In]::SetCursorPos($x, $y) | Out-Null }
switch ($Action) {
  "drag" {
    $x1 = [int]$Arg1; $y1 = [int]$Arg2; $x2 = [int]$Arg3; $y2 = [int]$Arg4
    Guard $x1 $y1
    MoveCursor $x1 $y1; Start-Sleep -Milliseconds 80
    [In]::mouse_event(2, 0, 0, 0, 0); Start-Sleep -Milliseconds 60
    foreach ($i in 1..12) { MoveCursor ($x1 + [int](($x2 - $x1) * $i / 12)) ($y1 + [int](($y2 - $y1) * $i / 12)); Start-Sleep -Milliseconds 20 }
    Start-Sleep -Milliseconds 60
    [In]::mouse_event(4, 0, 0, 0, 0)
  }
  { $_ -in "click", "dbl", "right" } {
    $x = [int]$Arg1; $y = [int]$Arg2
    Guard $x $y
    MoveCursor $x $y; Start-Sleep -Milliseconds 80
    $n = if ($Action -eq "dbl") { 2 } else { 1 }
    foreach ($i in 1..$n) {
      if ($Action -eq "right") { [In]::mouse_event(8, 0, 0, 0, 0); [In]::mouse_event(16, 0, 0, 0, 0) }
      else { [In]::mouse_event(2, 0, 0, 0, 0); [In]::mouse_event(4, 0, 0, 0, 0) }
      Start-Sleep -Milliseconds 50
    }
  }
  "key" {
    if ((Owner ([In]::GetForegroundWindow())) -ne $ProcessId) { throw "The foreground window is not the test instance (it belongs to process $(Owner ([In]::GetForegroundWindow()))); not sending keys" }
    $parts = $Arg1.Split("+")
    $vk = @{ Ctrl = 0x11; Shift = 0x10; Alt = 0x12; Enter = 0x0D; Escape = 0x1B; Left = 0x25; Up = 0x26; Right = 0x27; Down = 0x28; Back = 0x08; Tab = 0x09; Space = 0x20; Delete = 0x2E }
    foreach ($n in 1..24) { $vk["F$n"] = 0x6F + $n }
    $codes = foreach ($p in $parts) { if ($vk.ContainsKey($p)) { $vk[$p] } else { [int][char]$p.ToUpper() } }
    foreach ($c in $codes) { [In]::keybd_event([byte]$c, 0, 0, 0) }
    [array]::Reverse($codes)
    foreach ($c in $codes) { [In]::keybd_event([byte]$c, 0, 2, 0) }
  }
  "type" {
    if ((Owner ([In]::GetForegroundWindow())) -ne $ProcessId) { throw "The foreground window is not the test instance; not typing" }
    foreach ($ch in $Arg1.ToCharArray()) { [In]::Char($ch); Start-Sleep -Milliseconds 15 }
  }
  "fg" { "Foreground process: $(Owner ([In]::GetForegroundWindow()))" }
}

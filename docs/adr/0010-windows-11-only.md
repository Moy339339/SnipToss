# ADR-0010 Windows 11 only

- Status: accepted (2026-10-27)
- Related: ADR-0002 (installer)

## Context
The installer originally declared Windows 10 22H2 as the minimum system (`MinVersion=10.0.19045`), and the README also said Windows 10 was supported. But Windows 10 had never been tested on a real machine:
Windows Sandbox borrows the host system's files, so a sandbox opened on Windows 11 can only be Windows 11; testing Windows 10 would need a separate Windows 10 virtual machine (turn on Hyper-V and download an image; Microsoft's free evaluation edition is LTSC 2021, version 19044, which cannot even install our package).
Things that may differ between Windows 10 and Windows 11: the WebView2 runtime ships with Windows 11 but not necessarily with Windows 10; the dark window border (`DWMWA_BORDER_COLOR`) exists only on Windows 11; the Segoe UI Variable font exists only on Windows 11.
Windows 10 support ended in October 2025; in 2026 StatCounter still shows Windows 10 at roughly 30% of Windows desktops.

## Decision
1. **Only Windows 11 is supported** (64-bit). The installer uses `MinVersion=10.0.22000`: on Windows 10 the setup wizard says directly that the system version is too old and does not install; the winget manifest says `MinimumOSVersion: 10.0.22000.0`.
2. Windows 10 entries in the README's system requirements and elsewhere are removed; the help page shown when WebView2 is missing no longer mentions "some Windows 10 machines do not have it".
3. The portable build does not block: unzipped on Windows 10 it still opens, but it is not supported and problems are not fixed.
4. Code that already skips things on older systems (such as `WDA_EXCLUDEFROMCAPTURE`, rename with POSIX semantics) is not specially removed; leaving it is harmless.

## Consequences
- The installer no longer has to carry the WebView2 installer (Windows 11 ships it); in the rare case where WebView2 is missing, the app's help page gives the download link.
- If Windows 10 users do show up later, reassess then (a Windows 10 test environment has to exist first).

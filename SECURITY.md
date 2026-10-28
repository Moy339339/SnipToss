# Security policy

## Reporting a vulnerability

Please **don't** open a public issue for a security problem. Email **jujuw3939@outlook.com** with:

- what the problem is and what an attacker could do with it,
- the steps or a file that reproduces it,
- the version (**Help → About**) and your Windows version.

You'll get a reply within 7 days. Once the problem is confirmed, a fix is prepared and released, and you're credited in the release notes unless you'd rather not be. Please give us a reasonable time to ship the fix before you disclose it publicly.

## Supported versions

Security fixes go into the latest release. Until 1.0 that's the latest beta.

## What's in scope

SnipToss opens files that often come from somewhere else — assets an AI generated, project folders you cloned or downloaded. Things we especially want to hear about:

- a file or folder (image, video, annotation JSON in `.sniptoss/`, file name, path) that makes the app run code, write outside the project's `.sniptoss/` folder, modify or delete the user's assets, or read files the user didn't open;
- ways for content shown in the UI to escape the WebView2 sandbox, get around the content security policy, or call the bridge (`app/Bridge.cs`) beyond what the UI itself does;
- ways for another local user or process to send commands to a running instance (the single-instance pipe only accepts the current user);
- the app opening anything other than `http`/`https` links in the browser, or the update check (`app/Updates.cs`) sending anything beyond a plain request to the GitHub Releases API;
- the diagnostics package or logs leaking item paths, user names or other personal data beyond what's described in the app.

Out of scope: attacks that need administrator rights or physical access to an unlocked machine, and problems in Windows, WebView2 or .NET themselves (please report those to Microsoft).

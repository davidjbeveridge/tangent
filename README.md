<p align="center">
  <img src="build/icon.svg" width="80" height="80" alt="Tangent's geometric mark">
</p>

# Tangent

**An open-source browser for people who want to keep browsing the Arc way.**

[![Check](https://github.com/davidjbeveridge/tangent/actions/workflows/check.yml/badge.svg)](https://github.com/davidjbeveridge/tangent/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Spaces. Vertical tabs. Favorites that stay put. A command bar that gets out of your way. Tangent brings those ideas into an independent desktop browser built with Electron, Chromium, and TypeScript.

No account, subscription, API key, or Arc installation is required to use it.

**Status: early development, version 0.1.0.** Real websites run in real Chromium browsing surfaces. Native browser tests cover macOS on Apple Silicon and Intel, Windows x64, and Linux x64, including profile isolation, session restore, split view, and popups. This is an experimental browser with substantial work ahead. [Get an installer](https://github.com/davidjbeveridge/tangent/releases) or [run it from source](#from-source).

## Why Tangent exists

Tangent was built because **The Browser Company decided to discontinue Arc**. Its [October 22, 2026 announcement](https://arc.net/) says Arc for macOS and Windows will stop working on **December 22, 2026**, with the company's engineering and security efforts moving to Dia. Arc remains available with basic updates until that date.

That decision leaves people who like Arc's workflow looking for a home. Tangent's goal is to keep the useful parts of that experience alive in a browser whose code, direction, and future are open to its users and contributors.

Tangent is an independent implementation. It is not affiliated with The Browser Company, and it does not contain Arc's proprietary source, executable, branding, or cloud services. [How it was built](#how-it-was-built) explains the research and its limits.

## Install and run

### From source

Install [Git](https://git-scm.com/downloads) and [Node.js 24](https://nodejs.org/en/download), version **24.15 or newer**, with npm. Then open a terminal:

```sh
git clone https://github.com/davidjbeveridge/tangent.git
cd tangent
npm ci
npm start
```

`npm ci` downloads the pinned dependencies and Electron runtime. `npm start` builds Tangent and opens the desktop application. These commands work in macOS Terminal, Windows PowerShell, and a Linux desktop terminal.

Linux needs a graphical desktop and Electron's system libraries. For a headless Ubuntu development machine, install the required desktop libraries and Xvfb, then use `xvfb-run -a npm start`. Run the app as your normal user. Do not disable the Chromium sandbox to make a regular installation work.

### Desktop installers

Open [GitHub Releases](https://github.com/davidjbeveridge/tangent/releases) and choose the package for your computer. Each manual release includes `SHA256SUMS` and `BUILDINFO.json` with the source commit, runtime versions, and package hashes. No Apple or Windows signing credentials are needed to build these installers.

| Platform | Package | Installation |
| --- | --- | --- |
| macOS, Apple Silicon | `Tangent-<version>-mac-arm64.dmg` | Open the DMG and drag Tangent into Applications |
| macOS, Intel | `Tangent-<version>-mac-x64.dmg` | Open the DMG and drag Tangent into Applications |
| Windows, x64 | `Tangent-<version>-win-x64.exe` | Run the installer and follow its prompts |
| Linux, x64 | `Tangent-<version>-linux-x86_64.AppImage` | Mark the file executable with `chmod +x`, then run it |

On a Mac, **Apple menu > About This Mac** identifies an Apple chip or Intel processor. ZIP copies of both macOS builds are also included; extract one and move `Tangent.app` into Applications. Windows ARM64 and Linux ARM64 packages are not included in this release.

Read the release notes before installing. Manual macOS builds use ad hoc signing without a developer certificate; they are not notarized or authenticated to a publisher. These builds and unsigned Windows builds may trigger operating-system warnings and are intended for development and evaluation. If an installer is blocked, use the source instructions above. Keep platform security protections enabled. Release checks exercise the packaged browser in clean CI environments; they do not certify every operating-system configuration or an upgrade from every previous version.

**Linux requirements:** The AppImage needs a working Chromium sandbox, including permission to use unprivileged user namespaces. Ubuntu 24.04 and other restricted configurations can block this. Tangent will not silently turn the sandbox off. Linux release checks use Ubuntu 22.04; source builds need a working sandbox too. See the [AppImage sandbox requirements](https://docs.appimage.org/user-guide/troubleshooting/electron-sandboxing.html).

If only FUSE is unavailable, [AppImage supports extracting the package](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages). From a directory containing the downloaded file:

```sh
chmod +x Tangent-0.1.0-linux-x86_64.AppImage
./Tangent-0.1.0-linux-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

Extraction does not remove the sandbox requirement. Keep the extracted directory together, since it contains the runtime and resources.

## Update without signing

**You can install and update Tangent without setting up code-signing certificates.** The supported path today is a manual source update or manual replacement of a packaged build.

### One command for a source installation

Quit Tangent, open a terminal in its repository, and run:

```sh
npm run update
```

The updater checks that you're on `main` with a clean working tree and the expected repository. It fetches Tangent's current `main`, prepares a separate temporary checkout, installs its pinned dependencies, and runs the build and browser tests there. Only after those checks pass does it move your checkout forward and use the tested build. Your browsing-data directory is left alone.

It refuses local changes, divergent history, and failed checks. It records a backup branch and prints recovery instructions. On Linux, the browser tests need a display or Xvfb. Save work in websites before quitting; session restore cannot recover unsaved form contents.

To inspect available source changes without installing them:

```sh
npm run update -- --check
```

For an already closed app in an unattended development environment, `npm run update -- --yes` acknowledges the close-app prompt. It does not skip tests or working-tree checks.

### A packaged installation

1. In **Settings > About Tangent**, choose **Open releases**.
2. Read the release notes and download the package for your operating system and architecture, plus `SHA256SUMS` when supplied.
3. Verify the download's SHA-256 hash against that file.
4. Save your work, quit Tangent, and install the new package or replace the old AppImage.
5. Reopen Tangent. Its normal application-data folder remains in place.

Common commands for checking a downloaded file:

```sh
# macOS
shasum -a 256 "Tangent-0.1.0-mac-arm64.dmg"

# Linux
sha256sum "Tangent-0.1.0-linux-x86_64.AppImage"
```

```powershell
# Windows
Get-FileHash ".\Tangent-0.1.0-win-x64.exe" -Algorithm SHA256
```

Use the actual filename from the release. Checksums detect a corrupt or mismatched download; they do not authenticate an unsigned publisher. Download from this repository's release page. See [Releasing and updating Tangent](docs/RELEASING.md) for the maintainer workflow.

Before a meaningful upgrade, use **Settings > Your data > Export backup**. A backup contains Spaces, tab URLs, settings, and history. It does not contain cookies, passwords, or live page contents.

### How Chromium stays current

Tangent updates **Electron and its bundled Chromium together**. It does not replace Chromium independently. Electron's APIs, Node runtime, and Chromium integration are released together; Chromium major upgrades can also change browser behavior. See [Electron's versioning policy](https://www.electronjs.org/docs/latest/tutorial/electron-versioning).

The repository includes daily dependency update checks through Dependabot. Electron updates arrive as pull requests and run through type checks, unit tests, and real browser tests. A maintainer reviews runtime changes before merging them. The source update command then picks up that tested, pinned version, while the release workflows build complete desktop packages.

This avoids making every user integrate Chromium changes themselves. It still depends on upstream fixes and maintainer review. Tests reduce regression risk; they cannot guarantee every site keeps working or that a Chrome fix reaches Electron and Tangent immediately. Major Electron upgrades need review of upstream breaking changes. Security updates should take priority.

### Optional automatic updates later

Signed macOS and Windows builds can also use the included in-app updater. Eligible builds check after startup and every six hours. Settings shows the installed Tangent, Electron, and Chromium versions. When an update is available, choose **Download update**, then **Restart and install** when ready. The app asks before restarting and saves its session first.

Only stable, newer versions from the fixed Tangent GitHub release feed are accepted. Updates are not installed automatically on quit. Signature verification and release configuration are required; source, unsigned, and Linux builds use the manual flow. The signing setup is optional for using Tangent and is documented in the [release guide](docs/RELEASING.md).

## Get comfortable in five minutes

1. **Open a page.** Press **⌘T** on macOS or **Ctrl+T** on Windows/Linux. Type a URL or search, then press Enter. Use **⌘/Ctrl+L** to change the focused page's address.
2. **Make a Space.** Choose **Create a space** on the new-tab screen or use the sidebar. Give it a name and color. Use Spaces for projects, work, or personal browsing.
3. **Keep useful pages.** Right-click a tab to pin it, make it a Favorite, rename it, or move it to another Space. Drag tabs to reorder them within their section.
4. **Separate your logins.** Open **Settings > Profiles > New profile**, then assign that Profile when creating a Space. Spaces sharing a Profile share website logins; different Profiles use separate cookies and storage.
5. **Browse side by side.** Right-click a page link to open it in a split or Peek. Peek is temporary; promoting it to a tab keeps the same live page, including its current form and JavaScript state.

The sidebar menu also opens history, archived tabs, downloads, and settings. Closing a pinned tab or Favorite unloads its page but keeps the saved entry. Use **Remove** when you want to delete that entry.

### The tab model

| Kind | Where it lives | What closing it does |
| --- | --- | --- |
| Favorite | Shared by all Spaces using the same Profile | Keeps the bookmark and returns it to its saved URL |
| Pinned tab | One Space | Keeps the bookmark and returns it to its saved URL |
| Today tab | One Space | Archives its URL so you can reopen it later |

Today tabs archive after 12 idle hours by default. Change that interval, or turn it off, in Settings. Current pages, split panes, audible tabs, pins, and Favorites are exempt from the idle sweep. Restoring an archived tab restores its address, not the previous page's form state or navigation history.

Tabs can move between Spaces using the same Profile. To use another Profile's login state, open the address in that Profile instead.

### Keyboard shortcuts

Use **⌘** on macOS and **Ctrl** on Windows/Linux.

| Shortcut | Action |
| --- | --- |
| ⌘/Ctrl + T | Open the command bar for a new tab |
| ⌘/Ctrl + L | Edit the focused page's address |
| ⌘/Ctrl + W | Close the focused page or Peek |
| ⌘/Ctrl + Shift + T | Restore the most recently archived tab in this Profile |
| ⌘/Ctrl + B | Show or hide the sidebar |
| ⌘/Ctrl + \ | Toggle split view |
| ⌘/Ctrl + F | Find text in the focused page |
| ⌘/Ctrl + R | Reload the focused page |
| ⌘/Ctrl + 1 through 9 | Switch Space |
| ⌘/Ctrl + Y | Open the archive |
| ⌘/Ctrl + , | Open settings |
| Escape | Close the command bar, dialog, or Peek |

## What works today

| Area | Implemented |
| --- | --- |
| Browsing | HTTP/HTTPS, search, back/forward, reload/stop, find, zoom, page developer tools |
| Organization | Spaces, separate Profiles, Favorites, pinned tabs, Today tabs, rename, reorder |
| Focus | Command bar, sidebar toggle, two-page split with adjustable divider, Peek |
| Persistence | Session restore, validated JSON import/export, pre-import backups, corrupt-file recovery |
| History and archive | Profile-scoped history, tab archive, restore, clear actions |
| Downloads | Native save dialog, progress, cancellation, reveal completed files |
| Popups | GET/POST requests, source Profile cookies, opener semantics, blocked hidden-source popups |
| Site permissions | Origin-specific prompts for supported permissions, reset when Tangent quits |
| Appearance | Light, dark, and system themes; original interface and icon |
| Updates | Tested source update script, manual release access, optional signed macOS/Windows updater |

### Still missing

There is no Chrome Web Store integration, password manager, private browsing, ad/tracker blocker, Arc import converter, cloud sync, default-browser integration, multi-window workspace synchronization, folders, Easels, Boosts, Little Arc, four-pane splits, or mobile app. DRM, passkeys, hardware-dependent sites, and other advanced website features need broader testing.

Tangent accepts HTTP/HTTPS pages and its own new-tab screen. External application schemes and arbitrary local files are blocked. Background tabs remain in memory until closed or archived; automatic resource suspension is not implemented. Closing or archiving a page does not yet provide complete protection for unsaved forms.

An Arc export is not a Tangent session backup. Tangent's JSON import currently accepts its own backup format. You can open exported Arc links manually; a dedicated migration path is still missing.

## Privacy and local data

Tangent has no account service or analytics backend. Your workspace is stored locally in Electron's Tangent application-data directory:

| Platform | Default location |
| --- | --- |
| macOS | `~/Library/Application Support/Tangent/` |
| Windows | `%APPDATA%/Tangent/` |
| Linux | `$XDG_CONFIG_HOME/Tangent/`, normally `~/.config/Tangent/` |

`session.json` contains tab URLs, titles, Spaces, settings, archive entries, and history in plain text. Chromium stores cookies and website storage in separate Profile partitions. Profiles separate website identities; they do not protect data from someone with access to your operating-system account.

Websites, searches, downloads, and eligible builds' update checks make network requests to their respective services. No app analytics does not mean anonymous browsing. Read [SECURITY.md](SECURITY.md) for the current security boundaries and reporting process.

For development with an isolated data directory:

```sh
mkdir -p /tmp/tangent-development
TANGENT_USER_DATA=/tmp/tangent-development npm start
```

PowerShell:

```powershell
$env:TANGENT_USER_DATA = Join-Path $env:TEMP 'tangent-development'
New-Item -ItemType Directory -Force $env:TANGENT_USER_DATA | Out-Null
npm start
```

## Build, test, and contribute

```sh
npm run check       # TypeScript, unit tests, production build
npm run test:e2e    # Real Electron tests; requires a display
npm audit          # Known advisories across runtime and build dependencies
npm run pack       # Unpacked development app for the current platform
npm run dist:mac    # Unsigned DMG + ZIP on macOS
npm run dist:linux  # AppImage on Linux
npm run dist:win    # Unsigned NSIS installer on Windows
```

On a Linux CI runner, use `xvfb-run -a npm run test:e2e`. Desktop tests use a local HTTP fixture and temporary browsing-data directories. They exercise real Chromium content, cookie isolation, navigation, split focus, Peek promotion, popup request semantics, persistence, and the development updater boundary. Unit tests cover state transitions, URL handling, and updater behavior.

The test harness uses `--no-sandbox` only when launched as root in a disposable test container. Production code keeps sandboxing enabled. Those container tests do not prove that the operating-system sandbox is working. [Validation notes](docs/VALIDATION.md) distinguish completed checks from remaining platform and security work.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Useful contributions include native platform testing, migration from Arc exports, stronger session recovery, accessibility, browser compatibility, and maintained runtime upgrades. Open a focused [issue](https://github.com/davidjbeveridge/tangent/issues) with the behavior you want to improve and a reproducible example.

Dependency changes also build and exercise the delivered installers on all four supported platform/architecture targets. CI rejects known moderate-or-higher dependency advisories and checks that Node type definitions match Electron's bundled Node major. [Dependency maintenance](docs/DEPENDENCIES.md) explains the version choices and the scoped packaging override.

### Architecture

The local TypeScript interface runs at `tangent://app/index.html`. A narrow preload bridge connects it to the main process. Each website runs in a sandboxed `WebContentsView` with no Node integration and no Tangent bridge. Browsing Profiles map to separate persistent Chromium sessions.

| Location | Responsibility |
| --- | --- |
| `src/core/` | Tab and Space state, persistence schema, URL handling, command validation |
| `src/main/` | Windows, Chromium views, permissions, downloads, filesystem access, updates |
| `src/renderer/` | Sidebar, command bar, settings, history, archive, update controls |
| `src/shared/` | Typed state, commands, and preload API |
| `tests/` | Unit tests and real Electron integration tests |
| `docs/` | Architecture, research provenance, validation, and release operations |

See [Architecture and trust boundaries](docs/ARCHITECTURE.md) before changing profile ownership, IPC, popup handling, or the updater.

## How it was built

[REA](https://github.com/morluto/rea) **6.7.0 was installed and used** to investigate the official Arc **1.170.0 (89123)** macOS distribution. The investigation hashed the installer, inventoried an extracted subset, and analyzed two shipped JavaScript resources and two JSON policies. It recorded native framework metadata, resource hashes, REA evidence IDs, and unknown coverage.

Those observations, together with public Arc documentation, informed Tangent's independent behavior model. The implementation is original TypeScript. It is not recovered Arc source or a complete reconstruction of Arc's internals.

The investigation ran on Linux. REA's macOS-specific Mach-O and plist providers could not run there; their capability failures and supplemental Python metadata are documented. No full native decompilation or live Arc UI recording occurred. Arc binaries, extracted proprietary scripts, and complete source-derived semantic graphs are excluded from this repository. The work does not claim a formally separated clean-room process.

- [REA investigation and reproduction details](docs/rea/REA-INVESTIGATION.md)
- [Public behavior specification](docs/arc-behavior.md)
- [Source inventory and retrieval limits](docs/sources.json)

To continue the investigation on a Mac with a locally obtained Arc installation:

```sh
npm run analyze:arc -- /Applications/Arc.app /tmp/tangent-arc-analysis
```

This installs the pinned REA CLI into the specified output directory and analyzes Arc without modifying it. Keep raw research outputs outside this repository.

## License

Tangent's original code and icon are available under the [MIT License](LICENSE). Electron, Chromium, and other dependencies retain their respective licenses and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Packaged builds include the runtime notices.

Arc is a trademark of The Browser Company. Tangent is an independent open-source project.

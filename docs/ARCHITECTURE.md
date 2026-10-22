# Architecture

Tangent is an independent Electron desktop browser implementing a workspace-oriented browsing model. Real websites run in Chromium `WebContentsView` instances. The interface is a local renderer, not a web page containing browsing iframes.

This is a v0.1 implementation. It is not Arc's recovered source, a Chromium fork, or a claim of full Arc compatibility.

## Process and trust boundaries

| Component | Responsibility | Privilege |
| --- | --- | --- |
| `src/main/main.ts` | Window and web-content ownership, sessions, navigation, permissions, downloads, IPC | Electron main process; filesystem and OS access |
| `src/main/preload.ts` | Narrow `window.tangent` API for the local shell | Sandboxed preload; typed IPC methods |
| `src/renderer/` | Sidebar, command bar, Spaces, preferences, archive, history | Local shell at `tangent://app/index.html`; no Node integration |
| Remote `WebContentsView` | Render and interact with HTTP(S) sites | Sandboxed, isolated Chromium content; no Tangent preload |
| `src/core/` | State transitions, validation, URL interpretation | Pure application logic except ID generation |
| `src/main/storage.ts` | Session serialization and recovery | Main-process filesystem access |
| `src/main/updates.ts` | Release policy, update state, native updater and restart sequencing | Main-process access to a fixed release feed and platform signature verification |

The local protocol serves only an explicit asset allowlist. The shell has a restrictive Content Security Policy. IPC handlers verify that the sender is the local shell's main frame and validate command payloads. Remote contents cannot call the bridge.

These choices follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security). They reduce exposure; they do not turn a new shell into an independently audited browser.

## State ownership

The main process owns the authoritative `BrowserState`. The renderer sends a bounded command, receives a snapshot, and rerenders. Main-process web-content events update title, URL, loading, media and navigation state, then push a new snapshot.

`applyCommand` clones state and applies domain transitions. Runtime web-content objects never enter serialized state. That makes a profile/tab transition testable without starting Electron.

| Entity | Scope and behavior |
| --- | --- |
| Profile | Stable ID selecting one persistent Chromium session partition |
| Space | Named context belonging to one Profile, with its own theme and tabs |
| Favorite | Saved tab visible in every Space of its Profile |
| Pinned tab | Saved tab owned by one Space |
| Today tab | Working tab eligible for archive |
| Archived tab | Recoverable URL/title plus original Profile/Space and archive time |
| History entry | URL/title and last visit, scoped to Profile |

A tab's `savedUrl` is distinct from its current `url`. Closing a pinned/favorite page preserves its saved entry. Removing the saved entry is a separate action. Moving a tab between Profiles is refused; opening its address in the destination Profile establishes a new browsing session.

## Website sessions

`session.fromPartition('persist:tangent-profile-' + profileId)` owns cookies, cache and other Chromium session storage. Spaces with the same Profile intentionally share website identity. Spaces with different Profiles use different partitions. Profile identity is not a separate OS account or a boundary against the local user.

Permissions are configured on every Profile session. Supported sensitive permissions prompt for the requesting origin and last only for the current process session. The shell's own default session denies permission requests. See [Electron Session](https://www.electronjs.org/docs/latest/api/session).

## Native view lifecycle

The main process maintains a tab-ID-to-`WebContentsView` map. A page view is created when needed, attached to the window, and hidden when not displayed. Ordinary tab switching preserves the page instance. The implementation must explicitly close owned web contents on tab/window teardown; see [BaseWindow resource management](https://www.electronjs.org/docs/latest/api/base-window).

Two tabs can be visible in a horizontal split with an adjustable ratio. Focus and pane placement must be kept distinct: navigation commands should target the pane the user is working in. Peek is a temporary view using the source browsing context. Promoting it should retain its live content, not reconstruct a GET request from its URL.

Native child views sit above shell DOM. When the command bar or a modal opens, page views are hidden so the local overlay receives input. The views are restored when the overlay closes. Inline controls such as find-in-page live in the toolbar area outside native page bounds.

Popup handling must preserve the source Profile and request state. A `window.open` or form POST cannot be faithfully replaced by a new GET navigation. Any unsupported popup case should be reported as a limitation, not silently described as working compatibility. See [Electron webContents window handling](https://www.electronjs.org/docs/latest/api/web-contents).

## Persistence and recovery

The session file lives under Electron's `userData` directory. `TANGENT_USER_DATA` selects a separate directory for tests and development. Session writes replace the JSON file through a temporary file; runtime-only fields, downloads and Peek are omitted. Chromium's own persistent partition data is stored separately.

Imports are size bounded and reconstructed field by field through `restoreState`. Invalid URLs and identifiers are filtered; unknown state versions are refused. An unreadable session is retained in a recovery copy before a new initial state is used. Importing a replacement session requires a confirmation and preserves a pre-import backup.

Atomic file replacement is not a promise of power-loss durability. Session JSON contains URLs, titles and history in plain text. Exported session files do not contain cookies or a transferable login state.

## Archive policy

Today tabs are archived after a configurable interval. The active and split tabs and currently audible tabs are exempt from the idle sweep. Saved tabs are never automatically archived. The default interval is 12 hours; “Never” is an intentional Tangent option.

The archive and history are bounded. Restoring an archived page uses its original Profile and a suitable Space. This is URL restoration, not restoration of a renderer's form state or navigation stack.

## Scope of v0.1

The implemented foundation covers real browsing, Spaces/Profiles, saved tabs, command navigation, two-pane split, explicit Peek, archive/history, permissions, downloads and session import/export. Source code and behavior tests are the authority for the current feature set.

The following are not claimed: Arc Sync interoperability, account services, exact native UI parity, a Chrome Web Store extension product, a password manager, private browsing, built-in content blocking, a production security-update service, a certified signed release, full browser-default integration, Easels, Boosts, mobile apps or multi-window parity. Some websites need browser features outside this first implementation.

## Manual and optional signed updates

Tangent updates as a complete Electron application. Its Chromium version is the version shipped inside the selected Electron release; the application does not replace Chromium binaries independently. Preferences show the running Tangent, Electron and Chromium versions.

The default distribution uses manual updates. **Open releases** is an IPC action that opens the fixed `https://github.com/davidjbeveridge/tangent/releases` URL in the OS browser. Its caller cannot supply a URL. A downloaded installer or app is replaced explicitly after quitting Tangent. Source checkouts also have `npm run update`; its separate script checks the checkout and validates an upstream revision before updating the source installation. Neither flow needs a signing service or an in-app execution path for unsigned installers.

Optional signed macOS and Windows releases can enable `electron-updater` 6.8.9. Ordinary packaging has `publish: null` and contains no enabling policy. The separate release configuration requires signing credentials and adds `resources/update-policy.json` in `afterPack`, before code signing. Startup requires a packaged app, a supported platform, the exact stable GitHub feed in that policy and `app-update.yml`, and a platform signing identity. macOS additionally verifies the installed bundle and its Developer ID team with `codesign`. Windows requires full publisher Distinguished Names that match both resources.

The signed path checks after startup and every six hours. Downloads are explicit. It disables prereleases, downgrades, web installers, development update configuration and install-on-quit. It uses complete application downloads and upstream checksum/signature verification. The Windows wrapper treats any verifier warning, error or exception as failure, including upstream's unsupported-PowerShell fallback; cached downloads undergo the same signature check again. macOS delegates downloaded-app signature verification to Squirrel.Mac when the user requests installation. A downloaded state is therefore not a claim that macOS has already accepted the app's signature.

Only the local shell can call the typed update bridge. The renderer receives status and capability flags; it cannot change the provider, channel, publisher, downgrade setting or signing gate. Restart requires a native confirmation describing unsaved page/form state, Peek and download limits. The main process flushes site storage and cookies and saves the session successfully before calling the installer. A failed save or cancelled confirmation leaves the app running. No timer or ordinary quit requests installation.

Linux releases remain manual. The optional signing configuration and tests are implementation work, not evidence that a signed production release or an end-to-end update has been published. See [Electron's update overview](https://www.electronjs.org/docs/latest/tutorial/updates) and the pinned updater dependency/source for the platform mechanisms.

## Evidence and independent implementation

[Arc behavior reference](arc-behavior.md) records public first-party behavior and explicit inference. [Source inventory](sources.json) identifies retrieval quality. [REA investigation](rea/REA-INVESTIGATION.md) records actual shipped-artifact inspection and its limits. These are separate from runtime tests of Tangent.

No Arc executable, source script, branded image, icon, font, or service credentials belong in this repository. The workspace was shared by analysis and implementation agents; this is independent implementation, not a formally isolated clean-room certification.

## Build and delivery

`scripts/build.mjs` bundles main/preload code and the browser renderer, then copies local HTML/CSS. Updater packages remain ordinary production dependencies so their runtime paths and license notices are preserved. `electron-builder` packages the app. The check workflow validates code and runs desktop tests on Linux x64 under Xvfb, Windows x64, and Apple Silicon/Intel macOS.

The ordinary packaging workflow builds unsigned macOS, Windows and Linux artifacts for manual installation. The optional signed workflow builds a macOS universal app and a Windows NSIS installer, verifies their platform signatures and embedded policy, checks update-file hashes and prepares a draft release. Release workflows describe intended automation; they do not establish that any release has been executed or published. Signed-update metadata is excluded from manual builds.

CI files describe intended automation until a hosted run has completed. Local validation and actual platform verification are reported separately.

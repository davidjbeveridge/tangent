# Arc behavior reference for an independent browser

Researched 2026-10-22. Scope: desktop behavior, macOS first; Electron implementation guidance.

## Evidence standard and limits

This document reconstructs a behavioral contract from first-party Arc Help Center and Electron documentation. It does **not** claim inspection of Arc's source code or live desktop interactions. REA artifact findings are tracked separately. Several Arc article URLs returned 404 to the browsing tool even though both search engines retained first-party article content. These are marked `indexed_primary` in `sources.json`; their detailed behavior needs a live Arc comparison before claiming exact parity. Release notes establish features at a point in time, not every detail of the current version.

All implementation decisions below are proposals for our independent code. No Arc code, icons, branded artwork, bundled resources, or private service contracts are needed.

## Model: Profile → Spaces → tabs

| Entity | Documented behavior | Independent implementation contract | Evidence |
|---|---|---|---|
| Profile | Holds login/cookie/cache state, history, favorites, extensions, archive timing and settings; can serve several Spaces. A new Profile starts empty. | Give every profile an immutable ID. Use a persistent Chromium session keyed by profile ID. Do not use Space IDs as cookie partitions. Scope history and favorites to profile. | [Profiles](https://resources.arc.net/hc/en-us/articles/19227964556183-Profiles-Separate-Work-Personal-Browsing) |
| Space | A context with its own pinned section, unpinned section, theme and icon. | Store `profileId`, name, color/icon and ordered tab IDs. Switching Space changes navigation context; changing profile changes website identity. | [Spaces](https://resources.arc.net/hc/en-us/articles/19228064149143-Spaces-Distinct-Browsing-Areas) |
| Favorite | Icon at the top of the sidebar; available across Spaces. Up to 12. Profiles documentation clarifies favorites belong to a profile. | `kind: favorite`, profile ownership, stable saved URL; show in every Space assigned to that profile, never in another profile. | [Favorites](https://resources.arc.net/hc/en-us/articles/19230755904151-Favorites-Top-Tabs-Across-Every-Space), Profiles |
| Pinned tab | Saved to a particular Space; can be in folders; never auto-archives. Pin/unpin uses Cmd/Ctrl+D. | Persist saved URL separately from current URL. Pinning converts an existing Today tab. Unpinning moves it to Today. Explicit removal is separate from merely closing its loaded page. | [Pinned tabs](https://resources.arc.net/hc/en-us/articles/19231060187159-Pinned-Tabs-Tabs-you-want-to-stick-around) |
| Today tab | Unpinned working tab, subject to inactivity archive. | `kind: today`, Space ownership, creation and last-active timestamps. Closing moves it to recoverable archive. | [Auto Archive](https://resources.arc.net/hc/en-us/articles/19228855311127-Auto-Archive-Clean-as-you-go) |
| Folder | Groups saved tabs; its tabs do not auto-archive. | Persist folder order and expanded state within a Space; moving a Today tab into it pins that tab. | [Folders](https://resources.arc.net/hc/en-us/articles/19228419623447-Folders-Stash-Similar-Tabs-Together) |

**Inferred model decision:** Store `homeUrl` and `url` separately for saved tabs. Arc release notes describe an explicit return-to-pinned-URL action, which needs this distinction. This is a compatible data model, not a recovered Arc schema. [Windows release notes](https://resources.arc.net/hc/en-us/articles/22513842649623-Arc-for-Windows-2023-2026-Release-Notes)

## Archive and restore

Documented: idle unpinned tabs archive after 12 hours by default. Viewing/clicking a tab resets its timer. Cadence is configurable per Profile; default settings can be inherited. Archive can be opened through Cmd/Ctrl+T → “View Archive”; individual records can be restored. Official documentation says Arc does not allow auto-archive to be disabled. [Auto Archive](https://resources.arc.net/hc/en-us/articles/19228855311127-Auto-Archive-Clean-as-you-go)

Implementation choices: preserve title, URL, profile ID, Space ID and archived-at timestamp. Run archive checks on startup and periodically; exempt the current visible tab(s) and favorites/pinned tabs. An optional “Never” setting is a deliberate product difference. Retain a bounded archive and support restore even after restart. Avoid erasing tabs just because a file has invalid data: quarantine a bad state file and recover a backup.

## Command bar and keyboard

Arc's command bar opens with Cmd+T / Ctrl+T and accepts URLs, searches and browser actions. Official Windows release notes explicitly list Pin Tab, toggle sidebar, new split, rename, and new Space/folder commands. Space names can be entered to switch context. [Windows release notes](https://resources.arc.net/hc/en-us/articles/22513842649623-Arc-for-Windows-2023-2026-Release-Notes), [Spaces](https://resources.arc.net/hc/en-us/articles/19228064149143-Spaces-Distinct-Browsing-Areas)

Minimum independent contract: Cmd/Ctrl+T opens new-tab intent; Cmd/Ctrl+L edits current URL; Escape dismisses; arrows select a result; Enter executes it. Suggest existing tabs and actions locally. Search history must be filtered to the current profile. A fully qualified HTTP(S) URL navigates; ordinary text becomes a search query. Explicitly reject unsafe schemes rather than feeding them to operating-system handlers.

| Shortcut | Action | Evidence strength |
|---|---|---|
| Cmd/Ctrl+T | New-tab command bar | Official help/search index |
| Cmd/Ctrl+W | Close current tab/window | Official keyboard article search excerpt |
| Cmd/Ctrl+D | Pin/unpin current tab | Official pinned-tab article |
| Cmd/Ctrl+O while Peek is open | Promote Peek to a tab | Official Peek article excerpt |
| Control+number on macOS; Alt+number on Windows | Select Space | Official Spaces article |
| Cmd/Ctrl+L, Cmd/Ctrl+Shift+T, Cmd/Ctrl+R | Edit current URL, restore recent tab, reload | Recommended browser conventions; verify exact Arc parity separately |

Do not claim the exact current Arc shortcut map was exhaustively recovered. [Keyboard shortcuts](https://resources.arc.net/hc/en-us/articles/20595231349911-Keyboard-Shortcuts)

## Split View

Arc supports viewing several sites together. Its release notes document horizontal/vertical orientation, per-panel URLs, up to four tabs, dragging one sidebar tab onto another to create a split, and an unsplit action. Windows notes document draggable dividers. [macOS 2023 notes](https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes), [macOS 2024–2026 notes](https://resources.arc.net/hc/en-us/articles/20498293324823-Arc-for-macOS-2024-2026-Release-Notes), [Windows notes](https://resources.arc.net/hc/en-us/articles/22513842649623-Arc-for-Windows-2023-2026-Release-Notes)

Independent baseline: two real `WebContentsView`s, adjustable ratio, an explicitly focused pane, and per-pane navigation/back-forward state. Closing one pane collapses the layout without closing the remaining tab. Each underlying tab retains its profile session. A two-pane-only first build is a declared difference from documented Arc, not full parity.

## Peek

Documented: links from pinned/favorited tabs can open a transient preview; a preview can be expanded to a tab or split, or closed using its close control/outside click. Cmd/Ctrl+O promotes it. macOS July 2023 notes document Shift+click for Peek and configurable behavior. The exact current link-selection heuristics (same-origin, target attribute, redirects and special sites) have **not** been established. [Peek](https://resources.arc.net/hc/en-us/articles/19335302900887-Peek-Preview-Sites-From-Pinned-Tabs), [macOS 2023 notes](https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes)

Independent baseline: explicit Open in Peek action creates a temporary native web-content surface using the source tab's session; Escape/close restores source focus; promotion preserves the preview's current URL. If automatic interception is used, document exactly which navigation triggers it. Do not silently replace normal form submits, OAuth popups or downloads with URL-only navigation, which loses request state.

## Electron implementation boundaries

- `BrowserView` is deprecated; `WebContentsView` is its replacement. Construct it after `app.whenReady()`, attach to window content view, and manage its bounds. A web contents can be adopted by a single view. [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [BrowserView](https://www.electronjs.org/docs/latest/api/browser-view)
- `session.fromPartition('persist:' + profileId)` preserves cookies/cache per Profile. Identical partition keys share a session; a key without `persist:` is in-memory. [Session](https://www.electronjs.org/docs/latest/api/session)
- Use navigation, title, favicon, loading, crash and window-open events to keep the shell synchronized. `setWindowOpenHandler` controls popup creation; navigation API calls do not necessarily fire the same interception events as page-initiated navigation, so validate at the command boundary too. [webContents](https://www.electronjs.org/docs/latest/api/web-contents)
- Child view web contents do not automatically die with a `BaseWindow`; close them explicitly during teardown. [BaseWindow](https://www.electronjs.org/docs/latest/api/base-window)
- Listen for `will-download` on each profile session. Leaving the save path unset uses the normal save dialog; downloaded content must not auto-execute. [DownloadItem](https://www.electronjs.org/docs/latest/api/download-item)

### Security baseline

Electron's own guidance warns that it is not a general browser security product. A browser shell must isolate untrusted content: sandbox enabled, Node integration disabled, context isolation enabled, web security left enabled, no privileged renderer bridge in remote tabs. Keep privileged shell content local behind a restrictive CSP/custom protocol. Validate the sender/frame and payload of every IPC request. Restrict navigation/new windows, and implement permission checks/requests for every profile session. Do not blindly call `shell.openExternal` on website-supplied URLs. Chromium/Electron versions require continued updates; enabling these settings is not a security audit. [Security](https://www.electronjs.org/docs/latest/tutorial/security)

## Acceptance checks derived from this contract

1. Two Spaces using one Profile share a test cookie; a Space using another Profile does not. Favorites follow the same scope.
2. Pinning survives reload/restart; archive never removes saved tabs. An old Today tab archives; viewing resets inactivity.
3. Restoring an archive record reopens its URL in the correct profile context.
4. Address bar tracks redirects and back/forward changes. A rejected scheme cannot reach OS execution or privileged shell pages.
5. Split panes load independent real web pages; focused-pane navigation targets the correct pane; collapsing one keeps the other.
6. Peek uses source profile; dismiss leaves parent state unchanged; promote creates a normal tab.
7. Remote page cannot access Node APIs, preload IPC or local shell protocol; permission requests cannot silently succeed.
8. Closing a tab/window destroys its owned web contents; state writes survive interrupted shutdown through atomic replacement.

These are proposed validation cases, not test results. Runtime/REA evidence and implementation test results must be reported independently.

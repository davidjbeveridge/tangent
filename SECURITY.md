# Security

Tangent v0.1 is experimental. Its security boundaries have targeted tests and code review, not a completed independent security audit. There is no established production support or guaranteed security-update service.

## Supported versions

Only the current development version is maintained. When Electron or Chromium receives security updates, Tangent must be rebuilt and redistributed with an updated Electron release. Updating Tangent updates the complete runtime; it does not independently patch Chromium. Preferences display the running versions.

Manual updates are the default. Open the project's releases from Preferences, quit Tangent, and explicitly install or replace the downloaded app. Source users can run `npm run update` after closing Tangent. These flows do not need signing credentials. Published checksums help identify damaged downloads; they do not independently authenticate an unsigned publisher.

An optional signed-release configuration enables in-app updates on macOS and Windows only. Its existence does not establish that a signed release has been published or that delivery has been verified on those platforms. Linux, source builds and ordinary unsigned packages keep in-app updating disabled.

## Reporting

If this repository's **Security → Report a vulnerability** option is enabled, use its private reporting flow. Include the affected version, operating system, minimal reproduction, expected behavior and actual impact. Use synthetic pages and disposable profiles.

If private reporting is unavailable, contact a repository maintainer through an existing private channel. Do not put credentials, personal history, session files or an uncoordinated exploit in a public issue. No response-time commitment is established for this initial project.

## Boundaries to preserve

- HTTP(S) page contents run with sandboxing, context isolation and web security enabled, with Node integration disabled.
- Packaged builds force Chromium sandboxing before creating web contents and reject sandbox-disabling launch flags. The AppImage launcher preserves that policy when the host lacks user namespaces; it fails to launch instead of falling back to an unprotected browser. Linux requires a regular user account and a system policy that permits Chromium's sandbox.
- Only the local shell receives the Tangent preload bridge. Privileged IPC validates sender, frame, origin and command payload.
- Profiles select separate persistent Chromium session partitions. Several Spaces may intentionally share one Profile.
- Navigation and popup handling validate URLs and preserve the originating browsing context. Website-controlled URLs must not be handed directly to OS execution.
- Sensitive site permissions require an origin-scoped decision. Certificate failures are not silently accepted.
- Imported state is treated as untrusted data, size bounded and reconstructed through a schema-aware parser.
- Downloaded files are not automatically executed.
- Update endpoints accept no renderer-selected feed, channel, executable path or downgrade policy. Only the local shell may call them.
- Unsigned builds cannot enable in-app updating through preferences, an environment flag or a website.
- Installing an in-app update requires native user confirmation and a successful session save. Ordinary quit and timers do not install it.

See [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [Architecture](docs/ARCHITECTURE.md) for rationale and implementation boundaries.

## Data and limitations

The app's session JSON and exports contain URLs, page titles, archive entries, history and profile labels in plain text. Treat them as private. Chromium manages cookies and site storage in separate on-disk partitions. Exporting the Tangent session does not export login state.

Profiles separate website identity; they do not protect one local user's browsing from another person with access to the same OS account or application files. All profile metadata is visible to the trusted shell. There is no private-browsing mode in this version.

The application has no analytics backend or account service. Browsing websites, searching and downloads naturally contact the selected services. Absence of app analytics does not mean network anonymity or tracking protection.

Unsigned packaging output supports the manual review and installation flow. The app does not automatically download or execute unsigned installers. Broader browser hardening, actual signing/notarization operations and comprehensive platform testing remain release work. Do not disable platform security protections globally to run a development artifact.

## Optional signed update boundary

The stable update feed is fixed to `davidjbeveridge/tangent` on GitHub. The main process requires a packaged build plus a valid release policy and matching `app-update.yml`. Release policy is generated before packaging is signed and contains only the public feed and publisher identity. Credentials remain in the signing tools' environment and are not written into configuration or app resources. The signed workflow separately verifies the resulting artifacts before preparing a draft release.

The pinned `electron-updater` 6.8.9 dependency checks download hashes and uses platform code signing. macOS requires a verified Developer ID installation and delegates update signature checking to Squirrel.Mac before installation. Windows requires a matching full publisher Distinguished Name and rejects verifier warnings, errors and exceptions; this closes upstream's fallback that can otherwise skip verification when PowerShell is unavailable. Cached Windows downloads are verified again. Web installers, prereleases and downgrades are disabled. Release manifests in this stable updater version are not separately signed, so metadata integrity also depends on the fixed HTTPS feed and the repository's release controls; app authenticity depends on the platform signature.

The downloaded update remains inactive until the user approves a native restart prompt. Tabs, Spaces and settings are saved; live page/form contents, Peek state and active downloads cannot be preserved as an in-memory browser session. Tests exercise policy gating, invalid versions, verifier failure, duplicate requests, cancellation and save failure. Tests with injected updater events do not substitute for a signed installation-to-installation update on macOS or Windows.

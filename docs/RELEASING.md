# Releasing and updating Tangent

**Signing is optional.** Tangent can be built, installed, and updated from source or through manual installer replacement without signing credentials. Default packages have no verified publisher identity and do not enable the in-app updater. Native macOS packaging uses certificate-free ad hoc signing (`identity: "-"`, hardened runtime disabled), which supports local Apple Silicon execution but provides no Developer ID identity or notarization. Windows and Linux manual packages are unsigned. The signed release workflow is a separate, optional path for maintainers who have the required certificates.

## Update a source installation

Quit Tangent, open a terminal in its Git checkout, and run:

```sh
npm run update -- --check
npm run update
```

The first command fetches the upstream branch and reports incoming changes. The second prepares the update in an isolated Git worktree, installs the locked dependencies, and runs the build, unit tests, and real Electron browser tests before replacing the original checkout's source and runtime. It requires the expected upstream repository, `main`, a clean working tree, and a fast-forward update. The update retains a previous-source branch and runtime backup. `--yes` confirms that Tangent is quit; it does not skip the tests. Use `npm run update -- --help` for the complete contract.

The staging worktree isolates files, not program execution: dependency installation and tests run with your user account's permissions. Browser profile data is separate from the checkout and is not replaced by this script. For an installed application, use the manual replacement flow below instead.

## Update an installed copy manually

Download the matching package and `SHA256SUMS` from the [official releases](https://github.com/davidjbeveridge/tangent/releases). Compare the package's SHA-256 value with its line in that file before opening it:

| System | Compute the selected file's hash |
| --- | --- |
| macOS | `shasum -a 256 Tangent-VERSION-mac-arm64.dmg` (use `x64` on Intel) |
| Windows PowerShell | `Get-FileHash .\Tangent-VERSION-win-x64.exe -Algorithm SHA256` |
| Linux | `sha256sum Tangent-VERSION-linux-x64.AppImage` |

Replace `VERSION` with the version in the filename. Checksums detect a mismatched or corrupted download; a checksum hosted with the download is **not a publisher signature**.

Export your workspace and quit Tangent before replacing it. On macOS, copy the new app into the same Applications location. On Windows, run the new installer using the same installation location. On Linux, replace the AppImage and make the replacement executable. Keep the browser's profile directory. Retain the previous installer until the new version opens and your spaces, tabs, and sessions work.

An unsigned macOS download may require an app-specific approval in **System Settings → Privacy & Security → Open Anyway** after an initial launch attempt. Follow [Apple's instructions](https://support.apple.com/en-us/102445) only for a download you have chosen to trust. No Tangent workflow disables Gatekeeper globally or removes quarantine recursively. Source builds and installer replacement remain available without enabling signed automatic updates.

## Keep Electron and Chromium current

`.github/dependabot.yml` checks npm every calendar day at 09:00 UTC, including weekends. Electron, electron-builder, and electron-updater updates stay in separate pull requests. Other development tools may be grouped for minor and patch updates; major upgrades remain separate. The cron schedule is intentional: GitHub's `daily` interval runs only on weekdays. See the [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Electron, its updater, and the packaging tool use exact stable versions in `package.json` and `package-lock.json`. `scripts/check-runtime.mjs` rejects ranges, prereleases, lockfile drift, and an installed Electron that differs from the pin. It probes the actual executable and records its Electron, Chromium, and Node versions in the CI summary and `BUILDINFO.json`.

**Chromium is bundled with Electron.** Upgrade the pinned Electron package, test the complete application, and distribute a complete new Tangent build. Do not replace Chromium binaries inside an existing app. Electron publishes its [support policy and release cadence](https://www.electronjs.org/docs/latest/tutorial/electron-timelines); maintainers still need to review upstream security advisories and release notes promptly. A daily dependency check does not make an unreviewed update safe or guarantee immediate delivery of every Chromium fix.

There is no automatic merge or automatic publication. Review every dependency update. For an Electron major upgrade, read the [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes), examine changes to navigation, sessions, permissions, popups, sandboxing, and packaging, and exercise the resulting installers before release. A green test suite cannot establish compatibility with every website, GPU, OS version, or existing profile.

## Repository setup

Enable GitHub Actions and Dependabot. Protect `main` with the **Browser checks** required status, pull-request review, and Code Owner review for dependency, updater, and workflow changes. The supplied `CODEOWNERS` requests the repository maintainer's review; the file alone does not enforce branch protection. Protect release tags against replacement or deletion. Never reuse a published version for different binaries.

`check.yml` runs the same checks on Linux x64, Windows x64, Apple Silicon macOS, and Intel macOS. It uses fixture websites and real Electron processes for browser integration tests. Linux also runs release-helper fixtures that reject invalid/moved tags, mixed assets, tampering, and accidentally enabled unsigned updaters, using a local GitHub CLI stub. Pull requests have read-only repository permissions and no signing secrets. Actions are pinned to full commit hashes and receive their own Dependabot updates.

| Workflow | Trigger | Result |
| --- | --- | --- |
| **Check** (`check.yml`) | Main pushes, PRs, manual, reusable | Four-platform checks and runtime evidence |
| **Build unsigned installers** (`release.yml`) | Version tag, manual, reusable | Tested installers retained as Actions artifacts for 14 days |
| **Create draft manual release** (`manual-release.yml`) | Manual, existing stable tag | Four-platform unsigned packages, checksums, and build information in a GitHub draft |
| **Create draft signed release** (`signed-release.yml`) | Manual, existing stable tag | Verified macOS universal and Windows x64 packages plus updater metadata in a GitHub draft |

Both draft workflows resolve the tag to an immutable commit on `main`, check that it matches `package.json`, rerun the complete platform matrix, and require all packaging jobs to pass. The final job verifies every uploaded asset against its build inventory and rechecks the remote tag before creating the draft. Only that final job receives `contents: write`. Neither workflow publishes the draft.

## Create a manual release

1. Update the application version and lockfile together, review the change, and merge it to `main`. For example, `npm version 0.1.1 --no-git-tag-version` prepares a version change for review.
2. From the intended tested commit, create and push an immutable version tag, for example `git tag -a v0.1.1 -m "Tangent 0.1.1"` followed by `git push origin v0.1.1`.
3. In GitHub Actions, run **Create draft manual release** from `main` with that tag. The equivalent CLI command is `gh workflow run manual-release.yml --ref main -f tag=v0.1.1`.
4. After all jobs pass, inspect the draft's six installers: macOS arm64 DMG/ZIP, macOS x64 DMG/ZIP, Windows x64 NSIS EXE, and Linux x64 AppImage. `SHA256SUMS` and `BUILDINFO.json` accompany them. Unsigned packages contain neither an updater policy nor a feed; unsigned `latest*.yml` files are excluded.
5. Install and replace a previous version on the target systems. Check startup, normal browsing, profile/session retention, export/import, splits, and the manual update instructions. Review the release notes and remove the maintainer reminder after recording those results.
6. Publish the draft deliberately when it is ready for users. [GitHub CLI documents the distinction between draft creation and publication](https://cli.github.com/manual/gh_release_create).

Use one release workflow per version tag. An existing release is not overwritten. Build artifacts and a prepared draft are not evidence that a maintainer has completed installation testing or published a release.

## Optional: enable signed releases

This section is not required for source updates or manual installer replacement. The optional signing path uses the stable electron-builder 26 / electron-updater 6 APIs. The project's [v26 update documentation](https://www.electron.build/v26/docs/features/auto-update/) describes the macOS ZIP requirement and supported Windows NSIS updates.

Create a GitHub environment named **`release-signing`**, restrict it to `main`, and configure maintainer approval. Environment protection must be configured in GitHub; the workflow cannot establish it by naming the environment. GitHub explains when [environment secrets become available to an approved job](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments).

Add these values to that environment:

| Name | Kind | Value |
| --- | --- | --- |
| `CSC_LINK` | Secret | Base64 macOS Developer ID Application certificate and private key export (`.p12`) |
| `CSC_KEY_PASSWORD` | Secret | Nonempty password protecting that export |
| `APPLE_ID` | Secret | Apple account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Secret | App-specific notarization password |
| `APPLE_TEAM_ID` | Variable | Ten-character Apple team identifier |
| `TANGENT_MAC_IDENTITY` | Variable | Full `Developer ID Application: … (TEAMID)` certificate identity |
| `WIN_CSC_LINK` | Secret | Base64 Windows Authenticode certificate and private key export (`.pfx`) |
| `WIN_CSC_KEY_PASSWORD` | Secret | Nonempty password protecting that export |
| `TANGENT_WINDOWS_PUBLISHER` | Variable | Full certificate Subject distinguished name, including `CN=…` and its remaining fields |

This workflow expects usable certificate exports. A signing service or hardware-only key needs a reviewed signing adapter. Do not commit private keys, passwords, generated keychains, or environment files. The [v26 signing reference](https://www.electron.build/v26/docs/features/code-signing/) documents certificate environment variables and `forceCodeSigning`.

Run **Create draft signed release** from `main` with a new stable tag. The build requires `TANGENT_RELEASE_BUILD=1`, the complete platform credentials, forced code signing, macOS hardened runtime and notarization, and Windows publisher validation. Credentials are passed only to the signing step. Missing credentials or a failed signature/notarization check fail the job; there is no fallback to an unsigned signed-release artifact.

The release configuration embeds a fixed GitHub update feed and a platform-specific policy before signing. The workflow checks the final macOS app, ZIP, and mounted DMG for signature identity, team, universal architectures, notarization, and policy. It checks the Windows executable and installer for a valid Authenticode signature, expected full publisher name, and timestamp. Manifest SHA-512 values must match the generated files. The same asset inventory and draft-only release checks used for manual releases then apply.

Before the first signed release is published, test a complete installed-version-to-new-version update on macOS and Windows using the real signing identities. Check rejection of an incorrect publisher and damaged download, preservation of profile data, explicit download/install consent, cancellation, and restart. The first signed version must be installed manually over an unsigned version: unsigned builds intentionally do not activate an updater.

Stable builder 26 / updater 6 do not provide the next-version Ed25519 manifest feature. This implementation relies on HTTPS plus platform payload signatures, and does not claim that update metadata itself is signed. Linux continues to use manual AppImage replacement. When adopting a future updater major, review its actual released package and migration instructions rather than assuming that features in the default next-version documentation are available.

After the first signed update channel is published, every release designated **Latest** on GitHub must include the signed macOS/Windows payloads and their `latest*.yml` metadata. A newer manual-only release has no updater metadata and would make signed clients' update checks fail. Keep subsequent manual-only builds out of the Latest designation, or move them to a separately designed release channel. This does not affect the initial manual-only release process.

Keep signing identities stable across releases. Repair a bad release with a higher application version; the in-app updater rejects downgrades. Record installer and upgrade test results for each signed release. The prepared workflow and local tests alone do not prove that a certificate-backed, live update has succeeded.

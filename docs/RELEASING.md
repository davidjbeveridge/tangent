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
| Linux | `sha256sum Tangent-VERSION-linux-x86_64.AppImage` |

Replace `VERSION` with the version in the filename. Checksums detect a mismatched or corrupted download; a checksum hosted with the download is **not a publisher signature**.

Export your workspace and quit Tangent before replacing it. On macOS, copy the new app into the same Applications location. On Windows, run the new installer using the same installation location. On Linux, replace the AppImage and make the replacement executable. Keep the browser's profile directory. Retain the previous installer until the new version opens and your spaces, tabs, and sessions work.

An unsigned macOS download may require an app-specific approval in **System Settings → Privacy & Security → Open Anyway** after an initial launch attempt. Follow [Apple's instructions](https://support.apple.com/en-us/102445) only for a download you have chosen to trust. No Tangent workflow disables Gatekeeper globally or removes quarantine recursively. Source builds and installer replacement remain available without enabling signed automatic updates.

Linux packages and browser tests use **Ubuntu 22.04 x64** as their CI baseline. AppImage launch requires the host to permit Chromium's user-namespace sandbox. Ubuntu 24.04 and other systems with restrictive namespace policies can reject this launch; the application fails closed. Do not add `--no-sandbox`, run Tangent as root, or disable AppArmor or system namespace restrictions to make a package launch. A passing Ubuntu 22.04 check is not certification of every Linux distribution.

## Keep Electron and Chromium current

`.github/dependabot.yml` checks npm every calendar day at 09:00 UTC, including weekends. Electron, electron-builder, and electron-updater updates stay in separate pull requests. Other development tools may be grouped for minor and patch updates; major upgrades remain separate. The cron schedule is intentional: GitHub's `daily` interval runs only on weekdays. See the [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Electron, its updater, and the packaging tool use exact stable versions in `package.json` and `package-lock.json`. `scripts/check-runtime.mjs` rejects ranges, prereleases, lockfile drift, and an installed Electron that differs from the pin. It probes the actual executable and records its Electron, Chromium, and Node versions in the CI summary and `BUILDINFO.json`.

**Chromium is bundled with Electron.** Upgrade the pinned Electron package, test the complete application, and distribute a complete new Tangent build. Do not replace Chromium binaries inside an existing app. Electron publishes its [support policy and release cadence](https://www.electronjs.org/docs/latest/tutorial/electron-timelines); maintainers still need to review upstream security advisories and release notes promptly. A daily dependency check does not make an unreviewed update safe or guarantee immediate delivery of every Chromium fix.

Dependency updates never merge or publish automatically. Review every dependency update. A release is published only through an explicit maintainer publication request after all release gates pass. For an Electron major upgrade, read the [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes), examine changes to navigation, sessions, permissions, popups, sandboxing, and packaging, and exercise the resulting installers before release. A green test suite cannot establish compatibility with every website, GPU, OS version, or existing profile.

## Repository setup

Enable GitHub Actions and Dependabot. Protect `main` with the **Browser checks** required status, pull-request review, and Code Owner review for dependency, updater, and workflow changes. The supplied `CODEOWNERS` requests the repository maintainer's review; the file alone does not enforce branch protection. Protect release tags against replacement or deletion. Never reuse a published version for different binaries.

`check.yml` runs the same checks on Ubuntu 22.04 x64, Windows Server 2025 x64, Apple Silicon macOS 15, and Intel macOS 15. It uses fixture websites and real Electron processes, with Chromium sandboxing enabled, for browser integration tests. Linux also runs offline release-helper fixtures covering explicit publication consent, immutable source ancestry, invalid or moved tags, mixed assets, missing packaged checks, tampering, partial uploads, and unsigned updater exclusion. Those fixtures use a local GitHub CLI stub. Pull requests have read-only repository permissions and no signing secrets. Actions are pinned to full commit hashes and receive their own Dependabot updates.

| Workflow | Trigger | Result |
| --- | --- | --- |
| **Check** (`check.yml`) | Main pushes except request-only changes, PRs, manual, reusable | Four-platform checks and runtime evidence |
| **Build unsigned installers** (`release.yml`) | Version tag, manual, reusable | Six installers with native packaged checks, retained as Actions artifacts for 14 days |
| **Release manual installers** (`manual-release.yml`) | Main push changing the release request, or manual dispatch | Exact-commit packages, checksums, and build information; draft by default, public only when explicitly requested |
| **Create draft signed release** (`signed-release.yml`) | Manual, existing stable tag | Verified macOS universal and Windows x64 packages plus updater metadata in a GitHub draft |

Both release workflows bind the build to an immutable commit on `main`, check that its version matches `package.json`, rerun the complete platform matrix, and require all packaging jobs to pass. The final job verifies every asset against its build inventory and rechecks the remote tag. Only that final job receives `contents: write`; build jobs never receive repository write permission. The manual workflow can create an absent version tag after its gates pass, but never moves an existing tag. The optional signed workflow requires an existing tag and remains draft-only.

The manual workflow creates a draft first, uploads all six installers plus `SHA256SUMS` and `BUILDINFO.json`, and compares GitHub's uploaded asset names, sizes, completion states, and SHA-256 digests with the locally verified files. It publishes that draft only if the request explicitly sets `publish: true`. A missing digest, incomplete upload, changed tag, or mismatched inventory stops publication. See GitHub's [release API](https://docs.github.com/en/rest/releases/releases), [asset API](https://docs.github.com/en/rest/releases/assets), and [reference API](https://docs.github.com/en/rest/git/refs).

## Create a manual release

1. Update the application version and lockfile together, add reviewed notes at `docs/releases/vVERSION.md`, and merge the prepared source to `main`. For example, `npm version 0.1.1 --no-git-tag-version` prepares a version change. Record that source commit's full 40-character SHA.
2. In a separate commit on `main`, create or update `.github/release-request.json` using the schema below. The source commit must already be an ancestor of the request commit. Use `publish: false` or omit the field to prepare a draft for review; use `publish: true` only when publication of that version is intended.
3. Push the request commit. **Release manual installers** validates the upstream repository, `main`, request schema, exact source SHA, ancestry, package version, release notes, and existing tag. It checks out the requested source for every build and test. Request-only pushes skip the redundant standalone Check run; the release still runs the full source check matrix itself.
4. Inspect the workflow's platform results. macOS must extract the ZIP, mount and copy the DMG, verify their ad hoc signatures and equivalent content, then launch the delivered app. Windows must install the NSIS package into a disposable per-user location, launch it, then uninstall it. Linux must extract the delivered AppImage and launch its actual AppRun. Each native run checks packaged runtime, bundled notices, manual-update configuration, real web content, remote privilege isolation, and workspace/cookie/local-storage retention across a restart.
5. After every source and installer gate passes, the final job creates an absent tag, uploads a draft, and verifies the uploaded checksums. With `publish: true`, it then publishes and marks the release Latest. Otherwise it leaves the verified draft for review. The release body uses the versioned notes and appends the exact commit, Electron/Chromium versions, and the validation scope.

```json
{
  "schemaVersion": 1,
  "version": "0.1.1",
  "tag": "v0.1.1",
  "commit": "REPLACE_WITH_THE_FULL_40_CHARACTER_SOURCE_SHA",
  "publish": false
}
```

The example's placeholder must be replaced with a lowercase hexadecimal commit SHA. Unknown fields, branch names, mismatched tags, string booleans, unmerged source, and attempts to redirect an existing tag are rejected. Publication requires nonempty release notes in that source commit. The request uses normal repository review and GitHub Actions permissions; it needs no personal access token, signing secret, or additional credential.

Manual dispatch is also available from `main`:

```sh
gh workflow run manual-release.yml --ref main \
  -f tag=v0.1.1 -f source-sha=FULL_SOURCE_SHA -F publish=false
```

Set the Boolean input to `true` for explicit publication after the same gates. An existing immutable tag can be used by leaving `source-sha` empty. A version tag created by the workflow's own `GITHUB_TOKEN` does not start a second tag-push build; the complete build has already run before tag creation. GitHub documents [workflow token event behavior](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication).

The six installer assets are macOS arm64 DMG/ZIP, macOS x64 DMG/ZIP, Windows x64 NSIS EXE, and Linux x86_64 AppImage. `SHA256SUMS` covers these plus `BUILDINFO.json`; the latter contains the source commit, runtime versions, per-platform smoke reports, and installer hashes. Manual packages contain neither an updater policy nor a feed; unsigned `latest*.yml` files are excluded.

Use one release workflow per version. An existing release, including an unfinished draft left by a failed upload, is never overwritten automatically. Inspect that draft and its workflow failure before choosing a recovery action. The automation never deletes a release, replaces an uploaded asset, or moves a tag. After a version is published, fix a defect with a higher version.

Native smoke checks establish that these packaged builds launched and retained a fresh test profile on the named runners. They do not certify Gatekeeper or SmartScreen approval, every device and OS version, or migration from every older profile. Before later upgrades, separately test replacing an installed previous version and retaining real representative profile data. A draft is not a public release; inspect the resulting release state and asset list before announcing availability.

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

The release configuration embeds a fixed GitHub update feed and a platform-specific policy before signing. The workflow checks the final macOS app, ZIP, and mounted DMG for signature identity, team, universal architectures, notarization, and policy. It checks the Windows executable and installer for a valid Authenticode signature, expected full publisher name, and timestamp. Manifest SHA-512 values must match the generated files. The same inventory and uploaded-checksum verification applies, but this optional workflow always leaves a draft.

Before the first signed release is published, test a complete installed-version-to-new-version update on macOS and Windows using the real signing identities. Check rejection of an incorrect publisher and damaged download, preservation of profile data, explicit download/install consent, cancellation, and restart. The first signed version must be installed manually over an unsigned version: unsigned builds intentionally do not activate an updater.

Stable builder 26 / updater 6 do not provide the next-version Ed25519 manifest feature. This implementation relies on HTTPS plus platform payload signatures, and does not claim that update metadata itself is signed. Linux continues to use manual AppImage replacement. When adopting a future updater major, review its actual released package and migration instructions rather than assuming that features in the default next-version documentation are available.

After the first signed update channel is published, every release designated **Latest** on GitHub must include the signed macOS/Windows payloads and their `latest*.yml` metadata. A newer manual-only release has no updater metadata and would make signed clients' update checks fail. The manual workflow's `publish: true` path marks its release Latest, so use its draft-only mode after adopting signed updates and publish future stable versions through the signed path. Keep subsequent manual-only builds out of the Latest designation, or move them to a separately designed release channel. This does not affect the initial manual-only release process.

Keep signing identities stable across releases. Repair a bad release with a higher application version; the in-app updater rejects downgrades. Record installer and upgrade test results for each signed release. The prepared workflow and local tests alone do not prove that a certificate-backed, live update has succeeded.

# Validation record: Tangent 0.1.0

Validation began on 22 October 2026 in a Linux x86_64 workspace using Node 24.19.0, Electron 45.0.0 and Playwright 1.64.1. The source package records exact dependencies in package-lock.json. The local results below describe the initial implementation; the release gates add checks against the actual delivered installers.

## Completed

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Passed | `npm run typecheck` |
| State and URL tests | 33 passed | `tests/state.test.ts` (24), `tests/urls.test.ts` (9) |
| Optional signed updater | 18 passed | `tests/updates.test.ts`: policy, verification, versions, scheduling, consent, persistence failures |
| Release configuration | 4 passed | `tests/release-config.test.ts`: missing credentials, platform identity, builder schema, public-only policy |
| Packaged sandbox and launcher | 3 passed | `tests/sandbox.test.ts`: mandatory sandbox policy, packaging hook, argument handling and fail-closed launcher |
| Manual source updater | 13 passed | `tests/source-update.test.ts`: real Git fixtures, staging, working-tree conflicts, rollback, locks, cancellation and verification policies |
| Release workflow helpers | 50 passed | `node scripts/check-release-workflow.mjs`: request/tag binding, installer/smoke hashes, draft behavior, explicit publication, upload failures and remote digest checks |
| Workflow syntax | Passed | actionlint 1.7.12 on all four workflow files |
| Production bundles | Passed | `npm run build` |
| Real Electron integration | 5 scenarios passed | `tests/browser.e2e.ts` |
| Actual desktop rendering | Inspected | Dedicated Xvfb compositor capture of home, browsing and two native split panes |
| Official Arc artifact investigation | Completed within stated limits | `docs/rea/REA-INVESTIGATION.md` and evidence files |
| Packaged Linux app | Started successfully | `app.isPackaged` true, Tangent name/version, manual updater status, enabled Open releases, installed runtime dependencies |
| Delivered Linux AppImage | Passed as an unprivileged user | Actual extracted AppRun, no sandbox bypass, renderer `NoNewPrivs=1` and `Seccomp=2`, notices, manual update UI, tabs and website storage retained across restart |
| macOS arm64 package | Assembled on Linux | `Tangent-0.1.0-mac-arm64.zip`; 349,083,734 bytes, notices present, no enabling updater policy; unsigned, not run on macOS |

All 71 unit tests, type checking, and the production build passed again after the packaged sandbox changes. The five desktop scenarios cover:

1. Tangent branding and versions, manual update UI, source-build updater disabled, command-palette navigation, back/forward, remote privilege isolation, unsafe schemes, archive, persistent restart and saved-tab rename/restore.
2. Profile cookie separation, cookie sharing between Spaces of one Profile, and Profile-scoped Favorites.
3. Two visible native browsing surfaces, bounds, stable pane positions, and navigation targeting the focused pane.
4. Peek promotion preserving the same web contents, form input, JavaScript state and SPA URL; popup from Peek retaining its opener.
5. GET/POST popup semantics, explicit opener retention, source Profile cookies, blocking background-source popups and cleanup after self-close.

The final five-scenario suite passed in 8.7 seconds after the Tangent rename and manual update controls. Earlier compositor checks captured the native X11 rendering of browsing and split panes. BrowserWindow.capturePage does not include child WebContentsViews, so shell-only images were not used to infer real page rendering.

## Limits of this evidence

The root-owned disposable Electron test harness uses `--no-sandbox` because Chromium refuses a root launch otherwise. The tests verify that remote pages have no Node globals or Tangent bridge and exercise real browser behavior; they do **not** validate the operating-system sandbox. Normal launch code specifies `sandbox: true` and does not add a no-sandbox switch.

This local validation did not run on macOS or Windows. The initial [four-platform hosted run](https://github.com/davidjbeveridge/tangent/actions/runs/39836184343) passed at commit `1ad89ae58a96e819507b2ce9aa13e6786532763d`, including the native source browser tests on Windows and both Mac architectures. Those early tests used Playwright's default sandbox setting and establish functional behavior, not operating-system sandbox enforcement. The release changes explicitly set `chromiumSandbox: true` for normal-user source tests and every packaged launch.

The locally assembled macOS ZIP above has no Developer ID signature or notarization and was not run on macOS. Public release artifacts are separately rebuilt and checked on native runners. Manual macOS release builds use ad hoc signatures, which establish internal package integrity without authenticating a publisher.

Downloads and permission prompts have implementation and code review but no automated interactive OS-dialog coverage in this run. No broad website-compatibility, DRM/passkey, accessibility conformance, performance, power-loss, unsaved-form protection, hostile-site penetration, or long-running stability certification is claimed. The current hosted status is available on the repository Actions page. This record describes the local checks above; a workflow definition alone is not evidence of a completed hosted run.

## Installer release gates

`scripts/check-packaged.mjs` checks the actual delivered files using temporary profiles and installation directories. It requires a normal user and never disables the Chromium sandbox. The Linux release baseline is Ubuntu 22.04, with existing support for unprivileged user namespaces. The workflow does not weaken AppArmor or change host sandbox policy to pass a test.

| Delivered format | Required native check |
| --- | --- |
| macOS DMG, both architectures | Mount read-only, copy the app, verify its ad hoc signature, launch and restart |
| macOS ZIP, both architectures | Extract, verify its signature and notices, compare application code and Electron runtime with the tested DMG |
| Windows NSIS | Install per-user into a temporary directory on disposable CI, launch, restart, and uninstall |
| Linux AppImage | Extract the delivered image, verify the reviewed AppRun and desktop entry, then launch through AppRun and restart |

Each launched package must report `app.isPackaged`, the expected ASAR and executable, and the pinned Tangent/Electron/Chromium versions. Tests check its manual-update controls, bundled license notices, and absence of signed-update configuration. A local HTTP fixture checks remote privilege isolation and retained Spaces, pinned tabs, persistent cookies, and local storage after normal shutdown and restart.

The sandbox check inspects Electron's process metrics on macOS and Windows. On Linux it checks the renderer's `NoNewPrivs` and seccomp state in `/proc`, in addition to Electron preferences and the absence of disabling command-line flags. This is a concrete launch check, not a sandbox escape audit.

Before publication, installer hashes must match the files named in the passed smoke reports. `BUILDINFO.json` in each release records those reports, runtime versions, and the exact source commit; `SHA256SUMS` covers the installer downloads. Consult the release's actual evidence and workflow run for its result. Gatekeeper and SmartScreen approval, FUSE mounting, every Linux security-policy configuration, and upgrades from a previous released version are outside the first release's automated coverage.

## Reproduce

```sh
npm ci
npm run check
npm run test:e2e
```

On a Linux desktop-less CI runner:

```sh
xvfb-run -a npm run test:e2e
```

The source-updater fixtures use temporary local Git repositories and injected build checks, with no GitHub or npm network access. They verify successful staged replacement, retained backups, failure before installation, runtime rollback after a refused merge, unchanged browser-independent files, and respect for Git signature-verification policy. They do not simulate a production power failure or prove arbitrary npm installation scripts are safe. Optional signed-updater tests use injected events; no certificate-backed installation-to-installation update has been performed.

The integration tests use a local HTTP server and isolated temporary user-data folders. They do not use a personal browser profile, real accounts or remote private data.

## Distribution notices

The macOS packaging path removes Electron's root license files. Tangent therefore explicitly copies Electron's LICENSE and LICENSES.chromium.html into Contents/Resources/licenses/electron, alongside its own license and third-party notices. The original Tangent license, Electron notices, and updater/parser dependency license files were verified in the packaged outputs. The official Electron 45.0.0 macOS arm64 and Linux x64 distributions were checked: those two notice files match byte for byte across the runtime packages used here. Their SHA-256 values are `5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d` and `214152f78cc0b611f63ff8faefcc6670c4605ffbff05f092bb671e6df80ce741`, respectively.

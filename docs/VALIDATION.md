# Validation record: Tangent 0.1.0

Validated on 22 October 2026 in a Linux x86_64 workspace using Node 24.19.0, Electron 45.0.0 and Playwright 1.64.1. The source package records exact dependencies in package-lock.json.

## Completed

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Passed | `npm run typecheck` |
| State and URL tests | 33 passed | `tests/state.test.ts` (24), `tests/urls.test.ts` (9) |
| Optional signed updater | 18 passed | `tests/updates.test.ts`: policy, verification, versions, scheduling, consent, persistence failures |
| Release configuration | 4 passed | `tests/release-config.test.ts`: missing credentials, platform identity, builder schema, public-only policy |
| Manual source updater | 13 passed | `tests/source-update.test.ts`: real Git fixtures, staging, working-tree conflicts, rollback, locks, cancellation and verification policies |
| Release workflow helpers | 12 passed | `node scripts/check-release-workflow.mjs`: tag/asset validation and draft-only invocation |
| Workflow syntax | Passed | actionlint 1.7.12 on all four workflow files |
| Production bundles | Passed | `npm run build` |
| Real Electron integration | 5 scenarios passed | `tests/browser.e2e.ts` |
| Actual desktop rendering | Inspected | Dedicated Xvfb compositor capture of home, browsing and two native split panes |
| Official Arc artifact investigation | Completed within stated limits | `docs/rea/REA-INVESTIGATION.md` and evidence files |
| Packaged Linux app | Started successfully | `app.isPackaged` true, Tangent name/version, manual updater status, enabled Open releases, installed runtime dependencies |
| macOS arm64 package | Assembled on Linux | `Tangent-0.1.0-mac-arm64.zip`; 349,083,734 bytes, notices present, no enabling updater policy; unsigned, not run on macOS |

The five desktop scenarios cover:

1. Tangent branding and versions, manual update UI, source-build updater disabled, command-palette navigation, back/forward, remote privilege isolation, unsafe schemes, archive, persistent restart and saved-tab rename/restore.
2. Profile cookie separation, cookie sharing between Spaces of one Profile, and Profile-scoped Favorites.
3. Two visible native browsing surfaces, bounds, stable pane positions, and navigation targeting the focused pane.
4. Peek promotion preserving the same web contents, form input, JavaScript state and SPA URL; popup from Peek retaining its opener.
5. GET/POST popup semantics, explicit opener retention, source Profile cookies, blocking background-source popups and cleanup after self-close.

The final five-scenario suite passed in 8.7 seconds after the Tangent rename and manual update controls. Earlier compositor checks captured the native X11 rendering of browsing and split panes. BrowserWindow.capturePage does not include child WebContentsViews, so shell-only images were not used to infer real page rendering.

## Limits of this evidence

The root-owned disposable Electron test harness uses `--no-sandbox` because Chromium refuses a root launch otherwise. The tests verify that remote pages have no Node globals or Tangent bridge and exercise real browser behavior; they do **not** validate the operating-system sandbox. Normal launch code specifies `sandbox: true` and does not add a no-sandbox switch.

This local validation did not run on macOS or Windows. The four-platform GitHub workflow is configured to run native tests on those systems; consult its actual run before claiming they passed. The macOS ZIP has no Developer ID signature or notarization. It is an assembled development artifact, not a verified install-and-run release. For development on a Mac, use `npm ci && npm start` from the source package. Build/sign locally before distributing a macOS app.

Downloads and permission prompts have implementation and code review but no automated interactive OS-dialog coverage in this run. No broad website-compatibility, DRM/passkey, accessibility conformance, performance, power-loss, unsaved-form protection, hostile-site penetration, or long-running stability certification is claimed. The current hosted status is available on the repository Actions page. This record describes the local checks above; a workflow definition alone is not evidence of a completed hosted run.

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

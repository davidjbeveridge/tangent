# Contributing

Tangent is an independent open-source browser project at v0.1. Keep changes small enough to explain and verify. Describe the user-visible problem, the intended behavior, and what was actually tested.

## Develop

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npm run check
npm start
```

Use a separate browsing-data directory while developing:

```sh
TANGENT_USER_DATA=/absolute/path/to/tangent-dev-data npm start
```

On PowerShell:

```powershell
$env:TANGENT_USER_DATA = Join-Path $PWD '.tangent-dev-data'
npm start
```

Keep that directory outside commits. It contains browsing history and Chromium session data. Use a new empty directory when testing Profile isolation or import recovery.

## Verify behavior

`npm run check` runs TypeScript checks, unit tests and a build. `npm run test:e2e` builds the application and starts the desktop integration tests. On a Linux host without a display, run:

```sh
xvfb-run --auto-servernum npm run test:e2e
```

Electron integration tests should use local fixture pages and a disposable user-data directory. A static screenshot or a successful build does not prove real browsing, Profile isolation, popup semantics or native view cleanup.

Add focused regression coverage when changing behavior that can lose state or cross a privilege boundary. Useful checks include cookie separation between Profiles, preservation across restart, focus in both split panes, POST popups, Peek promotion, URL rejection, import validation and destruction of closed contents. Do not substitute mocks for native behavior when Electron itself determines the result.

Report tested OS/architecture and remaining gaps. The packaging workflow is not evidence that macOS or Windows has been exercised until it actually runs.

## Code organization

Keep state transitions and validation in `src/core/`. Keep filesystem, window, session and web-content access in `src/main/`. The shell renderer may use only the narrow preload bridge. Remote pages must never receive that bridge or Node access.

Read [Architecture](docs/ARCHITECTURE.md) before changing state ownership, profile partitioning or view lifecycle. Keep source ownership explicit; a popup belongs to the context that created it, even when another Space is currently selected.

## Dependencies and releases

Commit the npm lockfile. Changes to Electron should include a review of its release notes and real desktop smoke tests. Do not weaken shipped certificate checks, browser sandboxing, web security or IPC sender validation to make a test pass. Any environment-specific test exception must be explicit and reported as a limit of that test; it must not alter application defaults.

`npm run pack` produces an unpacked development app. Platform scripts produce unsigned installers. The manual release workflow tests and packages a tagged revision, generates checksums, and creates a draft release without signing credentials. The optional signed release workflow adds code signing, notarization, and the in-app update channel. Read [Releasing and updating Tangent](docs/RELEASING.md) for both paths.

For a clean source installation, `npm run update` stages and tests the current main branch before advancing the checkout. Do not use it to overwrite active development work. Dependency updates arrive through daily Dependabot checks and must pass the browser regression suite before review and merge.

## Research and provenance

Keep original code independent of proprietary products. Public behavior may guide a new implementation. Do not copy Arc code, decompiled routines, images, fonts, icons, credentials or bundled services into this repository.

The REA evidence summary records a limited investigation, not full reverse engineering. Keep raw proprietary material and complete source-derived semantic graphs outside the repository. Explain whether each claim is documented behavior, static observation, inference, or a Tangent design choice.

## Changes and review

A change description should cover the problem, resulting behavior, validation, and material limitations. Include screenshots for interface changes where they clarify the result; use synthetic browsing content. Never attach real user sessions or exported profiles.

Report sensitive defects through the process in [SECURITY.md](SECURITY.md).

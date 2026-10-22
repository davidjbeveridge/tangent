# Dependency maintenance

Review dependency updates against the code that uses them, the runtime Tangent actually ships, and the delivered installers. A newer major version is not automatically a security fix.

## Node types follow Electron

Electron 45 includes Node 24.22.0 ([upstream release](https://releases.electronjs.org/release/v45.0.0)). Tangent therefore uses `@types/node` 24.x. Node 26 declarations could allow an API that is absent from the packaged browser, even if the build host supports it.

`scripts/check-runtime.mjs` probes the installed Electron executable and compares its Node major with the installed, locked type definitions. Dependabot still proposes Node 24 minor and patch updates; major type updates are handled alongside the corresponding Electron runtime migration. Revisit the Dependabot exception when that migration occurs.

## YAML has two consumers

Tangent directly uses `js-yaml` 5.5.0 to validate packaged update configuration and release artifacts. The package supplies its own TypeScript declarations. The configuration is limited to 64 KiB, depth 16, no aliases, and an explicit root mapping without `<<` merge keys. Tests use the actual builder serializer for both macOS and Windows configuration.

The pinned builder and updater still require their own `js-yaml` 4.3.2 copies. Do not force them onto v5: YAML schema and merge behavior differ. Upgrading Tangent's direct parser does not upgrade the updater's remote-manifest parser. Both versions remain visible to the dependency audit.

## Temporary build logger override

`app-builder-lib` 26.15.3 uses `@electron/get` 3.1.0, whose optional `global-agent` 3 dependency brings in `roarr` and `sprintf-js` 1.1.3. The formatter is affected by [CVE-2026-97058 / GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). On 22 October 2026, no patched formatter release was available. This is a build-tool dependency chain, not a web-page dependency in the shipped browser.

The root manifest narrowly overrides `roarr` to **3.3.0 only under `@electron/get` 3.1.0 → `global-agent` 3.0.0**. That logger retains the CommonJS default export, child contexts, and logging methods used by the existing proxy agent, while replacing `sprintf-js` with `fast-printf`. The proxy and downloader networking implementations stay on their supported versions. Electron's separate `@electron/get` 5.x installation is unaffected.

A trial of `global-agent` 4.1.3 removed the advisory but failed real downloader tests: percent-encoded proxy passwords were sent incorrectly, and a trusted destination certificate was validated against `localhost`. That upgrade was rejected. The regression tests exercise HTTP forwarding, authenticated proxies, `NO_PROXY`, HTTPS CONNECT with destination-name verification, invalid certificates, checksum rejection, and structured diagnostic logging. Every request stays within the local fixture; no TLS checks are disabled.

Remove the override when the builder adopts a downloader/proxy dependency tree without this advisory. Check the full locked tree and proxy behavior before removing or widening it. A builder downgrade suggested by an audit tool is not a substitute for compatibility review.

## Required evidence

Run `npm ci`, `npm audit --audit-level=moderate`, `npm run check`, and the real Electron integration tests. The runtime probe checks exact Electron, builder, and updater pins as well as Node type alignment.

PRs that change dependency manifests, the lockfile, or packaging inputs also run the unsigned installer workflow on Linux x64, Windows x64, macOS arm64, and macOS x64. It checks the actual delivered packages, Chromium sandboxing, and session/storage retention after restart. These runs upload review artifacts; they do not publish a release.

A clear audit means the advisory database reported no matching known vulnerabilities at that time. It does not certify the browser or replace source review and runtime tests.

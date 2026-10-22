# Third-party notices

Tangent's original code and original geometric icon are licensed under MIT; see LICENSE.

The desktop runtime is [Electron](https://github.com/electron/electron), licensed under MIT. Electron bundles Chromium, Node.js, V8, and other components with their own licenses. Packaged Electron distributions retain their runtime license and Chromium notices. Preserve all notices in redistributed app bundles; this document does not replace them.

The app update service uses electron-updater (MIT) and js-yaml (MIT). Their production dependencies and license files are included in the packaged application.

Build and test tools include TypeScript (Apache-2.0), esbuild (MIT), tsx (MIT), Playwright (Apache-2.0), and electron-builder (MIT). Their transitive dependencies retain their respective licenses. `package-lock.json` records the exact dependency graph. These development dependencies are not imported into Tangent's remote page contexts.

[REA](https://github.com/morluto/rea) 6.7.0 was used as a separately installed analysis tool. REA-authored code is MIT; its third-party tools/material retain their own licenses. REA is not bundled with the browser. `npm run analyze:arc` installs the pinned CLI in a separate analysis output folder when explicitly invoked.

Arc is a product and trademark of The Browser Company. Tangent is independent and unaffiliated. No Arc executable, original JavaScript implementation, images, icons, fonts, service credentials, or branded assets are distributed with this project. Public documentation references, bounded factual metadata, resource hashes, and tool-status evidence are included for provenance. The research is not a formally separated clean-room process and does not claim recovered Arc source code.

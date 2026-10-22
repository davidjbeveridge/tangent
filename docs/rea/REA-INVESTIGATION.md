# Arc investigation with REA

REA 6.7.0 was installed and used against an official Arc macOS release on 22 October 2026. This is a bounded static investigation. It does not claim complete reverse engineering, native decompilation, or runtime parity.

## Target and provenance

The [official Arc download page](https://arc.net/download) links to the macOS installer. Its redirect resolved to:

`https://releases.arc.net/release/Arc-1.170.0-89123.dmg`

| Item | Observed value |
| --- | --- |
| Installer size | 458,434,157 bytes |
| Installer SHA-256 | `5cf6d057e8944f847dac83d89b4d30d7a49c8974d02d29b35d2cf5afce9e36c1` |
| App version and build | 1.170.0 / 89123 |
| App bundle identifier | `company.thebrowser.Browser` |
| App minimum macOS | 13.0.0 |
| Main executable SHA-256 | `25af5f4eaaae5aca25021f2737e90cc4d41fdf195c4a5c4012ea31a1bba4b86a` |
| Main executable architecture | x86_64 and arm64 slices |
| ArcCore framework version | 156.0.8078.48 |

Version values were decoded with Python `plistlib`. Architecture and load-command facts were decoded by the included small read-only Mach-O metadata parser. These supplemental observations are explicitly separate from REA output.

## What REA actually did

1. Inspected and hashed the official DMG. Evidence: `ev_36da66621cbde8c48f9ed3d4cca0de7ea7a2d408311228a2e45286170bd748e3`. REA correctly reported that the Linux host could not perform its native macOS DMG traversal.
2. Inventoried a selected extracted app subset, identifying the universal Mach-O executable and plist resources. This was not an inventory of the complete installed application.
3. Parsed two shipped JavaScript resources and two JSON policy files. Evidence: `ev_f102aad03ebded9612fea13b8bc551d06c739efbe899833a12689bbf15e2af0b`.

The JavaScript pass read 36,621 bytes from four selected resources, parsed two JavaScript files without parse failures, visited 3,619 AST nodes, and produced 2,890 semantic nodes and 2,863 semantic relations. It retained 898 unknowns. Its semantic coverage is explicitly **unknown**, with partial call-flow coverage. Successful parsing is not full semantic recovery.

REA's first JavaScript attempt failed because the restricted process namespace broke its mandatory `ps` ownership check. A subsequently approved run outside that namespace completed. No target JavaScript was executed.

The upstream npm package was installed with lifecycle scripts disabled, in the workspace only. No global agent settings or existing user configuration were changed. The CLI and analysis work; this does not imply that a persistent MCP registration was added to the user's Mac.

## Findings and implementation implications

| Finding | Evidence type | Implication |
| --- | --- | --- |
| The main executable declares AppKit, SwiftUI, ArcCore, WebKit, and Swift runtime loads; it contains Swift metadata sections. | Direct native metadata | Arc's desktop interface cannot be reconstructed by extracting an Electron ASAR. A new implementation needs its own shell and state model. The load declarations do not identify which framework renders each feature. |
| A shipped command-bar policy names domains whose results should be deduplicated by title and host. | Parsed configuration | Search behavior contains contextual policy beyond a universal URL match. Runtime application of this policy was not verified. |
| Web-content configuration includes keepalive, picture-in-picture, title cleanup, and tab suspension policy groups. | Parsed configuration | A production tab-lifecycle system needs exceptions for active sites and media. The exact runtime decisions remain unknown. |
| Boosts includes a shipped selector-picker script with DOM lookup, computed-style, element geometry, and selector-related identifiers in the REA graph. | Static semantic graph | Page customization requires DOM selection and geometry handling. No original implementation was copied into the new browser. |
| Easel resources include an inline-link control script with event-listener and default-prevention operations. | Static semantic graph | An embedded page surface may need navigation policy distinct from an ordinary tab. This does not establish the complete Easel design. |

These observations guide architecture and identify future investigation work. The new browser's UX implementation should rely on independently written code and documented behavior. This shared development workspace is not a formally isolated clean-room process.

## Unresolved work

- Native command-bar ranking and tab-state transitions.
- Actual sidebar serialization, migration, crash recovery, and sync conflict handling.
- Native event flow for Peek, Split View, Spaces, and profile switching.
- Runtime memory, media, permission, and suspension behavior.
- Native decompilation and direct macOS UI observation.

REA `inspect-macho` and `inspect-plist` were attempted and refused with `capability_unavailable`: their native utility provider requires macOS. The exact error responses are preserved. No Ghidra, Hopper, or IDA decompilation was performed.

## Reproduce

Run the included `analyze-arc.sh` against a locally obtained Arc.app. It installs the pinned REA CLI into the chosen output folder, selects the same four resource paths, and writes the original local evidence. Its comments list the exact version and hashes for this run.

The analysis sources are [REA](https://github.com/morluto/rea), its [CLI documentation](https://github.com/morluto/rea/blob/main/docs/cli.md), the [official Arc installer](https://releases.arc.net/release/Arc-1.170.0-89123.dmg), and the [official portable 7-Zip distribution](https://www.7-zip.org/download.html), used to extract selected files without running Arc.

## Included files

`rea-evidence-summary.json` is a metadata projection with original evidence IDs, resource hashes, counts, and limitations. It is not a canonical REA Evidence record. `arc-dmg.evidence.json` is the exact successful REA root-inspection response. The native command error responses and supplemental metadata are included separately.

The original 5.3 MB JavaScript semantic graph and extracted resources were kept in the local investigation workspace; they are excluded from the open-source project. No Arc executable, source script, font, image, icon, or other proprietary asset is included here.

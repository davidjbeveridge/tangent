# Tangent demonstration media

These files show the actual Tangent desktop application. They are available with Tangent's original MIT-licensed project material.

| File | Description |
| --- | --- |
| [tangent-split.png](tangent-split.png) | 1440 × 900 screenshot of Spaces, Favorites, pinned tabs, and split view |
| [tangent-demo.mp4](tangent-demo.mp4) | 19.35-second H.264 workflow recording, 1440 × 980, with explanatory captions below the unchanged application frame; no audio |
| [tangent-demo.vtt](tangent-demo.vtt) | Separate English captions |
| [capture-evidence.json](capture-evidence.json) | Runtime details, sandbox observations, and interaction timing |

[Watch the demonstration on the launch page](https://tangent-browser.davidjbeveridge.chatgpt.site/#demo).

## Provenance

Captured on October 22, 2026 from a Linux source build at commit [`aa0203f12a760e2bd463413500a8ead5701f3dae`](https://github.com/davidjbeveridge/tangent/commit/aa0203f12a760e2bd463413500a8ead5701f3dae), with Electron 45.0.0 and Chromium 156.0.8078.48.

The browser interface was not reconstructed, modified, or composited. The original Fieldnotes sample pages were served locally over loopback addresses and visibly labeled as demo content. They are not external publications or private browsing data. The video has a caption strip added beneath the full application frame.

The recording demonstrates Spaces, Favorites, pinned tabs, the command bar, split view, and Peek. It is a source-build demonstration on Linux, not footage of every platform, an installer upgrade, or every supported website.

## Bounded runtime observations

The app ran as an unprivileged user with Chromium sandboxing enabled. All ten sample-page renderers showed sandbox enabled, Node integration disabled, and context isolation enabled. Their Linux process status showed `NoNewPrivs: 1` and `Seccomp: 2`. These observations apply to the captured run and are not a general security certification.

## File integrity

```text
9b520119feb944de34d1655b4050380a6589cab58a4845aea4e9506bbbbf5413  tangent-split.png
230040364c419a3ebe40116571ec77bc268333096ae17445c23aafe983eaee3f  tangent-demo.mp4
```

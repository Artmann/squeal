---
title:
  'The release ships two look-alike macOS DMGs and the update feed locks an
  install to whichever arch it started on'
severity: 'major'
---

## Expected Behavior

Downloading Squeal on a Mac gets you a build that runs natively, or at least
tells you it is not.

## Current Behavior

`.github/workflows/release.yml` builds macOS on two runners and publishes
`Squeal-<v>-arm64.dmg` and `Squeal-<v>-x64.dmg` side by side. Nothing on the
release page or in `README.md` says which one to take, so an Apple Silicon user
can install the Intel build, where every JIT-heavy path — React reconciliation,
CodeMirror keystroke handling, Effect fibers, Schema decode — runs under Rosetta
2 at roughly 2-4x the cost. It presents as "the published app feels laggy", with
no error and nothing in the logs.

It cannot heal itself either: `src/main/updates/electron-updater.ts` builds the
feed URL from `process.arch`, which reports `x64` under Rosetta, so every future
update is also the Intel build.

## Possible Solution

Publish a single universal macOS build and drop the per-arch assets.
`update.electronjs.org` falls back to a `-universal` darwin asset when no
arch-specific asset exists at that version (`src/updates.ts` in
`electron/update.electronjs.org`), so existing x64 installs would receive it and
run native from then on — but only if the per-arch assets are gone, because at
equal versions an arch-specific asset wins.

## Minimal Reproducible Example

    lipo -archs /Applications/Squeal.app/Contents/MacOS/Squeal   # x86_64
    uname -m                                                    # arm64

## Context

Cost most of an investigation into UI lag. Because dev runs the native arm64
Electron from `node_modules`, the slowdown only appears in the published app,
which points the investigation at packaging, the renderer bundle and the
database before anything suggests looking at the binary's architecture.

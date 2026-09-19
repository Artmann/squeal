---
title: '`yarn start` exits immediately without a TTY, so the agent-browser workflow in CLAUDE.md loads a blank window'
severity: 'minor'
---

## Expected Behavior

`CLAUDE.md` tells an agent to "Start the app with `yarn start`, then drive the
renderer with agent-browser" over CDP on port 9222. That should leave a running
app with its Vite dev server still up.

## Current Behavior

`electron-forge start` prints "Type rs in terminal to restart main process",
then exits about 3.5 seconds later with `✘ [ERROR] The build was canceled` and
`Done in 3.65s` whenever stdin is not a TTY — which is every non-interactive
shell an agent has. Electron survives as an orphan and keeps answering CDP, so
the failure does not look like one: `curl 127.0.0.1:9222/json/list` returns a
page and `agent-browser --cdp 9222 snapshot` answers `(empty page)`.

The Vite dev server died with its parent, so the window has nothing to load:

```
(node:94123) electron: Failed to load URL: http://localhost:5173/ with error: ERR_CONNECTION_REFUSED
```

The tell is the CDP target's title — `localhost:5173` rather than `Squeal`.

## Possible Solution

Hold stdin open for it:

```bash
tail -f /dev/null | yarn start
```

Worth a line in the agent-browser section of `CLAUDE.md`, or a `yarn start:ci`
script that does it.

## Minimal Reproducible Example

```bash
nohup yarn start > start.log 2>&1 &
# wait ~5s
tail -3 start.log                              # "Done in 3.65s"
curl -s 127.0.0.1:9222/json/list | grep title  # "localhost:5173", not "Squeal"
```

## Context

Hit while smoke-testing the oxfmt/oxlint/TypeScript 7 migration against the
running app. Cost about fifteen minutes, most of it spent suspecting the change
under test: that migration touched the window's load path in `src/main.ts`, and
a blank window with `ERR_CONNECTION_REFUSED` is exactly what a regression there
would look like.

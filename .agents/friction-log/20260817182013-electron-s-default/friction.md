---
title: 'Electron''s default menu owns ⌘R and ⌘⇧R, so renderer refresh shortcuts silently reload the window'
severity: 'minor'
---

### Expected Behavior

Binding an app shortcut like `mod+shift+r` in the renderer (react-hotkeys-hook)
fires the app's own handler.

### Current Behavior

`src/main.ts` never calls `Menu.setApplicationMenu`, so Electron installs its
default application menu. Its View submenu binds ⌘R to Reload and ⌘⇧R to Force
Reload, and those accelerators win over anything the renderer registers — the
whole window reloads instead. Nothing about the window suggests a menu exists:
it is frameless with `titleBarStyle: 'hidden'`, and on macOS the menu bar is
off-window entirely.

The obvious fix — `Menu.setApplicationMenu(null)` — is worse on macOS: the
standard Edit menu is what supplies ⌘C/⌘V/⌘X/⌘A/⌘Z to the renderer, so removing
the menu breaks copy and paste app-wide.

### Possible Solution

Either document the reserved accelerators next to the hotkeys we do register, or
install a trimmed custom menu (keep the Edit roles, drop Reload and Force
Reload) so the renderer can own ⌘R the way other database clients do.

### Minimal Reproducible Example

1. `useHotkeys('mod+shift+r', handler)` anywhere in `src/app`.
2. `yarn start`, press ⌘⇧R.
3. The renderer reloads; `handler` never runs.

### Context

Hit while adding the Databases refresh button. Cost a design round-trip: the
shortcut had to move to ⌘⌥R, which is not what anyone reaches for to refresh.

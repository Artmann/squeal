/**
 * The Toggle sidebar shortcut as the user's platform spells it. Read at call
 * time rather than cached in a module constant so tests can stand in a
 * platform.
 *
 * ⌘B, the key VS Code and most editors use for the same thing. Neither the
 * application menu in `src/main/menu.ts` nor CodeMirror's default keymap binds
 * it.
 */
export function getSidebarShortcut(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘B' : 'Ctrl+B'
}

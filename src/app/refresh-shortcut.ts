/**
 * The Refresh shortcut as the user's platform spells it. Read at call time
 * rather than cached in a module constant so tests can stand in a platform.
 *
 * Deliberately not ⌘R or ⌘⇧R: Electron's default application menu, which this
 * app never replaces, binds those to Reload and Force Reload.
 */
export function getRefreshShortcut(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘⌥R' : 'Ctrl+Alt+R'
}

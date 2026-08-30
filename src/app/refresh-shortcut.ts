/**
 * The Refresh shortcut as the user's platform spells it. Read at call time
 * rather than cached in a module constant so tests can stand in a platform.
 *
 * ⌘R, the key every other database client refreshes on. It was ⌘⌥R for as long
 * as Electron's default application menu owned ⌘R and ⌘⇧R for Reload and Force
 * Reload; `src/main/menu.ts` replaces that menu and leaves both roles out.
 */
export function getRefreshShortcut(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘R' : 'Ctrl+R'
}

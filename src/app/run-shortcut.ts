/**
 * The Run shortcut as the user's platform spells it. Read at call time rather
 * than cached in a module constant so tests can stand in a platform.
 */
export function getRunShortcut(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘↵' : 'Ctrl↵'
}

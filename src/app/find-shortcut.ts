/**
 * The Find in results shortcut as the user's platform spells it. Read at call
 * time rather than cached in a module constant so tests can stand in a
 * platform.
 *
 * ⌘F is safe to claim: Electron's default application menu, which this app
 * never replaces, has no Find role -- unlike ⌘R and ⌘W, which it does own. What
 * it does collide with is CodeMirror, so `use-worksheet-editor.ts` turns the
 * editor's search keymap off; see the note there.
 */
export function getFindShortcut(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘F' : 'Ctrl+F'
}

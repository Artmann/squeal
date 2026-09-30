export const sidebarCollapsedStorageKey = 'ui:sidebar-collapsed:v1'

/**
 * Whether the user has collapsed the sidebar. Persisted so a user who hides it
 * to get the editor width back does not have to hide it again on every launch.
 * The width is stored on its own, under `ui:sidebarWidth`, so expanding brings
 * back the width the sidebar had. Anything unreadable reads as "expanded"
 * rather than throwing; storage can be unavailable in some Electron contexts.
 */
export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(sidebarCollapsedStorageKey) === 'true'
  } catch (error) {
    console.warn('Could not read the sidebar preference.', error)

    return false
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(sidebarCollapsedStorageKey, String(collapsed))
  } catch (error) {
    console.warn('Could not save the sidebar preference.', error)
  }
}

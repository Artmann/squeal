import { initialTabsState, type TabsState } from './tabs-slice'

export const tabsStorageKey = 'ui:tabs:v1'

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  )
}

/**
 * Reads the persisted tabs. Anything unreadable falls back to the empty state
 * rather than throwing — a corrupt value must not stop the app from booting.
 * Ids that no longer exist are dropped later by `tabsReconciled`, once the
 * worksheets have loaded.
 */
export function readStoredTabs(): TabsState {
  try {
    const stored = localStorage.getItem(tabsStorageKey)

    if (!stored) {
      return initialTabsState
    }

    const parsed: unknown = JSON.parse(stored)

    if (typeof parsed !== 'object' || parsed === null) {
      return initialTabsState
    }

    const { activeWorksheetId, openWorksheetIds } = parsed as Record<
      string,
      unknown
    >

    if (!isStringArray(openWorksheetIds)) {
      return initialTabsState
    }

    return {
      activeWorksheetId:
        typeof activeWorksheetId === 'string' &&
        openWorksheetIds.includes(activeWorksheetId)
          ? activeWorksheetId
          : openWorksheetIds[openWorksheetIds.length - 1],
      openWorksheetIds
    }
  } catch (error) {
    console.warn('Could not read the stored worksheet tabs.', error)

    return initialTabsState
  }
}

export function writeStoredTabs(state: TabsState): void {
  try {
    localStorage.setItem(tabsStorageKey, JSON.stringify(state))
  } catch (error) {
    // Tabs that do not survive a restart are a much smaller problem than a
    // crash on every tab change.
    console.warn('Could not save the open worksheet tabs.', error)
  }
}

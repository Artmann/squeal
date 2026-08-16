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
 *
 * A payload the app actually wrote comes back `reconciled`, so the user's own
 * arrangement survives the restart — including having closed every tab. The
 * fallbacks come back `restored`, so a fresh install still gets a worksheet
 * picked for it. Stored tabs whose worksheets are all gone are safe either way:
 * that is a prune, and `tabsReconciled` opens the fallback regardless.
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
      openWorksheetIds,
      status: 'reconciled'
    }
  } catch (error) {
    console.warn('Could not read the stored worksheet tabs.', error)

    return initialTabsState
  }
}

export function writeStoredTabs(state: TabsState): void {
  try {
    // Only the tabs themselves. The status is not a fact about them, it is
    // where they came from, and `readStoredTabs` decides that on the way back
    // in from whether the payload was readable at all.
    const persisted = {
      activeWorksheetId: state.activeWorksheetId,
      openWorksheetIds: state.openWorksheetIds
    }

    localStorage.setItem(tabsStorageKey, JSON.stringify(persisted))
  } catch (error) {
    // Tabs that do not survive a restart are a much smaller problem than a
    // crash on every tab change.
    console.warn('Could not save the open worksheet tabs.', error)
  }
}

const gettingStartedStorageKey = 'ui:getting-started-dismissed:v1'

/**
 * Whether the user has dismissed the getting-started screen. Persisted because a
 * first-run prompt that returns on every launch is a nag — connecting a database
 * is still one click away in the sidebar. Anything unreadable reads as "not
 * dismissed" rather than throwing; storage can be unavailable in some Electron
 * contexts.
 */
export function readGettingStartedDismissed(): boolean {
  try {
    return localStorage.getItem(gettingStartedStorageKey) === 'true'
  } catch (error) {
    console.warn('Could not read the getting-started preference.', error)

    return false
  }
}

export function writeGettingStartedDismissed(dismissed: boolean): void {
  try {
    localStorage.setItem(gettingStartedStorageKey, String(dismissed))
  } catch (error) {
    console.warn('Could not save the getting-started preference.', error)
  }
}

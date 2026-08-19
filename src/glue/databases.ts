// Re-exported from the API contract so the renderer keeps one import path
// for database shapes.
import type { DatabaseDto } from './api/schemas'

export type { DatabaseDto } from './api/schemas'

// The row exists but its stored secret could not be decrypted, so the API had
// no connection details to send — most often because the OS keychain key that
// sealed them is gone. Named rather than compared inline, because a null here
// means "needs repair", not "no connection info": the row still has to be
// listed, and the edit form is what fixes it.
export function isConnectionUnreadable(database: DatabaseDto): boolean {
  return database.connectionInfo === null
}

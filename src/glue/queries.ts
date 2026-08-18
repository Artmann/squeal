// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
export const canceledQueryMessage = 'Query canceled.'

// One answer to "has this query finished", so the places that ask -- the
// results body, its meta line, the status bar, the poller -- cannot disagree.
// finishedAt is compared to null rather than tested for falsiness, because 0
// is a legitimate timestamp, and the callers converted here were split across
// both conventions. Narrowing finishedAt is what lets a caller compute a
// duration, or read the row it just proved is finished, without asking the
// question a second time.
export function isQueryFinished<T extends QueryLifecycle>(
  query: T | undefined
): query is T & { finishedAt: number } {
  return query !== undefined && query.finishedAt !== null
}

export function isQueryInFlight<T extends QueryLifecycle>(
  query: T | undefined
): query is T & { finishedAt: null } {
  return query !== undefined && !isQueryFinished(query)
}

interface QueryLifecycle {
  finishedAt: number | null
}

import type { CollectionStatus } from '@tanstack/react-db'

interface PersistingTransaction {
  isPersisted: { promise: Promise<unknown> }
}

interface WritableCollection<TUtils> {
  status: CollectionStatus
  utils: TUtils
}

/**
 * Watches an optimistic transaction's save without blocking on it. The
 * collection rolls the optimistic change back on its own when the save fails,
 * so the handler is only for telling the user. Leaving it out drops the
 * failure on purpose, which still keeps the rejection from going unhandled.
 */
export function onPersistFailure(
  transaction: PersistingTransaction,
  onError: (error: unknown) => void = () => undefined
): void {
  void transaction.isPersisted.promise.catch(onError)
}

/**
 * Writes a server answer straight into a collection, but only once it has
 * synced. A collection that has not started syncing will fetch fresh data,
 * the written row included, on its first read instead.
 */
export function writeIfReady<TUtils>(
  collection: WritableCollection<TUtils>,
  write: (utils: TUtils) => void
): void {
  if (collection.status !== 'ready') {
    return
  }

  write(collection.utils)
}

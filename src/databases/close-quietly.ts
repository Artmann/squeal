import { log } from 'tiny-typescript-logger'

/**
 * Closes a connection without letting the close itself throw.
 *
 * Every adapter opens a connection, uses it in a `try`, and closes it in the
 * matching `finally`. A bare `await client.end()` there is a trap: when the
 * body already failed, a rejecting close replaces the error the caller actually
 * needs — the failed query — with a socket error, and the connection leaks
 * anyway because nothing retries the close. Closing is best effort by nature,
 * so it is logged and swallowed.
 *
 * Accepts a sync or async close so it covers both mysql2 APIs: the promise
 * connection returns a promise from `end()`, the callback one returns void.
 */
export async function closeQuietly(
  close: () => Promise<void> | void,
  description: string
): Promise<void> {
  try {
    await close()
  } catch (error) {
    // The message only — a driver error object embeds the connection config.
    log.warn(
      `Could not close the ${description} connection: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

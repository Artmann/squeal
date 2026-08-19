import { isNull } from 'drizzle-orm'
import { log } from 'tiny-typescript-logger'

import type { database } from '@/database'
import { queriesTable } from '@/database/schema'

export const interruptedQueryMessage =
  'Query was interrupted because the app restarted.'

// Queries run in the background of the previous process, so any row still
// unfinished at boot was cut off by a crash or quit and can never complete.
// Marking them failed stops the renderer from showing an eternal spinner and
// polling for a result that will never arrive.
export async function markInterruptedQueries(
  client: typeof database
): Promise<number> {
  const interrupted = await client
    .update(queriesTable)
    .set({ error: interruptedQueryMessage, finishedAt: Date.now() })
    .where(isNull(queriesTable.finishedAt))
    .returning({ id: queriesTable.id })

  if (interrupted.length > 0) {
    log.info(`Marked ${interrupted.length} interrupted query(ies) as failed.`)
  }

  return interrupted.length
}

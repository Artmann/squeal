import { sql } from 'drizzle-orm'
import { log } from 'tiny-typescript-logger'

import { database } from '@/database'

const dayInMilliseconds = 24 * 60 * 60 * 1000

export const defaultTraceRetentionDays = 7
export const defaultMaxSpanCount = 50000

export interface DeleteExpiredSpansOptions {
  maxSpanCount?: number
  retentionDays?: number
}

// Spans are debug data with a short shelf life; time-based expiry plus a hard
// row cap keeps the table bounded even under heavy tracing. The cap deletes
// the oldest spans regardless of trace, which can truncate the tail of an old
// trace — acceptable for a local debug tool.
export async function deleteExpiredSpans(
  options: DeleteExpiredSpansOptions = {}
): Promise<number> {
  const maxSpanCount = options.maxSpanCount ?? defaultMaxSpanCount
  const retentionDays = options.retentionDays ?? defaultTraceRetentionDays
  const cutoff = Date.now() - retentionDays * dayInMilliseconds

  const expired = await database.run(sql`
    DELETE FROM spans
    WHERE startedAt < ${cutoff}
  `)

  const overCap = await database.run(sql`
    DELETE FROM spans
    WHERE id NOT IN (
      SELECT id FROM spans
      ORDER BY startedAt DESC
      LIMIT ${maxSpanCount}
    )
  `)

  const deletedCount =
    Number(expired.rowsAffected ?? 0) + Number(overCap.rowsAffected ?? 0)

  if (deletedCount > 0) {
    log.info(`Deleted ${deletedCount} trace span(s).`)
  }

  return deletedCount
}

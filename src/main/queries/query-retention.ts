import { sql } from 'drizzle-orm'
import { log } from 'tiny-typescript-logger'

import { database } from '@/database'

const dayInMilliseconds = 24 * 60 * 60 * 1000

export const defaultRetentionDays = 30

// Query history grows without bound otherwise — every run stores its full
// result (up to 10,000 rows of JSON) in the app database. Each worksheet's
// newest query is always kept regardless of age because the result panel
// shows it.
export async function deleteExpiredQueries(
  retentionDays = defaultRetentionDays
): Promise<number> {
  const cutoff = Date.now() - retentionDays * dayInMilliseconds

  const result = await database.run(sql`
    DELETE FROM queries
    WHERE queriedAt < ${cutoff}
      AND queriedAt < (
        SELECT MAX(newer.queriedAt)
        FROM queries AS newer
        WHERE newer.worksheetId = queries.worksheetId
      )
  `)

  const deletedCount = Number(result.rowsAffected ?? 0)

  if (deletedCount > 0) {
    log.info(
      `Deleted ${deletedCount} query history entry(ies) older than ${retentionDays} days.`
    )
  }

  return deletedCount
}

// Desktop apps can stay open for weeks, so a boot-only sweep is not enough.
export function startQueryRetentionSchedule(): void {
  const sweep = () => {
    void deleteExpiredQueries().catch((error: unknown) => {
      log.error(
        `Query history cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    })
  }

  sweep()

  setInterval(sweep, dayInMilliseconds)
}

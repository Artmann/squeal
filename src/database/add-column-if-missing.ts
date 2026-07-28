import type { SQL } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

// Startup schema evolution: adding a column that already exists is the one
// expected, safe failure. Anything else — a locked file, a corrupt database —
// must surface instead of being swallowed as if the migration succeeded.
export async function addColumnIfMissing(
  database: LibSQLDatabase,
  statement: SQL
): Promise<void> {
  try {
    await database.run(statement)
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error
    }
  }
}

// Drizzle wraps the driver error, so the tell-tale message sits somewhere in
// the cause chain rather than on the thrown error itself.
function isDuplicateColumnError(error: unknown): boolean {
  let current: unknown = error

  while (current instanceof Error) {
    if (current.message.includes('duplicate column name')) {
      return true
    }

    current = current.cause
  }

  return false
}

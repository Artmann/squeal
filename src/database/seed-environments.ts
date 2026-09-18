import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { environmentsTable } from './schema'

/**
 * The environments every install starts with. Their ids are fixed so that
 * re-seeding an existing database is a primary key conflict and nothing else:
 * a renamed or recoloured default keeps what the user did to it, and a deleted
 * one stays deleted, because deletion is a soft delete that leaves the row in
 * place.
 *
 * `createdAt` is what the list is ordered by, so the numbers here are the
 * order they appear in — not a real timestamp. They are the same on every
 * install, which is the point: the three defaults sort ahead of anything the
 * user adds later.
 */
const defaultEnvironments = [
  { createdAt: 1, hue: 152, id: 'local', name: 'Local' },
  { createdAt: 2, hue: 70, id: 'staging', name: 'Staging' },
  { createdAt: 3, hue: 25, id: 'production', name: 'Production' }
]

/**
 * Inserts the shipped environments, skipping any that are already there.
 * Idempotent, and safe to run on every boot.
 *
 * Runs after `reconcileColumns`: an insert naming columns an older `databases`
 * table has not been widened with yet would throw.
 */
export async function seedEnvironments(
  database: LibSQLDatabase
): Promise<void> {
  await database
    .insert(environmentsTable)
    .values(defaultEnvironments)
    .onConflictDoNothing()
}

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { describe, expect, it } from 'vitest'

import { environmentsTable } from './schema'
import { seedEnvironments } from './seed-environments'
import { createTables } from './tables'

async function makeDatabase() {
  const client = drizzle(':memory:')

  await createTables(client)

  return client
}

function summarize(
  rows: { id: string; name: string; deletedAt: number | null }[]
) {
  return rows.map((row) => ({
    deleted: row.deletedAt !== null,
    id: row.id,
    name: row.name
  }))
}

// Seeding runs on every boot, not once, so everything here is about what the
// second run does to a database the user has already edited.
describe('seedEnvironments', () => {
  it('creates the three shipped environments in their shipped order', async () => {
    const client = await makeDatabase()

    await seedEnvironments(client)

    const rows = await client.select().from(environmentsTable)

    expect(
      rows.map((row) => ({ hue: row.hue, id: row.id, name: row.name }))
    ).toEqual([
      { hue: 152, id: 'local', name: 'Local' },
      { hue: 70, id: 'staging', name: 'Staging' },
      { hue: 25, id: 'production', name: 'Production' }
    ])
  })

  it('adds nothing on a second run', async () => {
    const client = await makeDatabase()

    await seedEnvironments(client)
    await seedEnvironments(client)

    const rows = await client.select().from(environmentsTable)

    expect(rows.length).toEqual(3)
  })

  // The user renamed a default. A seed that wrote over it would undo that on
  // every restart, which is the kind of bug nobody reports because it looks
  // like they imagined making the change.
  it('keeps a renamed default', async () => {
    const client = await makeDatabase()

    await seedEnvironments(client)

    await client
      .update(environmentsTable)
      .set({ hue: 310, name: 'Live' })
      .where(eq(environmentsTable.id, 'production'))

    await seedEnvironments(client)

    const rows = await client
      .select()
      .from(environmentsTable)
      .where(eq(environmentsTable.id, 'production'))

    expect(rows[0]).toEqual(
      expect.objectContaining({ hue: 310, id: 'production', name: 'Live' })
    )
  })

  // The reason delete is a soft delete: the row is what the next seed conflicts
  // with, so a deleted default stays deleted instead of coming back at every
  // launch.
  it('does not bring a deleted default back', async () => {
    const client = await makeDatabase()

    await seedEnvironments(client)

    await client
      .update(environmentsTable)
      .set({ deletedAt: 1700000000000 })
      .where(eq(environmentsTable.id, 'staging'))

    await seedEnvironments(client)

    const rows = await client.select().from(environmentsTable)

    expect(summarize(rows)).toEqual([
      { deleted: false, id: 'local', name: 'Local' },
      { deleted: true, id: 'staging', name: 'Staging' },
      { deleted: false, id: 'production', name: 'Production' }
    ])
  })
})

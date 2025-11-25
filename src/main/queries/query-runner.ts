import { eq } from 'drizzle-orm'
import { v7 } from 'uuid'

import { database } from '@/database'
import { queriesTable } from '@/database/schema'

import { PostgresAdapter } from './postgres-adapter'

class QueryRunner {
  async createAndRunQuery(query: string) {
    const data: typeof queriesTable.$inferInsert = {
      content: query,
      id: v7(),
      queriedAt: Date.now()
    }

    console.log('Inserting query into database:', data)

    const [insertedQueryRow] = await database
      .insert(queriesTable)
      .values(data)
      .returning()

    void this.runQueryInBackground(insertedQueryRow)

    return insertedQueryRow
  }

  private async runQueryInBackground(query: any): Promise<void> {
    try {
      const result = await new PostgresAdapter().runQuery(query.content)

      console.log('Query result:', result)
      await database
        .update(queriesTable)
        .set({
          result: JSON.stringify(result)
        })
        .where(eq(queriesTable.id, query.id))
    } catch (error) {
      console.error('Query failed:', error)

      const errorMessage =
        error instanceof Error ? error.message : String(error)

      await database
        .update(queriesTable)
        .set({ error: errorMessage })
        .where(eq(queriesTable.id, query.id))
    }
  }
}

export const queryRunner = new QueryRunner()

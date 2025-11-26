import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { database } from '@/database'
import { queriesTable } from '@/database/schema'

import {
  PostgresAdapter,
  PostgresConnectionInfo
} from '../../databases/postgres-adapter'

export const createQuerySchema = z.object({
  content: z.string(),
  id: z.string(),
  queriedAt: z.number(),
  worksheetId: z.string()
})

export type CreateQueryInput = z.infer<typeof createQuerySchema>

class QueryRunner {
  async createAndRunQuery(input: CreateQueryInput) {
    const data: typeof queriesTable.$inferInsert = {
      content: input.content,
      id: input.id,
      queriedAt: input.queriedAt,
      worksheetId: input.worksheetId
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
      const connectionInfo: PostgresConnectionInfo = {
        database: 'squeal',
        host: 'localhost',
        username: 'postgres',
        password: 'postgres'
      }

      const result = await new PostgresAdapter().runQuery(
        connectionInfo,
        query.content
      )

      console.log('Query result:', result)
      await database
        .update(queriesTable)
        .set({
          finishedAt: Date.now(),
          result: JSON.stringify(result)
        })
        .where(eq(queriesTable.id, query.id))
    } catch (error) {
      console.error('Query failed:', error)

      const errorMessage =
        error instanceof Error ? error.message : String(error)

      await database
        .update(queriesTable)
        .set({ error: errorMessage, finishedAt: Date.now() })
        .where(eq(queriesTable.id, query.id))
    }
  }
}

export const queryRunner = new QueryRunner()

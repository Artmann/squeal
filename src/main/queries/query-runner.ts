import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { database } from '@/database'
import { databasesTable, queriesTable } from '@/database/schema'

import {
  PostgresAdapter,
  PostgresConnectionInfo
} from '../../databases/postgres-adapter'

export const createQuerySchema = z.object({
  content: z.string(),
  databaseId: z.string(),
  id: z.string(),
  queriedAt: z.number(),
  worksheetId: z.string()
})

export type CreateQueryInput = z.infer<typeof createQuerySchema>

class QueryRunner {
  async createAndRunQuery(input: CreateQueryInput) {
    const data: typeof queriesTable.$inferInsert = {
      content: input.content,
      databaseId: input.databaseId,
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
      const [databaseRecord] = await database
        .select()
        .from(databasesTable)
        .where(
          and(
            eq(databasesTable.id, query.databaseId),
            isNull(databasesTable.deletedAt)
          )
        )
        .limit(1)

      if (!databaseRecord) {
        throw new Error(`Database not found: ${query.databaseId}`)
      }

      const connectionInfo: PostgresConnectionInfo = JSON.parse(
        databaseRecord.connectionInfo
      )

      const result = await new PostgresAdapter(connectionInfo).runQuery(
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

      const errorMessage = extractErrorMessage(error)

      await database
        .update(queriesTable)
        .set({ error: errorMessage, finishedAt: Date.now() })
        .where(eq(queriesTable.id, query.id))
    }
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const messages = error.errors.map((e) =>
      e instanceof Error ? e.message : String(e)
    )

    return messages.join('; ') || error.message || 'Connection failed'
  }

  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error'
  }

  return String(error)
}

export const queryRunner = new QueryRunner()

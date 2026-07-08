import { eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { database } from '@/database'
import { databasesTable, queriesTable } from '@/database/schema'
import { canceledQueryMessage } from '@/glue/queries'
import type { DatabaseAdapter } from '@/databases/adapter'
import { createAdapter } from '@/databases/create-adapter'
import { DatabaseService } from '@/main/databases/database-service'

export const createQuerySchema = z.object({
  content: z.string(),
  databaseId: z
    .string()
    .nullish()
    .transform((value) => value || undefined),
  id: z.string(),
  queriedAt: z.number(),
  worksheetId: z.string()
})

export type CreateQueryInput = z.infer<typeof createQuerySchema>

export { canceledQueryMessage }

class QueryRunner {
  private readonly runningAdapters = new Map<string, DatabaseAdapter>()

  async cancelQuery(id: string): Promise<void> {
    const adapter = this.runningAdapters.get(id)

    if (!adapter?.cancel) {
      return
    }

    await adapter.cancel()
  }

  async createAndRunQuery(input: CreateQueryInput) {
    let databaseId = input.databaseId

    if (!databaseId) {
      const [firstDatabase] = await database
        .select()
        .from(databasesTable)
        .where(isNull(databasesTable.deletedAt))
        .limit(1)

      if (!firstDatabase) {
        throw new Error('No database available')
      }

      databaseId = firstDatabase.id
    }

    const data: typeof queriesTable.$inferInsert = {
      content: input.content,
      databaseId,
      id: input.id,
      queriedAt: input.queriedAt,
      worksheetId: input.worksheetId
    }

    const [insertedQueryRow] = await database
      .insert(queriesTable)
      .values(data)
      .returning()

    void this.runQueryInBackground(insertedQueryRow)

    return insertedQueryRow
  }

  private async runQueryInBackground(query: any): Promise<void> {
    try {
      const service = new DatabaseService()
      const databaseRecord = await service.getDatabaseWithSecrets(
        query.databaseId
      )

      if (!databaseRecord) {
        throw new Error(`Database not found: ${query.databaseId}`)
      }

      const adapter = createAdapter(
        databaseRecord.type,
        databaseRecord.connectionInfo
      )

      this.runningAdapters.set(query.id, adapter)

      try {
        const result = await adapter.runQuery(query.content)

        await database
          .update(queriesTable)
          .set({
            finishedAt: Date.now(),
            result: JSON.stringify(result)
          })
          .where(eq(queriesTable.id, query.id))
      } finally {
        this.runningAdapters.delete(query.id)
      }
    } catch (error) {
      const errorMessage = isCancellationError(error)
        ? canceledQueryMessage
        : extractErrorMessage(error)

      await database
        .update(queriesTable)
        .set({ error: errorMessage, finishedAt: Date.now() })
        .where(eq(queriesTable.id, query.id))
    }
  }
}

function isCancellationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  return message
    .toLowerCase()
    .includes('canceling statement due to user request')
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

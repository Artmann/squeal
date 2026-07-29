import { eq, isNull } from 'drizzle-orm'
import { log } from 'tiny-typescript-logger'
import { z } from 'zod'

import { database } from '@/database'
import { databasesTable, queriesTable } from '@/database/schema'
import { canceledQueryMessage } from '@/glue/queries'
import { SpanContext } from '@/glue/tracing/spans'
import {
  QueryCanceledError,
  type DatabaseAdapter,
  type QueryResult
} from '@/databases/adapter'
import { createAdapter } from '@/databases/create-adapter'
import { DatabaseService } from '@/main/databases/database-service'
import {
  getActiveSpanContext,
  runWithContext,
  startSpan,
  withSpan,
  type Span
} from '@/main/tracing/tracer'

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

    // The active span context must be captured here: the fire-and-forget
    // call below escapes the request scope, so AsyncLocalStorage alone
    // would not link the background spans to the request trace.
    const parentContext = getActiveSpanContext()

    void this.runQueryInBackground(insertedQueryRow, parentContext)

    return insertedQueryRow
  }

  private async executeQuery(
    query: typeof queriesTable.$inferSelect
  ): Promise<void> {
    const { adapter, databaseType } = await withSpan(
      'query.loadConnection',
      { attributes: { 'database.id': query.databaseId } },
      async () => {
        const service = new DatabaseService()
        const databaseRecord = await service.getDatabaseWithSecrets(
          query.databaseId
        )

        if (!databaseRecord) {
          throw new Error(`Database not found: ${query.databaseId}`)
        }

        return {
          adapter: createAdapter(
            databaseRecord.type,
            databaseRecord.connectionInfo
          ),
          databaseType: databaseRecord.type
        }
      }
    )

    this.runningAdapters.set(query.id, adapter)

    try {
      const result = await this.runAdapterQuery(adapter, databaseType, query)

      await withSpan(
        'query.saveResult',
        {
          attributes: {
            'query.id': query.id,
            'query.rowCount': result.rowCount,
            'query.truncated': result.truncated
          }
        },
        async () => {
          await database
            .update(queriesTable)
            .set({
              finishedAt: Date.now(),
              result: JSON.stringify(result)
            })
            .where(eq(queriesTable.id, query.id))
        }
      )
    } finally {
      this.runningAdapters.delete(query.id)
    }
  }

  private async runAdapterQuery(
    adapter: DatabaseAdapter,
    databaseType: string,
    query: typeof queriesTable.$inferSelect
  ): Promise<QueryResult> {
    const span = startSpan('db.query', {
      attributes: {
        'db.statement': query.content,
        'db.system': databaseType,
        'query.id': query.id
      }
    })

    try {
      const result = await runWithContext(span.context, () =>
        adapter.runQuery(query.content)
      )

      span.setStatus('ok')

      return result
    } catch (error) {
      recordQueryOutcome(span, error)

      throw error
    } finally {
      await span.end()
    }
  }

  private async runQueryInBackground(
    query: typeof queriesTable.$inferSelect,
    parentContext?: SpanContext
  ): Promise<void> {
    const span = startSpan('query.execute', {
      attributes: { 'database.id': query.databaseId, 'query.id': query.id },
      parent: parentContext
    })

    try {
      await runWithContext(span.context, () => this.executeQuery(query))

      span.setStatus('ok')
    } catch (error) {
      recordQueryOutcome(span, error)

      const errorMessage = isCancellationError(error)
        ? canceledQueryMessage
        : extractErrorMessage(error)

      // This promise is fire-and-forget, so a failed write must be contained
      // here — an unhandled rejection would take down the main process while
      // the row silently stayed "running".
      try {
        await database
          .update(queriesTable)
          .set({ error: errorMessage, finishedAt: Date.now() })
          .where(eq(queriesTable.id, query.id))
      } catch (updateError) {
        log.error(
          `Could not mark query ${query.id} as failed: ${
            updateError instanceof Error
              ? updateError.message
              : String(updateError)
          }`
        )
      }
    } finally {
      await span.end()
    }
  }
}

// A canceled query is a user action, not a failure — the span stays ok and
// carries an event instead of an exception.
function recordQueryOutcome(span: Span, error: unknown): void {
  if (isCancellationError(error)) {
    span.addEvent('query.canceled')
    span.setStatus('ok')

    return
  }

  span.recordException(error)
}

function isCancellationError(error: unknown): boolean {
  if (error instanceof QueryCanceledError) {
    return true
  }

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

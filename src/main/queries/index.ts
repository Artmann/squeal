import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import invariant from 'tiny-invariant'
import { log } from 'tiny-typescript-logger'

import { database } from '@/database'
import { queriesTable } from '@/database/schema'
import type { QueryResult } from '@/databases/adapter'
import { ApiError, ValidationError } from '@/errors'
import { createQuerySchema, queryRunner } from './query-runner'

export { canceledQueryMessage } from './query-runner'

export const queryRouter = new Hono()

export interface QueryDto {
  content: string
  databaseId: string
  error: string | null
  finishedAt?: number | null
  id: string
  queriedAt: number
  result: QueryResult | null
  truncated: boolean
  worksheetId: string
}

export interface GetQueriesResponse {
  queries: QueryDto[]
}

queryRouter.get('/', async (context) => {
  const queries = await database
    .select()
    .from(queriesTable)
    .orderBy(desc(queriesTable.queriedAt))
    .limit(250)

  return context.json({ queries: queries.map(transformQuery) })
})

export interface GetQueryResponse {
  query: QueryDto
}

queryRouter.get('/:id', async (context) => {
  const { id } = context.req.param()

  invariant(id, 'Query ID is required')

  const rows = await database
    .select()
    .from(queriesTable)
    .where(eq(queriesTable.id, id))
    .limit(1)

  if (rows.length === 0) {
    throw new ApiError(404, 'Query not found')
  }

  const query = rows[0]

  const response: GetQueryResponse = {
    query: transformQuery(query)
  }

  return context.json(response)
})

export interface CreateQueryResponse {
  query: QueryDto
}

queryRouter.post('/', async (context) => {
  const body = await context.req.json()

  const result = await createQuerySchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const query = await queryRunner.createAndRunQuery(result.data)

  const response: CreateQueryResponse = {
    query: transformQuery(query)
  }

  return context.json(response)
})

queryRouter.post('/:id/cancel', async (context) => {
  const { id } = context.req.param()

  invariant(id, 'Query ID is required')

  await queryRunner.cancelQuery(id)

  return context.json({ success: true })
})

function transformQuery(query: typeof queriesTable.$inferSelect): QueryDto {
  let parsed: QueryResult | null = null
  let parseError: string | null = null

  // One unreadable stored result must not take down the whole history list.
  if (query.result) {
    try {
      parsed = JSON.parse(query.result) as QueryResult
    } catch {
      parseError = 'Stored result could not be read.'

      log.error(`Could not parse the stored result for query ${query.id}.`)
    }
  }

  return {
    content: query.content,
    databaseId: query.databaseId,
    error: query.error ?? parseError,
    finishedAt: query.finishedAt ?? null,
    id: query.id,
    queriedAt: query.queriedAt,
    result: parsed,
    truncated: parsed?.truncated ?? false,
    worksheetId: query.worksheetId
  }
}

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import invariant from 'tiny-invariant'
import z from 'zod'

import { database } from '@/database'
import { queriesTable } from '@/database/schema'
import { ApiError, ValidationError } from '@/errors'
import { queryRunner } from './query-runner'

export const queryRouter = new Hono()

export interface QueryDto {
  id: string
  content: string
  error: string | null
  queriedAt: number
  result: string | null
}

export interface GetQueriesResponse {
  queries: QueryDto[]
}

queryRouter.get('/', async (context) => {
  const queries = await database.select().from(queriesTable).limit(250)

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

const createQuerySchema = z.object({
  query: z.string()
})

queryRouter.post('/', async (context) => {
  const body = await context.req.json()

  const result = await createQuerySchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const query = await queryRunner.createAndRunQuery(result.data.query)

  const response: CreateQueryResponse = {
    query: transformQuery(query)
  }

  return context.json(response)
})

function transformQuery(query: any): QueryDto {
  return {
    content: query.content,
    error: query.error ?? null,
    id: query.id,
    queriedAt: query.queriedAt,
    result: query.result ?? null
  }
}

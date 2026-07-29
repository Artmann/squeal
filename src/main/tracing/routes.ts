import { asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { database } from '@/database'
import { spansTable } from '@/database/schema'
import { ValidationError } from '@/errors'
import {
  SpanAttributes,
  SpanEvent,
  SpanKind,
  SpanRecord,
  SpanStatus,
  TraceServiceName
} from '@/glue/tracing/spans'

import { writeSpans } from './span-writer'

export type SpanDto = SpanRecord

export interface GetTraceResponse {
  spans: SpanDto[]
}

export interface GetTracesResponse {
  traces: TraceSummaryDto[]
}

export interface IngestSpansResponse {
  insertedCount: number
}

export interface TraceSummaryDto {
  durationMs: number
  errorMessage: string | null
  hasError: boolean
  name: string
  serviceName: string
  spanCount: number
  startedAt: number
  traceId: string
}

const maxIngestBatchSize = 200

const attributesSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.number(), z.string()])
)

const spanEventSchema = z.object({
  attributes: attributesSchema.optional(),
  name: z.string(),
  time: z.number()
})

const spanInputSchema = z.object({
  attributes: attributesSchema,
  durationMs: z.number().min(0),
  events: z.array(spanEventSchema),
  id: z.string().regex(/^[0-9a-f]{16}$/),
  kind: z.enum(['client', 'internal', 'server']),
  name: z.string().min(1),
  parentSpanId: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  serviceName: z.enum(['main', 'renderer']),
  startedAt: z.number(),
  status: z.enum(['error', 'ok', 'unset']),
  statusMessage: z.string().nullable(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/)
})

const ingestSpansSchema = z.object({
  spans: z.array(spanInputSchema).max(maxIngestBatchSize)
})

const listTracesQuerySchema = z.object({
  before: z.coerce.number().int().optional(),
  errorOnly: z
    .enum(['false', 'true'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional()
})

interface TraceSummaryRow {
  durationMs: number
  errorMessage: string | null
  hasError: number
  name: string
  serviceName: string
  spanCount: number
  startedAt: number
  traceId: string
}

export const traceRouter = new Hono()

traceRouter.get('/', async (context) => {
  const result = await listTracesQuerySchema.safeParseAsync(context.req.query())

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const { before, errorOnly, limit, search } = result.data

  const filters = [sql`1 = 1`]

  if (errorOnly) {
    filters.push(sql`hasError = 1`)
  }

  if (search !== undefined) {
    filters.push(sql`instr(lower(name), ${search.toLowerCase()}) > 0`)
  }

  if (before !== undefined) {
    filters.push(sql`startedAt < ${before}`)
  }

  // Traces are aggregated rather than read off root spans: the renderer
  // exports its root span last, so grouping keeps in-flight and interrupted
  // traces visible.
  const rows = await database.all<TraceSummaryRow>(sql`
    SELECT *
    FROM (
      SELECT
        traceId,
        COUNT(*) AS spanCount,
        MIN(startedAt) AS startedAt,
        MAX(startedAt + durationMs) - MIN(startedAt) AS durationMs,
        MAX(status = 'error') AS hasError,
        (
          SELECT failed.statusMessage FROM spans AS failed
          WHERE failed.traceId = spans.traceId
            AND failed.status = 'error'
            AND failed.statusMessage IS NOT NULL
          ORDER BY failed.startedAt LIMIT 1
        ) AS errorMessage,
        COALESCE(
          (
            SELECT root.name FROM spans AS root
            WHERE root.traceId = spans.traceId
              AND root.parentSpanId IS NULL
            ORDER BY root.startedAt LIMIT 1
          ),
          (
            SELECT earliest.name FROM spans AS earliest
            WHERE earliest.traceId = spans.traceId
            ORDER BY earliest.startedAt LIMIT 1
          )
        ) AS name,
        COALESCE(
          (
            SELECT root.serviceName FROM spans AS root
            WHERE root.traceId = spans.traceId
              AND root.parentSpanId IS NULL
            ORDER BY root.startedAt LIMIT 1
          ),
          (
            SELECT earliest.serviceName FROM spans AS earliest
            WHERE earliest.traceId = spans.traceId
            ORDER BY earliest.startedAt LIMIT 1
          )
        ) AS serviceName
      FROM spans
      GROUP BY traceId
    )
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY startedAt DESC
    LIMIT ${limit}
  `)

  const response: GetTracesResponse = {
    traces: rows.map((row) => ({
      durationMs: row.durationMs,
      errorMessage: row.errorMessage,
      hasError: row.hasError === 1,
      name: row.name,
      serviceName: row.serviceName,
      spanCount: row.spanCount,
      startedAt: row.startedAt,
      traceId: row.traceId
    }))
  }

  return context.json(response)
})

traceRouter.get('/:traceId', async (context) => {
  const { traceId } = context.req.param()

  const rows = await database
    .select()
    .from(spansTable)
    .where(eq(spansTable.traceId, traceId))
    .orderBy(asc(spansTable.startedAt))

  const response: GetTraceResponse = {
    spans: rows.map(transformSpan)
  }

  return context.json(response)
})

traceRouter.post('/spans', async (context) => {
  const body = await context.req.json()
  const result = await ingestSpansSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  // Zod infers nullable keys as optional; the record shape requires them.
  const spans: SpanRecord[] = result.data.spans.map((span) => ({
    ...span,
    parentSpanId: span.parentSpanId ?? null,
    statusMessage: span.statusMessage ?? null
  }))

  const insertedCount = await writeSpans(spans)

  const response: IngestSpansResponse = { insertedCount }

  return context.json(response)
})

function parseJsonArray(value: string | null): SpanEvent[] {
  if (!value) {
    return []
  }

  // One corrupted row must not take down the whole trace view.
  try {
    const parsed: unknown = JSON.parse(value)

    return Array.isArray(parsed) ? (parsed as SpanEvent[]) : []
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null): SpanAttributes {
  if (!value) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as SpanAttributes
    }

    return {}
  } catch {
    return {}
  }
}

function transformSpan(row: typeof spansTable.$inferSelect): SpanDto {
  return {
    attributes: parseJsonObject(row.attributes),
    durationMs: row.durationMs,
    events: parseJsonArray(row.events),
    id: row.id,
    kind: row.kind as SpanKind,
    name: row.name,
    parentSpanId: row.parentSpanId,
    serviceName: row.serviceName as TraceServiceName,
    startedAt: row.startedAt,
    status: row.status as SpanStatus,
    statusMessage: row.statusMessage,
    traceId: row.traceId
  }
}

import { asc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { spansTable } from '@/database/schema'
import type {
  ListTracesUrlParams,
  SpanDto,
  TraceSummaryDto
} from '@/glue/api/schemas'
import {
  SpanAttributes,
  SpanEvent,
  SpanKind,
  SpanRecord,
  SpanStatus,
  TraceServiceName
} from '@/glue/tracing/spans'
import { writeSpans } from '@/main/tracing/span-writer'
import { AppDatabase } from './app-database'

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

export class TraceStore extends Effect.Service<TraceStore>()('TraceStore', {
  accessors: true,
  dependencies: [AppDatabase.Default],
  effect: Effect.gen(function* () {
    const appDatabase = yield* AppDatabase

    // Deliberately no Effect.fn spans in this service: the /traces routes
    // are excluded from tracing (self-tracing feedback loop), and a span
    // here would surface as a parentless root trace on every dashboard
    // poll and every renderer span batch.
    const getTrace = Effect.fn(function* (traceId: string) {
      const rows = yield* appDatabase.execute((client) =>
        client
          .select()
          .from(spansTable)
          .where(eq(spansTable.traceId, traceId))
          .orderBy(asc(spansTable.startedAt))
      )

      return rows.map(transformSpan)
    })

    const ingestSpans = Effect.fn(function* (spans: SpanRecord[]) {
      return yield* appDatabase.execute((client) => writeSpans(spans, client))
    })

    const listTraces = Effect.fn(function* (params: ListTracesUrlParams) {
      const { before, errorOnly, limit, search } = params

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
      // exports its root span last, so grouping keeps in-flight and
      // interrupted traces visible.
      const rows = yield* appDatabase.execute((client) =>
        client.all<TraceSummaryRow>(sql`
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
      )

      return rows.map(
        (row): TraceSummaryDto => ({
          durationMs: row.durationMs,
          errorMessage: row.errorMessage,
          hasError: row.hasError === 1,
          name: row.name,
          serviceName: row.serviceName,
          spanCount: row.spanCount,
          startedAt: row.startedAt,
          traceId: row.traceId
        })
      )
    })

    return { getTrace, ingestSpans, listTraces } as const
  })
}) {}

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

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
      return yield* appDatabase.execute((client) => writeSpans(client, spans))
    })

    const listTraces = Effect.fn(function* (params: ListTracesUrlParams) {
      const { before, errorOnly, limit, search } = params

      // Every filter names a column the aggregate below publishes as an
      // alias, and is applied outside it -- so `search` matches the name the
      // trace is listed under rather than any span's name, and `before`
      // compares against the trace's own start rather than any span's.
      // Only the aliases are in scope out here; a raw span column would be
      // rejected by SQLite rather than quietly filter something else.
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
      //
      // Which span speaks for a trace is stated once, as `representativeId`.
      // `parentSpanId IS NOT NULL` sorts parentless spans ahead of the rest,
      // so the ordering reads as "the earliest parentless span, or the
      // earliest span when none is parentless yet" -- the fallback the
      // paragraph above needs. The name and the service then come off that
      // one row by construction. Resolved as two independent lookups apiece,
      // which is what this replaced, a later edit to one predicate --
      // preferring `kind = 'server'` roots, say -- would pair one span's name
      // with another span's service, and nothing in `TraceSummaryDto` would
      // say so.
      //
      // The row is fetched by joining on `spans.id` rather than by ranking
      // every span with a window function: `ROW_NUMBER() OVER (PARTITION BY
      // traceId ...)` cannot use `spans_trace_id_index`, and measured against
      // a full retention budget it made this query about twice as slow as the
      // two-lookup shape below. This is polled every 2000ms.
      const rows = yield* appDatabase.execute((client) =>
        client.all<TraceSummaryRow>(sql`
          SELECT *
          FROM (
            SELECT
              summary.traceId AS traceId,
              summary.spanCount AS spanCount,
              summary.startedAt AS startedAt,
              summary.durationMs AS durationMs,
              summary.hasError AS hasError,
              summary.errorMessage AS errorMessage,
              representative.name AS name,
              representative.serviceName AS serviceName
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
                (
                  SELECT chosen.id FROM spans AS chosen
                  WHERE chosen.traceId = spans.traceId
                  ORDER BY chosen.parentSpanId IS NOT NULL, chosen.startedAt
                  LIMIT 1
                ) AS representativeId
              FROM spans
              GROUP BY traceId
            ) AS summary
            JOIN spans AS representative
              ON representative.id = summary.representativeId
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

import { database } from '@/database'
import { spansTable } from '@/database/schema'
import { SpanRecord } from '@/glue/tracing/spans'

export async function writeSpans(
  records: SpanRecord[],
  client: typeof database = database
): Promise<number> {
  if (records.length === 0) {
    return 0
  }

  // The span id is the primary key, so re-ingested renderer batches dedupe
  // instead of failing the whole insert.
  const result = await client
    .insert(spansTable)
    .values(records.map(toRow))
    .onConflictDoNothing()

  return result.rowsAffected
}

function toRow(record: SpanRecord): typeof spansTable.$inferInsert {
  return {
    attributes: JSON.stringify(record.attributes),
    durationMs: record.durationMs,
    events: JSON.stringify(record.events),
    id: record.id,
    kind: record.kind,
    name: record.name,
    parentSpanId: record.parentSpanId,
    serviceName: record.serviceName,
    startedAt: record.startedAt,
    status: record.status,
    statusMessage: record.statusMessage,
    traceId: record.traceId
  }
}

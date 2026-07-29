import { canceledQueryMessage } from '@/glue/queries'
import { SpanAttributes, SpanContext } from '@/glue/tracing/spans'

import { Span, startSpan } from './tracer'

interface QueryTraceInput {
  content: string
  databaseId?: string | null
  id: string
  worksheetId?: string | null
}

interface QueryTraceResult {
  error?: string | null
  id: string
}

// Bridges the query trace from the run action in App.tsx to the collection's
// onInsert handler and the result poller — the client-generated query id is
// the correlation key at every hop.
const activeQuerySpans = new Map<string, Span>()

export function finishQueryTrace(query: QueryTraceResult): void {
  const span = activeQuerySpans.get(query.id)

  if (!span) {
    return
  }

  activeQuerySpans.delete(query.id)

  if (query.error === canceledQueryMessage) {
    span.addEvent('query.canceled')
    span.setStatus('ok')
  } else if (query.error) {
    span.setStatus('error', query.error)
  } else {
    span.setStatus('ok')
  }

  span.addEvent('query.finished', { 'query.success': !query.error })
  span.end()
}

export function getQueryTraceParent(queryId: string): SpanContext | undefined {
  return activeQuerySpans.get(queryId)?.context
}

export function startQueryTrace(query: QueryTraceInput): void {
  // Guards double invocations (React StrictMode, repeated run clicks on the
  // same optimistic row) so the first span survives.
  if (activeQuerySpans.has(query.id)) {
    return
  }

  const attributes: SpanAttributes = {
    'db.statement': query.content,
    'query.id': query.id
  }

  if (query.databaseId) {
    attributes['database.id'] = query.databaseId
  }

  if (query.worksheetId) {
    attributes['worksheet.id'] = query.worksheetId
  }

  activeQuerySpans.set(query.id, startSpan('query.run', { attributes }))
}

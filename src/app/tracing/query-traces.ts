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

// Only `finishQueryTrace` removes an entry, and its callers are the result
// poller and the failed optimistic insert. The poller follows one query per
// worksheet — the latest — so switching worksheets mid-run disables it, and so
// does starting a second run in the same worksheet. Either way the span would
// otherwise sit here for the lifetime of the window, holding up to 2000
// characters of SQL and never exporting at all.
//
// The cap does not make tracing complete: whatever is still open when the
// window closes is lost, exactly as before. What it does is bound the map and
// give an evicted trace a terminal outcome that reaches the exporter, so the
// oldest leak becomes visible instead of silently retained.
//
// The cap is deliberately generous, because reaching it ends the root span of
// a query that may still be running. The sibling bridge on the same key,
// `errorNoticeQueryIds`, uses 20: a stale toast intent is cheap to drop, while
// this drops a trace of work the user actually did.
const maxActiveQueryTraces = 50

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

  if (activeQuerySpans.size >= maxActiveQueryTraces) {
    abandonOldestQueryTrace()
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

function abandonOldestQueryTrace(): void {
  // A Map iterates in insertion order, so the first entry is the oldest. The
  // only caller checks the size first, but destructuring an empty map throws a
  // TypeError that TypeScript cannot see, and this runs on the path that
  // starts the user's query.
  const oldest = activeQuerySpans.entries().next().value

  if (!oldest) {
    return
  }

  const [queryId, span] = oldest

  activeQuerySpans.delete(queryId)

  // The status stays unset: the query was not observed to succeed or fail, and
  // saying either would be a guess.
  span.addEvent('query.abandoned')
  span.end()
}

import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { IngestSpansRequest } from '../api/schemas'
import { SpanDraft } from './span-draft'

// What the renderer ships is exactly what `finish()` returns, and the server
// validates it against the ingest contract before writing a row. Nothing
// between the two converts anything, so a span the drafter can build and the
// contract will not accept is a batch that fails forever: the exporter retries
// it and logs once per outage, and the spans are simply lost.
function ingest(spans: unknown[]): unknown {
  return Schema.decodeUnknownSync(IngestSpansRequest)({ spans })
}

describe('SpanDraft', () => {
  // Attribute values are not all strings: `api-client.ts` sets a numeric
  // `http.status_code` and `query-traces.ts` sends a boolean `query.success` on
  // an event. Narrowing the contract to strings would compile, pass a
  // string-only test, and then reject every batch the renderer sends.
  it('finishes a root span the ingest contract accepts', () => {
    const draft = new SpanDraft('query.run', { serviceName: 'renderer' })

    draft.setAttribute('database.id', 'pagila')
    draft.setAttribute('http.status_code', 200)
    draft.setAttribute('query.cached', false)
    draft.addEvent('query.sent', { 'query.success': true, 'row.count': 42 })

    const record = draft.finish()

    expect({
      attributes: record?.attributes,
      events: record?.events?.map((event) => event.attributes)
    }).toEqual({
      attributes: {
        'database.id': 'pagila',
        'http.status_code': 200,
        'query.cached': false
      },
      events: [{ 'query.success': true, 'row.count': 42 }]
    })
    expect(ingest([record])).toEqual({ spans: [record] })
  })

  // A root span carries no parent and no status message, and both fields have
  // to survive the round trip as null rather than being dropped or refused.
  it('finishes a root span with nothing to say about its parent or status', () => {
    const record = new SpanDraft('boot', { serviceName: 'main' }).finish()

    expect(record).toEqual({
      attributes: {},
      durationMs: expect.any(Number),
      events: [],
      id: expect.any(String),
      kind: 'internal',
      name: 'boot',
      parentSpanId: null,
      serviceName: 'main',
      startedAt: expect.any(Number),
      status: 'unset',
      statusMessage: null,
      traceId: expect.any(String)
    })
    expect(ingest([record])).toEqual({ spans: [record] })
  })

  it('finishes a child span the ingest contract accepts', () => {
    const parent = new SpanDraft('query.run', { serviceName: 'renderer' })
    const child = new SpanDraft('db.query', {
      kind: 'client',
      parent: parent.context,
      serviceName: 'renderer'
    })

    const record = child.finish()

    expect({
      kind: record?.kind,
      parentSpanId: record?.parentSpanId,
      traceId: record?.traceId
    }).toEqual({
      kind: 'client',
      parentSpanId: parent.context.spanId,
      traceId: parent.context.traceId
    })
    expect(ingest([record])).toEqual({ spans: [record] })
  })

  // The heaviest span the drafter can produce: an exception event carries three
  // attributes and a stack trace, and the failure sets a status message.
  it('finishes a failed span the ingest contract accepts', () => {
    const draft = new SpanDraft('db.query', {
      attributes: { 'db.system': 'postgres' },
      kind: 'server',
      serviceName: 'main'
    })

    draft.recordException(new Error('relation "users" does not exist'))

    const record = draft.finish()

    expect({
      status: record?.status,
      statusMessage: record?.statusMessage
    }).toEqual({
      status: 'error',
      statusMessage: 'relation "users" does not exist'
    })
    expect(ingest([record])).toEqual({ spans: [record] })
  })

  // The one span shape the contract must refuse. An all-zero id is what a
  // malformed `traceparent` decays to, and the ingest boundary is the last
  // place that can keep it out of the table.
  it('is refused by the ingest contract with an all-zero id', () => {
    const record = new SpanDraft('boot', { serviceName: 'main' }).finish()

    expect(() => ingest([{ ...record, id: '0'.repeat(16) }])).toThrow()
    expect(() => ingest([{ ...record, traceId: '0'.repeat(32) }])).toThrow()
  })

  it('finishes once and returns nothing afterwards', () => {
    const draft = new SpanDraft('query.run', { serviceName: 'renderer' })

    expect({
      first: draft.finish() === undefined,
      second: draft.finish() === undefined
    }).toEqual({ first: false, second: true })
  })
})

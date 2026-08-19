import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/errors'
import type {
  DatabaseDto,
  QueryDto,
  SchemaInfoDto,
  WorksheetDto
} from '@/glue/api/schemas'
import type { SpanRecord } from '@/glue/tracing/spans'

const mockFetch = vi.fn()

// Finished spans are observed at the exporter boundary so the assertions read
// the record the renderer would actually ship.
const { enqueueSpan } = vi.hoisted(() => ({
  enqueueSpan: vi.fn<(record: SpanRecord) => void>()
}))

vi.mock('./tracing/exporter', () => ({ enqueueSpan }))

vi.stubGlobal('fetch', mockFetch)

import { apiClient } from './api-client'
import { capturedFetch, jsonResponse } from './test-fetch'

const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

const databaseDto: DatabaseDto = {
  connectionInfo: {
    database: 'testdb',
    host: 'localhost',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
  id: 'db-123',
  name: 'Test Database',
  sortOrder: null,
  type: 'postgres' as const
}

const worksheetDto: WorksheetDto = {
  content: 'select 1',
  createdAt: 1704067200000,
  databaseId: 'db-123',
  id: 'ws-123',
  lastOpenedAt: null,
  name: 'Worksheet 1',
  sortOrder: null
}

const queryDto: QueryDto = {
  content: 'select 1',
  databaseId: 'db-123',
  error: null,
  finishedAt: null,
  id: 'query-1',
  queriedAt: 1704067200000,
  result: null,
  worksheetId: 'ws-123'
}

const spanRecord: SpanRecord = {
  attributes: {},
  durationMs: 1,
  events: [],
  id: '1'.repeat(16),
  kind: 'client',
  name: 'HTTP GET /databases',
  parentSpanId: null,
  serviceName: 'renderer',
  startedAt: 1704067200000,
  status: 'ok',
  statusMessage: null,
  traceId: 'a'.repeat(32)
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('requests', () => {
    it('sends the bearer token and a traceparent on traced calls', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ databases: [] }))

      await apiClient.getDatabases()

      const request = await capturedFetch()

      expect(request.url).toEqual('http://127.0.0.1:7847/databases')
      expect(request.method).toEqual('GET')
      expect(request.headers.authorization).toEqual('Bearer test-token')
      expect(request.headers.traceparent).toMatch(traceparentPattern)
    })

    it('posts a database and returns the created row', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          { database: databaseDto, updatedWorksheet: worksheetDto },
          { status: 201 }
        )
      )

      const result = await apiClient.createDatabase({
        connectionInfo: {
          database: 'testdb',
          host: 'localhost',
          password: 'secret',
          port: 5432,
          username: 'admin'
        },
        name: 'Test Database',
        type: 'postgres'
      })

      const request = await capturedFetch()

      expect({
        body: request.body,
        method: request.method,
        url: request.url
      }).toEqual({
        body: {
          connectionInfo: {
            database: 'testdb',
            host: 'localhost',
            password: 'secret',
            port: 5432,
            username: 'admin'
          },
          name: 'Test Database',
          type: 'postgres'
        },
        method: 'POST',
        url: 'http://127.0.0.1:7847/databases'
      })
      expect(result).toEqual({
        database: databaseDto,
        updatedWorksheet: worksheetDto
      })
    })

    it('unwraps the schema from the response', async () => {
      const schema: SchemaInfoDto = { databaseName: 'testdb', tables: [] }

      mockFetch.mockResolvedValueOnce(jsonResponse({ schema }))

      const result = await apiClient.getDatabaseSchema('db-123')

      expect((await capturedFetch()).url).toEqual(
        'http://127.0.0.1:7847/databases/db-123/schema'
      )
      expect(result).toEqual(schema)
    })

    it('unwraps the worksheet from a patch response', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ worksheet: { ...worksheetDto, name: 'Renamed' } })
      )

      const result = await apiClient.updateWorksheet('ws-123', {
        name: 'Renamed'
      })

      const request = await capturedFetch()

      expect({
        body: request.body,
        method: request.method,
        url: request.url
      }).toEqual({
        body: { name: 'Renamed' },
        method: 'PATCH',
        url: 'http://127.0.0.1:7847/worksheets/ws-123'
      })
      expect(result).toEqual({ ...worksheetDto, name: 'Renamed' })
    })

    // The third verb that carries a payload, and the one whose payload is the
    // whole request: an order the server cannot read is an order it drops.
    it('puts the worksheet order as a list of ids', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ worksheets: [worksheetDto] })
      )

      await apiClient.reorderWorksheets(['ws-2', 'ws-123', 'ws-3'])

      const request = await capturedFetch()

      expect({
        body: request.body,
        method: request.method,
        url: request.url
      }).toEqual({
        body: { worksheetIds: ['ws-2', 'ws-123', 'ws-3'] },
        method: 'PUT',
        url: 'http://127.0.0.1:7847/worksheets/order'
      })
    })

    // The renderer mints the id and the timestamp before the request leaves, so
    // the poller has something to poll for; both have to survive encoding.
    it('sends the id the renderer minted for a query', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ query: queryDto }))

      await apiClient.createQuery({
        content: 'select 1',
        databaseId: 'db-123',
        id: 'query-1',
        queriedAt: 1704067200000,
        worksheetId: 'ws-123'
      })

      const request = await capturedFetch()

      expect({
        body: request.body,
        method: request.method,
        url: request.url
      }).toEqual({
        body: {
          content: 'select 1',
          databaseId: 'db-123',
          id: 'query-1',
          queriedAt: 1704067200000,
          worksheetId: 'ws-123'
        },
        method: 'POST',
        url: 'http://127.0.0.1:7847/queries'
      })
    })

    it('returns a failed connection test as data, not an error', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          message: 'password authentication failed',
          success: false
        })
      )

      const result = await apiClient.testConnection({
        connectionInfo: {
          database: 'testdb',
          host: 'localhost',
          username: 'admin'
        },
        type: 'postgres'
      })

      expect(result).toEqual({
        message: 'password authentication failed',
        success: false
      })
    })
  })

  describe('tracing', () => {
    it('continues a provided parent trace', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ query: queryDto }))

      const traceId = 'a'.repeat(32)

      await apiClient.createQuery(
        {
          content: 'select 1',
          databaseId: 'db-123',
          id: 'query-1',
          queriedAt: 1704067200000,
          worksheetId: 'ws-123'
        },
        { traceParent: { spanId: '00f067aa0ba902b7', traceId } }
      )

      expect((await capturedFetch()).headers.traceparent).toMatch(
        new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)
      )
    })

    it('does not send a traceparent for health checks', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'ok' }))

      await apiClient.getHealth()

      expect((await capturedFetch()).headers.traceparent).toBeUndefined()
    })

    it('does not send a traceparent for the result poller', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ query: queryDto }))

      await apiClient.getQuery('query-1')

      expect((await capturedFetch()).headers.traceparent).toBeUndefined()
    })

    it('does not send a traceparent when ingesting spans', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ insertedCount: 1 }))

      await apiClient.ingestSpans([spanRecord])

      expect((await capturedFetch()).headers.traceparent).toBeUndefined()
    })

    // The batch is the one wire format the renderer authors rather than
    // consumes, and it wraps the records the exporter collected in a field the
    // caller never passes.
    it('wraps a span batch in the payload the ingest route expects', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ insertedCount: 1 }))

      await apiClient.ingestSpans([spanRecord])

      const request = await capturedFetch()

      expect({
        body: request.body,
        method: request.method,
        url: request.url
      }).toEqual({
        body: { spans: [spanRecord] },
        method: 'POST',
        url: 'http://127.0.0.1:7847/traces/spans'
      })
    })
  })

  describe('errors', () => {
    it('throws the tagged error so callers can discriminate on _tag', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            _tag: 'DatabaseNotFoundError',
            databaseId: 'missing',
            message: 'Database not found'
          },
          { status: 404 }
        )
      )

      try {
        await apiClient.getDatabaseSchema('missing')
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            _tag: 'DatabaseNotFoundError',
            databaseId: 'missing'
          })
        )
      }
    })

    it('throws a tagged QueryNotFoundError from the poller', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            _tag: 'QueryNotFoundError',
            message: 'Query not found',
            queryId: 'missing'
          },
          { status: 404 }
        )
      )

      try {
        await apiClient.getQuery('missing')
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({ _tag: 'QueryNotFoundError' })
        )
      }
    })

    it('maps a decode error to an ApiError carrying field details', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            _tag: 'HttpApiDecodeError',
            issues: [
              { _tag: 'Type', message: 'Name is required.', path: ['name'] }
            ],
            message: 'The request payload is invalid'
          },
          { status: 400 }
        )
      )

      try {
        await apiClient.createWorksheet({ name: '' })
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).statusCode).toEqual(400)
        expect((error as ApiError).details).toEqual({
          name: 'Name is required.'
        })
      }
    })

    it('surfaces a transport failure as an ApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))

      await expect(apiClient.getDatabases()).rejects.toBeInstanceOf(ApiError)
    })

    it('reports an unreachable backend without leaking the fetch message', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))

      try {
        await apiClient.getDatabases()
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            message:
              "Could not reach Squeal's backend. Restart Squeal and try again.",
            statusCode: 503
          })
        )
      }
    })

    it('reports a 500 without leaking the platform status message', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { status: 500 }))

      try {
        await apiClient.getDatabases()
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            message:
              "Squeal's backend reported an error. Restart Squeal and try again.",
            statusCode: 500
          })
        )
      }
    })

    // An invalid payload never leaves the machine: the client encodes against
    // the contract first. The failure has to arrive as field errors, not as the
    // schema tree ParseError.message renders.
    it('maps an encode failure to field errors and sends nothing', async () => {
      try {
        await apiClient.testConnection({
          connectionInfo: { database: 'testdb', host: '', username: 'admin' },
          type: 'postgres'
        })
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).statusCode).toEqual(400)
        expect((error as ApiError).details?.['connectionInfo.host']).toEqual(
          'Host is required.'
        )
        expect((error as ApiError).message).toEqual(
          'Please correct the highlighted fields.'
        )
      }

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('reports a response that does not match the contract as a bug', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ databases: [{ id: 123 }] }, { status: 200 })
      )

      try {
        await apiClient.getDatabases()
        expect.fail('Expected the request to reject')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).message).toEqual(
          'Squeal could not read the response from its backend. Please report this.'
        )
        expect((error as ApiError).details).toBeUndefined()
      }
    })
  })

  describe('spans', () => {
    it('records the response status code on the client span', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ databases: [] }))

      await apiClient.getDatabases()

      const spans = enqueueSpan.mock.calls.map(([record]) => record)
      const request = spans.find((span) => span.name === 'HTTP GET /databases')

      expect(request?.attributes['http.status_code']).toEqual(200)
      expect(request?.status).toEqual('ok')
    })

    it('marks the span as errored when the request fails', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, { status: 500 }))

      await expect(apiClient.getDatabases()).rejects.toBeInstanceOf(ApiError)

      const spans = enqueueSpan.mock.calls.map(([record]) => record)
      const request = spans.find((span) => span.name === 'HTTP GET /databases')

      expect(request?.attributes['http.status_code']).toEqual(500)
      expect(request?.status).toEqual('error')
    })
  })
})

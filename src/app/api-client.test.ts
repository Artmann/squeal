import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/errors'
import type {
  DatabaseDto,
  QueryDto,
  SchemaInfoDto,
  WorksheetDto
} from '@/glue/api/schemas'

const mockFetch = vi.fn()

vi.stubGlobal('fetch', mockFetch)

import { apiClient } from './api-client'

const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

interface CapturedRequest {
  headers: Record<string, string>
  method: string
  url: string
}

function toHeaderRecord(source: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {}

  if (source === undefined) {
    return headers
  }

  new Headers(source).forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  return headers
}

// The client hands fetch a Request object, so assertions read it back rather
// than inspecting a plain options bag.
function captured(callIndex = 0): CapturedRequest {
  const [input, init] = mockFetch.mock.calls[callIndex] as [
    Request | string,
    RequestInit | undefined
  ]

  if (input instanceof Request) {
    return {
      headers: toHeaderRecord(input.headers),
      method: input.method,
      url: input.url
    }
  }

  return {
    headers: toHeaderRecord(init?.headers),
    method: init?.method ?? 'GET',
    url: String(input)
  }
}

function respondWith(data: unknown, options: { status?: number } = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
    status: options.status ?? 200
  })
}

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
  truncated: false,
  worksheetId: 'ws-123'
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
      mockFetch.mockResolvedValueOnce(respondWith({ databases: [] }))

      await apiClient.getDatabases()

      const request = captured()

      expect(request.url).toEqual('http://127.0.0.1:7847/databases')
      expect(request.method).toEqual('GET')
      expect(request.headers.authorization).toEqual('Bearer test-token')
      expect(request.headers.traceparent).toMatch(traceparentPattern)
    })

    it('posts a database and returns the created row', async () => {
      mockFetch.mockResolvedValueOnce(
        respondWith(
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

      const request = captured()

      expect(request.method).toEqual('POST')
      expect(request.url).toEqual('http://127.0.0.1:7847/databases')
      expect(result).toEqual({
        database: databaseDto,
        updatedWorksheet: worksheetDto
      })
    })

    it('unwraps the schema from the response', async () => {
      const schema: SchemaInfoDto = { databaseName: 'testdb', tables: [] }

      mockFetch.mockResolvedValueOnce(respondWith({ schema }))

      const result = await apiClient.getDatabaseSchema('db-123')

      expect(captured().url).toEqual(
        'http://127.0.0.1:7847/databases/db-123/schema'
      )
      expect(result).toEqual(schema)
    })

    it('unwraps the worksheet from a patch response', async () => {
      mockFetch.mockResolvedValueOnce(
        respondWith({ worksheet: { ...worksheetDto, name: 'Renamed' } })
      )

      const result = await apiClient.updateWorksheet('ws-123', {
        name: 'Renamed'
      })

      const request = captured()

      expect(request.method).toEqual('PATCH')
      expect(request.url).toEqual('http://127.0.0.1:7847/worksheets/ws-123')
      expect(result.name).toEqual('Renamed')
    })

    it('returns a failed connection test as data, not an error', async () => {
      mockFetch.mockResolvedValueOnce(
        respondWith({
          message: 'password authentication failed',
          success: false
        })
      )

      const result = await apiClient.testConnection(
        { database: 'testdb', host: 'localhost', username: 'admin' },
        'postgres'
      )

      expect(result).toEqual({
        message: 'password authentication failed',
        success: false
      })
    })
  })

  describe('tracing', () => {
    it('continues a provided parent trace', async () => {
      mockFetch.mockResolvedValueOnce(respondWith({ query: queryDto }))

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

      expect(captured().headers.traceparent).toMatch(
        new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)
      )
    })

    it('does not send a traceparent for health checks', async () => {
      mockFetch.mockResolvedValueOnce(
        respondWith({ encryptionAvailable: true, status: 'ok' })
      )

      await apiClient.getHealth()

      expect(captured().headers.traceparent).toBeUndefined()
    })

    it('does not send a traceparent for the result poller', async () => {
      mockFetch.mockResolvedValueOnce(respondWith({ query: queryDto }))

      await apiClient.getQuery('query-1')

      expect(captured().headers.traceparent).toBeUndefined()
    })

    it('does not send a traceparent when ingesting spans', async () => {
      mockFetch.mockResolvedValueOnce(respondWith({ insertedCount: 1 }))

      await apiClient.ingestSpans([
        {
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
      ])

      expect(captured().headers.traceparent).toBeUndefined()
    })
  })

  describe('errors', () => {
    it('throws the tagged error so callers can discriminate on _tag', async () => {
      mockFetch.mockResolvedValueOnce(
        respondWith(
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
        respondWith(
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
        respondWith(
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
  })
})

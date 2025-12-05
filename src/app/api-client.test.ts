import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/errors'

const mockFetch = vi.fn()

vi.stubGlobal('fetch', mockFetch)

import { apiClient } from './api-client'

function createMockResponse(
  data: unknown,
  options: { ok?: boolean; status?: number; statusText?: string } = {}
) {
  return {
    json: () => Promise.resolve(data),
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK'
  }
}

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createDatabase', () => {
    const request = {
      connectionInfo: {
        database: 'testdb',
        host: 'localhost',
        password: 'secret',
        port: 5432,
        username: 'admin'
      },
      name: 'Test Database'
    }

    it('should make a POST request to /databases', async () => {
      const responseData = {
        database: {
          connectionInfo: request.connectionInfo,
          createdAt: 1704067200000,
          id: 'db-123',
          name: 'Test Database',
          type: 'postgres'
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      await apiClient.createDatabase(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7847/databases',
        {
          body: JSON.stringify(request),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST'
        }
      )
    })

    it('should return the response data on success', async () => {
      const responseData = {
        database: {
          connectionInfo: request.connectionInfo,
          createdAt: 1704067200000,
          id: 'db-123',
          name: 'Test Database',
          type: 'postgres'
        },
        updatedWorksheet: {
          createdAt: 1704067200000,
          databaseId: 'db-123',
          id: 'ws-123',
          name: 'Worksheet 1'
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      const result = await apiClient.createDatabase(request)

      expect(result).toEqual(responseData)
    })

    it('should throw ApiError on error response', async () => {
      const errorResponse = {
        error: {
          details: { name: 'Name is required.' },
          message: 'Validation error',
          status: 400
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse))

      try {
        await apiClient.createDatabase(request)
        expect.fail('Expected ApiError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).statusCode).toEqual(400)
        expect((error as ApiError).message).toEqual('Validation error')
        expect((error as ApiError).details).toEqual({
          name: 'Name is required.'
        })
      }
    })
  })

  describe('createQuery', () => {
    const request = {
      content: 'SELECT * FROM users',
      databaseId: 'db-123',
      id: 'query-123',
      queriedAt: 1704067200000,
      worksheetId: 'ws-123'
    }

    it('should make a POST request to /queries', async () => {
      const responseData = {
        query: {
          content: request.content,
          databaseId: request.databaseId,
          error: null,
          finishedAt: null,
          id: request.id,
          queriedAt: request.queriedAt,
          result: null,
          worksheetId: request.worksheetId
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      await apiClient.createQuery(request)

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:7847/queries', {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
    })

    it('should return the response data on success', async () => {
      const responseData = {
        query: {
          content: request.content,
          databaseId: request.databaseId,
          error: null,
          finishedAt: 1704067201000,
          id: request.id,
          queriedAt: request.queriedAt,
          result: { columns: ['id', 'name'], rows: [[1, 'Alice']] },
          worksheetId: request.worksheetId
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      const result = await apiClient.createQuery(request)

      expect(result).toEqual(responseData)
    })
  })

  describe('getQuery', () => {
    it('should make a GET request to /queries/:id', async () => {
      const queryId = 'query-123'
      const responseData = {
        query: {
          content: 'SELECT 1',
          databaseId: 'db-123',
          error: null,
          finishedAt: 1704067201000,
          id: queryId,
          queriedAt: 1704067200000,
          result: { columns: ['?column?'], rows: [[1]] },
          worksheetId: 'ws-123'
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      await apiClient.getQuery(queryId)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7847/queries/query-123'
      )
    })

    it('should return the query from the response', async () => {
      const queryId = 'query-123'
      const query = {
        content: 'SELECT 1',
        databaseId: 'db-123',
        error: null,
        finishedAt: 1704067201000,
        id: queryId,
        queriedAt: 1704067200000,
        result: { columns: ['?column?'], rows: [[1]] },
        worksheetId: 'ws-123'
      }

      mockFetch.mockResolvedValueOnce(createMockResponse({ query }))

      const result = await apiClient.getQuery(queryId)

      expect(result).toEqual(query)
    })

    it('should throw ApiError when query is not found', async () => {
      const errorResponse = {
        error: {
          message: 'Query not found',
          status: 404
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse))

      await expect(apiClient.getQuery('nonexistent')).rejects.toThrow(ApiError)
    })
  })

  describe('testConnection', () => {
    const connectionInfo = {
      database: 'testdb',
      host: 'localhost',
      password: 'secret',
      port: 5432,
      username: 'admin'
    }

    it('should make a POST request to /connection-tests', async () => {
      const responseData = { success: true }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      await apiClient.testConnection(connectionInfo)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7847/connection-tests',
        {
          body: JSON.stringify({ connectionInfo }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST'
        }
      )
    })

    it('should return success response', async () => {
      const responseData = { success: true }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      const result = await apiClient.testConnection(connectionInfo)

      expect(result).toEqual({ success: true })
    })

    it('should return failure response with message', async () => {
      const responseData = {
        message: 'Connection refused',
        success: false
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      const result = await apiClient.testConnection(connectionInfo)

      expect(result).toEqual({
        message: 'Connection refused',
        success: false
      })
    })
  })

  describe('updateWorksheet', () => {
    const worksheetId = 'ws-123'
    const updates = { databaseId: 'db-456' }

    it('should make a PATCH request to /worksheets/:id', async () => {
      const responseData = {
        worksheet: {
          createdAt: 1704067200000,
          databaseId: 'db-456',
          id: worksheetId,
          name: 'Worksheet 1'
        }
      }

      mockFetch.mockResolvedValueOnce(createMockResponse(responseData))

      await apiClient.updateWorksheet(worksheetId, updates)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7847/worksheets/ws-123',
        {
          body: JSON.stringify(updates),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH'
        }
      )
    })

    it('should return the updated worksheet', async () => {
      const worksheet = {
        createdAt: 1704067200000,
        databaseId: 'db-456',
        id: worksheetId,
        name: 'Worksheet 1'
      }

      mockFetch.mockResolvedValueOnce(createMockResponse({ worksheet }))

      const result = await apiClient.updateWorksheet(worksheetId, updates)

      expect(result).toEqual(worksheet)
    })

    it('should handle name updates', async () => {
      const nameUpdate = { name: 'New Name' }
      const worksheet = {
        createdAt: 1704067200000,
        databaseId: null,
        id: worksheetId,
        name: 'New Name'
      }

      mockFetch.mockResolvedValueOnce(createMockResponse({ worksheet }))

      const result = await apiClient.updateWorksheet(worksheetId, nameUpdate)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7847/worksheets/ws-123',
        {
          body: JSON.stringify(nameUpdate),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH'
        }
      )
      expect(result).toEqual(worksheet)
    })
  })

  describe('error handling', () => {
    it('should throw ApiError with status from non-OK response without error body', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {},
          { ok: false, status: 500, statusText: 'Internal Server Error' }
        )
      )

      try {
        await apiClient.getQuery('query-123')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).statusCode).toEqual(500)
        expect((error as ApiError).message).toEqual('Internal Server Error')
      }
    })

    it('should prefer error body over HTTP status when both present', async () => {
      const errorResponse = {
        error: {
          message: 'Custom error message',
          status: 422
        }
      }

      mockFetch.mockResolvedValueOnce(
        createMockResponse(errorResponse, {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
      )

      try {
        await apiClient.getQuery('query-123')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).statusCode).toEqual(422)
        expect((error as ApiError).message).toEqual('Custom error message')
      }
    })
  })
})

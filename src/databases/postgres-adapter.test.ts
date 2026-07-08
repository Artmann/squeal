import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConnect, mockEnd, mockQuery } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockEnd: vi.fn(),
  mockQuery: vi.fn()
}))

vi.mock('pg', () => {
  function MockClient(this: any) {
    this.connect = mockConnect
    this.end = mockEnd
    this.query = mockQuery
  }

  return { Client: vi.fn(MockClient) }
})

import { Client } from 'pg'

import { PostgresAdapter } from './postgres-adapter'

const connectionInfo = {
  database: 'testdb',
  host: 'localhost',
  password: 'secret',
  port: 5432,
  username: 'testuser'
}

describe('PostgresAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('testConnection', () => {
    it('connects and disconnects', async () => {
      const adapter = new PostgresAdapter(connectionInfo)

      await adapter.testConnection()

      expect(mockConnect).toHaveBeenCalled()
      expect(mockEnd).toHaveBeenCalled()
    })

    it('closes connection even when connection fails', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'))

      const adapter = new PostgresAdapter(connectionInfo)

      await expect(adapter.testConnection()).rejects.toThrow(
        'Connection refused'
      )
      expect(mockEnd).toHaveBeenCalled()
    })
  })

  describe('runQuery', () => {
    it('executes query and returns formatted results', async () => {
      mockQuery.mockResolvedValueOnce({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }]
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users')
      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }],
        truncated: false
      })
      expect(mockEnd).toHaveBeenCalled()
    })

    it('handles multiple rows', async () => {
      const rows = [
        { letter: 'a', num: 1 },
        { letter: 'b', num: 2 },
        { letter: 'c', num: 3 }
      ]

      mockQuery.mockResolvedValueOnce({
        fields: [{ name: 'letter' }, { name: 'num' }],
        rowCount: 3,
        rows
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT letter, num FROM test')

      expect(result).toEqual({
        fields: [{ name: 'letter' }, { name: 'num' }],
        rowCount: 3,
        rows,
        truncated: false
      })
    })

    it('handles empty result set', async () => {
      mockQuery.mockResolvedValueOnce({
        fields: [],
        rowCount: 0,
        rows: []
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM empty_table')

      expect(result).toEqual({
        fields: [],
        rowCount: 0,
        rows: [],
        truncated: false
      })
    })

    it('uses null rowCount as 0', async () => {
      mockQuery.mockResolvedValueOnce({
        fields: [],
        rowCount: null,
        rows: []
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('DELETE FROM logs')

      expect(result.rowCount).toEqual(0)
    })

    it('truncates results to 10,000 rows', async () => {
      const manyRows = Array.from({ length: 10_001 }, (_, i) => ({ id: i }))

      mockQuery.mockResolvedValueOnce({
        fields: [{ name: 'id' }],
        rowCount: 10_001,
        rows: manyRows
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM big_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_001)
      expect(result.truncated).toEqual(true)
      expect(result.rows[0]).toEqual({ id: 0 })
      expect(result.rows[9_999]).toEqual({ id: 9_999 })
    })

    it('does not truncate results at exactly 10,000 rows', async () => {
      const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: i }))

      mockQuery.mockResolvedValueOnce({
        fields: [{ name: 'id' }],
        rowCount: 10_000,
        rows
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM exact_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.truncated).toEqual(false)
    })

    it('closes connection even when query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      const adapter = new PostgresAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow(
        'Query failed'
      )
      expect(mockEnd).toHaveBeenCalled()
    })

    it('passes discrete connection fields without ssl when sslMode is disable', async () => {
      mockQuery.mockResolvedValueOnce({ fields: [], rowCount: 0, rows: [] })

      const adapter = new PostgresAdapter({
        ...connectionInfo,
        sslMode: 'disable'
      })

      await adapter.runQuery('SELECT 1')

      expect(Client).toHaveBeenCalledWith({
        database: 'testdb',
        host: 'localhost',
        password: 'secret',
        port: 5432,
        user: 'testuser'
      })
    })

    it('passes passwords with special characters verbatim', async () => {
      mockQuery.mockResolvedValueOnce({ fields: [], rowCount: 0, rows: [] })

      const adapter = new PostgresAdapter({
        ...connectionInfo,
        password: 'p@ss:w/rd#?'
      })

      await adapter.runQuery('SELECT 1')

      expect(Client).toHaveBeenCalledWith({
        database: 'testdb',
        host: 'localhost',
        password: 'p@ss:w/rd#?',
        port: 5432,
        user: 'testuser'
      })
    })

    it('defaults the port to 5432 when omitted', async () => {
      mockQuery.mockResolvedValueOnce({ fields: [], rowCount: 0, rows: [] })

      const adapter = new PostgresAdapter({
        ...connectionInfo,
        port: undefined
      })

      await adapter.runQuery('SELECT 1')

      expect(Client).toHaveBeenCalledWith({
        database: 'testdb',
        host: 'localhost',
        password: 'secret',
        port: 5432,
        user: 'testuser'
      })
    })

    it('disables certificate verification when sslMode is require', async () => {
      mockQuery.mockResolvedValueOnce({ fields: [], rowCount: 0, rows: [] })

      const adapter = new PostgresAdapter({
        ...connectionInfo,
        sslMode: 'require'
      })

      await adapter.runQuery('SELECT 1')

      expect(Client).toHaveBeenCalledWith({
        database: 'testdb',
        host: 'localhost',
        password: 'secret',
        port: 5432,
        ssl: { rejectUnauthorized: false },
        user: 'testuser'
      })
    })
  })
})

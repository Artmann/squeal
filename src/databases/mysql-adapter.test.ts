import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MysqlAdapter } from './mysql-adapter'

const mockEnd = vi.fn()
const mockPing = vi.fn()
const mockQuery = vi.fn()

const mockConnection = {
  end: mockEnd,
  ping: mockPing,
  query: mockQuery
}

vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: vi.fn(() => Promise.resolve(mockConnection))
  }
}))

import mysql from 'mysql2/promise'

const connectionInfo = {
  database: 'testdb',
  host: 'localhost',
  password: 'secret',
  port: 3306,
  username: 'testuser'
}

describe('MysqlAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('testConnection', () => {
    it('connects and pings the database', async () => {
      const adapter = new MysqlAdapter(connectionInfo)

      await adapter.testConnection()

      expect(mysql.createConnection).toHaveBeenCalledWith({
        connectTimeout: 5000,
        database: 'testdb',
        host: 'localhost',
        password: 'secret',
        port: 3306,
        user: 'testuser'
      })
      expect(mockPing).toHaveBeenCalled()
      expect(mockEnd).toHaveBeenCalled()
    })

    it('uses default port when not specified', async () => {
      const adapter = new MysqlAdapter({
        ...connectionInfo,
        port: undefined
      })

      await adapter.testConnection()

      expect(mysql.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ port: 3306 })
      )
    })
  })

  describe('runQuery', () => {
    it('executes query and returns formatted results', async () => {
      const mockRows = [{ id: 1, name: 'Test' }]
      const mockFields = [{ name: 'id' }, { name: 'name' }]
      mockQuery.mockResolvedValueOnce([mockRows, mockFields])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM users')
      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }]
      })
      expect(mockEnd).toHaveBeenCalled()
    })

    it('handles multiple rows', async () => {
      const mockRows = [
        { letter: 'a', num: 1 },
        { letter: 'b', num: 2 },
        { letter: 'c', num: 3 }
      ]
      const mockFields = [{ name: 'letter' }, { name: 'num' }]
      mockQuery.mockResolvedValueOnce([mockRows, mockFields])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT letter, num FROM test')

      expect(result).toEqual({
        fields: [{ name: 'letter' }, { name: 'num' }],
        rowCount: 3,
        rows: mockRows
      })
    })

    it('handles empty result set', async () => {
      mockQuery.mockResolvedValueOnce([[], []])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM empty_table')

      expect(result).toEqual({
        fields: [],
        rowCount: 0,
        rows: []
      })
    })

    it('closes connection even when query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      const adapter = new MysqlAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow('Query failed')
      expect(mockEnd).toHaveBeenCalled()
    })
  })
})

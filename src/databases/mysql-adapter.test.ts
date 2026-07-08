import { EventEmitter } from 'events'
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

const mockCallbackEnd = vi.fn()
const mockCallbackQuery = vi.fn()
const mockDestroy = vi.fn()

vi.mock('mysql2', () => ({
  createConnection: vi.fn(() => ({
    destroy: mockDestroy,
    end: mockCallbackEnd,
    query: mockCallbackQuery
  }))
}))

import { createConnection } from 'mysql2'
import mysql from 'mysql2/promise'

interface QueryEvent {
  name: 'end' | 'error' | 'fields' | 'result'
  payload?: unknown
}

// Queues a statement emitter that replays the given events on the next
// microtask, after the adapter has subscribed.
function emitQueryEvents(events: QueryEvent[]): void {
  mockCallbackQuery.mockImplementationOnce(() => {
    const statement = new EventEmitter()

    queueMicrotask(() => {
      for (const event of events) {
        statement.emit(event.name, event.payload)
      }
    })

    return statement
  })
}

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

    it('does not include ssl when sslMode is disable', async () => {
      const adapter = new MysqlAdapter({
        ...connectionInfo,
        sslMode: 'disable'
      })

      await adapter.testConnection()

      expect(mysql.createConnection).toHaveBeenCalledWith(
        expect.not.objectContaining({ ssl: expect.anything() })
      )
    })

    it('uses rejectUnauthorized: false for sslMode require', async () => {
      const adapter = new MysqlAdapter({
        ...connectionInfo,
        sslMode: 'require'
      })

      await adapter.testConnection()

      expect(mysql.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: false } })
      )
    })

    it('uses rejectUnauthorized: true for sslMode verify-full without cert', async () => {
      const adapter = new MysqlAdapter({
        ...connectionInfo,
        sslMode: 'verify-full'
      })

      await adapter.testConnection()

      expect(mysql.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: true } })
      )
    })

    it('uses rejectUnauthorized: true for sslMode verify-full with system cert', async () => {
      const adapter = new MysqlAdapter({
        ...connectionInfo,
        sslMode: 'verify-full',
        sslRootCert: 'system'
      })

      await adapter.testConnection()

      expect(mysql.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: true } })
      )
    })
  })

  describe('runQuery', () => {
    it('executes query and returns formatted results', async () => {
      emitQueryEvents([
        { name: 'fields', payload: [{ name: 'id' }, { name: 'name' }] },
        { name: 'result', payload: { id: 1, name: 'Test' } },
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(createConnection).toHaveBeenCalledWith({
        database: 'testdb',
        host: 'localhost',
        password: 'secret',
        port: 3306,
        user: 'testuser'
      })
      expect(mockCallbackQuery).toHaveBeenCalledWith('SELECT * FROM users')
      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }],
        truncated: false
      })
      expect(mockCallbackEnd).toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('handles multiple rows', async () => {
      const rows = [
        { letter: 'a', num: 1 },
        { letter: 'b', num: 2 },
        { letter: 'c', num: 3 }
      ]

      emitQueryEvents([
        { name: 'fields', payload: [{ name: 'letter' }, { name: 'num' }] },
        ...rows.map((row) => ({ name: 'result' as const, payload: row })),
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT letter, num FROM test')

      expect(result).toEqual({
        fields: [{ name: 'letter' }, { name: 'num' }],
        rowCount: 3,
        rows,
        truncated: false
      })
    })

    it('handles empty result set', async () => {
      emitQueryEvents([
        { name: 'fields', payload: [{ name: 'id' }] },
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM empty_table')

      expect(result).toEqual({
        fields: [{ name: 'id' }],
        rowCount: 0,
        rows: [],
        truncated: false
      })
    })

    it('reports affected rows for statements without rows', async () => {
      emitQueryEvents([
        { name: 'fields', payload: undefined },
        { name: 'result', payload: { affectedRows: 7 } },
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('DELETE FROM users WHERE old = 1')

      expect(result).toEqual({
        fields: [],
        rowCount: 7,
        rows: [],
        truncated: false
      })
    })

    it('does not truncate at exactly 10,000 rows', async () => {
      const rows = Array.from({ length: 10_000 }, (_, index) => ({
        id: index
      }))

      emitQueryEvents([
        { name: 'fields', payload: [{ name: 'id' }] },
        ...rows.map((row) => ({ name: 'result' as const, payload: row })),
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM exact_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_000)
      expect(result.truncated).toEqual(false)
      expect(mockCallbackEnd).toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })

    it('destroys the connection and truncates past 10,000 rows', async () => {
      const rows = Array.from({ length: 10_005 }, (_, index) => ({
        id: index
      }))

      emitQueryEvents([
        { name: 'fields', payload: [{ name: 'id' }] },
        ...rows.map((row) => ({ name: 'result' as const, payload: row })),
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM big_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_000)
      expect(result.truncated).toEqual(true)
      expect(result.rows[0]).toEqual({ id: 0 })
      expect(result.rows[9_999]).toEqual({ id: 9_999 })
      expect(mockDestroy).toHaveBeenCalled()
      expect(mockCallbackEnd).not.toHaveBeenCalled()
    })

    it('rejects once when the query errors before end', async () => {
      emitQueryEvents([
        { name: 'error', payload: new Error('Query failed') },
        { name: 'end' }
      ])

      const adapter = new MysqlAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow(
        'Query failed'
      )
      expect(mockCallbackEnd).toHaveBeenCalled()
      expect(mockDestroy).not.toHaveBeenCalled()
    })
  })
})

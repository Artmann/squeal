import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SqliteAdapter } from './sqlite-adapter'

const mockClose = vi.fn()
const mockExecute = vi.fn()

const mockClient = {
  close: mockClose,
  execute: mockExecute
}

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => mockClient)
}))

const mockDatabaseClose = vi.fn()
const mockPrepare = vi.fn()

vi.mock('libsql', () => ({
  default: vi.fn(function () {
    return {
      close: mockDatabaseClose,
      prepare: mockPrepare
    }
  })
}))

import { createClient } from '@libsql/client'
import Database from 'libsql'

interface SelectStatementFixture {
  pulledCount(): number
  statement: {
    columns(): { name: string }[]
    iterate(): IterableIterator<unknown>
    reader: boolean
    run(): { changes: number }
  }
}

function createSelectStatement(
  columns: string[],
  rows: Record<string, unknown>[]
): SelectStatementFixture {
  let pulled = 0

  return {
    pulledCount: () => pulled,
    statement: {
      columns: () => columns.map((name) => ({ name })),
      *iterate() {
        for (const row of rows) {
          pulled += 1

          yield row
        }
      },
      reader: true,
      run: () => ({ changes: 0 })
    }
  }
}

const connectionInfo = {
  path: '/path/to/database.sqlite'
}

describe('SqliteAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('testConnection', () => {
    it('connects and executes SELECT 1', async () => {
      mockExecute.mockResolvedValueOnce({ columns: [], rows: [] })

      const adapter = new SqliteAdapter(connectionInfo)

      await adapter.testConnection()

      expect(createClient).toHaveBeenCalledWith({
        url: 'file:///path/to/database.sqlite'
      })
      expect(mockExecute).toHaveBeenCalledWith('SELECT 1')
      expect(mockClose).toHaveBeenCalled()
    })

    it('closes connection even when test fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Database not found'))

      const adapter = new SqliteAdapter(connectionInfo)

      await expect(adapter.testConnection()).rejects.toThrow(
        'Database not found'
      )
      expect(mockClose).toHaveBeenCalled()
    })
  })

  describe('getServerVersion', () => {
    it('reports the SQLite library version', async () => {
      mockExecute.mockResolvedValueOnce({
        columns: ['version'],
        rows: [{ version: '3.45.1' }]
      })

      const adapter = new SqliteAdapter(connectionInfo)

      expect(await adapter.getServerVersion()).toEqual('SQLite 3.45')
      expect(mockExecute).toHaveBeenCalledWith(
        'select sqlite_version() as version'
      )
      expect(mockClose).toHaveBeenCalled()
    })

    it('closes the connection even when the probe fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Database not found'))

      const adapter = new SqliteAdapter(connectionInfo)

      await expect(adapter.getServerVersion()).rejects.toThrow(
        'Database not found'
      )
      expect(mockClose).toHaveBeenCalled()
    })
  })

  describe('runQuery', () => {
    it('executes query and returns formatted results', async () => {
      const fixture = createSelectStatement(
        ['id', 'name'],
        [{ id: 1, name: 'Test' }]
      )

      mockPrepare.mockReturnValueOnce(fixture.statement)

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(Database).toHaveBeenCalledWith('/path/to/database.sqlite')
      expect(mockPrepare).toHaveBeenCalledWith('SELECT * FROM users')
      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }],
        truncated: false
      })
      expect(mockDatabaseClose).toHaveBeenCalled()
    })

    it('handles multiple rows', async () => {
      const fixture = createSelectStatement(
        ['letter', 'num'],
        [
          { letter: 'a', num: 1 },
          { letter: 'b', num: 2 },
          { letter: 'c', num: 3 }
        ]
      )

      mockPrepare.mockReturnValueOnce(fixture.statement)

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT letter, num FROM test')

      expect(result).toEqual({
        fields: [{ name: 'letter' }, { name: 'num' }],
        rowCount: 3,
        rows: [
          { letter: 'a', num: 1 },
          { letter: 'b', num: 2 },
          { letter: 'c', num: 3 }
        ],
        truncated: false
      })
    })

    it('handles empty result set', async () => {
      const fixture = createSelectStatement(['id'], [])

      mockPrepare.mockReturnValueOnce(fixture.statement)

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM empty_table')

      expect(result).toEqual({
        fields: [{ name: 'id' }],
        rowCount: 0,
        rows: [],
        truncated: false
      })
    })

    it('runs non-reader statements and reports affected rows', async () => {
      mockPrepare.mockReturnValueOnce({
        columns: (): { name: string }[] => [],
        iterate: (): IterableIterator<unknown> => [].values(),
        reader: false,
        run: () => ({ changes: 7 })
      })

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('DELETE FROM users WHERE old = 1')

      expect(result).toEqual({
        fields: [],
        rowCount: 7,
        rows: [],
        truncated: false
      })
      expect(mockDatabaseClose).toHaveBeenCalled()
    })

    it('does not truncate at exactly 10,000 rows', async () => {
      const rows = Array.from({ length: 10_000 }, (_, index) => ({
        id: index
      }))
      const fixture = createSelectStatement(['id'], rows)

      mockPrepare.mockReturnValueOnce(fixture.statement)

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM big_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_000)
      expect(result.truncated).toEqual(false)
    })

    it('truncates results to 10,000 rows without reading further', async () => {
      const rows = Array.from({ length: 50_000 }, (_, index) => ({
        id: index
      }))
      const fixture = createSelectStatement(['id'], rows)

      mockPrepare.mockReturnValueOnce(fixture.statement)

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM big_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_000)
      expect(result.truncated).toEqual(true)
      expect(result.rows[0]).toEqual({ id: 0 })
      expect(result.rows[9_999]).toEqual({ id: 9_999 })
      expect(fixture.pulledCount()).toEqual(10_001)
    })

    it('closes connection even when query fails', async () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('Query failed')
      })

      const adapter = new SqliteAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow(
        'Query failed'
      )
      expect(mockDatabaseClose).toHaveBeenCalled()
    })
  })

  describe('getSchema', () => {
    it('returns schema with tables and columns', async () => {
      mockExecute
        .mockResolvedValueOnce({
          columns: ['name'],
          rows: [{ name: 'users' }, { name: 'posts' }]
        })
        .mockResolvedValueOnce({
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          rows: [
            {
              cid: 0,
              name: 'id',
              type: 'INTEGER',
              notnull: 1,
              dflt_value: null,
              pk: 1
            },
            {
              cid: 1,
              name: 'name',
              type: 'TEXT',
              notnull: 0,
              dflt_value: null,
              pk: 0
            }
          ]
        })
        .mockResolvedValueOnce({
          columns: ['id', 'seq', 'table', 'from', 'to'],
          rows: []
        })
        .mockResolvedValueOnce({
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          rows: [
            {
              cid: 0,
              name: 'id',
              type: 'INTEGER',
              notnull: 1,
              dflt_value: null,
              pk: 1
            },
            {
              cid: 1,
              name: 'user_id',
              type: 'INTEGER',
              notnull: 0,
              dflt_value: null,
              pk: 0
            },
            {
              cid: 2,
              name: 'title',
              type: 'TEXT',
              notnull: 0,
              dflt_value: "'Untitled'",
              pk: 0
            }
          ]
        })
        .mockResolvedValueOnce({
          columns: ['id', 'seq', 'table', 'from', 'to'],
          rows: [{ id: 0, seq: 0, table: 'users', from: 'user_id', to: 'id' }]
        })

      const adapter = new SqliteAdapter(connectionInfo)
      const schema = await adapter.getSchema()

      expect(schema.databaseName).toEqual('database.sqlite')
      expect(schema.tables).toHaveLength(2)

      expect(schema.tables[0]).toEqual({
        columns: [
          {
            columnName: 'id',
            dataType: 'INTEGER',
            defaultValue: null,
            isNullable: false,
            isPrimaryKey: true,
            ordinalPosition: 1
          },
          {
            columnName: 'name',
            dataType: 'TEXT',
            defaultValue: null,
            isNullable: true,
            isPrimaryKey: false,
            ordinalPosition: 2
          }
        ],
        foreignKeys: [],
        tableName: 'users',
        tableSchema: 'main'
      })

      expect(schema.tables[1]).toEqual({
        columns: [
          {
            columnName: 'id',
            dataType: 'INTEGER',
            defaultValue: null,
            isNullable: false,
            isPrimaryKey: true,
            ordinalPosition: 1
          },
          {
            columnName: 'user_id',
            dataType: 'INTEGER',
            defaultValue: null,
            isNullable: true,
            isPrimaryKey: false,
            ordinalPosition: 2
          },
          {
            columnName: 'title',
            dataType: 'TEXT',
            defaultValue: "'Untitled'",
            isNullable: true,
            isPrimaryKey: false,
            ordinalPosition: 3
          }
        ],
        foreignKeys: [
          {
            columnName: 'user_id',
            constraintName: 'fk_posts_0',
            referencedColumnName: 'id',
            referencedTableName: 'users',
            referencedTableSchema: 'main'
          }
        ],
        tableName: 'posts',
        tableSchema: 'main'
      })

      expect(mockClose).toHaveBeenCalled()
    })

    it('handles empty database', async () => {
      mockExecute.mockResolvedValueOnce({
        columns: ['name'],
        rows: []
      })

      const adapter = new SqliteAdapter(connectionInfo)
      const schema = await adapter.getSchema()

      expect(schema).toEqual({
        databaseName: 'database.sqlite',
        tables: []
      })
    })

    it('closes connection even when schema query fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Permission denied'))

      const adapter = new SqliteAdapter(connectionInfo)

      await expect(adapter.getSchema()).rejects.toThrow('Permission denied')
      expect(mockClose).toHaveBeenCalled()
    })
  })
})

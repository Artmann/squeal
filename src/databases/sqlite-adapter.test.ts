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

import { createClient } from '@libsql/client'

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

  describe('runQuery', () => {
    it('executes query and returns formatted results', async () => {
      mockExecute.mockResolvedValueOnce({
        columns: ['id', 'name'],
        rows: [[1, 'Test']]
      })

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(mockExecute).toHaveBeenCalledWith('SELECT * FROM users')
      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }]
      })
      expect(mockClose).toHaveBeenCalled()
    })

    it('handles multiple rows', async () => {
      mockExecute.mockResolvedValueOnce({
        columns: ['letter', 'num'],
        rows: [
          ['a', 1],
          ['b', 2],
          ['c', 3]
        ]
      })

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT letter, num FROM test')

      expect(result).toEqual({
        fields: [{ name: 'letter' }, { name: 'num' }],
        rowCount: 3,
        rows: [
          { letter: 'a', num: 1 },
          { letter: 'b', num: 2 },
          { letter: 'c', num: 3 }
        ]
      })
    })

    it('handles empty result set', async () => {
      mockExecute.mockResolvedValueOnce({
        columns: [],
        rows: []
      })

      const adapter = new SqliteAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM empty_table')

      expect(result).toEqual({
        fields: [],
        rowCount: 0,
        rows: []
      })
    })

    it('closes connection even when query fails', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Query failed'))

      const adapter = new SqliteAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow(
        'Query failed'
      )
      expect(mockClose).toHaveBeenCalled()
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
            { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
            { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 }
          ]
        })
        .mockResolvedValueOnce({
          columns: ['id', 'seq', 'table', 'from', 'to'],
          rows: []
        })
        .mockResolvedValueOnce({
          columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
          rows: [
            { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
            { cid: 1, name: 'user_id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
            { cid: 2, name: 'title', type: 'TEXT', notnull: 0, dflt_value: "'Untitled'", pk: 0 }
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

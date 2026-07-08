import { beforeEach, describe, expect, it, vi } from 'vitest'

interface CursorFixture {
  error?: Error
  fields: { name: string }[]
  rowCount?: number | null
  rows: Record<string, unknown>[]
}

const { cursorState, mockConnect, mockEnd, mockQuery } = vi.hoisted(() => ({
  cursorState: {
    closeCount: 0,
    createdWith: [] as string[],
    fixtures: [] as {
      error?: Error
      fields: { name: string }[]
      rowCount?: number | null
      rows: Record<string, unknown>[]
    }[],
    readRequests: [] as number[]
  },
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

vi.mock('pg-cursor', () => {
  class FakeCursor {
    private readonly fixture: CursorFixture
    private served = 0

    constructor(text: string) {
      cursorState.createdWith.push(text)
      this.fixture = cursorState.fixtures.shift() ?? { fields: [], rows: [] }
    }

    read(
      count: number,
      callback: (
        error: Error | undefined,
        rows: Record<string, unknown>[],
        result: {
          fields: { name: string }[]
          rowCount: number | null
          rows: never[]
        }
      ) => void
    ): void {
      cursorState.readRequests.push(count)

      if (this.fixture.error) {
        callback(this.fixture.error, [], {
          fields: this.fixture.fields,
          rowCount: null,
          rows: []
        })

        return
      }

      const batch = this.fixture.rows.slice(this.served, this.served + count)

      this.served += batch.length

      // The driver only learns the row count once the statement completes,
      // which the adapter observes as an empty batch.
      const exhausted = batch.length === 0

      callback(undefined, batch, {
        fields: this.fixture.fields,
        rowCount: exhausted ? (this.fixture.rowCount ?? this.served) : null,
        rows: []
      })
    }

    close(): Promise<void> {
      cursorState.closeCount += 1

      return Promise.resolve()
    }
  }

  return { default: FakeCursor }
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

    cursorState.closeCount = 0
    cursorState.createdWith.length = 0
    cursorState.fixtures.length = 0
    cursorState.readRequests.length = 0

    mockQuery.mockImplementation((input: unknown) => input)
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
      cursorState.fixtures.push({
        fields: [{ name: 'id' }, { name: 'name' }],
        rows: [{ id: 1, name: 'Test' }]
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(cursorState.createdWith).toEqual(['SELECT * FROM users'])
      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 1,
        rows: [{ id: 1, name: 'Test' }],
        truncated: false
      })
      expect(cursorState.closeCount).toEqual(1)
      expect(mockEnd).toHaveBeenCalled()
    })

    it('handles multiple rows', async () => {
      const rows = [
        { letter: 'a', num: 1 },
        { letter: 'b', num: 2 },
        { letter: 'c', num: 3 }
      ]

      cursorState.fixtures.push({
        fields: [{ name: 'letter' }, { name: 'num' }],
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
      cursorState.fixtures.push({ fields: [], rows: [] })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM empty_table')

      expect(result).toEqual({
        fields: [],
        rowCount: 0,
        rows: [],
        truncated: false
      })
    })

    it('reports affected rows for statements without rows', async () => {
      cursorState.fixtures.push({ fields: [], rowCount: 5, rows: [] })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('DELETE FROM logs')

      expect(result).toEqual({
        fields: [],
        rowCount: 5,
        rows: [],
        truncated: false
      })
    })

    it('treats a missing driver rowCount as the number of returned rows', async () => {
      cursorState.fixtures.push({ fields: [], rowCount: null, rows: [] })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('CREATE TABLE example (id int)')

      expect(result.rowCount).toEqual(0)
    })

    it('truncates results to 10,000 rows without reading further', async () => {
      const manyRows = Array.from({ length: 50_000 }, (_, i) => ({ id: i }))

      cursorState.fixtures.push({ fields: [{ name: 'id' }], rows: manyRows })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM big_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_000)
      expect(result.truncated).toEqual(true)
      expect(result.rows[0]).toEqual({ id: 0 })
      expect(result.rows[9_999]).toEqual({ id: 9_999 })

      const totalRequested = cursorState.readRequests.reduce(
        (sum, count) => sum + count,
        0
      )

      expect(totalRequested).toEqual(10_001)
      expect(cursorState.closeCount).toEqual(1)
    })

    it('does not truncate results at exactly 10,000 rows', async () => {
      const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: i }))

      cursorState.fixtures.push({ fields: [{ name: 'id' }], rows })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM exact_table')

      expect(result.rows).toHaveLength(10_000)
      expect(result.rowCount).toEqual(10_000)
      expect(result.truncated).toEqual(false)
    })

    it('retries with quoted identifiers when the relation is missing', async () => {
      cursorState.fixtures.push(
        {
          error: new Error('relation "users" does not exist'),
          fields: [],
          rows: []
        },
        { fields: [{ name: 'id' }], rows: [{ id: 1 }] }
      )

      mockQuery.mockImplementation((input: unknown) => {
        if (typeof input === 'string') {
          return Promise.resolve({
            rows: input.includes('referenced')
              ? []
              : [
                  {
                    column_default: null,
                    column_name: 'id',
                    data_type: 'integer',
                    is_nullable: 'NO',
                    is_primary_key: true,
                    ordinal_position: 1,
                    table_name: 'Users',
                    table_schema: 'public'
                  }
                ]
          })
        }

        return input
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM users')

      expect(cursorState.createdWith).toEqual([
        'SELECT * FROM users',
        'SELECT * FROM "public"."Users"'
      ])
      expect(result).toEqual({
        fields: [{ name: 'id' }],
        rowCount: 1,
        rows: [{ id: 1 }],
        truncated: false
      })
      expect(cursorState.closeCount).toEqual(2)
    })

    it('closes the cursor and connection even when the query fails', async () => {
      cursorState.fixtures.push({
        error: new Error('Query failed'),
        fields: [],
        rows: []
      })

      const adapter = new PostgresAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow(
        'Query failed'
      )
      expect(cursorState.closeCount).toEqual(1)
      expect(mockEnd).toHaveBeenCalled()
    })

    it('passes discrete connection fields without ssl when sslMode is disable', async () => {
      cursorState.fixtures.push({ fields: [], rows: [] })

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
      cursorState.fixtures.push({ fields: [], rows: [] })

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
      cursorState.fixtures.push({ fields: [], rows: [] })

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
      cursorState.fixtures.push({ fields: [], rows: [] })

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

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest'

interface CursorFixture {
  error?: Error
  fields: { name: string }[]

  // Runs at the top of every read, before the callback. Lets a test act while
  // the statement is in flight — cancelling it, for instance — which is the
  // only way to reach the paths that depend on a cancel already being
  // requested.
  onRead?: () => void

  rowCount?: number | null
  rows: Record<string, unknown>[]
}

const { clientState, cursorState, mockConnect, mockEnd, mockQuery } =
  vi.hoisted(() => ({
    // node-postgres learns the backend process id during connect, so a client
    // only carries one once the server has answered. Undefined is the default
    // because that is what a client that never connected looks like.
    clientState: { processId: undefined as number | undefined },
    cursorState: {
      closeCount: 0,
      createdWith: [] as string[],
      fixtures: [] as CursorFixture[],
      readRequests: [] as number[]
    },
    mockConnect: vi.fn(),
    mockEnd: vi.fn(),
    mockQuery: vi.fn()
  }))

vi.mock('pg', () => {
  // Constructor-function mock, so `this` needs the shape it assigns.
  interface MockClientInstance {
    connect: typeof mockConnect
    end: typeof mockEnd
    processID: number | undefined
    query: typeof mockQuery
  }

  function MockClient(this: MockClientInstance) {
    this.connect = mockConnect
    this.end = mockEnd
    this.processID = clientState.processId
    this.query = mockQuery
  }

  return { Client: vi.fn(MockClient) }
})

vi.mock('pg-cursor', () => {
  class FakeCursor {
    private done = false
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
        result?: {
          fields: { name: string }[]
          rowCount: number | null
          rows: never[]
        }
      ) => void
    ): void {
      cursorState.readRequests.push(count)

      this.fixture.onRead?.()

      if (this.fixture.error) {
        callback(this.fixture.error, [])

        return
      }

      // Once the portal completes, pg-cursor answers any further read with an
      // empty batch and no result object. This is the terminal read that used
      // to clobber the captured fields.
      if (this.done) {
        callback(undefined, [])

        return
      }

      const batch = this.fixture.rows.slice(this.served, this.served + count)

      this.served += batch.length

      // A read returning fewer rows than requested exhausts the portal, so the
      // driver attaches CommandComplete — the fields and the final row count —
      // to it and the cursor is done. A full batch suspends with the count
      // still unknown.
      const completed = batch.length < count

      if (completed) {
        this.done = true
      }

      callback(undefined, batch, {
        fields: this.fixture.fields,
        rowCount: completed ? (this.fixture.rowCount ?? this.served) : null,
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

import { QueryCanceledError } from './adapter'
import {
  connectWithRetry,
  isTooManyClientsError,
  PostgresAdapter
} from './postgres-adapter'

const connectionInfo = {
  database: 'testdb',
  host: 'localhost',
  password: 'secret',
  port: 5432,
  username: 'testuser'
}

// pg rejects with a DatabaseError: an Error carrying the SQLSTATE on `code`.
// The cursor fixture only promises an Error, so the code rides along on the
// instance rather than widening the fixture type for a driver detail.
function driverError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
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

  describe('getServerVersion', () => {
    it('asks the server and returns the major release', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ server_version: '16.2 (Debian 16.2-1.pgdg120+2)' }]
      })

      const adapter = new PostgresAdapter(connectionInfo)

      expect(await adapter.getServerVersion()).toEqual('PostgreSQL 16')
      expect(mockQuery).toHaveBeenCalledWith('SHOW server_version')
      expect(mockEnd).toHaveBeenCalled()
    })

    it('closes the connection even when the probe fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection terminated'))

      const adapter = new PostgresAdapter(connectionInfo)

      await expect(adapter.getServerVersion()).rejects.toThrow(
        'Connection terminated'
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

    it('keeps the column fields when the result completes inside one batch', async () => {
      // Regression: a completed result smaller than the batch cap makes the
      // adapter read once more, and that terminal read carries no driver
      // result. The captured fields must survive it, or the grid renders rows
      // with no columns.
      const rows = Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        name: `Employer ${index + 1}`
      }))

      cursorState.fixtures.push({
        fields: [{ name: 'id' }, { name: 'name' }],
        rows
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT * FROM Employers LIMIT 100')

      expect(result).toEqual({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 100,
        rows,
        truncated: false
      })
    })

    it('keeps the column fields when the row count is an exact batch multiple', async () => {
      // The other path: a full batch suspends the portal, so completion (and
      // the fields) arrive on the trailing empty read instead. Both paths must
      // preserve the fields.
      const rows = Array.from({ length: 1_000 }, (_, index) => ({ id: index }))

      cursorState.fixtures.push({ fields: [{ name: 'id' }], rows })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery('SELECT id FROM batch_table')

      expect(result).toEqual({
        fields: [{ name: 'id' }],
        rowCount: 1_000,
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

    it('retries with quoted identifiers when a column is missing', async () => {
      cursorState.fixtures.push(
        {
          error: new Error('column "platformid" does not exist'),
          fields: [],
          rows: []
        },
        { fields: [{ name: 'PlatformId' }], rows: [{ PlatformId: 'abc' }] }
      )

      mockQuery.mockImplementation((input: unknown) => {
        if (typeof input === 'string') {
          return Promise.resolve({
            rows: input.includes('referenced')
              ? []
              : [
                  {
                    column_default: null,
                    column_name: 'PlatformId',
                    data_type: 'uuid',
                    is_nullable: 'NO',
                    is_primary_key: false,
                    ordinal_position: 2,
                    table_name: 'Employees',
                    table_schema: 'platform'
                  }
                ]
          })
        }

        return input
      })

      const adapter = new PostgresAdapter(connectionInfo)
      const result = await adapter.runQuery(
        "SELECT * FROM Employees WHERE PlatformId = 'abc'"
      )

      expect(cursorState.createdWith).toEqual([
        "SELECT * FROM Employees WHERE PlatformId = 'abc'",
        'SELECT * FROM Employees WHERE "PlatformId" = \'abc\''
      ])
      expect(result).toEqual({
        fields: [{ name: 'PlatformId' }],
        rowCount: 1,
        rows: [{ PlatformId: 'abc' }],
        truncated: false
      })
      expect(cursorState.closeCount).toEqual(2)
    })

    // A real driver rejection carries a SQLSTATE, and only 57014 means the
    // statement was canceled. An ordinary 42P01 must still reach the rewrite.
    it('retries with quoted identifiers when the missing relation carries SQLSTATE 42P01', async () => {
      cursorState.fixtures.push(
        {
          error: driverError('relation "users" does not exist', '42P01'),
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
    })

    it('propagates a SQLSTATE 42P01 error the schema cannot rewrite', async () => {
      const missingRelation = driverError(
        'relation "ghosts" does not exist',
        '42P01'
      )

      cursorState.fixtures.push({
        error: missingRelation,
        fields: [],
        rows: []
      })

      mockQuery.mockImplementation((input: unknown) =>
        typeof input === 'string' ? Promise.resolve({ rows: [] }) : input
      )

      const adapter = new PostgresAdapter(connectionInfo)

      // The whole error, SQLSTATE included: the property under test is that
      // the driver's own error reaches the caller unwrapped.
      await expect(adapter.runQuery('SELECT * FROM ghosts')).rejects.toEqual(
        missingRelation
      )
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

    // The close lives in the `finally`, so a rejecting one used to replace the
    // error the caller needs with a socket error — and the connection leaked
    // anyway, since nothing retries the close.
    it('still reports the query error when closing the connection fails', async () => {
      cursorState.fixtures.push({
        error: new Error('Query failed'),
        fields: [],
        rows: []
      })
      mockEnd.mockRejectedValueOnce(new Error('socket hang up'))

      const adapter = new PostgresAdapter(connectionInfo)

      await expect(adapter.runQuery('INVALID SQL')).rejects.toThrow(
        'Query failed'
      )
    })

    it('still returns rows when closing the connection fails', async () => {
      cursorState.fixtures.push({
        fields: [{ name: 'id' }],
        rowCount: 1,
        rows: [{ id: 1 }]
      })
      mockEnd.mockRejectedValueOnce(new Error('socket hang up'))

      const adapter = new PostgresAdapter(connectionInfo)

      expect(await adapter.runQuery('SELECT id FROM t')).toEqual({
        fields: [{ name: 'id' }],
        rowCount: 1,
        rows: [{ id: 1 }],
        truncated: false
      })
    })

    it('passes discrete connection fields without ssl when sslMode is disable', async () => {
      cursorState.fixtures.push({ fields: [], rows: [] })

      const adapter = new PostgresAdapter({
        ...connectionInfo,
        sslMode: 'disable'
      })

      await adapter.runQuery('SELECT 1')

      expect(Client).toHaveBeenCalledWith({
        connectionTimeoutMillis: 10000,
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
        connectionTimeoutMillis: 10000,
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
        connectionTimeoutMillis: 10000,
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
        connectionTimeoutMillis: 10000,
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

describe('isTooManyClientsError', () => {
  it('matches the Postgres too-many-clients message', () => {
    expect(
      isTooManyClientsError(new Error('sorry, too many clients already'))
    ).toEqual(true)
  })

  it('matches when wrapped in an AggregateError', () => {
    const aggregate = new AggregateError([
      new Error('connect ECONNREFUSED'),
      new Error('sorry, too many clients already')
    ])

    expect(isTooManyClientsError(aggregate)).toEqual(true)
  })

  it('does not match unrelated errors', () => {
    expect(
      isTooManyClientsError(new Error('relation "users" does not exist'))
    ).toEqual(false)
  })
})

describe('connectWithRetry', () => {
  function retryOptions(sleep: (milliseconds: number) => Promise<void>) {
    return {
      delays: [1, 2, 3],
      isRetryable: isTooManyClientsError,
      onExhausted: () => new Error('out of slots'),
      sleep
    }
  }

  const tooMany = () => new Error('sorry, too many clients already')

  it('returns the first successful connection without sleeping', async () => {
    const sleep = vi.fn(async () => undefined)
    const connect = vi.fn(async () => 'connection')

    const result = await connectWithRetry(connect, retryOptions(sleep))

    expect(result).toEqual('connection')
    expect(connect).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a retryable failure then succeeds, backing off each time', async () => {
    const sleep = vi.fn(async () => undefined)
    const connect = vi
      .fn()
      .mockRejectedValueOnce(tooMany())
      .mockRejectedValueOnce(tooMany())
      .mockResolvedValueOnce('connection')

    const result = await connectWithRetry(connect, retryOptions(sleep))

    expect(result).toEqual('connection')
    expect(connect).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[1], [2]])
  })

  it('propagates a non-retryable error immediately', async () => {
    const sleep = vi.fn(async () => undefined)
    const connect = vi
      .fn()
      .mockRejectedValue(new Error('password authentication failed'))

    await expect(
      connectWithRetry(connect, retryOptions(sleep))
    ).rejects.toThrow('password authentication failed')
    expect(connect).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws the exhausted error after using every retry', async () => {
    const sleep = vi.fn(async () => undefined)
    const connect = vi.fn().mockRejectedValue(tooMany())

    await expect(
      connectWithRetry(connect, retryOptions(sleep))
    ).rejects.toThrow('out of slots')
    expect(connect).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })
})

describe('PostgresAdapter cancellation', () => {
  // Silenced for the whole suite rather than the one test that asserts on it:
  // the failing-cancel path logs, so a test merely exercising it would print a
  // real outage line during a green run.
  let logged: MockInstance<typeof console.log>

  beforeEach(() => {
    vi.clearAllMocks()

    clientState.processId = undefined
    cursorState.closeCount = 0
    cursorState.createdWith.length = 0
    cursorState.fixtures.length = 0
    cursorState.readRequests.length = 0

    logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    mockQuery.mockImplementation((input: unknown) => input)
  })

  afterEach(() => {
    logged.mockRestore()
  })

  it('fails fast when canceled before connecting', async () => {
    const adapter = new PostgresAdapter(connectionInfo)

    await adapter.cancel()

    await expect(adapter.runQuery('SELECT 1')).rejects.toEqual(
      new QueryCanceledError()
    )
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('aborts a connect in flight and reports the query as canceled', async () => {
    let rejectConnect: ((error: Error) => void) | undefined

    mockConnect.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectConnect = reject
        })
    )

    const adapter = new PostgresAdapter(connectionInfo)
    const runPromise = adapter.runQuery('SELECT pg_sleep(60)')

    // Give the connect a beat to start so cancel sees the in-flight client.
    await vi.waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    await adapter.cancel()

    // Ending the client makes the pending connect reject.
    expect(mockEnd).toHaveBeenCalled()

    rejectConnect?.(new Error('Connection terminated'))

    await expect(runPromise).rejects.toEqual(new QueryCanceledError())
  })

  // pg_cancel_backend makes the in-flight read reject with the server's own
  // prose, and Postgres translates that prose through lc_messages. Only the
  // SQLSTATE reads the same on every server, so only the SQLSTATE can be read.
  it('reports a canceled statement as canceled on a German server', async () => {
    const adapter = new PostgresAdapter(connectionInfo)

    let cancelPromise: Promise<void> | undefined

    cursorState.fixtures.push({
      error: driverError(
        'Anweisung wegen Benutzeranforderung abgebrochen',
        '57014'
      ),
      fields: [],
      // The user hits Cancel with the statement running, and the read then
      // rejects with the server's acknowledgement.
      onRead: () => {
        cancelPromise ??= adapter.cancel()
      },
      rows: []
    })

    await expect(adapter.runQuery('SELECT pg_sleep(60)')).rejects.toEqual(
      new QueryCanceledError()
    )
    expect(cursorState.closeCount).toEqual(1)
    expect(mockEnd).toHaveBeenCalled()

    await cancelPromise
  })

  // 57014 says a statement stopped early, not who stopped it. A server-side
  // statement_timeout raises it too — ALTER ROLE ... SET, postgresql.conf, and
  // the default on most managed Postgres — and so does a standby recovery
  // conflict. Nobody asked for those, so the server's own message is all the
  // user has to go on and it has to survive.
  it('propagates a statement timeout rather than claiming the user canceled', async () => {
    const timeout = driverError(
      'canceling statement due to statement timeout',
      '57014'
    )

    cursorState.fixtures.push({ error: timeout, fields: [], rows: [] })

    const adapter = new PostgresAdapter(connectionInfo)

    await expect(adapter.runQuery('SELECT id FROM big_table')).rejects.toEqual(
      timeout
    )
  })

  // The mixed-case retry fetches the catalog on the same connection the query
  // runs on, and on a heavily multi-schema database those two scans are slow —
  // which makes this exactly the moment a user gives up and hits Cancel.
  it('reports a cancel that lands while the schema is being fetched', async () => {
    const adapter = new PostgresAdapter(connectionInfo)

    let cancelPromise: Promise<void> | undefined

    cursorState.fixtures.push({
      error: new Error('relation "users" does not exist'),
      fields: [],
      rows: []
    })

    mockQuery.mockImplementation((input: unknown) => {
      if (typeof input !== 'string') {
        return input
      }

      cancelPromise ??= adapter.cancel()

      return Promise.reject(
        driverError('Anweisung wegen Benutzeranforderung abgebrochen', '57014')
      )
    })

    await expect(adapter.runQuery('SELECT * FROM users')).rejects.toEqual(
      new QueryCanceledError()
    )

    await cancelPromise
  })

  it('does nothing when no query is running', async () => {
    const adapter = new PostgresAdapter(connectionInfo)

    await adapter.cancel()

    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('asks the server to cancel the running backend', async () => {
    clientState.processId = 4242

    const adapter = new PostgresAdapter(connectionInfo)

    let cancelPromise: Promise<void> | undefined

    cursorState.fixtures.push({
      error: driverError('canceling statement due to user request', '57014'),
      fields: [],
      onRead: () => {
        cancelPromise ??= adapter.cancel()
      },
      rows: []
    })

    await expect(adapter.runQuery('SELECT pg_sleep(60)')).rejects.toEqual(
      new QueryCanceledError()
    )

    await cancelPromise

    // The connection running the statement is busy, so the request has to come
    // over a second one — and it has to name the backend, or the server is
    // asked to cancel nothing at all.
    expect({
      clientsConstructed: vi.mocked(Client).mock.calls.length,
      statements: mockQuery.mock.calls.filter(
        ([statement]) => typeof statement === 'string'
      )
    }).toEqual({
      clientsConstructed: 2,
      statements: [['SELECT pg_cancel_backend($1)', [4242]]]
    })
  })

  it('resolves even when the cancel connection cannot be opened', async () => {
    clientState.processId = 4242

    // The query's own client connects; the throwaway one the cancel opens does
    // not.
    mockConnect.mockResolvedValueOnce(undefined)
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'))

    const adapter = new PostgresAdapter(connectionInfo)

    let cancelPromise: Promise<void> | undefined

    cursorState.fixtures.push({
      error: driverError('canceling statement due to user request', '57014'),
      fields: [],
      onRead: () => {
        cancelPromise ??= adapter.cancel()
      },
      rows: []
    })

    await expect(adapter.runQuery('SELECT pg_sleep(60)')).rejects.toEqual(
      new QueryCanceledError()
    )

    // A cancel that cannot reach the server is reported, not thrown: the route
    // answers, the query keeps running, and the user can ask again.
    await expect(cancelPromise).resolves.toBeUndefined()
    expect(logged.mock.calls.map(String).join(' ')).toContain(
      'Could not cancel the running query'
    )
  })

  // The connect resolving and the statement starting are not the same instant.
  // The adapter used to let go of the connecting client and only take hold of
  // the running one several turns later, and a cancel arriving in between found
  // nothing to act on — so the query the user had just canceled ran to
  // completion and was recorded as a success.
  it('reports a cancel that lands between connecting and executing', async () => {
    clientState.processId = 4242

    let finishConnecting: (() => void) | undefined

    mockConnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishConnecting = () => resolve()
        })
    )

    cursorState.fixtures.push({
      fields: [{ name: 'id' }],
      rowCount: 1,
      rows: [{ id: 1 }]
    })

    const adapter = new PostgresAdapter(connectionInfo)
    const runPromise = adapter.runQuery('SELECT id FROM users')

    await vi.waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    finishConnecting?.()

    // One turn of the microtask queue: the earliest moment anything outside the
    // adapter can look, and still long before `runQuery` resumes to send the
    // statement. The connection is already owned as the running one by then —
    // the request below is what proves it, since a handover left for later would
    // have this cancel tearing down a connecting socket instead.
    //
    // Measured: this test passes at one, two, and three turns and fails at zero
    // and at four. The count is load-bearing, so a refactor that adds or removes
    // an async frame in `acquireConnection` will fail this — loudly, but looking
    // like a product bug. Both edges are real: at zero the cancel takes the
    // `connecting` branch and never asks the server, at four the statement has
    // already gone out.
    await Promise.resolve()

    const cancelPromise = adapter.cancel()

    await expect(runPromise).rejects.toEqual(new QueryCanceledError())

    await cancelPromise

    expect({
      requested: mockQuery.mock.calls.filter(
        ([statement]) => typeof statement === 'string'
      ),
      statements: cursorState.createdWith
    }).toEqual({
      requested: [['SELECT pg_cancel_backend($1)', [4242]]],
      statements: []
    })
  })

  // The other side of the same instant: the user gives up while the connect is
  // still in flight and the server answers anyway. Aborting the socket comes too
  // late to matter, so all that is left is the record that they asked — and a
  // handover that overwrites it hands the query a connection to run on.
  it('reports a cancel the connection beat by a moment', async () => {
    let finishConnecting: (() => void) | undefined

    mockConnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishConnecting = () => resolve()
        })
    )

    cursorState.fixtures.push({
      fields: [{ name: 'id' }],
      rowCount: 1,
      rows: [{ id: 1 }]
    })

    const adapter = new PostgresAdapter(connectionInfo)
    const runPromise = adapter.runQuery('SELECT id FROM users')

    await vi.waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })

    const cancelPromise = adapter.cancel()

    finishConnecting?.()

    await expect(runPromise).rejects.toEqual(new QueryCanceledError())

    await cancelPromise

    // No request over a second connection is the half that says which branch
    // ran: this cancel tore down a socket that was still connecting, rather
    // than naming a backend that was never reached.
    expect({
      requested: mockQuery.mock.calls.filter(
        ([statement]) => typeof statement === 'string'
      ),
      statements: cursorState.createdWith
    }).toEqual({ requested: [], statements: [] })
  })

  // The backoff between two connect attempts is the longest stretch in which
  // the adapter holds nothing at all, so a cancel landing there has only the
  // record of itself to leave behind — and the top of the next attempt is the
  // one place that record can be read. Without it, giving up on a server that
  // is refusing connections still waits out the whole retry schedule.
  it('answers a cancel that lands during the backoff', async () => {
    mockConnect.mockRejectedValueOnce(
      new Error('sorry, too many clients already')
    )

    const adapter = new PostgresAdapter(connectionInfo)
    const runPromise = adapter.runQuery('SELECT id FROM users')

    await vi.waitFor(() => {
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })

    await adapter.cancel()

    await expect(runPromise).rejects.toEqual(new QueryCanceledError())

    expect({
      connects: mockConnect.mock.calls.length,
      statements: cursorState.createdWith
    }).toEqual({ connects: 1, statements: [] })
  })
})

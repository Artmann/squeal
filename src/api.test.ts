import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'

import type { QueryResult, SchemaInfo } from '@/databases/adapter'

// Create a test database before mocking.
let testDatabase: LibSQLDatabase

async function createTestDatabase(): Promise<LibSQLDatabase> {
  // Use file::memory: for in-memory SQLite with libsql.
  // Each call creates a new isolated in-memory database.
  const database = drizzle(':memory:')

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      chatId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      toolInvocations TEXT,
      FOREIGN KEY (chatId) REFERENCES chats(id) ON DELETE CASCADE
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS databases (
      id TEXT PRIMARY KEY NOT NULL,
      connectionInfo TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      deletedAt INTEGER,
      lastUsedAt INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL,
      databaseId TEXT NOT NULL,
      error TEXT,
      finishedAt INTEGER,
      queriedAt INTEGER NOT NULL,
      result TEXT,
      worksheetId TEXT NOT NULL
    )
  `)

  await database.run(sql`
    CREATE TABLE IF NOT EXISTS worksheets (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      databaseId TEXT,
      deletedAt INTEGER,
      name TEXT NOT NULL DEFAULT 'Untitled Worksheet'
    )
  `)

  return database
}

// Mock the database module to use our test database.
vi.mock('@/database', () => ({
  get database() {
    return testDatabase
  }
}))

// Mock adapter configuration that can be changed per test.
let mockAdapterConfig = {
  getSchema: async (): Promise<SchemaInfo> => ({
    databaseName: 'test_db',
    tables: []
  }),
  runQuery: async (): Promise<QueryResult> => ({
    fields: [{ name: 'id' }, { name: 'name' }],
    rowCount: 2,
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]
  }),
  testConnection: async (): Promise<void> => {
    // Success by default.
  }
}

// Mock the database adapters.
vi.mock('@/databases/postgres-adapter', () => ({
  PostgresAdapter: class {
    async getSchema() {
      return mockAdapterConfig.getSchema()
    }
    async runQuery(query: string) {
      return mockAdapterConfig.runQuery()
    }
    async testConnection() {
      return mockAdapterConfig.testConnection()
    }
  }
}))

vi.mock('@/databases/mysql-adapter', () => ({
  MysqlAdapter: class {
    async getSchema() {
      return mockAdapterConfig.getSchema()
    }
    async runQuery(query: string) {
      return mockAdapterConfig.runQuery()
    }
    async testConnection() {
      return mockAdapterConfig.testConnection()
    }
  }
}))

// Import app after mocks are set up.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'

import { connectionTestRouter, databaseRouter } from './databases'
import { errorHandler } from './main/middleware/error-handler'
import { queryRouter } from './main/queries'
import { worksheetRouter } from './main/worksheets'

function createApp() {
  const app = new Hono()

  app.use('*', prettyJSON())
  app.use('*', cors())

  app.get('/health', (context) => {
    return context.json({ status: 'ok' })
  })

  app.route('/connection-tests', connectionTestRouter)
  app.route('/databases', databaseRouter)
  app.route('/queries', queryRouter)
  app.route('/worksheets', worksheetRouter)

  app.onError(errorHandler)

  return app
}

describe('API', () => {
  let app: Hono

  beforeEach(async () => {
    // Create a fresh database for each test.
    testDatabase = await createTestDatabase()
    app = createApp()

    // Reset mock adapter config to defaults.
    mockAdapterConfig = {
      getSchema: async () => ({
        databaseName: 'test_db',
        tables: []
      }),
      runQuery: async () => ({
        fields: [{ name: 'id' }, { name: 'name' }],
        rowCount: 2,
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' }
        ]
      }),
      testConnection: async () => {}
    }
  })

  describe('GET /health', () => {
    it('should return status ok', async () => {
      const response = await app.request('/health')

      expect(response.status).toEqual(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    })
  })

  describe('POST /connection-tests', () => {
    it('should return success when connection succeeds', async () => {
      const response = await app.request('/connection-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'postgres',
          connectionInfo: {
            host: 'localhost',
            port: 5432,
            database: 'testdb',
            username: 'user',
            password: 'pass'
          }
        })
      })

      expect(response.status).toEqual(200)
      expect(await response.json()).toEqual({ success: true })
    })

    it('should return failure when connection fails', async () => {
      mockAdapterConfig.testConnection = async () => {
        throw new Error('Connection refused')
      }

      const response = await app.request('/connection-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'postgres',
          connectionInfo: {
            host: 'localhost',
            port: 5432,
            database: 'testdb',
            username: 'user',
            password: 'pass'
          }
        })
      })

      expect(response.status).toEqual(500)
      expect(await response.json()).toEqual({
        message: 'Connection refused',
        success: false
      })
    })

    it('should validate request body', async () => {
      const response = await app.request('/connection-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'invalid_type'
        })
      })

      expect(response.status).toEqual(400)
    })
  })

  describe('POST /databases', () => {
    it('should create a database and return it', async () => {
      const response = await app.request('/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Production DB',
          type: 'postgres',
          connectionInfo: {
            host: 'localhost',
            port: 5432,
            database: 'production',
            username: 'admin',
            password: 'secret'
          }
        })
      })

      expect(response.status).toEqual(201)

      const data = await response.json()

      expect(data.database).toMatchObject({
        name: 'Production DB',
        type: 'postgres',
        connectionInfo: {
          host: 'localhost',
          port: 5432,
          database: 'production',
          username: 'admin',
          password: 'secret'
        }
      })
      expect(data.database.id).toBeDefined()
      expect(data.database.createdAt).toBeDefined()
    })

    it('should persist the database to storage', async () => {
      await app.request('/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test DB',
          type: 'mysql',
          connectionInfo: {
            host: 'localhost',
            port: 3306,
            database: 'test',
            username: 'root',
            password: 'password'
          }
        })
      })

      // Verify the database was persisted by reading directly from the test database.
      const rows = await testDatabase.all(
        sql`SELECT * FROM databases WHERE name = 'Test DB'`
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        name: 'Test DB',
        type: 'mysql'
      })
    })

    it('should link the first database to worksheets without a database', async () => {
      // First, create a worksheet without a database.
      const worksheetId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO worksheets (id, content, createdAt, name)
        VALUES (${worksheetId}, '', ${Date.now()}, 'My Worksheet')
      `)

      const response = await app.request('/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'First Database',
          type: 'postgres',
          connectionInfo: {
            host: 'localhost',
            port: 5432,
            database: 'mydb',
            username: 'user',
            password: 'pass'
          }
        })
      })

      expect(response.status).toEqual(201)

      const data = await response.json()

      expect(data.updatedWorksheet).toBeDefined()
      expect(data.updatedWorksheet.id).toEqual(worksheetId)
      expect(data.updatedWorksheet.databaseId).toEqual(data.database.id)
    })

    it('should validate required fields', async () => {
      const response = await app.request('/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing Fields'
        })
      })

      expect(response.status).toEqual(400)
    })
  })

  describe('GET /databases/:id/schema', () => {
    it('should return the schema for a database', async () => {
      // First, create a database.
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt)
        VALUES (
          ${databaseId},
          'Schema Test DB',
          'postgres',
          ${JSON.stringify({
            host: 'localhost',
            port: 5432,
            database: 'schemadb',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()}
        )
      `)

      mockAdapterConfig.getSchema = async () => ({
        databaseName: 'schemadb',
        tables: [
          {
            tableName: 'users',
            tableSchema: 'public',
            columns: [
              {
                columnName: 'id',
                dataType: 'integer',
                defaultValue: null,
                isNullable: false,
                isPrimaryKey: true,
                ordinalPosition: 1
              },
              {
                columnName: 'email',
                dataType: 'varchar',
                defaultValue: null,
                isNullable: false,
                isPrimaryKey: false,
                ordinalPosition: 2
              }
            ],
            foreignKeys: []
          }
        ]
      })

      const response = await app.request(`/databases/${databaseId}/schema`)

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.schema.databaseName).toEqual('schemadb')
      expect(data.schema.tables).toHaveLength(1)
      expect(data.schema.tables[0].tableName).toEqual('users')
      expect(data.schema.tables[0].columns).toHaveLength(2)
    })

    it('should return 404 for non-existent database', async () => {
      const response = await app.request(
        `/databases/${crypto.randomUUID()}/schema`
      )

      expect(response.status).toEqual(404)
    })

    it('should not return soft-deleted databases', async () => {
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt, deletedAt)
        VALUES (
          ${databaseId},
          'Deleted DB',
          'postgres',
          ${JSON.stringify({
            host: 'localhost',
            port: 5432,
            database: 'deleted',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()},
          ${Date.now()}
        )
      `)

      const response = await app.request(`/databases/${databaseId}/schema`)

      expect(response.status).toEqual(404)
    })
  })

  describe('PATCH /databases/:id', () => {
    it('should update a database', async () => {
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt)
        VALUES (
          ${databaseId},
          'Original Name',
          'postgres',
          ${JSON.stringify({
            host: 'localhost',
            port: 5432,
            database: 'original',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()}
        )
      `)

      const response = await app.request(`/databases/${databaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Name',
          type: 'postgres',
          connectionInfo: {
            host: 'newhost.example.com',
            port: 5433,
            database: 'updated',
            username: 'newuser',
            password: 'newpass'
          }
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.database).toMatchObject({
        id: databaseId,
        name: 'Updated Name',
        type: 'postgres',
        connectionInfo: {
          host: 'newhost.example.com',
          port: 5433,
          database: 'updated',
          username: 'newuser',
          password: 'newpass'
        }
      })
    })

    it('should persist updates to storage', async () => {
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt)
        VALUES (
          ${databaseId},
          'Before Update',
          'mysql',
          ${JSON.stringify({
            host: 'localhost',
            port: 3306,
            database: 'before',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()}
        )
      `)

      await app.request(`/databases/${databaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'After Update',
          type: 'postgres',
          connectionInfo: {
            host: 'updated.example.com',
            port: 5432,
            database: 'after',
            username: 'newuser',
            password: 'newpass'
          }
        })
      })

      const rows = await testDatabase.all(
        sql`SELECT * FROM databases WHERE id = ${databaseId}`
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        name: 'After Update',
        type: 'postgres'
      })
    })
  })

  describe('GET /queries', () => {
    it('should return an empty list when no queries exist', async () => {
      const response = await app.request('/queries')

      expect(response.status).toEqual(200)
      expect(await response.json()).toEqual({ queries: [] })
    })

    it('should return all queries', async () => {
      const databaseId = crypto.randomUUID()
      const worksheetId = crypto.randomUUID()
      const queryId1 = crypto.randomUUID()
      const queryId2 = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO queries (id, content, databaseId, worksheetId, queriedAt)
        VALUES
          (${queryId1}, 'SELECT * FROM users', ${databaseId}, ${worksheetId}, ${Date.now()}),
          (${queryId2}, 'SELECT * FROM orders', ${databaseId}, ${worksheetId}, ${Date.now()})
      `)

      const response = await app.request('/queries')

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.queries).toHaveLength(2)
    })
  })

  describe('GET /queries/:id', () => {
    it('should return a specific query', async () => {
      const databaseId = crypto.randomUUID()
      const worksheetId = crypto.randomUUID()
      const queryId = crypto.randomUUID()
      const queriedAt = Date.now()

      await testDatabase.run(sql`
        INSERT INTO queries (id, content, databaseId, worksheetId, queriedAt, result, finishedAt)
        VALUES (
          ${queryId},
          'SELECT * FROM products',
          ${databaseId},
          ${worksheetId},
          ${queriedAt},
          ${JSON.stringify({ fields: [{ name: 'id' }], rowCount: 1, rows: [{ id: 1 }] })},
          ${queriedAt + 100}
        )
      `)

      const response = await app.request(`/queries/${queryId}`)

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.query).toMatchObject({
        id: queryId,
        content: 'SELECT * FROM products',
        databaseId,
        worksheetId,
        result: { fields: [{ name: 'id' }], rowCount: 1, rows: [{ id: 1 }] }
      })
    })

    it('should return 404 for non-existent query', async () => {
      const response = await app.request(`/queries/${crypto.randomUUID()}`)

      expect(response.status).toEqual(404)
    })

    it('should return query with error', async () => {
      const databaseId = crypto.randomUUID()
      const worksheetId = crypto.randomUUID()
      const queryId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO queries (id, content, databaseId, worksheetId, queriedAt, error, finishedAt)
        VALUES (
          ${queryId},
          'SELECT * FROM nonexistent',
          ${databaseId},
          ${worksheetId},
          ${Date.now()},
          'relation "nonexistent" does not exist',
          ${Date.now()}
        )
      `)

      const response = await app.request(`/queries/${queryId}`)

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.query.error).toEqual('relation "nonexistent" does not exist')
      expect(data.query.result).toBeNull()
    })
  })

  describe('POST /queries', () => {
    it('should create a query and return it', async () => {
      // First, create a database so the query has something to run against.
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt)
        VALUES (
          ${databaseId},
          'Query Test DB',
          'postgres',
          ${JSON.stringify({
            host: 'localhost',
            port: 5432,
            database: 'querydb',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()}
        )
      `)

      const worksheetId = crypto.randomUUID()
      const queryId = crypto.randomUUID()
      const queriedAt = Date.now()

      const response = await app.request('/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: queryId,
          content: 'SELECT * FROM users',
          databaseId,
          worksheetId,
          queriedAt
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.query).toMatchObject({
        id: queryId,
        content: 'SELECT * FROM users',
        databaseId,
        worksheetId
      })
    })

    it('should persist the query to storage', async () => {
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt)
        VALUES (
          ${databaseId},
          'Persist Test DB',
          'postgres',
          ${JSON.stringify({
            host: 'localhost',
            port: 5432,
            database: 'persistdb',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()}
        )
      `)

      const worksheetId = crypto.randomUUID()
      const queryId = crypto.randomUUID()

      await app.request('/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: queryId,
          content: 'SELECT 1',
          databaseId,
          worksheetId,
          queriedAt: Date.now()
        })
      })

      const rows = await testDatabase.all(
        sql`SELECT * FROM queries WHERE id = ${queryId}`
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: queryId,
        content: 'SELECT 1',
        databaseId,
        worksheetId
      })
    })

    it('should auto-select first available database when none specified', async () => {
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO databases (id, name, type, connectionInfo, createdAt)
        VALUES (
          ${databaseId},
          'Auto Select DB',
          'postgres',
          ${JSON.stringify({
            host: 'localhost',
            port: 5432,
            database: 'autodb',
            username: 'user',
            password: 'pass'
          })},
          ${Date.now()}
        )
      `)

      const worksheetId = crypto.randomUUID()
      const queryId = crypto.randomUUID()

      const response = await app.request('/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: queryId,
          content: 'SELECT 1',
          worksheetId,
          queriedAt: Date.now()
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.query.databaseId).toEqual(databaseId)
    })

    it('should fail when no database is available and none specified', async () => {
      const worksheetId = crypto.randomUUID()
      const queryId = crypto.randomUUID()

      const response = await app.request('/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: queryId,
          content: 'SELECT 1',
          worksheetId,
          queriedAt: Date.now()
        })
      })

      expect(response.status).toEqual(500)
    })

    it('should validate required fields', async () => {
      const response = await app.request('/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'SELECT 1'
        })
      })

      expect(response.status).toEqual(400)
    })
  })

  describe('PATCH /worksheets/:id', () => {
    it('should update worksheet name', async () => {
      const worksheetId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO worksheets (id, content, createdAt, name)
        VALUES (${worksheetId}, '', ${Date.now()}, 'Original Name')
      `)

      const response = await app.request(`/worksheets/${worksheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Worksheet Name'
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.worksheet).toMatchObject({
        id: worksheetId,
        name: 'Updated Worksheet Name'
      })
    })

    it('should update worksheet content', async () => {
      const worksheetId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO worksheets (id, content, createdAt, name)
        VALUES (${worksheetId}, '', ${Date.now()}, 'Test Worksheet')
      `)

      const response = await app.request(`/worksheets/${worksheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'SELECT * FROM users;\nSELECT * FROM orders;'
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.worksheet.content).toEqual(
        'SELECT * FROM users;\nSELECT * FROM orders;'
      )
    })

    it('should update worksheet databaseId', async () => {
      const worksheetId = crypto.randomUUID()
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO worksheets (id, content, createdAt, name)
        VALUES (${worksheetId}, '', ${Date.now()}, 'Test Worksheet')
      `)

      const response = await app.request(`/worksheets/${worksheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.worksheet.databaseId).toEqual(databaseId)
    })

    it('should allow setting databaseId to null', async () => {
      const worksheetId = crypto.randomUUID()
      const databaseId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO worksheets (id, content, createdAt, name, databaseId)
        VALUES (${worksheetId}, '', ${Date.now()}, 'Test Worksheet', ${databaseId})
      `)

      const response = await app.request(`/worksheets/${worksheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId: null
        })
      })

      expect(response.status).toEqual(200)

      const data = await response.json()

      expect(data.worksheet.databaseId).toBeNull()
    })

    it('should persist updates to storage', async () => {
      const worksheetId = crypto.randomUUID()

      await testDatabase.run(sql`
        INSERT INTO worksheets (id, content, createdAt, name)
        VALUES (${worksheetId}, '', ${Date.now()}, 'Before Update')
      `)

      await app.request(`/worksheets/${worksheetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'After Update',
          content: 'SELECT 1;'
        })
      })

      const rows = await testDatabase.all(
        sql`SELECT * FROM worksheets WHERE id = ${worksheetId}`
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        name: 'After Update',
        content: 'SELECT 1;'
      })
    })
  })
})

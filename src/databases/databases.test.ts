import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'

import {
  getTestDatabase,
  mockAdapterConfig,
  resetTestDatabase,
  setupApiMocks,
  testEncryptionPrefix
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'

describe('POST /connection-tests', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

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

    expect(response.status).toEqual(200)
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
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

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
        username: 'admin'
      }
    })
    expect(data.database.connectionInfo.password).toBeUndefined()
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

    const database = getTestDatabase()
    const rows = await database.all(
      sql`SELECT * FROM databases WHERE name = 'Test DB'`
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Test DB',
      type: 'mysql'
    })

    const storedConnectionInfo = (rows[0] as { connectionInfo: string })
      .connectionInfo

    expect(storedConnectionInfo.startsWith(testEncryptionPrefix)).toEqual(true)
    expect(
      JSON.parse(storedConnectionInfo.slice(testEncryptionPrefix.length))
    ).toEqual({
      host: 'localhost',
      port: 3306,
      database: 'test',
      username: 'root',
      password: 'password'
    })
  })

  it('should link the first database to worksheets without a database', async () => {
    const database = getTestDatabase()
    const worksheetId = crypto.randomUUID()

    await database.run(sql`
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
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should return the schema for a database', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should update a database', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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
        username: 'newuser'
      }
    })
    expect(data.database.connectionInfo.password).toBeUndefined()
  })

  it('should persist updates to storage', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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

    const rows = await database.all(
      sql`SELECT * FROM databases WHERE id = ${databaseId}`
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'After Update',
      type: 'postgres'
    })
  })

  it('should keep the stored password when the update omits it', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
      INSERT INTO databases (id, name, type, connectionInfo, createdAt)
      VALUES (
        ${databaseId},
        'Keep Password',
        'postgres',
        ${JSON.stringify({
          host: 'localhost',
          port: 5432,
          database: 'original',
          username: 'user',
          password: 'stored-secret'
        })},
        ${Date.now()}
      )
    `)

    const response = await app.request(`/databases/${databaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Keep Password',
        type: 'postgres',
        connectionInfo: {
          host: 'newhost.example.com',
          port: 5432,
          database: 'original',
          username: 'user'
        }
      })
    })

    expect(response.status).toEqual(200)

    const rows = await database.all<{ connectionInfo: string }>(
      sql`SELECT connectionInfo FROM databases WHERE id = ${databaseId}`
    )
    const storedConnectionInfo = JSON.parse(
      rows[0].connectionInfo.slice(testEncryptionPrefix.length)
    )

    expect(storedConnectionInfo).toEqual({
      database: 'original',
      host: 'newhost.example.com',
      password: 'stored-secret',
      port: 5432,
      username: 'user'
    })
  })
})

describe('POST /connection-tests with a stored password', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should merge the stored password when the request omits it', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
      INSERT INTO databases (id, name, type, connectionInfo, createdAt)
      VALUES (
        ${databaseId},
        'Existing DB',
        'postgres',
        ${JSON.stringify({
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          username: 'user',
          password: 'stored-secret'
        })},
        ${Date.now()}
      )
    `)

    const response = await app.request('/connection-tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        databaseId,
        type: 'postgres',
        connectionInfo: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          username: 'user'
        }
      })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mockAdapterConfig.lastConnectionInfo).toEqual({
      database: 'testdb',
      host: 'localhost',
      password: 'stored-secret',
      port: 5432,
      username: 'user'
    })
  })

  it('should fail when the password is omitted without a databaseId', async () => {
    const response = await app.request('/connection-tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'postgres',
        connectionInfo: {
          host: 'localhost',
          port: 5432,
          database: 'testdb',
          username: 'user'
        }
      })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      message: 'Password is required.',
      success: false
    })
  })
})

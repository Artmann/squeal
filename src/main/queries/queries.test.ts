import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'

import {
  authorizeApp,
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks,
  testApiToken
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'

describe('GET /queries', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = authorizeApp(createApp({ enableLogging: false, token: testApiToken }))
  })

  it('should return an empty list when no queries exist', async () => {
    const response = await app.request('/queries')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ queries: [] })
  })

  it('should return all queries', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()
    const worksheetId = crypto.randomUUID()
    const queryId1 = crypto.randomUUID()
    const queryId2 = crypto.randomUUID()

    await database.run(sql`
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
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = authorizeApp(createApp({ enableLogging: false, token: testApiToken }))
  })

  it('should return a specific query', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()
    const worksheetId = crypto.randomUUID()
    const queryId = crypto.randomUUID()
    const queriedAt = Date.now()

    await database.run(sql`
      INSERT INTO queries (id, content, databaseId, worksheetId, queriedAt, result, finishedAt)
      VALUES (
        ${queryId},
        'SELECT * FROM products',
        ${databaseId},
        ${worksheetId},
        ${queriedAt},
        ${JSON.stringify({ fields: [{ name: 'id' }], rowCount: 1, rows: [{ id: 1 }], truncated: false })},
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
      result: {
        fields: [{ name: 'id' }],
        rowCount: 1,
        rows: [{ id: 1 }],
        truncated: false
      },
      truncated: false
    })
  })

  it('should return 404 for non-existent query', async () => {
    const response = await app.request(`/queries/${crypto.randomUUID()}`)

    expect(response.status).toEqual(404)
  })

  it('should return query with error', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()
    const worksheetId = crypto.randomUUID()
    const queryId = crypto.randomUUID()

    await database.run(sql`
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
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = authorizeApp(createApp({ enableLogging: false, token: testApiToken }))
  })

  it('should create a query and return it', async () => {
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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

    const rows = await database.all(
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
    const database = getTestDatabase()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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

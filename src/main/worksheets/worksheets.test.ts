import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'

describe('PATCH /worksheets/:id', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should update worksheet name', async () => {
    const database = getTestDatabase()
    const worksheetId = crypto.randomUUID()

    await database.run(sql`
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
    const database = getTestDatabase()
    const worksheetId = crypto.randomUUID()

    await database.run(sql`
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
    const database = getTestDatabase()
    const worksheetId = crypto.randomUUID()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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
    const database = getTestDatabase()
    const worksheetId = crypto.randomUUID()
    const databaseId = crypto.randomUUID()

    await database.run(sql`
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
    const database = getTestDatabase()
    const worksheetId = crypto.randomUUID()

    await database.run(sql`
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

    const rows = await database.all(
      sql`SELECT * FROM worksheets WHERE id = ${worksheetId}`
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'After Update',
      content: 'SELECT 1;'
    })
  })
})

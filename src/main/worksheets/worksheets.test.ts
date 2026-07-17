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

describe('POST /worksheets', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should create a worksheet with the given name', async () => {
    const response = await app.request('/worksheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My New Worksheet'
      })
    })

    expect(response.status).toEqual(201)

    const data = await response.json()

    expect(data.worksheet).toMatchObject({
      name: 'My New Worksheet',
      content: '',
      databaseId: null
    })
    expect(data.worksheet.id).toBeDefined()
    expect(data.worksheet.createdAt).toBeDefined()
  })

  it('should persist the worksheet to storage', async () => {
    const database = getTestDatabase()

    const response = await app.request('/worksheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Persisted Worksheet'
      })
    })

    const data = await response.json()

    const rows = await database.all(
      sql`SELECT * FROM worksheets WHERE id = ${data.worksheet.id}`
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Persisted Worksheet'
    })
  })

  it('should return 400 when name is missing', async () => {
    const response = await app.request('/worksheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    expect(response.status).toEqual(400)
  })
})

async function insertWorksheet(options: {
  createdAt?: number
  deletedAt?: number
  name: string
  sortOrder?: number
}): Promise<string> {
  const database = getTestDatabase()
  const worksheetId = crypto.randomUUID()

  await database.run(sql`
    INSERT INTO worksheets (id, content, createdAt, deletedAt, name, sortOrder)
    VALUES (
      ${worksheetId},
      '',
      ${options.createdAt ?? Date.now()},
      ${options.deletedAt ?? null},
      ${options.name},
      ${options.sortOrder ?? null}
    )
  `)

  return worksheetId
}

describe('GET /worksheets', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should order worksheets by sortOrder', async () => {
    const firstId = await insertWorksheet({
      createdAt: 1000,
      name: 'First',
      sortOrder: 1
    })
    const secondId = await insertWorksheet({
      createdAt: 2000,
      name: 'Second',
      sortOrder: 0
    })

    const response = await app.request('/worksheets')

    expect(response.status).toEqual(200)

    const data = await response.json()

    expect(
      data.worksheets.map((worksheet: { id: string; sortOrder: number }) => ({
        id: worksheet.id,
        sortOrder: worksheet.sortOrder
      }))
    ).toEqual([
      { id: secondId, sortOrder: 0 },
      { id: firstId, sortOrder: 1 }
    ])
  })

  it('should place worksheets without a sortOrder last, newest first', async () => {
    const orderedId = await insertWorksheet({
      createdAt: 1000,
      name: 'Ordered',
      sortOrder: 0
    })
    const olderId = await insertWorksheet({ createdAt: 2000, name: 'Older' })
    const newerId = await insertWorksheet({ createdAt: 3000, name: 'Newer' })

    const response = await app.request('/worksheets')

    expect(response.status).toEqual(200)

    const data = await response.json()

    expect(
      data.worksheets.map((worksheet: { id: string }) => worksheet.id)
    ).toEqual([orderedId, newerId, olderId])
  })
})

describe('PUT /worksheets/order', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should reorder worksheets and return the full list in the new order', async () => {
    const firstId = await insertWorksheet({ createdAt: 1000, name: 'First' })
    const secondId = await insertWorksheet({ createdAt: 2000, name: 'Second' })
    const thirdId = await insertWorksheet({ createdAt: 3000, name: 'Third' })

    const response = await app.request('/worksheets/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worksheetIds: [thirdId, firstId, secondId] })
    })

    expect(response.status).toEqual(200)

    const data = await response.json()

    expect(
      data.worksheets.map((worksheet: { id: string; sortOrder: number }) => ({
        id: worksheet.id,
        sortOrder: worksheet.sortOrder
      }))
    ).toEqual([
      { id: thirdId, sortOrder: 0 },
      { id: firstId, sortOrder: 1 },
      { id: secondId, sortOrder: 2 }
    ])
  })

  it('should persist the new order to storage', async () => {
    const firstId = await insertWorksheet({ createdAt: 1000, name: 'First' })
    const secondId = await insertWorksheet({ createdAt: 2000, name: 'Second' })

    await app.request('/worksheets/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worksheetIds: [secondId, firstId] })
    })

    const database = getTestDatabase()
    const rows = await database.all<{ id: string; sortOrder: number }>(
      sql`SELECT id, sortOrder FROM worksheets ORDER BY sortOrder`
    )

    expect(rows).toEqual([
      { id: secondId, sortOrder: 0 },
      { id: firstId, sortOrder: 1 }
    ])
  })

  it('should reject unknown worksheet ids', async () => {
    const knownId = await insertWorksheet({ name: 'Known' })

    const response = await app.request('/worksheets/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worksheetIds: [knownId, crypto.randomUUID()] })
    })

    expect(response.status).toEqual(400)
  })

  it('should reject soft-deleted worksheet ids', async () => {
    const activeId = await insertWorksheet({ name: 'Active' })
    const deletedId = await insertWorksheet({
      deletedAt: Date.now(),
      name: 'Deleted'
    })

    const response = await app.request('/worksheets/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worksheetIds: [activeId, deletedId] })
    })

    expect(response.status).toEqual(400)
  })

  it('should reject duplicate worksheet ids', async () => {
    const worksheetId = await insertWorksheet({ name: 'Duplicated' })

    const response = await app.request('/worksheets/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worksheetIds: [worksheetId, worksheetId] })
    })

    expect(response.status).toEqual(400)
  })

  it('should reject an empty list', async () => {
    const response = await app.request('/worksheets/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worksheetIds: [] })
    })

    expect(response.status).toEqual(400)
  })
})

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

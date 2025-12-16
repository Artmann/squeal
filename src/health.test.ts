import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { Hono } from 'hono'

import {
  getTestDatabase,
  mockAdapterConfig,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'

describe('GET /health', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false })
  })

  it('should return status ok', async () => {
    const response = await app.request('/health')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})

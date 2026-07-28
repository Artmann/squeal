import { beforeEach, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'

import {
  resetTestDatabase,
  setupApiMocks,
  testApiToken
} from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'

describe('GET /health', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()
    app = createApp({ enableLogging: false, token: testApiToken })
  })

  it('should return status ok without a token', async () => {
    const response = await app.request('/health')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      encryptionAvailable: true,
      status: 'ok'
    })
  })

  it('reports when secret encryption is unavailable', async () => {
    const unavailableApp = createApp({
      enableLogging: false,
      encryptionAvailable: false,
      token: testApiToken
    })

    const response = await unavailableApp.request('/health')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      encryptionAvailable: false,
      status: 'ok'
    })
  })
})

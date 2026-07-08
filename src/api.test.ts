import type { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetTestDatabase, setupApiMocks } from '@/test/api-test-helper'

setupApiMocks()

import { createApp } from '@/api'

describe('authentication', () => {
  let app: Hono

  beforeEach(async () => {
    await resetTestDatabase()

    app = createApp({ enableLogging: false, token: 'secret-token' })
  })

  it('rejects requests without an Authorization header', async () => {
    const response = await app.request('/databases')

    expect(response.status).toEqual(401)
    expect(await response.json()).toEqual({
      error: { message: 'Unauthorized', status: 401 }
    })
  })

  it('rejects requests with the wrong token', async () => {
    const response = await app.request('/databases', {
      headers: { Authorization: 'Bearer wrong-token' }
    })

    expect(response.status).toEqual(401)
    expect(await response.json()).toEqual({
      error: { message: 'Unauthorized', status: 401 }
    })
  })

  it('accepts requests with the correct token', async () => {
    const response = await app.request('/databases', {
      headers: { Authorization: 'Bearer secret-token' }
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ databases: [] })
  })

  it('allows health checks without a token', async () => {
    const response = await app.request('/health')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('does not require a token when none is configured', async () => {
    const openApp = createApp({ enableLogging: false })

    const response = await openApp.request('/databases')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ databases: [] })
  })
})

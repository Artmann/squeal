import { beforeEach, describe, expect, it, vi } from 'vitest'

let exporter: typeof import('./exporter')
let init: typeof import('./init')

beforeEach(async () => {
  vi.resetModules()

  exporter = await import('./exporter')
  init = await import('./init')
})

async function flushedSpans() {
  const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

  exporter.startExporter({ send })
  await exporter.flushSpans()
  exporter.stopExporter()

  return send.mock.calls.flatMap(
    (call) =>
      call[0] as {
        attributes: Record<string, unknown>
        name: string
        status: string
        statusMessage: string | null
      }[]
  )
}

describe('captureRendererError', () => {
  it('exports an error span with the source', async () => {
    init.captureRendererError(new Error('Boom'), 'error-boundary')

    const [span] = await flushedSpans()

    expect(span?.name).toEqual('renderer.error')
    expect(span?.status).toEqual('error')
    expect(span?.statusMessage).toEqual('Boom')
    expect(span?.attributes['error.source']).toEqual('error-boundary')
  })
})

describe('initTracing', () => {
  it('captures uncaught window errors', async () => {
    init.initTracing()

    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('Uncaught'),
        message: 'Uncaught'
      })
    )

    const spans = await flushedSpans()

    expect(spans).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          'error.source': 'window.onerror'
        }),
        name: 'renderer.error',
        status: 'error',
        statusMessage: 'Uncaught'
      })
    ])
  })

  it('captures unhandled promise rejections', async () => {
    init.initTracing()

    const event = new Event('unhandledrejection') as Event & {
      reason?: unknown
    }

    event.reason = new Error('Rejected')
    window.dispatchEvent(event)

    const spans = await flushedSpans()

    expect(spans).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          'error.source': 'unhandledrejection'
        }),
        name: 'renderer.error',
        statusMessage: 'Rejected'
      })
    ])
  })

  it('installs the listeners only once', async () => {
    init.initTracing()
    init.initTracing()

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('Once'), message: 'Once' })
    )

    expect((await flushedSpans()).length).toEqual(1)
  })
})

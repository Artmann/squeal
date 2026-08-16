import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ollamaBackend, ollamaBaseUrl } from './ollama-client'

const originalFetch = globalThis.fetch
const originalHost = process.env.OLLAMA_HOST

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status
  })
}

// The mock is typed rather than inferred so `mock.calls` keeps the URL and the
// request options — the tests read both back.
function stubFetch(respond: () => Response) {
  const fetchMock = vi.fn<
    (url: string, request?: RequestInit) => Promise<Response>
  >(async () => respond())

  globalThis.fetch = fetchMock as unknown as typeof fetch

  return fetchMock
}

beforeEach(() => {
  delete process.env.OLLAMA_HOST
})

afterEach(() => {
  globalThis.fetch = originalFetch

  if (originalHost === undefined) {
    delete process.env.OLLAMA_HOST
  } else {
    process.env.OLLAMA_HOST = originalHost
  }
})

describe('ollamaBaseUrl', () => {
  it('falls back to the loopback default', () => {
    expect(ollamaBaseUrl()).toEqual('http://127.0.0.1:11434')
  })

  it('adds a scheme to a bare host and port', () => {
    process.env.OLLAMA_HOST = '10.0.0.4:11434'

    expect(ollamaBaseUrl()).toEqual('http://10.0.0.4:11434')
  })

  it('keeps an explicit scheme and drops a trailing slash', () => {
    process.env.OLLAMA_HOST = 'https://ollama.internal:443/'

    expect(ollamaBaseUrl()).toEqual('https://ollama.internal:443')
  })

  it('ignores a blank value', () => {
    process.env.OLLAMA_HOST = '   '

    expect(ollamaBaseUrl()).toEqual('http://127.0.0.1:11434')
  })
})

describe('ollamaBackend.listModels', () => {
  it('asks Ollama for its tags and returns the model names', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        models: [{ name: 'qwen2.5-coder:1.5b' }, { name: 'llama3.2:3b' }]
      })
    )

    const models = await ollamaBackend.listModels()

    expect(models).toEqual(['qwen2.5-coder:1.5b', 'llama3.2:3b'])
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      'http://127.0.0.1:11434/api/tags'
    )
  })

  it('passes a signal that is already armed with a deadline', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ models: [] }))

    await ollamaBackend.listModels()

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined

    expect(request?.signal instanceof AbortSignal).toEqual(true)
  })

  it('aborts as soon as the caller does, without waiting for the deadline', async () => {
    const controller = new AbortController()

    globalThis.fetch = vi.fn(
      async (_input: unknown, request: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted.'))
          })
        })
    ) as unknown as typeof fetch

    const pending = ollamaBackend.listModels(controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow('The operation was aborted.')
  })

  it('rejects when Ollama answers with an error status', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'nope' }, 500)
    ) as unknown as typeof fetch

    await expect(ollamaBackend.listModels()).rejects.toThrow(
      'Ollama answered 500 for /api/tags.'
    )
  })

  it('rejects when the host is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    await expect(ollamaBackend.listModels()).rejects.toThrow('fetch failed')
  })

  it('rejects when the body has no models array', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ models: 'all of them' })
    ) as unknown as typeof fetch

    await expect(ollamaBackend.listModels()).rejects.toThrow(
      'Ollama returned a body without a `models` array.'
    )
  })

  it('skips entries that are not named models', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ models: [{ name: 'codegemma:2b' }, {}, 'llama'] })
    ) as unknown as typeof fetch

    expect(await ollamaBackend.listModels()).toEqual(['codegemma:2b'])
  })
})

describe('ollamaBackend.generate', () => {
  it('posts a non-streaming request with the completion options', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ done: true, response: 'title, release_year' })
    )

    const completion = await ollamaBackend.generate({
      model: 'qwen2.5-coder:1.5b',
      prompt: 'select '
    })

    expect(completion).toEqual('title, release_year')

    const [url, request] = fetchMock.mock.calls[0] ?? []

    expect(url).toEqual('http://127.0.0.1:11434/api/generate')
    expect(request?.method).toEqual('POST')
    expect(request?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(request?.body))).toEqual({
      model: 'qwen2.5-coder:1.5b',
      options: {
        num_predict: 128,
        stop: ['\n\n\n', '```'],
        temperature: 0.1
      },
      prompt: 'select ',
      stream: false
    })
  })

  it('rejects when Ollama answers with an error status', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'model not found' }, 404)
    ) as unknown as typeof fetch

    await expect(
      ollamaBackend.generate({ model: 'missing', prompt: 'select ' })
    ).rejects.toThrow('Ollama answered 404 for /api/generate.')
  })

  it('rejects when the body has no response string', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ done: true })
    ) as unknown as typeof fetch

    await expect(
      ollamaBackend.generate({ model: 'qwen2.5-coder:1.5b', prompt: 'select ' })
    ).rejects.toThrow('Ollama returned a body without a `response` string.')
  })

  it('aborts as soon as the caller does', async () => {
    const controller = new AbortController()

    globalThis.fetch = vi.fn(
      async (_input: unknown, request: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          request?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted.'))
          })
        })
    ) as unknown as typeof fetch

    const pending = ollamaBackend.generate({
      model: 'qwen2.5-coder:1.5b',
      prompt: 'select ',
      signal: controller.signal
    })

    controller.abort()

    await expect(pending).rejects.toThrow('The operation was aborted.')
  })
})

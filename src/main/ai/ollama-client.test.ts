import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { promptLabels } from './completion-prompt'
import {
  ollamaBackend,
  ollamaBaseUrl,
  type PullProgress
} from './ollama-client'

const originalFetch = globalThis.fetch
const originalHost = process.env.OLLAMA_HOST

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status
  })
}

// Ollama streams a pull as newline-delimited JSON. The chunks are given
// verbatim rather than one object per chunk, so a test can split a line across
// two of them the way a socket does.
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }

        controller.close()
      }
    })
  )
}

// A body that never produces anything, and fails the moment the request is
// aborted — which is what a real fetch does, and what the stall deadline needs
// in order to be observable.
function silentResponse(signal: AbortSignal | undefined): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => {
          controller.error(new Error('The operation was aborted.'))
        })
      }
    })
  )
}

// A stubbed fetch whose body the test feeds line by line, so the stall deadline
// can be driven against a stream that is still open.
function pushableFetch() {
  const encoder = new TextEncoder()

  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined

  globalThis.fetch = vi.fn(
    async (_input: unknown, request: RequestInit | undefined) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller

            request?.signal?.addEventListener('abort', () => {
              controller.error(new Error('The operation was aborted.'))
            })
          }
        })
      )
  ) as unknown as typeof fetch

  return {
    close: (): void => streamController?.close(),
    push: (line: string): void =>
      streamController?.enqueue(encoder.encode(line))
  }
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
        // The prompt's labels stop generation, so a model that runs past its
        // answer into a replay of the prompt is cut off at the source.
        stop: ['\n\n\n', '```', ...promptLabels],
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

describe('ollamaBackend.pullModel', () => {
  it('asks Ollama to stream the pull and reports every line', async () => {
    const progress: PullProgress[] = []

    const fetchMock = stubFetch(() =>
      streamResponse([
        '{"status":"pulling manifest"}\n',
        '{"status":"pulling 4c1b0e1e","completed":512,"total":1024}\n',
        '{"status":"success"}\n'
      ])
    )

    await ollamaBackend.pullModel({
      model: 'qwen2.5-coder:1.5b',
      onProgress: (update) => progress.push(update)
    })

    expect(progress).toEqual([
      { completed: 0, status: 'pulling manifest', total: 0 },
      { completed: 512, status: 'pulling 4c1b0e1e', total: 1024 },
      { completed: 0, status: 'success', total: 0 }
    ])

    const [url, request] = fetchMock.mock.calls[0] ?? []

    expect(url).toEqual('http://127.0.0.1:11434/api/pull')
    expect(request?.method).toEqual('POST')
    expect(JSON.parse(String(request?.body))).toEqual({
      model: 'qwen2.5-coder:1.5b',
      stream: true
    })
  })

  it('joins a line that arrived split across two chunks', async () => {
    const progress: PullProgress[] = []

    stubFetch(() =>
      streamResponse([
        '{"status":"pulling 4c1b',
        '0e1e","completed":8,"total":16}'
      ])
    )

    await ollamaBackend.pullModel({
      model: 'qwen2.5-coder:1.5b',
      onProgress: (update) => progress.push(update)
    })

    expect(progress).toEqual([
      { completed: 8, status: 'pulling 4c1b0e1e', total: 16 }
    ])
  })

  it('ignores a line that is not JSON rather than failing the download', async () => {
    const progress: PullProgress[] = []

    stubFetch(() => streamResponse(['not json\n', '{"status":"success"}\n']))

    await ollamaBackend.pullModel({
      model: 'qwen2.5-coder:1.5b',
      onProgress: (update) => progress.push(update)
    })

    expect(progress).toEqual([{ completed: 0, status: 'success', total: 0 }])
  })

  it('rejects with the error Ollama reported mid-stream', async () => {
    stubFetch(() =>
      streamResponse([
        '{"status":"pulling manifest"}\n',
        '{"error":"no space left on device"}\n'
      ])
    )

    await expect(
      ollamaBackend.pullModel({
        model: 'qwen2.5-coder:1.5b',
        onProgress: () => undefined
      })
    ).rejects.toThrow('no space left on device')
  })

  it('names the model when Ollama refuses the pull outright', async () => {
    stubFetch(() => jsonResponse({ error: 'not found' }, 404))

    await expect(
      ollamaBackend.pullModel({
        model: 'nonesuch:1b',
        onProgress: () => undefined
      })
    ).rejects.toThrow(
      'Ollama answered 404 for /api/pull. There may be no model called "nonesuch:1b".'
    )
  })

  it('gives up on a transfer that has gone silent', async () => {
    vi.useFakeTimers()

    try {
      globalThis.fetch = vi.fn(
        async (_input: unknown, request: RequestInit | undefined) =>
          silentResponse(request?.signal ?? undefined)
      ) as unknown as typeof fetch

      const pending = ollamaBackend.pullModel({
        model: 'qwen2.5-coder:1.5b',
        onProgress: () => undefined
      })

      const rejects = expect(pending).rejects.toThrow(
        'Ollama downloaded nothing for a minute.'
      )

      await vi.advanceTimersByTimeAsync(60_000)

      await rejects
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up when Ollama repeats the same line without moving a byte', async () => {
    vi.useFakeTimers()

    try {
      const stream = pushableFetch()

      const pending = ollamaBackend.pullModel({
        model: 'qwen2.5-coder:1.5b',
        onProgress: () => undefined
      })

      const rejects = expect(pending).rejects.toThrow(
        'Ollama downloaded nothing for a minute.'
      )

      // The line a stuck pull repeats several times a second: a phase, a
      // digest, a total, and no `completed` at all. The stream never goes
      // quiet, so only the byte count tells this apart from a fast download.
      for (let line = 0; line < 3; line += 1) {
        stream.push(
          '{"status":"pulling 29d8c98fa6b0","digest":"sha256:29d8","total":986048576}\n'
        )

        await vi.advanceTimersByTimeAsync(25_000)
      }

      await rejects
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a slow download alive as long as bytes keep arriving', async () => {
    vi.useFakeTimers()

    try {
      const progress: PullProgress[] = []
      const stream = pushableFetch()

      const pending = ollamaBackend.pullModel({
        model: 'qwen2.5-coder:1.5b',
        onProgress: (update) => progress.push(update)
      })

      // Two and a half minutes, in steps longer than half the deadline: this
      // only survives if a rising byte count pushes the deadline back.
      for (const completed of [10, 20, 30]) {
        stream.push(
          `{"status":"pulling 29d8c98fa6b0","completed":${completed},"total":100}\n`
        )

        await vi.advanceTimersByTimeAsync(50_000)
      }

      stream.close()

      await expect(pending).resolves.toBeUndefined()

      expect(progress).toEqual([
        { completed: 10, status: 'pulling 29d8c98fa6b0', total: 100 },
        { completed: 20, status: 'pulling 29d8c98fa6b0', total: 100 },
        { completed: 30, status: 'pulling 29d8c98fa6b0', total: 100 }
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets the caller cancel without dressing it up as a stall', async () => {
    const controller = new AbortController()

    globalThis.fetch = vi.fn(
      async (_input: unknown, request: RequestInit | undefined) =>
        silentResponse(request?.signal ?? undefined)
    ) as unknown as typeof fetch

    const pending = ollamaBackend.pullModel({
      model: 'qwen2.5-coder:1.5b',
      onProgress: () => undefined,
      signal: controller.signal
    })

    controller.abort()

    await expect(pending).rejects.toThrow('The operation was aborted.')
  })
})

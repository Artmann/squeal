// The only module that talks to Ollama.
//
// Plain promises and global `fetch` — no Effect and no Electron — so it can be
// exercised against a stubbed fetch, the same way `src/main/updates/updater.ts`
// keeps Electron behind an interface to stay unit-testable. Everything is
// loopback, so `net.fetch`'s proxy and certificate handling buys nothing here.

// Ollama's own default. Honouring OLLAMA_HOST means a user who moved the
// server does not have to be told twice.
const defaultHost = 'http://127.0.0.1:11434'

// Listing models is a local, in-memory answer; if it has not come back in two
// seconds Ollama is not in a state that will produce a suggestion either.
const listModelsTimeoutMilliseconds = 2_000

// Generation has to allow for a cold model being loaded from disk on the first
// request. Anything past this and the user has typed on regardless.
const generateTimeoutMilliseconds = 10_000

// A suggestion is the rest of a statement, not an essay. Capping it keeps
// latency down and stops a chatty model from running away.
const maxPredictedTokens = 128

export interface GenerateOptions {
  model: string
  prompt: string
  signal?: AbortSignal
}

export interface OllamaBackend {
  generate(options: GenerateOptions): Promise<string>
  listModels(signal?: AbortSignal): Promise<string[]>
}

export function ollamaBaseUrl(): string {
  const configured = process.env.OLLAMA_HOST

  if (configured === undefined || configured.trim().length === 0) {
    return defaultHost
  }

  const trimmed = configured.trim().replace(/\/+$/, '')

  // OLLAMA_HOST is documented as host:port and is commonly set without a
  // scheme, which `fetch` rejects outright.
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed
  }

  return `http://${trimmed}`
}

export const ollamaBackend: OllamaBackend = {
  async generate({ model, prompt, signal }: GenerateOptions): Promise<string> {
    const response = await fetch(`${ollamaBaseUrl()}/api/generate`, {
      body: JSON.stringify({
        model,
        options: {
          num_predict: maxPredictedTokens,
          stop: ['\n\n\n', '```'],
          temperature: 0.1
        },
        prompt,
        stream: false
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: withTimeout(generateTimeoutMilliseconds, signal)
    })

    if (!response.ok) {
      throw new Error(`Ollama answered ${response.status} for /api/generate.`)
    }

    const body: unknown = await response.json()

    if (
      typeof body !== 'object' ||
      body === null ||
      !('response' in body) ||
      typeof body.response !== 'string'
    ) {
      throw new Error('Ollama returned a body without a `response` string.')
    }

    return body.response
  },

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      signal: withTimeout(listModelsTimeoutMilliseconds, signal)
    })

    if (!response.ok) {
      throw new Error(`Ollama answered ${response.status} for /api/tags.`)
    }

    const body: unknown = await response.json()

    if (typeof body !== 'object' || body === null || !('models' in body)) {
      throw new Error('Ollama returned a body without a `models` array.')
    }

    const { models } = body

    if (!Array.isArray(models)) {
      throw new Error('Ollama returned a body without a `models` array.')
    }

    return models
      .map((entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'name' in entry &&
        typeof entry.name === 'string'
          ? entry.name
          : null
      )
      .filter((name: string | null): name is string => name !== null)
  }
}

// Every outbound call gets a deadline of its own, and still honours the
// caller's cancellation — a superseded suggestion must abort immediately rather
// than hold the socket until the timeout.
function withTimeout(
  milliseconds: number,
  signal: AbortSignal | undefined
): AbortSignal {
  const deadline = AbortSignal.timeout(milliseconds)

  if (signal === undefined) {
    return deadline
  }

  return AbortSignal.any([deadline, signal])
}

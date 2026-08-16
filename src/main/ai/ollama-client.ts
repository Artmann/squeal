// The only module that talks to Ollama.
//
// Plain promises and global `fetch` — no Effect and no Electron — so it can be
// exercised against a stubbed fetch, the same way `src/main/updates/updater.ts`
// keeps Electron behind an interface to stay unit-testable. Everything is
// loopback, so `net.fetch`'s proxy and certificate handling buys nothing here.

import { promptLabels } from './completion-prompt'

// Ollama's own default. Honouring OLLAMA_HOST means a user who moved the
// server does not have to be told twice.
const defaultHost = 'http://127.0.0.1:11434'

// Two shapes of runaway answer, and the prompt's own labels. A model that keeps
// going past the continuation starts replaying the prompt, so the labels are
// where the useful part of the answer ends.
const stopSequences = ['\n\n\n', '```', ...promptLabels]

// Listing models is a local, in-memory answer; if it has not come back in two
// seconds Ollama is not in a state that will produce a suggestion either.
const listModelsTimeoutMilliseconds = 2_000

// Generation has to allow for a cold model being loaded from disk on the first
// request. Anything past this and the user has typed on regardless.
const generateTimeoutMilliseconds = 10_000

// A suggestion is the rest of a statement, not an essay. Capping it keeps
// latency down and stops a chatty model from running away.
const maxPredictedTokens = 128

// A pull is gigabytes over someone else's network, so a fixed deadline like the
// other two would kill a download that is working. What is measured instead is
// standing still: a minute in which no byte arrived and no phase changed means
// the transfer is stuck, however long it has been running.
const pullSilenceMilliseconds = 60_000

export interface GenerateOptions {
  model: string
  prompt: string
  signal?: AbortSignal
}

// `total` and `completed` are bytes, and both are zero for the early phases
// ("pulling manifest") that have nothing to measure.
export interface PullProgress {
  completed: number
  status: string
  total: number
}

export interface PullOptions {
  model: string
  onProgress: (progress: PullProgress) => void
  signal?: AbortSignal
}

export interface OllamaBackend {
  generate(options: GenerateOptions): Promise<string>
  listModels(signal?: AbortSignal): Promise<string[]>
  pullModel(options: PullOptions): Promise<void>
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
          stop: stopSequences,
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
  },

  async pullModel({ model, onProgress, signal }: PullOptions): Promise<void> {
    // Its own controller rather than AbortSignal.timeout, because the deadline
    // has to be pushed back on every line rather than run from the first.
    const stalled = new AbortController()

    let stalledOut = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const restartDeadline = () => {
      clearTimeout(timer)

      timer = setTimeout(() => {
        stalledOut = true

        stalled.abort()
      }, pullSilenceMilliseconds)
    }

    restartDeadline()

    try {
      const response = await fetch(`${ollamaBaseUrl()}/api/pull`, {
        body: JSON.stringify({ model, stream: true }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal:
          signal === undefined
            ? stalled.signal
            : AbortSignal.any([stalled.signal, signal])
      })

      if (!response.ok) {
        throw new Error(
          `Ollama answered ${response.status} for /api/pull. There may be no model called "${model}".`
        )
      }

      if (response.body === null) {
        throw new Error('Ollama returned no progress for /api/pull.')
      }

      await readProgress(response.body, onProgress, restartDeadline)
    } catch (cause) {
      // The abort reached fetch as a plain cancellation, so the reason it was
      // aborted has to be recovered here. A caller who cancelled gets their own
      // abort back untouched, which is what keeps a cancel from reading as a
      // failure.
      if (stalledOut) {
        throw new Error('Ollama downloaded nothing for a minute.')
      }

      throw cause
    } finally {
      clearTimeout(timer)
    }
  }
}

// Ollama answers a pull with newline-delimited JSON, one object per progress
// update, and reports a failure as an `error` field rather than a status code
// once the stream has started.
async function readProgress(
  body: ReadableStream<Uint8Array>,
  onProgress: (progress: PullProgress) => void,
  onActivity: () => void
): Promise<void> {
  const decoder = new TextDecoder()
  const reader = body.getReader()

  let buffer = ''
  let lastCompleted = -1
  let lastStatus = ''

  // A line arriving is not progress. Ollama repeats the same line several times
  // a second for as long as it is trying, so a transfer that has connected to
  // nothing looks exactly as busy as one running at full speed — the only thing
  // that separates them is whether the byte count moves or the phase changes.
  const noteProgress = (progress: PullProgress): void => {
    if (progress.status === lastStatus && progress.completed <= lastCompleted) {
      return
    }

    lastCompleted = progress.completed
    lastStatus = progress.status

    onActivity()
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')

      // Whatever follows the last newline is an unfinished line, so it waits
      // for the next chunk rather than being parsed in half.
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        reportLine(line, onProgress, noteProgress)
      }
    }

    reportLine(buffer, onProgress, noteProgress)
  } finally {
    reader.releaseLock()
  }
}

function reportLine(
  line: string,
  onProgress: (progress: PullProgress) => void,
  noteProgress: (progress: PullProgress) => void
): void {
  const trimmed = line.trim()

  if (trimmed.length === 0) {
    return
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // A line that is not JSON tells us nothing and is not worth failing a
    // download over; the next one carries the same progress.
    return
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return
  }

  if ('error' in parsed && typeof parsed.error === 'string') {
    throw new Error(parsed.error)
  }

  const progress: PullProgress = {
    // Omitted entirely until the first byte lands, which is why a stuck
    // download reports a total and nothing else.
    completed: numberField(parsed, 'completed'),
    status:
      'status' in parsed && typeof parsed.status === 'string'
        ? parsed.status
        : '',
    total: numberField(parsed, 'total')
  }

  noteProgress(progress)
  onProgress(progress)
}

function numberField(source: object, field: string): number {
  if (!(field in source)) {
    return 0
  }

  const value: unknown = (source as Record<string, unknown>)[field]

  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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

// Ollama as a service. Thin on purpose: the HTTP details live in
// `src/main/ai/ollama-client.ts`, and this exists so the Completions service can
// depend on a tag that tests substitute, the same way AdapterFactory is
// substituted for a real database driver.
import { Effect } from 'effect'

import { ollamaBackend, ollamaBaseUrl } from '@/main/ai/ollama-client'
import type { OllamaBackend, PullProgress } from '@/main/ai/ollama-client'
import { OllamaError } from '../errors'

export interface OllamaGenerateOptions {
  model: string
  prompt: string
}

export interface OllamaPullOptions {
  model: string
  onProgress: (progress: PullProgress) => void
}

function toOllamaError(cause: unknown): OllamaError {
  return new OllamaError({
    message: cause instanceof Error ? cause.message : String(cause)
  })
}

export function makeOllamaService(backend: OllamaBackend) {
  return {
    // The signal comes from Effect: interrupting the fiber — which is what a
    // superseded keystroke does — aborts the request instead of leaving it to
    // finish into nothing.
    generate: ({ model, prompt }: OllamaGenerateOptions) =>
      Effect.tryPromise({
        catch: toOllamaError,
        try: (signal) => backend.generate({ model, prompt, signal })
      }),
    host: ollamaBaseUrl(),
    listModels: Effect.tryPromise({
      catch: toOllamaError,
      try: (signal) => backend.listModels(signal)
    }),
    // Interrupting this fiber is how the user cancels a download: the signal
    // reaches fetch and the connection closes, so Ollama stops sending.
    pullModel: ({ model, onProgress }: OllamaPullOptions) =>
      Effect.tryPromise({
        catch: toOllamaError,
        try: (signal) => backend.pullModel({ model, onProgress, signal })
      })
  }
}

export class Ollama extends Effect.Service<Ollama>()('Ollama', {
  accessors: true,
  sync: () => makeOllamaService(ollamaBackend)
}) {}

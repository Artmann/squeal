import { apiClient } from '../api-client'

import { startExporter } from './exporter'
import { startSpan } from './tracer'

export type RendererErrorSource =
  | 'error-boundary'
  | 'unhandledrejection'
  | 'window.onerror'

let initialized = false

export function captureRendererError(
  error: unknown,
  source: RendererErrorSource
): void {
  const span = startSpan('renderer.error', {
    attributes: { 'error.source': source }
  })

  span.recordException(error)
  span.end()
}

// Called from the renderer entry point before React renders — outside any
// component, so StrictMode double-invocation cannot double the listeners.
export function initTracing(): void {
  if (initialized) {
    return
  }

  initialized = true

  startExporter({ send: (spans) => apiClient.ingestSpans(spans) })

  window.addEventListener('error', (event) => {
    captureRendererError(event.error ?? event.message, 'window.onerror')
  })

  window.addEventListener('unhandledrejection', (event) => {
    captureRendererError(event.reason, 'unhandledrejection')
  })
}

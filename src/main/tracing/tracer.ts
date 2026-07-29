import { AsyncLocalStorage } from 'node:async_hooks'
import { log } from 'tiny-typescript-logger'

import { SpanDraft } from '@/glue/tracing/span-draft'
import {
  SpanAttributes,
  SpanAttributeValue,
  SpanContext,
  SpanKind,
  SpanStatus
} from '@/glue/tracing/spans'

import { writeSpans } from './span-writer'

export interface StartSpanOptions {
  attributes?: SpanAttributes
  kind?: SpanKind
  parent?: SpanContext
}

const contextStorage = new AsyncLocalStorage<SpanContext>()

export class Span {
  private readonly draft: SpanDraft

  constructor(name: string, options: StartSpanOptions) {
    this.draft = new SpanDraft(name, {
      ...options,
      parent: options.parent ?? getActiveSpanContext(),
      serviceName: 'main'
    })
  }

  get context(): SpanContext {
    return this.draft.context
  }

  get status(): SpanStatus {
    return this.draft.status
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.draft.addEvent(name, attributes)
  }

  // A failed write is logged and swallowed — tracing must never take the
  // traced operation down with it.
  async end(): Promise<void> {
    const record = this.draft.finish()

    if (!record) {
      return
    }

    try {
      await writeSpans([record])
    } catch (error) {
      log.error(
        `Could not write span ${record.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  recordException(error: unknown): void {
    this.draft.recordException(error)
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.draft.setAttribute(key, value)
  }

  setName(name: string): void {
    this.draft.setName(name)
  }

  setStatus(status: SpanStatus, message?: string): void {
    this.draft.setStatus(status, message)
  }
}

export function getActiveSpanContext(): SpanContext | undefined {
  return contextStorage.getStore()
}

export function runWithContext<T>(context: SpanContext, fn: () => T): T {
  return contextStorage.run(context, fn)
}

export function startSpan(name: string, options: StartSpanOptions = {}): Span {
  return new Span(name, options)
}

export async function withSpan<T>(
  name: string,
  options: StartSpanOptions,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = startSpan(name, options)

  try {
    const result = await contextStorage.run(span.context, () => fn(span))

    if (span.status === 'unset') {
      span.setStatus('ok')
    }

    return result
  } catch (error) {
    span.recordException(error)

    throw error
  } finally {
    await span.end()
  }
}

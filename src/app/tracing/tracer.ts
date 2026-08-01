import { SpanDraft } from '@/glue/tracing/span-draft'
import {
  SpanAttributes,
  SpanAttributeValue,
  SpanContext,
  SpanKind,
  SpanStatus
} from '@/glue/tracing/spans'

import { enqueueSpan } from './exporter'

export interface StartSpanOptions {
  attributes?: SpanAttributes
  kind?: SpanKind
  parent?: SpanContext
}

// Unlike the main-process tracer there is no ambient context here — parents
// are always passed explicitly.
export class Span {
  private readonly draft: SpanDraft

  constructor(name: string, options: StartSpanOptions) {
    this.draft = new SpanDraft(name, {
      ...options,
      serviceName: 'renderer'
    })
  }

  get context(): SpanContext {
    return this.draft.context
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.draft.addEvent(name, attributes)
  }

  end(): void {
    const record = this.draft.finish()

    if (record) {
      enqueueSpan(record)
    }
  }

  recordException(error: unknown): void {
    this.draft.recordException(error)
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.draft.setAttribute(key, value)
  }

  setStatus(status: SpanStatus, message?: string): void {
    this.draft.setStatus(status, message)
  }
}

export function startSpan(name: string, options: StartSpanOptions = {}): Span {
  return new Span(name, options)
}

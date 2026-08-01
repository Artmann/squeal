// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

import { generateSpanId, generateTraceId } from './ids'
import {
  maxAttributeValueLength,
  maxStacktraceLength,
  SpanAttributes,
  SpanAttributeValue,
  SpanContext,
  SpanEvent,
  SpanKind,
  SpanRecord,
  SpanStatus,
  TraceServiceName,
  truncateValue
} from './spans'

export interface SpanDraftOptions {
  attributes?: SpanAttributes
  kind?: SpanKind
  parent?: SpanContext
  serviceName: TraceServiceName
}

// Collects everything a span records during its lifetime; the per-process
// tracers own how a finished record is persisted or exported.
export class SpanDraft {
  readonly context: SpanContext

  private readonly attributes: SpanAttributes = {}
  private readonly events: SpanEvent[] = []
  private finished = false
  private readonly kind: SpanKind
  private name: string
  private readonly parentSpanId: string | null
  private readonly serviceName: TraceServiceName
  private readonly startedAt = Date.now()
  private readonly startedAtMonotonic = performance.now()
  private currentStatus: SpanStatus = 'unset'
  private statusMessage: string | null = null

  constructor(name: string, options: SpanDraftOptions) {
    this.context = {
      spanId: generateSpanId(),
      traceId: options.parent?.traceId ?? generateTraceId()
    }
    this.kind = options.kind ?? 'internal'
    this.name = name
    this.parentSpanId = options.parent?.spanId ?? null
    this.serviceName = options.serviceName

    for (const [key, value] of Object.entries(options.attributes ?? {})) {
      this.setAttribute(key, value)
    }
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.events.push({
      ...(attributes === undefined ? {} : { attributes }),
      name,
      time: Date.now()
    })
  }

  finish(): SpanRecord | undefined {
    if (this.finished) {
      return undefined
    }

    this.finished = true

    return {
      attributes: this.attributes,
      durationMs: performance.now() - this.startedAtMonotonic,
      events: this.events,
      id: this.context.spanId,
      kind: this.kind,
      name: this.name,
      parentSpanId: this.parentSpanId,
      serviceName: this.serviceName,
      startedAt: this.startedAt,
      status: this.currentStatus,
      statusMessage: this.statusMessage,
      traceId: this.context.traceId
    }
  }

  recordException(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? (error.stack ?? '') : ''
    const type = error instanceof Error ? error.name : typeof error

    this.addEvent('exception', {
      'exception.message': truncateValue(message, maxAttributeValueLength),
      'exception.stacktrace': truncateValue(stack, maxStacktraceLength),
      'exception.type': type
    })
    this.setStatus('error', message)
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.attributes[key] =
      typeof value === 'string'
        ? truncateValue(value, maxAttributeValueLength)
        : value
  }

  setName(name: string): void {
    if (this.finished) {
      return
    }

    this.name = name
  }

  setStatus(status: SpanStatus, message?: string): void {
    this.currentStatus = status
    this.statusMessage =
      message === undefined
        ? null
        : truncateValue(message, maxAttributeValueLength)
  }
}

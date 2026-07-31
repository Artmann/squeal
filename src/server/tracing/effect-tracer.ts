// The bridge between Effect's tracing and Squeal's span store: a custom
// Tracer whose spans persist straight into the spans table via writeSpans.
// Effect already generates W3C-format ids, so the renderer's traceparent
// propagation and the existing dashboard keep working unchanged.
import { Cause, Chunk, Effect, Exit, Layer, Option, Queue, Tracer } from 'effect'
import type { Context } from 'effect'
import { log } from 'tiny-typescript-logger'

import { generateTraceId, generateSpanId } from '@/glue/tracing/ids'
import { isValidSpanId, isValidTraceId } from '@/glue/tracing/traceparent'
import { AppDatabase } from '../services/app-database'
import {
  maxAttributeValueLength,
  maxStacktraceLength,
  SpanAttributes,
  SpanAttributeValue,
  SpanEvent,
  SpanKind as SpanRecordKind,
  SpanRecord,
  truncateValue
} from '@/glue/tracing/spans'
import { writeSpans } from '@/main/tracing/span-writer'

export interface SquealTracerOptions {
  // Injectable for tests; defaults to the spans-table writer.
  persist?: (records: SpanRecord[]) => Promise<unknown>
}

export function makeSquealTracer(
  options: SquealTracerOptions = {}
): Tracer.Tracer {
  const persist = options.persist ?? writeSpans

  return Tracer.make({
    context: (execution) => execution(),
    span: (name, parent, _context, links, startTime, kind) =>
      new SquealSpan(name, parent, _context, links, startTime, kind, persist)
  })
}

// Writes are batched, so one INSERT covers a whole burst rather than one per
// span end.
const spanBatchSize = 100
const spanQueueCapacity = 2048
const spanFlushTimeout = '2 seconds'
const droppedSpanLogInterval = 100

// Offering never blocks and never awaits: a span must not slow down the
// operation it measures, and unbounded in-flight writes are exactly what this
// queue exists to prevent. A full queue means the writer has fallen far
// behind, so spans are dropped — loudly — instead of being retained.
function makeQueuedPersist(
  queue: Queue.Queue<SpanRecord>
): (records: SpanRecord[]) => Promise<unknown> {
  let dropped = 0

  return (records) => {
    for (const record of records) {
      if (!Queue.unsafeOffer(queue, record)) {
        dropped += 1

        if (dropped % droppedSpanLogInterval === 1) {
          log.warn(`Span queue is full; dropped ${dropped} span(s).`)
        }
      }
    }

    return Promise.resolve()
  }
}

// Depends on AppDatabase for two reasons: spans are written through the service
// rather than a direct `@/database` import, and the dependency forces this
// layer to be torn down *before* the database handle closes — otherwise the
// shutdown flush would race the closing client and lose exactly the spans that
// explain the shutdown.
export const TracerLive = Layer.unwrapScoped(
  Effect.gen(function* () {
    const appDatabase = yield* AppDatabase
    const queue = yield* Queue.bounded<SpanRecord>(spanQueueCapacity)

    const writeBatch = (records: ReadonlyArray<SpanRecord>) =>
      appDatabase
        .execute((client) => writeSpans([...records], client))
        .pipe(
          Effect.catchAllCause((cause) =>
            Effect.logError('Could not write spans', cause)
          ),
          // Writing a span must never itself be traced.
          Effect.withTracerEnabled(false)
        )

    // Registered before the drain fiber so teardown interrupts the fiber first
    // (finalizers run last-in-first-out) and this then drains the remainder.
    yield* Effect.addFinalizer(() =>
      Queue.takeAll(queue).pipe(
        Effect.flatMap((remaining) =>
          Chunk.isEmpty(remaining)
            ? Effect.void
            : writeBatch(Chunk.toReadonlyArray(remaining))
        ),
        Effect.timeout(spanFlushTimeout),
        Effect.catchAllCause((cause) =>
          Effect.logError('Could not flush pending spans', cause)
        )
      )
    )

    yield* Effect.forkScoped(
      Queue.takeBetween(queue, 1, spanBatchSize).pipe(
        Effect.flatMap((records) => writeBatch(Chunk.toReadonlyArray(records))),
        Effect.forever
      )
    )

    return Layer.setTracer(
      makeSquealTracer({ persist: makeQueuedPersist(queue) })
    )
  })
)

class SquealSpan implements Tracer.Span {
  readonly _tag = 'Span' as const
  readonly attributes = new Map<string, unknown>()
  readonly context: Context.Context<never>
  readonly kind: Tracer.SpanKind
  readonly links: Tracer.SpanLink[]
  readonly name: string
  readonly parent: Option.Option<Tracer.AnySpan>
  readonly sampled: boolean
  readonly spanId: string
  readonly traceId: string
  status: Tracer.SpanStatus

  private readonly events: SpanEvent[] = []
  private readonly persist: (records: SpanRecord[]) => Promise<unknown>

  constructor(
    name: string,
    parent: Option.Option<Tracer.AnySpan>,
    context: Context.Context<never>,
    links: ReadonlyArray<Tracer.SpanLink>,
    startTime: bigint,
    kind: Tracer.SpanKind,
    persist: (records: SpanRecord[]) => Promise<unknown>
  ) {
    // Inbound parents come from client headers, and the platform's b3 fallback
    // does not validate them at all. An unusable id would produce a trace the
    // dashboard lists but cannot open (GET /traces/:id rejects it), so a parent
    // that fails validation is treated as absent and this span starts a fresh
    // root trace.
    const usableParent = Option.filter(
      parent,
      (span) => isValidTraceId(span.traceId) && isValidSpanId(span.spanId)
    )

    this.context = context
    this.kind = kind
    this.links = links.slice()
    this.name = name
    this.parent = usableParent
    this.persist = persist
    this.sampled = Option.match(usableParent, {
      onNone: () => true,
      onSome: (span) => span.sampled
    })
    this.spanId = generateSpanId()
    this.status = { _tag: 'Started', startTime }
    this.traceId = Option.match(usableParent, {
      onNone: () => generateTraceId(),
      onSome: (span) => span.traceId
    })
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.links.push(...links)
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value)
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === 'Ended') {
      return
    }

    const { startTime } = this.status

    this.status = { _tag: 'Ended', endTime, exit, startTime }

    const record = this.toRecord(startTime, endTime, exit)

    // A failed write is logged and swallowed — tracing must never take the
    // traced operation down with it.
    void this.persist([record]).then(undefined, (error: unknown) => {
      log.error(
        `Could not write span ${record.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    })
  }

  event(
    name: string,
    startTime: bigint,
    attributes?: Record<string, unknown>
  ): void {
    this.events.push({
      ...(attributes === undefined
        ? {}
        : { attributes: coerceAttributes(attributes) }),
      name,
      time: nanosToMillis(startTime)
    })
  }

  // The platform's HTTP tracer middleware names request spans generically
  // ("http.server GET") and the router records the matched pattern as
  // http.route — rename at write time so the trace list keeps today's
  // "POST /queries" naming.
  private recordName(): string {
    if (this.kind !== 'server') {
      return this.name
    }

    const method = this.attributes.get('http.request.method')
    const route = this.attributes.get('http.route')

    if (typeof method === 'string' && typeof route === 'string') {
      return `${method} ${route}`
    }

    return this.name
  }

  private toRecord(
    startTime: bigint,
    endTime: bigint,
    exit: Exit.Exit<unknown, unknown>
  ): SpanRecord {
    const failure = Exit.isFailure(exit)
      ? describeFailure(exit.cause, endTime)
      : undefined

    const events = [...this.events]

    if (failure?.event !== undefined) {
      events.push(failure.event)
    }

    const attributes: SpanAttributes = {}

    for (const [key, value] of this.attributes) {
      attributes[key] = coerceAttributeValue(value)
    }

    return {
      attributes,
      durationMs: Number(endTime - startTime) / 1e6,
      events,
      id: this.spanId,
      kind: toRecordKind(this.kind),
      name: this.recordName(),
      parentSpanId: Option.match(this.parent, {
        onNone: (): string | null => null,
        onSome: (span) => span.spanId
      }),
      serviceName: 'main',
      startedAt: nanosToMillis(startTime),
      status: failure === undefined ? 'ok' : 'error',
      statusMessage: failure?.statusMessage ?? null,
      traceId: this.traceId
    }
  }
}

interface SpanFailure {
  // Absent for interruption, which carries no exception to show.
  event: SpanEvent | undefined
  statusMessage: string | null
}

function describeFailure(
  cause: Cause.Cause<unknown>,
  endTime: bigint
): SpanFailure {
  // Interruption is a lifecycle event (app shutdown), not a failure.
  if (Cause.isInterruptedOnly(cause)) {
    return { event: undefined, statusMessage: 'Interrupted' }
  }

  const failure = Cause.failureOption(cause)
  const error = Option.isSome(failure) ? failure.value : Cause.squash(cause)
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const type = error instanceof Error ? error.name : typeof error

  return {
    event: {
      attributes: {
        'exception.message': truncateValue(message, maxAttributeValueLength),
        'exception.stacktrace': truncateValue(stack, maxStacktraceLength),
        'exception.type': type
      },
      name: 'exception',
      time: nanosToMillis(endTime)
    },
    statusMessage: truncateValue(message, maxAttributeValueLength)
  }
}

function coerceAttributes(
  attributes: Record<string, unknown>
): SpanAttributes {
  const coerced: SpanAttributes = {}

  for (const [key, value] of Object.entries(attributes)) {
    coerced[key] = coerceAttributeValue(value)
  }

  return coerced
}

function coerceAttributeValue(value: unknown): SpanAttributeValue {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  const text = typeof value === 'string' ? value : String(value)

  return truncateValue(text, maxAttributeValueLength)
}

function nanosToMillis(nanos: bigint): number {
  return Number(nanos / 1_000_000n)
}

// The span store only knows the three W3C-ish kinds the dashboard renders.
function toRecordKind(kind: Tracer.SpanKind): SpanRecordKind {
  if (kind === 'client' || kind === 'internal' || kind === 'server') {
    return kind
  }

  return 'internal'
}

// The renderer's API layer, derived from the shared HttpApi definition so
// request and response shapes stay in lockstep with the server. Everything
// exported here returns a promise: the React hooks (TanStack Query/DB) stay
// promise-based and know nothing about Effect.
import {
  FetchHttpClient,
  HttpApiClient,
  HttpClient,
  HttpClientRequest
} from '@effect/platform'
import { HttpApiDecodeError } from '@effect/platform/HttpApiError'
import {
  Cause,
  Effect,
  Exit,
  FiberRef,
  ManagedRuntime,
  Option,
  ParseResult
} from 'effect'

import { SquealApi } from '@/glue/api/api'
import type {
  ConnectionTestResponse,
  CreateDatabaseRequest,
  CreateDatabaseResponse,
  CreateQueryResponse,
  CreateWorksheetRequest,
  DatabaseDto,
  ListTracesUrlParams,
  QueryDto,
  ReorderDatabasesResponse,
  ReorderWorksheetsResponse,
  SchemaInfoDto,
  SpanDto,
  TraceSummaryDto,
  UpdateDatabaseConnection,
  UpdateDatabaseRequest,
  UpdateDatabaseResponse,
  UpdateStatusResponse,
  UpdateWorksheetRequest,
  WorksheetDto
} from '@/glue/api/schemas'
import { ApiError } from '@/errors'
import { SpanContext, SpanRecord } from '@/glue/tracing/spans'
import { formatTraceparent } from '@/glue/tracing/traceparent'

import { memoizePromise } from './memoize-promise'
import { Span, startSpan } from './tracing/tracer'

const baseUrl = 'http://127.0.0.1:7847'

interface GetHealthResponse {
  encryptionAvailable: boolean
  status: string
}

const getApiToken = memoizePromise(() => window.electron.getApiToken())

// The renderer's tracer is hand-rolled (no fiber context to inherit), so the
// traceparent for the current call travels through a FiberRef that the
// request transform reads.
const currentTraceparent = FiberRef.unsafeMake<string | undefined>(undefined)

// Payload encoding happens strictly before the request is executed, so a
// ParseError raised while `sent` is still false means the payload was invalid
// and nothing left the machine, while one raised afterwards means the response
// did not match the contract. `run` gives every call its own marker, so
// concurrent requests never read each other's state.
interface RequestPhase {
  sent: boolean
  status?: number
}

const currentRequestPhase = FiberRef.unsafeMake<RequestPhase | undefined>(
  undefined
)

const runtime = ManagedRuntime.make(FetchHttpClient.layer)

// HttpApiClient.make reflects over every group and endpoint and builds a fresh
// schema union, so it is resolved once rather than per call — the 250ms result
// poller would otherwise rebuild the entire client four times a second.
const getClient = memoizePromise(() =>
  runtime.runPromise(
    HttpApiClient.make(SquealApi, {
      baseUrl,
      transformClient: (httpClient) =>
        httpClient.pipe(
          HttpClient.mapRequestEffect((request) =>
            Effect.gen(function* () {
              const token = yield* Effect.promise(getApiToken)
              const traceparent = yield* FiberRef.get(currentTraceparent)
              const phase = yield* FiberRef.get(currentRequestPhase)

              if (phase !== undefined) {
                phase.sent = true
              }

              const authorized = HttpClientRequest.setHeader(
                request,
                'Authorization',
                `Bearer ${token}`
              )

              if (traceparent === undefined) {
                return authorized
              }

              return HttpClientRequest.setHeader(
                authorized,
                'traceparent',
                traceparent
              )
            })
          ),
          // Runs for every response the client receives, including non-2xx
          // ones, so both the span attribute and the error message get the
          // real status code.
          HttpClient.tap((response) =>
            Effect.gen(function* () {
              const phase = yield* FiberRef.get(currentRequestPhase)

              if (phase !== undefined) {
                phase.status = response.status
              }
            })
          ),
          // The spans below carry the traceparent explicitly; the client's own
          // propagation would inject a competing one.
          HttpClient.withTracerPropagation(false)
        )
    })
  )
)

const client = Effect.promise(getClient)

// Infrastructure failures the API contract does not describe. They carry
// `_tag` like domain errors but reference the whole request/response, so they
// are flattened into an ApiError instead of being handed to callers.
const infrastructureTags = new Set([
  'ParseError',
  'RequestError',
  'ResponseError'
])

const validationMessage = 'Please correct the highlighted fields.'

// Both the server's decode errors and the client's own encode errors carry
// their issues in this shape, so the database form's field mapping consumes
// either one unchanged.
function toFieldDetails(
  issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>
): Record<string, string> {
  const details: Record<string, string> = {}

  for (const issue of issues) {
    details[issue.path.join('.')] = issue.message
  }

  return details
}

// Contract errors carry a `_tag` the hooks discriminate on. Infrastructure
// failures carry one too, but describe the request rather than the domain.
function isDomainError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof error._tag === 'string' &&
    !infrastructureTags.has(error._tag)
  )
}

// Domain errors reach the caller as themselves so hooks can discriminate on
// `_tag`. Everything else becomes an ApiError carrying copy the user can act
// on: the underlying ParseError/ResponseError/RequestError messages are
// developer-facing (a schema tree, or `StatusCode: non 2xx status code …`) and
// must never reach a toast. They go to the console instead.
function toThrowable(
  cause: Cause.Cause<unknown>,
  phase: RequestPhase
): unknown {
  const failure = Cause.failureOption(cause)
  const error = Option.isSome(failure) ? failure.value : Cause.squash(cause)

  // The server rejected the payload and said which fields were wrong.
  if (error instanceof HttpApiDecodeError) {
    return new ApiError(400, validationMessage, toFieldDetails(error.issues))
  }

  if (ParseResult.isParseError(error)) {
    // Nothing was sent: the payload failed to encode against the contract, so
    // this is invalid user input and the issues map onto form fields.
    if (!phase.sent) {
      return new ApiError(
        400,
        validationMessage,
        toFieldDetails(ParseResult.ArrayFormatter.formatErrorSync(error))
      )
    }

    console.error('The API response did not match the contract:', error.message)

    return new ApiError(
      phase.status ?? 500,
      'Squeal could not read the response from its backend. Please report this.'
    )
  }

  if (isDomainError(error)) {
    return error
  }

  if (error instanceof Error) {
    console.error('Squeal API request failed:', error)
  }

  // No response ever arrived, so the backend is unreachable rather than broken.
  if (phase.status === undefined) {
    return new ApiError(
      503,
      "Could not reach Squeal's backend. Restart Squeal and try again."
    )
  }

  return new ApiError(
    phase.status,
    "Squeal's backend reported an error. Restart Squeal and try again."
  )
}

function run<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  phase: RequestPhase = { sent: false }
): Promise<A> {
  return runtime
    .runPromiseExit(Effect.locally(effect, currentRequestPhase, phase))
    .then((exit) => {
      if (Exit.isSuccess(exit)) {
        return exit.value
      }

      throw toThrowable(exit.cause, phase)
    })
}

function recordStatusCode(span: Span, status: number | undefined): void {
  if (status === undefined) {
    return
  }

  span.setAttribute('http.status_code', status)
}

// Requests the renderer traces get a client span whose context is sent as the
// traceparent. Health checks, the trace API itself, and the 250ms result
// poller would only produce noise (or feedback loops).
function traced<A, E>(
  name: string,
  attributes: { method: string; path: string },
  parent: SpanContext | undefined,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>
): Promise<A> {
  const span = startSpan(name, {
    attributes: {
      'http.method': attributes.method,
      'http.url': `${baseUrl}${attributes.path}`
    },
    kind: 'client',
    ...(parent === undefined ? {} : { parent })
  })
  const phase: RequestPhase = { sent: false }

  return run(
    Effect.locally(effect, currentTraceparent, formatTraceparent(span.context)),
    phase
  ).then(
    (value) => {
      recordStatusCode(span, phase.status)
      span.setStatus('ok')
      span.end()

      return value
    },
    (error: unknown) => {
      recordStatusCode(
        span,
        phase.status ??
          (error instanceof ApiError ? error.statusCode : undefined)
      )
      span.setStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      )
      span.recordException(error)
      span.end()

      throw error
    }
  )
}

export const apiClient = {
  async cancelQuery(queryId: string): Promise<void> {
    await traced(
      'HTTP POST /queries/:id/cancel',
      { method: 'POST', path: `/queries/${queryId}/cancel` },
      undefined,
      Effect.flatMap(client, (api) =>
        api.queries.cancel({ path: { id: queryId } })
      )
    )
  },

  async createDatabase(
    request: CreateDatabaseRequest
  ): Promise<CreateDatabaseResponse> {
    return traced(
      'HTTP POST /databases',
      { method: 'POST', path: '/databases' },
      undefined,
      // The payload schema is a union discriminated on `type`, so the generated
      // client's options object is a union too. Narrowing here hands it one
      // concrete member instead of reaching for a cast.
      Effect.flatMap(client, (api) =>
        request.type === 'sqlite'
          ? api.databases.create({ payload: request })
          : api.databases.create({ payload: request })
      )
    )
  },

  async createQuery(
    request: {
      content: string
      databaseId?: string
      id: string
      queriedAt: number
      worksheetId: string
    },
    options: { traceParent?: SpanContext } = {}
  ): Promise<CreateQueryResponse> {
    return traced(
      'HTTP POST /queries',
      { method: 'POST', path: '/queries' },
      options.traceParent,
      Effect.flatMap(client, (api) => api.queries.create({ payload: request }))
    )
  },

  async createWorksheet(
    request: CreateWorksheetRequest
  ): Promise<WorksheetDto> {
    const data = await traced(
      'HTTP POST /worksheets',
      { method: 'POST', path: '/worksheets' },
      undefined,
      Effect.flatMap(client, (api) =>
        api.worksheets.create({ payload: request })
      )
    )

    return data.worksheet
  },

  async deleteDatabase(databaseId: string): Promise<void> {
    await traced(
      'HTTP DELETE /databases/:id',
      { method: 'DELETE', path: `/databases/${databaseId}` },
      undefined,
      Effect.flatMap(client, (api) =>
        api.databases.remove({ path: { id: databaseId } })
      )
    )
  },

  async deleteWorksheet(worksheetId: string): Promise<void> {
    await traced(
      'HTTP DELETE /worksheets/:id',
      { method: 'DELETE', path: `/worksheets/${worksheetId}` },
      undefined,
      Effect.flatMap(client, (api) =>
        api.worksheets.remove({ path: { id: worksheetId } })
      )
    )
  },

  async getDatabaseSchema(databaseId: string): Promise<SchemaInfoDto> {
    const data = await traced(
      'HTTP GET /databases/:id/schema',
      { method: 'GET', path: `/databases/${databaseId}/schema` },
      undefined,
      Effect.flatMap(client, (api) =>
        api.databases.schema({ path: { id: databaseId } })
      )
    )

    return data.schema
  },

  async getDatabases(): Promise<DatabaseDto[]> {
    const data = await traced(
      'HTTP GET /databases',
      { method: 'GET', path: '/databases' },
      undefined,
      Effect.flatMap(client, (api) => api.databases.list())
    )

    return data.databases
  },

  // Untraced: a health probe every few seconds would drown the trace list.
  async getHealth(): Promise<GetHealthResponse> {
    return run(Effect.flatMap(client, (api) => api.health.get()))
  },

  async getQueries(): Promise<QueryDto[]> {
    const data = await traced(
      'HTTP GET /queries',
      { method: 'GET', path: '/queries' },
      undefined,
      Effect.flatMap(client, (api) => api.queries.list())
    )

    return data.queries
  },

  // Untraced: this is the 250ms result poller.
  async getQuery(queryId: string): Promise<QueryDto> {
    const data = await run(
      Effect.flatMap(client, (api) =>
        api.queries.get({ path: { id: queryId } })
      )
    )

    return data.query
  },

  // Untraced: tracing the trace API is a feedback loop.
  async getTraceSpans(traceId: string): Promise<SpanDto[]> {
    const data = await run(
      Effect.flatMap(client, (api) => api.traces.get({ path: { traceId } }))
    )

    return data.spans
  },

  async getWorksheets(): Promise<WorksheetDto[]> {
    const data = await traced(
      'HTTP GET /worksheets',
      { method: 'GET', path: '/worksheets' },
      undefined,
      Effect.flatMap(client, (api) => api.worksheets.list())
    )

    return data.worksheets
  },

  async getTraces(
    params: Partial<ListTracesUrlParams> = {}
  ): Promise<TraceSummaryDto[]> {
    const data = await run(
      Effect.flatMap(client, (api) =>
        api.traces.list({
          urlParams: {
            errorOnly: params.errorOnly ?? false,
            limit: params.limit ?? 50,
            ...(params.before === undefined ? {} : { before: params.before }),
            ...(params.search === undefined ? {} : { search: params.search })
          }
        })
      )
    )

    return data.traces
  },

  // Untraced: this answers from memory on a schedule for the whole session, and
  // the backend skips it too — see src/server/tracing/trace-skip.ts.
  async getUpdateStatus(): Promise<UpdateStatusResponse> {
    return run(Effect.flatMap(client, (api) => api.updates.get()))
  },

  async ingestSpans(spans: SpanRecord[]): Promise<{ insertedCount: number }> {
    return run(
      Effect.flatMap(client, (api) => api.traces.ingest({ payload: { spans } }))
    )
  },

  async installUpdate(): Promise<UpdateStatusResponse> {
    return traced(
      'HTTP POST /updates/install',
      { method: 'POST', path: '/updates/install' },
      undefined,
      Effect.flatMap(client, (api) => api.updates.install())
    )
  },

  async reorderDatabases(
    databaseIds: string[]
  ): Promise<ReorderDatabasesResponse> {
    return traced(
      'HTTP PUT /databases/order',
      { method: 'PUT', path: '/databases/order' },
      undefined,
      Effect.flatMap(client, (api) =>
        api.databases.reorder({ payload: { databaseIds } })
      )
    )
  },

  async reorderWorksheets(
    worksheetIds: string[]
  ): Promise<ReorderWorksheetsResponse> {
    return traced(
      'HTTP PUT /worksheets/order',
      { method: 'PUT', path: '/worksheets/order' },
      undefined,
      Effect.flatMap(client, (api) =>
        api.worksheets.reorder({ payload: { worksheetIds } })
      )
    )
  },

  async testConnection(
    connection: UpdateDatabaseConnection,
    databaseId?: string
  ): Promise<ConnectionTestResponse> {
    const target = databaseId === undefined ? {} : { databaseId }

    return traced(
      'HTTP POST /connection-tests',
      { method: 'POST', path: '/connection-tests' },
      undefined,
      Effect.flatMap(client, (api) =>
        connection.type === 'sqlite'
          ? api.connectionTests.create({
              payload: { ...connection, ...target }
            })
          : api.connectionTests.create({
              payload: { ...connection, ...target }
            })
      )
    )
  },

  async updateDatabase(
    databaseId: string,
    request: UpdateDatabaseRequest
  ): Promise<UpdateDatabaseResponse> {
    return traced(
      'HTTP PATCH /databases/:id',
      { method: 'PATCH', path: `/databases/${databaseId}` },
      undefined,
      Effect.flatMap(client, (api) =>
        request.type === 'sqlite'
          ? api.databases.update({ path: { id: databaseId }, payload: request })
          : api.databases.update({ path: { id: databaseId }, payload: request })
      )
    )
  },

  async updateWorksheet(
    worksheetId: string,
    updates: UpdateWorksheetRequest
  ): Promise<WorksheetDto> {
    const data = await traced(
      'HTTP PATCH /worksheets/:id',
      { method: 'PATCH', path: `/worksheets/${worksheetId}` },
      undefined,
      Effect.flatMap(client, (api) =>
        api.worksheets.update({ path: { id: worksheetId }, payload: updates })
      )
    )

    return data.worksheet
  }
}

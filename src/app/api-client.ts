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
import { Cause, Effect, Exit, FiberRef, ManagedRuntime, Option } from 'effect'

import { SquealApi } from '@/glue/api/api'
import type {
  ConnectionTestResponse,
  CreateDatabaseRequest,
  CreateDatabaseResponse,
  CreateQueryResponse,
  CreateWorksheetRequest,
  DatabaseDto,
  DatabaseType,
  ListTracesUrlParams,
  QueryDto,
  ReorderDatabasesResponse,
  ReorderWorksheetsResponse,
  SchemaInfoDto,
  SpanDto,
  TraceSummaryDto,
  UpdateConnectionInfo,
  UpdateDatabaseRequest,
  UpdateDatabaseResponse,
  UpdateWorksheetRequest,
  WorksheetDto
} from '@/glue/api/schemas'
import { ApiError } from '@/errors'
import { SpanContext, SpanRecord } from '@/glue/tracing/spans'
import { formatTraceparent } from '@/glue/tracing/traceparent'

import { startSpan } from './tracing/tracer'

const baseUrl = 'http://127.0.0.1:7847'

export interface GetHealthResponse {
  encryptionAvailable: boolean
  status: string
}

let apiTokenPromise: Promise<string> | undefined

function getApiToken(): Promise<string> {
  apiTokenPromise ??= window.electron.getApiToken()

  return apiTokenPromise
}

// The renderer's tracer is hand-rolled (no fiber context to inherit), so the
// traceparent for the current call travels through a FiberRef that the
// request transform reads.
const currentTraceparent = FiberRef.unsafeMake<string | undefined>(undefined)

const runtime = ManagedRuntime.make(FetchHttpClient.layer)

const client = HttpApiClient.make(SquealApi, {
  baseUrl,
  transformClient: (httpClient) =>
    httpClient.pipe(
      HttpClient.mapRequestEffect((request) =>
        Effect.gen(function* () {
          const token = yield* Effect.promise(getApiToken)
          const traceparent = yield* FiberRef.get(currentTraceparent)

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
      // The spans below carry the traceparent explicitly; the client's own
      // propagation would inject a competing one.
      HttpClient.withTracerPropagation(false)
    )
})

// Infrastructure failures the API contract does not describe. They carry
// `_tag` like domain errors but reference the whole request/response, so they
// are flattened into an ApiError instead of being handed to callers.
const infrastructureTags = new Set([
  'ParseError',
  'RequestError',
  'ResponseError'
])

// Domain errors reach the caller as themselves so hooks can discriminate on
// `_tag`; decode and transport failures become ApiError, which existing
// catch-alls and the database form's field mapping already understand.
function toThrowable(cause: Cause.Cause<unknown>): unknown {
  const failure = Cause.failureOption(cause)
  const error = Option.isSome(failure) ? failure.value : Cause.squash(cause)

  if (error instanceof HttpApiDecodeError) {
    const details: Record<string, string> = {}

    for (const issue of error.issues) {
      details[issue.path.join('.')] = issue.message
    }

    return new ApiError(400, 'Validation error', details)
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof error._tag === 'string' &&
    !infrastructureTags.has(error._tag)
  ) {
    return error
  }

  const status =
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { status?: number } }).response?.status ===
      'number'
      ? ((error as { response: { status: number } }).response.status ?? 500)
      : 500

  return new ApiError(
    status,
    error instanceof Error
      ? error.message
      : 'The request could not be completed. Please try again.'
  )
}

function run<A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>
): Promise<A> {
  return runtime.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) {
      return exit.value
    }

    throw toThrowable(exit.cause)
  })
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

  return run(
    Effect.locally(effect, currentTraceparent, formatTraceparent(span.context))
  ).then(
    (value) => {
      span.setStatus('ok')
      span.end()

      return value
    },
    (error: unknown) => {
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
      Effect.flatMap(client, (api) =>
        api.databases.create({ payload: request })
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

  async ingestSpans(spans: SpanRecord[]): Promise<{ insertedCount: number }> {
    return run(
      Effect.flatMap(client, (api) => api.traces.ingest({ payload: { spans } }))
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
    connectionInfo: UpdateConnectionInfo,
    type: DatabaseType,
    databaseId?: string
  ): Promise<ConnectionTestResponse> {
    return traced(
      'HTTP POST /connection-tests',
      { method: 'POST', path: '/connection-tests' },
      undefined,
      Effect.flatMap(client, (api) =>
        api.connectionTests.create({
          payload: {
            connectionInfo,
            type,
            ...(databaseId === undefined ? {} : { databaseId })
          }
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
        api.databases.update({ path: { id: databaseId }, payload: request })
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

import { CreateConnectionTestResponse } from '@/databases'
import { SchemaInfo } from '@/databases/adapter'
import {
  CreateDatabaseRequest,
  DatabaseType,
  UpdateConnectionInfo,
  UpdateDatabaseRequest
} from '@/databases/schemas'
import { ApiError } from '@/errors'
import { DatabaseDto } from '@/glue/databases'
import { SpanContext, SpanRecord } from '@/glue/tracing/spans'
import { formatTraceparent } from '@/glue/tracing/traceparent'
import { CreateWorksheetRequest, WorksheetDto } from '@/glue/worksheets'
import {
  CreateQueryResponse,
  GetQueriesResponse,
  GetQueryResponse,
  QueryDto
} from '@/main/queries'
import type {
  GetTraceResponse,
  GetTracesResponse,
  IngestSpansResponse,
  SpanDto,
  TraceSummaryDto
} from '@/main/tracing/routes'
import {
  CreateWorksheetResponse,
  ListWorksheetsResponse,
  ReorderWorksheetsResponse,
  UpdateWorksheetResponse
} from '@/main/worksheets'

import { startSpan } from './tracing/tracer'

const baseUrl = 'http://127.0.0.1:7847'

interface CreateDatabaseResponse {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

interface GetDatabasesResponse {
  databases: DatabaseDto[]
}

interface GetHealthResponse {
  encryptionAvailable: boolean
  status: string
}

interface GetSchemaResponse {
  schema: SchemaInfo
}

interface ReorderDatabasesResponse {
  databases: DatabaseDto[]
}

interface UpdateDatabaseResponse {
  database: DatabaseDto
}

interface ApiErrorResponse {
  error: {
    details?: Record<string, string>
    message: string
    status: number
  }
}

interface RequestOptions {
  body?: unknown
  method?: string
  traceParent?: SpanContext
}

const pollPathPattern = /^\/queries\/[^/]+$/
const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

// Health checks, the trace API itself, and the 250ms result poller would
// only produce noise (or feedback loops) as spans.
function shouldTrace(method: string, path: string): boolean {
  if (
    path === '/health' ||
    path === '/traces' ||
    path.startsWith('/traces/') ||
    path.startsWith('/traces?')
  ) {
    return false
  }

  return !(method === 'GET' && pollPathPattern.test(path))
}

// Collapses ids so requests group under one span name in the trace list.
function spanName(method: string, path: string): string {
  const pathname = path.split('?')[0] ?? path

  return `HTTP ${method} ${pathname.replace(uuidPattern, ':id')}`
}

let apiTokenPromise: Promise<string> | undefined

function getApiToken(): Promise<string> {
  apiTokenPromise ??= window.electron.getApiToken()

  return apiTokenPromise
}

function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as ApiErrorResponse).error === 'object'
  )
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json()

  if (isApiErrorResponse(data)) {
    throw new ApiError(
      data.error.status,
      data.error.message,
      data.error.details
    )
  }

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText)
  }

  return data as T
}

async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method ?? 'GET'
  const span = shouldTrace(method, path)
    ? startSpan(spanName(method, path), {
        attributes: {
          'http.method': method,
          'http.url': `${baseUrl}${path}`
        },
        kind: 'client',
        parent: options.traceParent
      })
    : undefined

  try {
    const token = await getApiToken()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }

    if (span) {
      headers.traceparent = formatTraceparent(span.context)
    }

    const response = await fetch(`${baseUrl}${path}`, {
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method
    })

    span?.setAttribute('http.status_code', response.status)

    if (response.ok) {
      span?.setStatus('ok')
    }

    // Error responses throw here, so the catch below records them.
    return await handleResponse<T>(response)
  } catch (error) {
    span?.recordException(error)

    throw error
  } finally {
    span?.end()
  }
}

export const apiClient = {
  async createWorksheet(
    request: CreateWorksheetRequest
  ): Promise<WorksheetDto> {
    const data = await apiRequest<CreateWorksheetResponse>('/worksheets', {
      body: request,
      method: 'POST'
    })

    return data.worksheet
  },

  async createDatabase(
    request: CreateDatabaseRequest
  ): Promise<CreateDatabaseResponse> {
    return apiRequest<CreateDatabaseResponse>('/databases', {
      body: request,
      method: 'POST'
    })
  },

  async deleteDatabase(databaseId: string): Promise<void> {
    await apiRequest<{ success: boolean }>(`/databases/${databaseId}`, {
      method: 'DELETE'
    })
  },

  async getDatabases(): Promise<DatabaseDto[]> {
    const data = await apiRequest<GetDatabasesResponse>('/databases')

    return data.databases
  },

  async getHealth(): Promise<GetHealthResponse> {
    return apiRequest<GetHealthResponse>('/health')
  },

  async getWorksheets(): Promise<WorksheetDto[]> {
    const data = await apiRequest<ListWorksheetsResponse>('/worksheets')

    return data.worksheets
  },

  async getDatabaseSchema(databaseId: string): Promise<SchemaInfo> {
    const data = await apiRequest<GetSchemaResponse>(
      `/databases/${databaseId}/schema`
    )

    return data.schema
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
    return apiRequest<CreateQueryResponse>('/queries', {
      body: request,
      method: 'POST',
      ...(options.traceParent === undefined
        ? {}
        : { traceParent: options.traceParent })
    })
  },

  async cancelQuery(queryId: string): Promise<void> {
    await apiRequest<{ success: boolean }>(`/queries/${queryId}/cancel`, {
      method: 'POST'
    })
  },

  async getQueries(): Promise<QueryDto[]> {
    const data = await apiRequest<GetQueriesResponse>('/queries')

    return data.queries
  },

  async getQuery(queryId: string): Promise<QueryDto> {
    const data = await apiRequest<GetQueryResponse>(`/queries/${queryId}`)

    return data.query
  },

  async getTraces(
    params: {
      before?: number
      errorOnly?: boolean
      limit?: number
      search?: string
    } = {}
  ): Promise<TraceSummaryDto[]> {
    const searchParams = new URLSearchParams()

    if (params.before !== undefined) {
      searchParams.set('before', String(params.before))
    }

    if (params.errorOnly) {
      searchParams.set('errorOnly', 'true')
    }

    if (params.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }

    if (params.search) {
      searchParams.set('search', params.search)
    }

    const query = searchParams.toString()
    const data = await apiRequest<GetTracesResponse>(
      query ? `/traces?${query}` : '/traces'
    )

    return data.traces
  },

  async getTraceSpans(traceId: string): Promise<SpanDto[]> {
    const data = await apiRequest<GetTraceResponse>(`/traces/${traceId}`)

    return data.spans
  },

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResponse> {
    return apiRequest<IngestSpansResponse>('/traces/spans', {
      body: { spans },
      method: 'POST'
    })
  },

  async reorderDatabases(
    databaseIds: string[]
  ): Promise<ReorderDatabasesResponse> {
    return apiRequest<ReorderDatabasesResponse>('/databases/order', {
      body: { databaseIds },
      method: 'PUT'
    })
  },

  async reorderWorksheets(
    worksheetIds: string[]
  ): Promise<ReorderWorksheetsResponse> {
    return apiRequest<ReorderWorksheetsResponse>('/worksheets/order', {
      body: { worksheetIds },
      method: 'PUT'
    })
  },

  async testConnection(
    connectionInfo: UpdateConnectionInfo,
    type: DatabaseType,
    databaseId?: string
  ): Promise<CreateConnectionTestResponse> {
    return apiRequest<CreateConnectionTestResponse>('/connection-tests', {
      body: { connectionInfo, databaseId, type },
      method: 'POST'
    })
  },

  async updateDatabase(
    databaseId: string,
    request: UpdateDatabaseRequest
  ): Promise<UpdateDatabaseResponse> {
    return apiRequest<UpdateDatabaseResponse>(`/databases/${databaseId}`, {
      body: request,
      method: 'PATCH'
    })
  },

  async updateWorksheet(
    worksheetId: string,
    updates: {
      databaseId?: string | null
      content?: string
      lastOpenedAt?: number
      name?: string
    }
  ): Promise<WorksheetDto> {
    const data = await apiRequest<UpdateWorksheetResponse>(
      `/worksheets/${worksheetId}`,
      {
        body: updates,
        method: 'PATCH'
      }
    )

    return data.worksheet
  }
}

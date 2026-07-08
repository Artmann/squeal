import { CreateConnectionTestResponse } from '@/databases'
import { SchemaInfo } from '@/databases/adapter'
import {
  ConnectionInfo,
  CreateDatabaseRequest,
  DatabaseType
} from '@/databases/schemas'
import { ApiError } from '@/errors'
import { DatabaseDto } from '@/glue/databases'
import { CreateWorksheetRequest, WorksheetDto } from '@/glue/worksheets'
import {
  CreateQueryResponse,
  GetQueriesResponse,
  GetQueryResponse,
  QueryDto
} from '@/main/queries'
import {
  CreateWorksheetResponse,
  ListWorksheetsResponse,
  UpdateWorksheetResponse
} from '@/main/worksheets'

const baseUrl = 'http://127.0.0.1:7847'

interface CreateDatabaseResponse {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

interface GetDatabasesResponse {
  databases: DatabaseDto[]
}

interface GetSchemaResponse {
  schema: SchemaInfo
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
  const token = await getApiToken()

  const response = await fetch(`${baseUrl}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    method: options.method ?? 'GET'
  })

  return handleResponse<T>(response)
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

  async getDatabases(): Promise<DatabaseDto[]> {
    const data = await apiRequest<GetDatabasesResponse>('/databases')

    return data.databases
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

  async createQuery(request: {
    content: string
    databaseId?: string
    id: string
    queriedAt: number
    worksheetId: string
  }): Promise<CreateQueryResponse> {
    return apiRequest<CreateQueryResponse>('/queries', {
      body: request,
      method: 'POST'
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

  async testConnection(
    connectionInfo: ConnectionInfo,
    type: DatabaseType
  ): Promise<CreateConnectionTestResponse> {
    return apiRequest<CreateConnectionTestResponse>('/connection-tests', {
      body: { connectionInfo, type },
      method: 'POST'
    })
  },

  async updateDatabase(
    databaseId: string,
    request: CreateDatabaseRequest
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

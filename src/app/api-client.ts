import { CreateConnectionTestResponse } from '@/databases'
import {
  CreateDatabaseRequest,
  PostgresConnectionInfo
} from '@/databases/schemas'
import { ApiError } from '@/errors'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { CreateQueryResponse, GetQueryResponse, QueryDto } from '@/main/queries'
import { UpdateWorksheetResponse } from '@/main/worksheets'

const baseUrl = 'http://localhost:7847'

interface CreateDatabaseResponse {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
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

export const apiClient = {
  async createDatabase(
    request: CreateDatabaseRequest
  ): Promise<CreateDatabaseResponse> {
    const response = await fetch(`${baseUrl}/databases`, {
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    return handleResponse<CreateDatabaseResponse>(response)
  },

  async createQuery(request: {
    content: string
    databaseId: string
    id: string
    queriedAt: number
    worksheetId: string
  }): Promise<CreateQueryResponse> {
    const response = await fetch(`${baseUrl}/queries`, {
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    return handleResponse<CreateQueryResponse>(response)
  },

  async getQuery(queryId: string): Promise<QueryDto> {
    const response = await fetch(`${baseUrl}/queries/${queryId}`)
    const data = await handleResponse<GetQueryResponse>(response)

    return data.query
  },

  async testConnection(
    connectionInfo: PostgresConnectionInfo
  ): Promise<CreateConnectionTestResponse> {
    const response = await fetch(`${baseUrl}/connection-tests`, {
      body: JSON.stringify({ connectionInfo }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    return handleResponse<CreateConnectionTestResponse>(response)
  },

  async updateDatabase(
    databaseId: string,
    request: CreateDatabaseRequest
  ): Promise<UpdateDatabaseResponse> {
    const response = await fetch(`${baseUrl}/databases/${databaseId}`, {
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH'
    })

    return handleResponse<UpdateDatabaseResponse>(response)
  },

  async updateWorksheet(
    worksheetId: string,
    updates: { databaseId?: string | null; name?: string }
  ): Promise<WorksheetDto> {
    const response = await fetch(`${baseUrl}/worksheets/${worksheetId}`, {
      body: JSON.stringify(updates),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH'
    })

    const data = await handleResponse<UpdateWorksheetResponse>(response)

    return data.worksheet
  }
}

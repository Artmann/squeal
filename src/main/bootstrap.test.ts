import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorksheetDto } from '@/glue/worksheets'
import { DatabaseDto } from '@/glue/databases'

const mockListWorksheets = vi.fn()
const mockCreateWorksheet = vi.fn()
const mockListDatabases = vi.fn()

vi.mock('./worksheets/worksheet-service', () => ({
  WorksheetService: class {
    listWorksheets = mockListWorksheets
    createWorksheet = mockCreateWorksheet
  }
}))

vi.mock('./databases/database-service', () => ({
  DatabaseService: class {
    listDatabases = mockListDatabases
  }
}))

import { bootstrap } from './bootstrap'

describe('bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListDatabases.mockResolvedValue([])
  })

  it('should set lastOpenWorksheetId to the worksheet with the most recent lastOpenedAt', async () => {
    const worksheets: WorksheetDto[] = [
      {
        id: 'ws-1',
        name: 'First',
        content: '',
        createdAt: 1000,
        databaseId: null,
        lastOpenedAt: 100
      },
      {
        id: 'ws-2',
        name: 'Second',
        content: '',
        createdAt: 2000,
        databaseId: null,
        lastOpenedAt: 300
      },
      {
        id: 'ws-3',
        name: 'Third',
        content: '',
        createdAt: 3000,
        databaseId: null,
        lastOpenedAt: 200
      }
    ]

    mockListWorksheets.mockResolvedValue(worksheets)

    const result = await bootstrap()

    expect(result.lastOpenWorksheetId).toEqual('ws-2')
  })

  it('should return undefined lastOpenWorksheetId when no worksheet has lastOpenedAt', async () => {
    const worksheets: WorksheetDto[] = [
      {
        id: 'ws-1',
        name: 'First',
        content: '',
        createdAt: 1000,
        databaseId: null,
        lastOpenedAt: null
      },
      {
        id: 'ws-2',
        name: 'Second',
        content: '',
        createdAt: 2000,
        databaseId: null,
        lastOpenedAt: null
      }
    ]

    mockListWorksheets.mockResolvedValue(worksheets)

    const result = await bootstrap()

    expect(result.lastOpenWorksheetId).toBeUndefined()
  })

  it('should create a default worksheet if none exist', async () => {
    const defaultWorksheet: WorksheetDto = {
      id: 'ws-default',
      name: 'My First Worksheet',
      content: '',
      createdAt: 1000,
      databaseId: null,
      lastOpenedAt: null
    }

    mockListWorksheets.mockResolvedValue([])
    mockCreateWorksheet.mockResolvedValue(defaultWorksheet)

    const result = await bootstrap()

    expect(mockCreateWorksheet).toHaveBeenCalledWith('My First Worksheet')
    expect(result.worksheets).toHaveLength(1)
    expect(result.worksheets[0].id).toEqual('ws-default')
  })
})

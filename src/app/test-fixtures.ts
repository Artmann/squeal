// DTO builders for renderer tests. Each test writes only the fields it cares
// about, so a field added to a DTO is one change here rather than one in every
// suite. Defaults follow what most of the hand-written literals used.
import type { DatabaseDto } from '@/glue/databases'
import type { WorksheetDto } from '@/glue/worksheets'

export function makeDatabase(
  overrides: Partial<DatabaseDto> = {}
): DatabaseDto {
  return {
    connectionInfo: {
      database: 'testdb',
      host: 'localhost',
      port: 5432,
      username: 'admin'
    },
    createdAt: 1704067200000,
    environmentId: null,
    id: 'db-123',
    name: 'Test Database',
    sortOrder: null,
    type: 'postgres',
    ...overrides
  }
}

export function makeWorksheet(
  overrides: Partial<WorksheetDto> = {}
): WorksheetDto {
  return {
    content: '',
    createdAt: 1704067200000,
    databaseId: null,
    id: 'ws-1',
    lastOpenedAt: null,
    name: 'Test Worksheet',
    sortOrder: null,
    ...overrides
  }
}

import { database } from '@/database'
import { queriesTable } from '@/database/schema'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { QueryDto } from './queries'
import { DatabaseService } from './databases/database-service'
import { WorksheetService } from './worksheets/worksheet-service'

export interface BootstrapData {
  apiPort: number
  databases: DatabaseDto[]
  lastOpenWorksheetId?: string
  queries: QueryDto[]
  worksheets: WorksheetDto[]
}

export async function bootstrap(): Promise<BootstrapData> {
  const databaseService = new DatabaseService()
  const worksheetService = new WorksheetService()

  const [databases, worksheets, queryRows] = await Promise.all([
    databaseService.listDatabases(),
    worksheetService.listWorksheets(),
    database.select().from(queriesTable).limit(250)
  ])

  const queries: QueryDto[] = queryRows.map((row) => ({
    content: row.content,
    databaseId: row.databaseId,
    error: row.error ?? null,
    finishedAt: row.finishedAt ?? null,
    id: row.id,
    queriedAt: row.queriedAt,
    result: row.result ? JSON.parse(row.result) : null,
    worksheetId: row.worksheetId
  }))

  if (worksheets.length === 0) {
    const defaultWorksheet =
      await worksheetService.createWorksheet('My First Worksheet')

    worksheets.push(defaultWorksheet)
  }

  // Find the most recently opened worksheet
  let lastOpenWorksheetId: string | undefined
  let maxLastOpenedAt = 0

  for (const worksheet of worksheets) {
    if (
      worksheet.lastOpenedAt !== null &&
      worksheet.lastOpenedAt > maxLastOpenedAt
    ) {
      maxLastOpenedAt = worksheet.lastOpenedAt
      lastOpenWorksheetId = worksheet.id
    }
  }

  return {
    apiPort: 7847,
    databases,
    lastOpenWorksheetId,
    queries,
    worksheets
  }
}

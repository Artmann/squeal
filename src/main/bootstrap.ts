import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { DatabaseService } from './databases/database-service'
import { WorksheetService } from './worksheets/worksheet-service'

export interface BootstrapData {
  apiPort: number
  databases: DatabaseDto[]
  worksheets: WorksheetDto[]
}

export async function bootstrap(): Promise<BootstrapData> {
  const databaseService = new DatabaseService()
  const worksheetService = new WorksheetService()

  const [databases, worksheets] = await Promise.all([
    databaseService.listDatabases(),
    worksheetService.listWorksheets()
  ])

  if (worksheets.length === 0) {
    const defaultWorksheet =
      await worksheetService.createWorksheet('My First Worksheet')

    worksheets.push(defaultWorksheet)
  }

  return {
    apiPort: 7847,
    databases,
    worksheets
  }
}

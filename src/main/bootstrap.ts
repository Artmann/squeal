import { WorksheetDto } from '@/glue/worksheets'
import { WorksheetService } from './worksheets/worksheet-service'

export interface BootstrapData {
  apiPort: number
  worksheets: WorksheetDto[]
}

export async function bootstrap(): Promise<BootstrapData> {
  const worksheetService = new WorksheetService()

  let worksheets = await worksheetService.listWorksheets()

  if (worksheets.length === 0) {
    const defaultWorksheet =
      await worksheetService.createWorksheet('My First Worksheet')

    worksheets = [defaultWorksheet]
  }

  return {
    apiPort: 7847,
    worksheets
  }
}
